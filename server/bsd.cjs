'use strict';
const {Fault}=require('./policy.cjs');
const {footballTeamKey}=require('./provider-identity.cjs');
const fault=(code,message)=>Object.assign(new Fault(502,message),{publicCode:code});
const token=()=>String(process.env.BSD_API_KEY||'').trim().replace(/^Token\s+/i,'');
function normalizeBsdEvent(row,seasonId){
 if(!row||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0||Number(row.league_id)!==11||Number(row.season_id)!==Number(seasonId))throw fault('BSD_SCHEMA','BSD maç kimliği, lig veya sezon bilgisi doğrulanamadı.');
 const at=new Date(row.event_date),round=Number(row.round_number);
 if(!row.home_team||!row.away_team||!Number.isFinite(at.getTime())||!Number.isInteger(round)||round<1||round>60)throw fault('BSD_SCHEMA','BSD takım, tarih veya hafta bilgisi eksik.');
 if(row.stage&&row.stage!=='regular-season')throw fault('BSD_STAGE','BSD maç aşaması Süper Lig normal sezonuyla eşleşmiyor.');
 const statuses={finished:'FT',notstarted:'NS',upcoming:'NS',unresolved:'NS','1st_half':'1H','2nd_half':'2H',halftime:'HT',inprogress:'live',live:'live',extratime:'live',aet:'live',penalties:'live',postponed:'postponed',cancelled:'cancelled',delayed:'delayed'};
 const status=String(row.status||'').toLowerCase();
 if(!Object.hasOwn(statuses,status))throw fault('BSD_STATUS','BSD maç durumu tanınmadı; sonuç değiştirilmedi.');
 const score=v=>v===null||v===undefined||v===''?null:Number(v);
 const h=score(row.home_score),a=score(row.away_score);
 if([h,a].some(v=>v!==null&&(!Number.isInteger(v)||v<0||v>99)))throw fault('BSD_SCORE','BSD skor alanı geçersiz.');
 return {idEvent:`bsd_${row.id}`,idHomeTeam:`bsd_${row.home_team_id}`,idAwayTeam:`bsd_${row.away_team_id}`,strHomeTeam:String(row.home_team),strAwayTeam:String(row.away_team),dateEvent:at.toISOString().slice(0,10),strTime:at.toISOString().slice(11,19),intRound:round,intHomeScore:h,intAwayScore:a,strStatus:statuses[status],strPostponed:/postponed|cancelled|delayed/.test(status)?'yes':'no',provider:'BSD'};
}
function createBsdClient({db,fetchImpl=fetch,deadline=Date.now()+45000}={}){
 // Keep a failing backup attempt bounded within the parent function deadline.
 deadline=Math.min(deadline,Date.now()+25000);
 const requests=new Map(),seasons=new Map();let blocked=null;
 async function request(path){
  if(blocked)throw blocked;
  if(!token())throw fault('BSD_NOT_CONFIGURED','Yedek API için Vercel BSD_API_KEY tanımlanmalı.');
  if(Date.now()>=deadline)throw fault('BSD_TIMEOUT','BSD işlem süresi doldu; yeniden deneyin.');
  if(db){
   const day=new Date().toISOString().slice(0,10);
   const claim=await db.ref(`serverPrivate/providerBudget/bsd/${day}`).transaction(old=>Number(old?.count||0)>=7000?undefined:{count:Number(old?.count||0)+1});
   if(!claim.committed)throw fault('BSD_LOCAL_QUOTA','BSD için ortak günlük 7000 istek bütçesi doldu.');
  }
  let response;
  try{response=await fetchImpl(`https://sports.bzzoiro.com/api/v2/${path}`,{headers:{Accept:'application/json',Authorization:`Token ${token()}`},cache:'no-store',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now())))});}
  catch{throw fault('BSD_NETWORK','BSD bağlantısı kurulamadı veya zaman aşımına uğradı.');}
  if(!response.ok){
   let detail='';
   try {
    const body=await response.json();
    const value=typeof body?.detail==='string'?body.detail:typeof body?.message==='string'?body.message:'';
    detail=value.split(token()).join('[gizli]').replace(/[\r\n\t]+/g,' ').slice(0,300);
   }catch{}
   const endpoint=path.split('?')[0];
   const error=fault('BSD_HTTP',`BSD HTTP ${Number(response.status)} (${endpoint}): yedek veri alınamadı.${detail?` ${detail}`:''} ${response.status===401?'BSD_API_KEY ve e-posta doğrulamasını kontrol edin.':response.status===429?'Sağlayıcı istek sınırını kontrol edin.':''}`);
   // Invalid requests and access failures must not fan out into further calls.
   if([400,401,403,429].includes(Number(response.status)))blocked=error;
   throw error;
  }
  try{return await response.json();}catch{throw fault('BSD_JSON','BSD JSON yanıtı okunamadı.');}
 }
 async function collection(path){
  const rows=[];let expected=null;
  for(let offset=0;offset<2000;offset+=200){
   const data=await request(`${path}${path.includes('?')?'&':'?'}limit=200&offset=${offset}`);
   if(Array.isArray(data))return data;
   if(!Array.isArray(data?.results)||!Number.isInteger(data.count)||data.count<0)throw fault('BSD_SCHEMA','BSD liste yanıtı doğrulanamadı.');
   if(expected!==null&&expected!==data.count)throw fault('BSD_PAGINATION','BSD listesi okunurken değişti; yeniden deneyin.');
   expected=data.count;rows.push(...data.results);
   if(rows.length===expected)return rows;
   if(rows.length>expected||!data.results.length)throw fault('BSD_PAGINATION','BSD sayfaları eksik veya tutarsız.');
  }
  throw fault('BSD_PAGINATION','BSD liste sınırı aşıldı; eksik liste kullanılmadı.');
 }
 async function seasonId(label){
  if(!/^\d{4}-\d{4}$/.test(label))throw fault('BSD_SEASON','Sezon etiketi YYYY-YYYY biçiminde olmalı.');
  if(!seasons.has(label))seasons.set(label,(async()=>{
   // OpenAPI LeagueSeasonsV2Schema is a non-paginated envelope.
   // The endpoint accepts only the path id, with no limit/offset query fields.
   const data=await request('leagues/11/seasons/');
   if(Number(data?.league_id)!==11||!Array.isArray(data?.seasons)||data.count!==data.seasons.length)throw fault('BSD_SCHEMA','BSD sezon listesi (league_id/count/seasons) doğrulanamadı.');
   const rows=data.seasons;
   const start=Number(label.slice(0,4)),end=Number(label.slice(5));
   if(end!==start+1)throw fault('BSD_SEASON','Sezon yılları ardışık olmalı.');
   const labels=[label,label.replace('-', '/'),`${start}/${String(end).slice(-2)}`,`${start}-${String(end).slice(-2)}`];
   const found=rows.filter(s=>Number(s.year)===start||(!s.year&&labels.includes(String(s.name||'').trim())));
   if(found.length!==1||!/^\d+$/.test(String(found[0].id)))throw fault('BSD_SEASON','Seçili Süper Lig sezonu BSD içinde tekil olarak bulunamadı.');
   return Number(found[0].id);
  })());
  return seasons.get(label);
 }
 async function events(label,round){
  const key=`${label}:${round||'all'}`;
  if(!requests.has(key))requests.set(key,(async()=>{
   const id=await seasonId(label);
   const query=new URLSearchParams({league_id:'11',season_id:String(id),...(round?{stage:'regular-season',round:String(round)}:{})});
   const rows=await collection(`events/?${query}`);
   const normalized=rows.filter(row=>!row.replaced_by).map(row=>normalizeBsdEvent(row,id));
   const appearances=new Set();
   for(const event of normalized)for(const team of [event.strHomeTeam,event.strAwayTeam]){
    const signature=`${event.intRound}:${footballTeamKey(team)}`;
    if(appearances.has(signature))throw fault('BSD_DUPLICATE','BSD aynı haftada bir takımı birden çok maçta gösteriyor; liste kullanılmadı.');
    appearances.add(signature);
   }
   if(new Set(normalized.map(e=>e.idEvent)).size!==normalized.length)throw fault('BSD_DUPLICATE','BSD listesinde yinelenen maç kimliği var.');
   if(round&&normalized.some(e=>e.intRound!==Number(round)))throw fault('BSD_ROUND','BSD hafta filtresi doğrulanamadı.');
   return normalized;
  })());
  return requests.get(key);
 }
 return {events};
}
module.exports={createBsdClient,normalizeBsdEvent};
