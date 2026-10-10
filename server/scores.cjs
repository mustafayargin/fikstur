'use strict';
const {randomUUID}=require('node:crypto');
const {contextualMatch,parseDate,normalizeName,key,Fault}=require('./policy.cjs');
const valid=(a,b)=>[a,b].every(v=>v!==null&&v!==undefined&&v!==''&&Number.isInteger(Number(v))&&Number(v)>=0);
// Temporary test mode; published-week and authentication checks still apply.
const USER_MANUAL_SCORE_TEST_MODE=true;
const yes=v=>v===true||v===1||v==='1'||v==='true';
const finalStatus=s=>/^(ft|aet|pen|finished|match finished|full time|full-time|after extra time|after penalties|bitti)$/i.test(s);
const lockActive=(record,now)=>!!record?.owner&&now-Number(record.startedAt)<90000;
async function scoreScope(db,actor,payload){
  const weekId=key(payload.weekId),seasonId=key(payload.seasonId);
  const settings=(await db.ref('settings').get()).val()||{};
  const week=Object.values(settings.weeksMeta||{}).find(w=>String(w.id)===weekId&&String(w.seasonId)===seasonId);
  if(!week)throw new Fault(404,'Seçili hafta bulunamadı.');
  if(!actor.admin&&!['aktif','yayinlandi','tamamlandi'].includes(week.status))throw new Fault(403,'Bu hafta henüz yayınlanmadı.');
  return {weekId,seasonId,settings,week};
}
async function scoreSyncStatus(db,actor,payload={}, {now=Date.now()}={}){
  const {weekId}=await scoreScope(db,actor,payload);
  const record=(await db.ref(`serverPrivate/scoreSync/${weekId}`).get()).val()||{};
  return {success:true,checked:false,pending:lockActive(record,now),finishedAt:Number(record.lastSuccessAt||0),startedAt:Number(record.startedAt||0),retryAfterMs:Math.max(0,10*60000-(now-Number(record.lastSuccessAt||0)))};
}
// Only provider fields change. No user, prediction, identity, week or manual result writes.
function scorePatch(match,event,now=Date.now()) {
  if(yes(match.manualScoreLocked ?? match.manualScoreLock ?? match.manuelSkorKilitli))return null;
  const status=String(event.strStatus||'').trim().toLowerCase();
  const postponed=String(event.strPostponed||'').toLowerCase()==='yes'||/postponed|delayed|deferred|suspended|abandoned|cancelled/.test(status);
  const finished=finalStatus(status),hasScore=valid(event.intHomeScore,event.intAwayScore);
  const started=/live|in play|in progress|^(ht|1h|2h|halftime|half time|half-time|first half|second half)$/.test(status)||parseDate(match.date||match.tarih)<=now;
  const played=yes(match.played ?? match.oynandiMi);
  if(played&&!finished)return null; // Old live responses cannot undo a final result.
  const patch={statusText:status,postponed};
  if(postponed){patch.liveHomeScore=null;patch.liveAwayScore=null;patch.liveScoreUpdatedAt='';}
  else if(hasScore&&finished){
    Object.assign(patch,{homeScore:Number(event.intHomeScore),awayScore:Number(event.intAwayScore),evGol:Number(event.intHomeScore),depGol:Number(event.intAwayScore),played:true,oynandiMi:1,liveHomeScore:null,liveAwayScore:null,liveScoreUpdatedAt:''});
  }else if(hasScore&&started&&!played){
    Object.assign(patch,{liveHomeScore:Number(event.intHomeScore),liveAwayScore:Number(event.intAwayScore)});
    if(Number(match.liveHomeScore)!==patch.liveHomeScore||Number(match.liveAwayScore)!==patch.liveAwayScore||!valid(match.liveHomeScore,match.liveAwayScore))patch.liveScoreUpdatedAt=new Date(now).toISOString();
  }
  const changed=Object.entries(patch).some(([key,value])=>(match[key]??null)!==value);
  return changed?patch:null;
}
async function syncScores(db,actor,payload={}, {fetchImpl=fetch,now=Date.now()}={}) {
  const {weekId,seasonId,settings,week}=await scoreScope(db,actor,payload);
  const force=(actor.admin||USER_MANUAL_SCORE_TEST_MODE)&&payload.force===true;
  const lock=db.ref(`serverPrivate/scoreSync/${weekId}`),owner=randomUUID();
  const claim=await lock.transaction(old=>{
    if(lockActive(old,now))return;
    if(!force&&now-Number(old?.lastSuccessAt||0)<10*60000)return;
    return {...old,owner,startedAt:now,lastAttemptAt:now};
  });
  if(!claim.committed){
    const previous=claim.snapshot.val()||{};
    if(lockActive(previous,now))return {success:true,checked:false,pending:true,startedAt:Number(previous.startedAt),finishedAt:Number(previous.lastSuccessAt||0)};
    return {success:true,checked:false,finishedAt:Number(previous.lastSuccessAt||0),checkedCount:0,updatedCount:0,retryAfterMs:Math.max(0,10*60000-(now-Number(previous.lastSuccessAt||0)))};
  }
  try{
    const matches=(await db.ref('matches').get()).val()||{};
    const scopedMatches=Object.entries(matches).filter(([,row])=>{
      const match=contextualMatch(row,settings);
      return match.seasonId===seasonId&&match.weekId===weekId;
    });
    if(!scopedMatches.length)throw new Fault(409,'Seçili haftanın maçları ortak Firebase kaydında bulunamadı. Hafta kaydını kontrol edin.');
    const candidates=scopedMatches.filter(([,row])=>!yes(row.manualScoreLocked ?? row.manualScoreLock ?? row.manuelSkorKilitli));
    if(candidates.length>24)throw new Fault(400,'Hafta maç sayısı beklenen sınırı aşıyor.');
    let updated=0,failures=0,checked=0;
    const requestDeadline=Date.now()+45000;
    const needsFinalCheck=(event,row)=>!finalStatus(String(event?.strStatus||'').trim())&&parseDate(row.date||row.tarih)+105*60000<=now&&!/postponed|delayed|deferred|suspended|abandoned|cancelled/i.test(String(event?.strStatus||''));
    const apiKey=process.env.SPORTSDB_API_KEY||'123';
    const fetchEvents=async suffix=>{
      try {
        const response=await fetchImpl(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/${suffix}`,{signal:AbortSignal.timeout(Math.max(1,Math.min(12000,requestDeadline-Date.now()))),cache:'no-store'});
        if(!response.ok)throw Error('Provider HTTP failure');
        const data=await response.json();return Array.isArray(data.events)?data.events:[];
      } catch { throw new Fault(502,'Skor kaynağına ulaşılamadı veya yanıtı okunamadı. Yeniden deneyin.'); }
    };
    // Use the same week/season sources as the Weeks screen, for every role.
    const season=Object.values(settings.seasonsMeta||{}).find(s=>String(s.id)===seasonId);
    let roundEvents=[],seasonEvents=[];
    if(candidates.length){
      if(!season?.name)throw new Fault(409,'API sezon bilgisi bulunamadı.');
      try{roundEvents=await fetchEvents(`eventsround.php?id=4339&r=${encodeURIComponent(week.number)}&s=${encodeURIComponent(season.name)}`);}catch{}
      const findEvent=(events,row)=>events.filter(e=>row.apiId?String(e.idEvent)===String(row.apiId):normalizeName(e.strHomeTeam)===normalizeName(row.homeTeam||row.evSahibi)&&normalizeName(e.strAwayTeam)===normalizeName(row.awayTeam||row.deplasman));
      if(candidates.some(([,row])=>{const found=findEvent(roundEvents,row);return found.length!==1||!valid(found[0].intHomeScore,found[0].intAwayScore)||needsFinalCheck(found[0],row);})){
        try{seasonEvents=await fetchEvents(`eventsseason.php?id=4339&s=${encodeURIComponent(season.name)}`);}catch{}
      }
    }
    for(let offset=0;offset<candidates.length;offset+=4){
      await Promise.all(candidates.slice(offset,offset+4).map(async([id,original])=>{
        try{
          const findEvent=events=>events.filter(e=>original.apiId?String(e.idEvent)===String(original.apiId):normalizeName(e.strHomeTeam)===normalizeName(original.homeTeam||original.evSahibi)&&normalizeName(e.strAwayTeam)===normalizeName(original.awayTeam||original.deplasman));
          const round=findEvent(roundEvents),season=findEvent(seasonEvents);
          let event=round.length===1?round[0]:null;
          if(season.length===1&&(!event||!valid(event.intHomeScore,event.intAwayScore)||(!finalStatus(String(event.strStatus||'').trim())&&finalStatus(String(season[0].strStatus||'').trim()))))event=season[0];
          if((!event||needsFinalCheck(event,original))&&/^\d+$/.test(String(original.apiId||''))){
            const found=findEvent(await fetchEvents(`lookupevent.php?id=${encodeURIComponent(original.apiId)}`));
            if(found.length===1&&(!event||finalStatus(String(found[0].strStatus||'').trim())||!valid(event.intHomeScore,event.intAwayScore)))event=found[0];
          }
          if(!event)throw Error('Provider event missing');
          // Transaction retries use current data, preserving concurrent admin edits and deletes.
          const result=await db.ref(`matches/${id}`).transaction(current=>{
            if(!current||String(current.apiId||'')!==String(original.apiId||'')||current.date!==original.date||String(current.weekId||'')!==String(original.weekId||'')||String(current.seasonId||'')!==String(original.seasonId||''))return;
            const patch=scorePatch(current,event,now);
            if(!patch)return;
            return {...current,...patch};
          });
          if(result.committed)updated++;
          checked++;
        }catch{failures++;}
      }));
    }
    if(failures)throw new Fault(502,'Bazı maçlarda API kontrolü veya Firebase kaydı tamamlanamadı. Başarılı kayıtlar korundu; yeniden deneyin.');
    const finishedAt=Date.now();
    await db.ref('settings').update({resultsLastAutoSyncAt:finishedAt,manualScoreLastSuccessAt:finishedAt});
    await lock.transaction(old=>old?.owner===owner?{...old,owner:null,lastSuccessAt:finishedAt}:undefined);
    return {success:true,checked:true,updatedCount:updated,checkedCount:checked,finishedAt,retryAfterMs:10*60000};
  }catch(error){
    await lock.transaction(old=>old?.owner===owner?{...old,owner:null}:undefined);
    throw error;
  }
}
module.exports={scorePatch,syncScores,scoreSyncStatus};
