'use strict';
const {randomUUID}=require('node:crypto');
const {contextualMatch,parseDate,normalizeName,key,Fault}=require('./policy.cjs');
const valid=(a,b)=>[a,b].every(v=>v!==null&&v!==undefined&&v!==''&&Number.isInteger(Number(v))&&Number(v)>=0);
// Temporary test mode; published-week and authentication checks still apply.
const USER_MANUAL_SCORE_TEST_MODE=true;
const yes=v=>v===true||v===1||v==='1'||v==='true';
const finalStatus=s=>/^(ft|aet|pen|finished|match finished|full time|full-time|after extra time|after penalties|bitti)$/i.test(s);
const lockActive=(record,now)=>!!record?.owner&&now-Number(record.startedAt)<90000;
function scoreSignature(row){
  const n=v=>v===null||v===undefined||v===''?null:Number(v);
  return JSON.stringify([yes(row.played??row.oynandiMi),n(row.homeScore??row.evGol),n(row.awayScore??row.depGol),n(row.liveHomeScore),n(row.liveAwayScore),String(row.statusText||'').trim().toLowerCase(),yes(row.manualScoreLocked??row.manualScoreLock??row.manuelSkorKilitli)]);
}
function scoreFault(code,message,status=502){const error=new Fault(status,message);error.publicCode=code;return error;}
function safeStage(error){return error.publicCode||'SCORE_INTERNAL';}
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
  return {success:true,checked:false,failed:!lockActive(record,now)&&Number(record.lastFailureAt||0)>=Number(record.startedAt||0)&&Number(record.lastSuccessAt||0)<Number(record.startedAt||0),failureMessage:record.failureMessage||"",pending:lockActive(record,now),verifiedScores:record.verifiedScores||[],verifiedMatchIds:record.verifiedMatchIds||[],finishedAt:Number(record.lastSuccessAt||0),startedAt:Number(record.startedAt||0),retryAfterMs:Math.max(0,10*60000-(now-Number(record.lastSuccessAt||0)))};
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
    return {...old,owner,startedAt:now,lastAttemptAt:now,lastFailureAt:0,failureMessage:""};
  });
  if(!claim.committed){
    const previous=claim.snapshot.val()||{};
    if(lockActive(previous,now))return {success:true,checked:false,pending:true,startedAt:Number(previous.startedAt),finishedAt:Number(previous.lastSuccessAt||0)};
    return {success:true,checked:false,finishedAt:Number(previous.lastSuccessAt||0),checkedCount:0,updatedCount:0,verifiedScores:previous.verifiedScores||[],verifiedMatchIds:previous.verifiedMatchIds||[],retryAfterMs:Math.max(0,10*60000-(now-Number(previous.lastSuccessAt||0)))};
  }
  let stage='MATCHES_READ';
  const failuresDetail=[];
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
    const providerErrors=[];
    const verifiedMatchIds=[],verifiedScores=[];
    const requestDeadline=Date.now()+45000;
    const needsFinalCheck=(event,row)=>!finalStatus(String(event?.strStatus||'').trim())&&parseDate(row.date||row.tarih)+105*60000<=now&&!/postponed|delayed|deferred|suspended|abandoned|cancelled/i.test(String(event?.strStatus||''));
    const apiKey=process.env.SPORTSDB_API_KEY||'123';
    const fetchEvents=async suffix=>{
      const source=suffix.split('?')[0];
      let response;
      try{response=await fetchImpl(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/${suffix}`,{signal:AbortSignal.timeout(Math.max(1,Math.min(12000,requestDeadline-Date.now()))),cache:'no-store'});}
      catch(error){throw scoreFault(error.name==='TimeoutError'||error.name==='AbortError'?'API_TIMEOUT':'API_NETWORK',`${source}: skor kaynağı bağlantısı ${error.name==='TimeoutError'||error.name==='AbortError'?'zaman aşımına uğradı':'kurulamadı'}.`);}
      if(!response.ok)throw scoreFault('API_HTTP',`${source}: skor kaynağı HTTP ${Number(response.status)||'hata'} döndürdü.`);
      let data;try{data=await response.json();}catch{throw scoreFault('API_JSON',`${source}: skor kaynağı yanıtı JSON olarak okunamadı.`);}
      if(data?.events!==null&&!Array.isArray(data?.events))throw scoreFault('API_SCHEMA',`${source}: beklenen maç listesi yanıt içinde bulunamadı.`);
      return data.events||[];
    };
    // Use the same week/season sources as the Weeks screen, for every role.
    const season=Object.values(settings.seasonsMeta||{}).find(s=>String(s.id)===seasonId);
    let roundEvents=[],seasonEvents=[];
    if(candidates.length){
      if(!season?.name)throw new Fault(409,'API sezon bilgisi bulunamadı.');
      try{roundEvents=await fetchEvents(`eventsround.php?id=4339&r=${encodeURIComponent(week.number)}&s=${encodeURIComponent(season.name)}`);}catch(error){providerErrors.push(error);}
      const findEvent=(events,row)=>events.filter(e=>row.apiId?String(e.idEvent)===String(row.apiId):normalizeName(e.strHomeTeam)===normalizeName(row.homeTeam||row.evSahibi)&&normalizeName(e.strAwayTeam)===normalizeName(row.awayTeam||row.deplasman));
      if(candidates.some(([,row])=>{const found=findEvent(roundEvents,row);return found.length!==1||!valid(found[0].intHomeScore,found[0].intAwayScore)||needsFinalCheck(found[0],row);})){
        try{seasonEvents=await fetchEvents(`eventsseason.php?id=4339&s=${encodeURIComponent(season.name)}`);}catch(error){providerErrors.push(error);}
      }
    }
    for(let offset=0;offset<candidates.length;offset+=4){
      await Promise.all(candidates.slice(offset,offset+4).map(async([id,original])=>{
        let matchStage="MATCH_MAPPING";
        try{
          const findEvent=events=>events.filter(e=>original.apiId?String(e.idEvent)===String(original.apiId):normalizeName(e.strHomeTeam)===normalizeName(original.homeTeam||original.evSahibi)&&normalizeName(e.strAwayTeam)===normalizeName(original.awayTeam||original.deplasman));
          const round=findEvent(roundEvents),season=findEvent(seasonEvents);
          let event=round.length===1?round[0]:null;
          if(season.length===1&&(!event||!valid(event.intHomeScore,event.intAwayScore)||(!finalStatus(String(event.strStatus||'').trim())&&finalStatus(String(season[0].strStatus||'').trim()))))event=season[0];
          if((!event||needsFinalCheck(event,original))&&/^\d+$/.test(String(original.apiId||''))){
            matchStage='API_LOOKUP';
            const found=findEvent(await fetchEvents(`lookupevent.php?id=${encodeURIComponent(original.apiId)}`));
            if(found.length===1&&(!event||finalStatus(String(found[0].strStatus||'').trim())||!valid(event.intHomeScore,event.intAwayScore)))event=found[0];
          }
          if(!event){
            if(!roundEvents.length&&!seasonEvents.length&&providerErrors.length)throw providerErrors[0];
            throw scoreFault('MATCH_MAPPING',`API yanıtındaki maç ortak kayıttaki API kimliği/takımlarla eşleşmedi (API kimliği: ${String(original.apiId||'yok').slice(0,30)}).`);
          }
          matchStage='FIREBASE_WRITE';
          // Transaction retries use current data, preserving concurrent admin edits and deletes.
          const result=await db.ref(`matches/${id}`).transaction(current=>{
            // A cold SDK cache can supply null before fetching the server value.
            // Returning null lets CAS retry if the server record exists; it cannot recreate a deleted match.
            if(current===null)return null;
            if(!current||String(current.apiId||'')!==String(original.apiId||'')||current.date!==original.date||String(current.weekId||'')!==String(original.weekId||'')||String(current.seasonId||'')!==String(original.seasonId||''))return;
            const patch=scorePatch(current,event,now);
            if(!patch)return;
            return {...current,...patch};
          });
          matchStage='FIREBASE_READ';
          const readback=(await db.ref(`matches/${id}`).get()).val();
          matchStage='FIREBASE_VERIFY';
          if(!readback||String(readback.apiId||'')!==String(original.apiId||'')||contextualMatch(readback,settings).weekId!==weekId||scorePatch(readback,event,now))throw scoreFault('FIREBASE_VERIFY','Geri okunan maç API skoru ve bitiş bilgisiyle eşleşmedi veya maç kaydı değişti.');
          if(result.committed)updated++;
          verifiedMatchIds.push(id);
          verifiedScores.push({id,signature:scoreSignature(readback)});
          checked++;
        }catch(error){
          failures++;
          const code=error.publicCode||matchStage;
          const matchLabel=`${String(original.homeTeam||original.evSahibi||'?').slice(0,60)} - ${String(original.awayTeam||original.deplasman||'?').slice(0,60)}`;
          const detail=error.publicCode?error.message:matchStage==='FIREBASE_WRITE'?'Firebase maç yazması tamamlanamadı.':matchStage==='FIREBASE_READ'?'Yazılan maç Firebase’den geri okunamadı.':'Maç kontrolü tamamlanamadı.';
          failuresDetail.push(`[${code}] ${matchLabel}: ${detail}`);
        }
      }));
    }
    if(failures)throw scoreFault('SCORE_SYNC_FAILED',`${failures} maç doğrulanamadı; ${checked} maç doğrulandı. ${failuresDetail.slice(0,2).join(' ')}${failures>2?' Diğer hatalar sunucu kaydında.':''}`);
    stage='SETTINGS_WRITE';
    const finishedAt=Date.now();
    await db.ref('settings').update({resultsLastAutoSyncAt:finishedAt,manualScoreLastSuccessAt:finishedAt});
    stage='SYNC_COMPLETE';
    await lock.transaction(old=>old?.owner===owner?{...old,owner:null,lastSuccessAt:finishedAt,verifiedMatchIds,verifiedScores,lastFailureAt:0,failureMessage:''}:undefined);
    return {success:true,checked:true,updatedCount:updated,checkedCount:checked,verifiedMatchIds,verifiedScores,finishedAt,retryAfterMs:10*60000};
  }catch(error){
    const failure=error instanceof Fault?error:scoreFault(stage,stage==='MATCHES_READ'?'Ortak maç listesi Firebase’den okunamadı.':stage==='SETTINGS_WRITE'?'Skorlar kontrol edildi fakat ortak güncelleme bilgisi kaydedilemedi.':'Skor kontrolünün ortak durum kaydı tamamlanamadı.');
    console.warn('SKORX_SCORE_SYNC_FAILURE',JSON.stringify({seasonId,weekId,stage:failure.publicCode||stage,message:failure.message,matchFailures:failuresDetail}));
    try{await lock.transaction(old=>old?.owner===owner?{...old,owner:null,lastFailureAt:Date.now(),failureMessage:failure.message}:undefined);}catch{console.warn('SKORX_SCORE_SYNC_STATUS_WRITE_FAILED');}
    throw failure;
  }
}
module.exports={scorePatch,syncScores,scoreSyncStatus};
