'use strict';
const {Fault}=require('./policy.cjs');
const {createSportsDbClient}=require('./sportsdb.cjs');
const {createBsdClient}=require('./bsd.cjs');
function createEventSource({db,fetchImpl=fetch,deadline=Date.now()+45000,seasonLabel=''}={}){
 const primary=createSportsDbClient({fetchImpl,deadline}),backup=createBsdClient({db,fetchImpl,deadline});
 const sources=new Set();let primaryError=null,outageLoaded=false;
 async function events(suffix){
  const query=new URLSearchParams(suffix.split('?')[1]||''),endpoint=suffix.split('?')[0];
  if(!outageLoaded&&db&&String(process.env.BSD_API_KEY||'').trim()){
   const outage=(await db.ref('serverPrivate/providers/thesportsdb').get()).val();
   if(Number(outage?.retryAt||0)>Date.now())primaryError=Object.assign(new Fault(502,'TheSportsDB erişim beklemesinde.'),{publicCode:'API_ACCESS_DENIED'});
   outageLoaded=true;
  }
  if(!primaryError){
   try{
    const rows=await primary(suffix);
    if(rows.length||!String(process.env.BSD_API_KEY||'').trim()){sources.add('TheSportsDB');return rows;}
   }catch(error){
    primaryError=error;
    if(db&&String(process.env.BSD_API_KEY||'').trim()&&['API_ACCESS_DENIED','API_RATE_LIMIT','API_NETWORK','API_TIMEOUT'].includes(error.publicCode))await db.ref('serverPrivate/providers/thesportsdb').update({retryAt:Date.now()+(error.publicCode==='API_ACCESS_DENIED'?10*60000:60000)});
   }
  }
  if(!String(process.env.BSD_API_KEY||'').trim())throw Object.assign(new Fault(502,`${primaryError?.message||'TheSportsDB verisi alınamadı.'} Yedek için Vercel BSD_API_KEY tanımlanmalı.`),{publicCode:'BSD_NOT_CONFIGURED'});
  try{
   const rows=await backup.events(query.get('s')||seasonLabel,endpoint==='eventsround.php'?Number(query.get('r')):null);
   if(!rows.length)throw Object.assign(new Fault(502,'BSD seçili sezon/hafta için maç döndürmedi.'),{publicCode:'BSD_EMPTY'});
   sources.add('BSD');return rows;
  }catch(error){throw Object.assign(new Fault(502,`Birincil kaynak kullanılamadı; ${error.message}`),{publicCode:error.publicCode||'BSD_FAILED'});}
 }
 return {events,sources};
}
module.exports={createEventSource};
