'use strict';
const {Fault}=require('./policy.cjs');
const fault=(code,message)=>Object.assign(new Fault(502,message),{publicCode:code});
function createSportsDbClient({fetchImpl=fetch,deadline=Date.now()+45000}={}) {
  let blocked=null;
  return async function request(suffix,field='events') {
    if(blocked)throw blocked;
    const apiKey=String(process.env.SPORTSDB_API_KEY||'123').trim();
    const source=suffix.split('?')[0];
    let response;
    try { response=await fetchImpl(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/${suffix}`,{signal:AbortSignal.timeout(Math.max(1,Math.min(12000,deadline-Date.now()))),cache:'no-store',headers:{Accept:'application/json'}}); }
    catch(error){throw fault(error.name==='TimeoutError'||error.name==='AbortError'?'API_TIMEOUT':'API_NETWORK',`${source}: TheSportsDB bağlantısı kurulamadı veya zaman aşımına uğradı.`);}
    if(!response.ok){
      if([401,403,429].includes(Number(response.status))){
        blocked=fault(response.status===429?'API_RATE_LIMIT':'API_ACCESS_DENIED',response.status===429?'TheSportsDB istek sınırı doldu. Bir süre bekleyin; mevcut skorlar korundu.':`TheSportsDB HTTP ${response.status}: API erişimi reddedildi. Vercel SPORTSDB_API_KEY değerini ve sağlayıcıdaki API erişimini kontrol edin. Mevcut skorlar korundu.`);
        throw blocked;
      }
      throw fault('API_HTTP',`${source}: TheSportsDB HTTP ${Number(response.status)||'hata'} döndürdü.`);
    }
    let data;try{data=await response.json();}catch{throw fault('API_JSON',`${source}: TheSportsDB JSON yanıtı alınamadı.`);}
    if(data?.[field]!==null&&!Array.isArray(data?.[field]))throw fault('API_SCHEMA',`${source}: beklenen veri listesi bulunamadı.`);
    return data[field]||[];
  };
}
async function sportsDbData(actor,payload={},options={}) {
  if(!actor.admin)throw new Fault(403,'Bu API işlemi yöneticiye açık.');
  const {endpoint,season,round,teamId}=payload;
  let suffix,field='events';
  if(endpoint==='lookupteam.php'){
    if(!/^\d{1,12}$/.test(String(teamId||'')))throw new Fault(400,'Geçersiz takım kimliği.');
    suffix=`lookupteam.php?id=${encodeURIComponent(teamId)}`;field='teams';
  }else{
    if(!/^\d{4}-\d{4}$/.test(String(season||'')))throw new Fault(400,'Geçersiz sezon.');
    if(endpoint==='eventsseason.php')suffix=`eventsseason.php?id=4339&s=${encodeURIComponent(season)}`;
    else if(endpoint==='eventsround.php'&&Number.isInteger(Number(round))&&Number(round)>=1&&Number(round)<=60)suffix=`eventsround.php?id=4339&r=${Number(round)}&s=${encodeURIComponent(season)}`;
    else throw new Fault(400,'Geçersiz API işlemi.');
  }
  if(field==='teams')return {success:true,teams:await createSportsDbClient(options)(suffix,field),sources:['TheSportsDB']};
  const source=require('./event-source.cjs').createEventSource({...options,seasonLabel:season});
  return {success:true,events:await source.events(suffix),sources:[...source.sources]};
}
module.exports={createSportsDbClient,sportsDbData};
