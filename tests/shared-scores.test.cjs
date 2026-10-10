'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {scorePatch,syncScores}=require('../server/scores.cjs');
const {execute}=require('../server/service.cjs');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function section(a,b){const start=code.indexOf(a);assert.ok(start>=0,a);return code.slice(start,code.indexOf(b,start));}
const clone=v=>v===undefined?undefined:structuredClone(v);
const now=Date.now(),user={admin:false,access:{mustChangePassword:false}},admin={admin:true,access:{mustChangePassword:false}};
const payload={seasonId:'s',weekId:'w'};
const match=(extra={})=>({id:'m',seasonId:'s',weekId:'w',apiId:'123456',date:new Date(now-20*60000).toISOString(),homeTeam:'A',awayTeam:'B',played:false,homeScore:'',awayScore:'',...extra});
const event=(status='1H',home=1,away=0)=>({idEvent:'123456',strHomeTeam:'A',strAwayTeam:'B',strStatus:status,intHomeScore:home,intAwayScore:away});
function database(extra={}){
  const data={settings:{seasonsMeta:[{id:'s',name:'2026-2027'}],weeksMeta:[{id:'w',seasonId:'s',number:7,status:'aktif'}]},matches:{m:match()},predictions:{secret:{homePred:9}},users:{u:{id:'u'}},...extra},writes=[],reads=[];
  const get=path=>path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],data);
  const put=(path,value)=>{const keys=path.split('/').filter(Boolean),last=keys.pop();let node=data;for(const k of keys)node=node[k]??={};if(value===null)delete node[last];else node[last]=clone(value);};
  const snap=value=>({val:()=>clone(value??null)});
  const db={data,writes,reads,fail:null,ref(path=''){
    return {get:async()=>{reads.push(path);return snap(get(path));},update:async updates=>{
      if(db.fail===path)throw Error('offline write');
      writes.push(path);for(const [k,v]of Object.entries(updates))put([path,k].filter(Boolean).join('/'),v);
    },transaction:async callback=>{
      if(db.fail===path)throw Error('offline transaction');
      const current=clone(get(path)??null),next=callback(current);
      if(next===undefined)return {committed:false,snapshot:snap(current)};
      writes.push(path);put(path,next);return {committed:true,snapshot:snap(next)};
    }};
  }};return db;
}
const provider=value=>async()=>({ok:true,json:async()=>({events:[value]})});
test('normal user request writes a verified live score to shared Firebase, never predictions or users',async()=>{
  const db=database(),before=clone(db.data.predictions);
  const result=await syncScores(db,user,{...payload,homeScore:99,force:true},{now,fetchImpl:provider(event())});
  assert.equal(result.checked,true);assert.equal(result.updatedCount,1);assert.equal(db.data.matches.m.liveHomeScore,1);assert.equal(db.data.matches.m.played,false);
  assert.deepEqual(db.data.predictions,before);assert.ok(db.writes.every(p=>/^(matches\/|settings$|serverPrivate\/scoreSync\/)/.test(p)));
});
test('user ten-minute limit cannot be bypassed with force; admin may fetch repeatedly without cooldown',async()=>{
  const db=database();let calls=0;const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({events:[event()]})}};
  const first=await syncScores(db,user,payload,{now,fetchImpl});
  const cached=await syncScores(db,user,{...payload,force:true},{now:first.finishedAt+100,fetchImpl});assert.equal(cached.checked,false);assert.equal(calls,1);assert.ok(cached.retryAfterMs>0);
  for(let i=0;i<3;i++)assert.equal((await syncScores(db,admin,{...payload,force:true},{now:first.finishedAt+200+i,fetchImpl})).checked,true);
  assert.equal(calls,4);
  await syncScores(db,user,payload,{now:db.data.serverPrivate.scoreSync.w.lastSuccessAt+10*60000+1,fetchImpl});assert.equal(calls,5);
});
test('cooldown is scoped to week, not an unrelated selected week',async()=>{
  const db=database();db.data.settings.weeksMeta.push({id:'w2',seasonId:'s',number:8,status:'aktif'});db.data.matches.m2=match({id:'m2',weekId:'w2',apiId:'123457'});
  const fetchImpl=async url=>({ok:true,json:async()=>({events:[{...event(),idEvent:url.includes('123457')?'123457':'123456'}]})});
  await syncScores(db,user,payload,{now,fetchImpl});assert.equal((await syncScores(db,user,{seasonId:'s',weekId:'w2'},{now,fetchImpl})).checked,true);
});
test('an existing manual result and its source flag are not fetched or overwritten',async()=>{
  const db=database({matches:{m:match({manualScoreLocked:true,played:true,homeScore:3,awayScore:1})}}),before=clone(db.data.matches);
  const result=await syncScores(db,user,payload,{now,fetchImpl:()=>{throw Error('must not fetch manual match')}});
  assert.equal(result.checkedCount,0);assert.deepEqual(db.data.matches,before);
});
test('manual score entered while provider is slow wins the race',async()=>{
  const db=database();let release;const wait=new Promise(r=>release=r);
  const pending=syncScores(db,user,payload,{now,fetchImpl:async()=>{await wait;return {ok:true,json:async()=>({events:[event('FT',2,2)]})}}});
  await new Promise(r=>setImmediate(r));
  Object.assign(db.data.matches.m,{manualScoreLocked:true,played:true,homeScore:3,awayScore:1});release();
  await pending;assert.equal(db.data.matches.m.homeScore,3);assert.equal(db.data.matches.m.awayScore,1);assert.equal(db.data.matches.m.manualScoreLocked,true);
});
test('a deletion during provider fetch cannot be resurrected',async()=>{
  const db=database();const fetchImpl=async()=>{delete db.data.matches.m;return {ok:true,json:async()=>({events:[event('FT')]})}};
  await syncScores(db,user,payload,{now,fetchImpl});assert.equal(db.data.matches.m,undefined);
});
test('FT writes canonical and legacy final fields; stale live response cannot undo it',async()=>{
  const db=database();await syncScores(db,admin,{...payload,force:true},{now,fetchImpl:provider(event('FT',2,2))});
  const final=clone(db.data.matches.m);assert.equal(final.played,true);assert.equal(final.oynandiMi,1);assert.equal(final.evGol,2);assert.ok(final.liveHomeScore==null);
  await syncScores(db,admin,{...payload,force:true},{now,fetchImpl:provider(event('2H',1,1))});assert.deepEqual(db.data.matches.m,final);
});
test('provider failure does not start successful cooldown and releases the lock for retry',async()=>{
  const db=database(),before=clone(db.data.matches);
  await assert.rejects(syncScores(db,user,payload,{now,fetchImpl:async()=>{throw Error('offline')}}),e=>e.status===502);
  assert.deepEqual(db.data.matches,before);assert.equal(db.data.settings.resultsLastAutoSyncAt,undefined);assert.ok(db.data.serverPrivate.scoreSync.w.owner==null);
  assert.equal((await syncScores(db,user,payload,{now,fetchImpl:provider(event())})).checked,true);
});
test('Firebase write failure is not a successful API update',async()=>{
  const db=database();db.fail='matches/m';
  await assert.rejects(syncScores(db,user,payload,{now,fetchImpl:provider(event())}),e=>e.status===502);
  assert.equal(db.data.settings.manualScoreLastSuccessAt,undefined);assert.equal(db.data.matches.m.liveHomeScore,undefined);
});
test('concurrent devices perform one provider request; in-progress response is not reported as updated',async()=>{
  const db=database();let release,calls=0;const wait=new Promise(r=>release=r);
  const first=syncScores(db,user,payload,{now,fetchImpl:async()=>{calls++;await wait;return {ok:true,json:async()=>({events:[event()]})}}});
  await new Promise(r=>setImmediate(r));
  await assert.rejects(syncScores(db,admin,{...payload,force:true},{now,fetchImpl:provider(event())}),e=>e.status===409);
  release();await first;assert.equal(calls,1);
});
test('unpublished or wrong-season weeks are rejected before requesting provider data',async()=>{
  const db=database();db.data.settings.weeksMeta[0].status='hazirlaniyor';let calls=0;const fetchImpl=async()=>{calls++;throw Error('must not fetch')};
  await assert.rejects(syncScores(db,user,payload,{now,fetchImpl}),e=>e.status===403);
  await assert.rejects(syncScores(db,user,{...payload,seasonId:'wrong'},{now,fetchImpl}),e=>e.status===404);assert.equal(calls,0);
});
test('temporary-password accounts cannot invoke the new action',async()=>{
  await assert.rejects(execute({db:database()},{admin:false,access:{mustChangePassword:true}},'syncScores',payload),e=>e.status===403);
});
test('legacy match without apiId resolves uniquely by registered week/team; no new match is created',async()=>{
  const db=database();delete db.data.matches.m.apiId;let url;
  const result=await syncScores(db,user,payload,{now,fetchImpl:async u=>{url=u;return {ok:true,json:async()=>({events:[event()]})}}});
  assert.ok(url.includes('eventsround.php'));assert.equal(result.updatedCount,1);assert.deepEqual(Object.keys(db.data.matches),['m']);
});
test('ambiguous fallback and wrong event ID are failures; neither can assign another match score',async()=>{
  const db=database();delete db.data.matches.m.apiId;
  await assert.rejects(syncScores(db,user,payload,{now,fetchImpl:async()=>({ok:true,json:async()=>({events:[event(),event()]})})}),e=>e.status===502);
  db.data.matches.m.apiId='123456';await assert.rejects(syncScores(db,user,payload,{now,fetchImpl:provider({...event(),idEvent:'wrong'})}),e=>e.status===502);
  assert.equal(db.data.matches.m.liveHomeScore,undefined);
});
test('absent score remains absent; elapsed time alone cannot invent a final result',()=>{
  const m=match({date:new Date(now-5*3600000).toISOString()});
  const patch=scorePatch(m,event('',null,null),now);assert.equal(patch?.played,undefined);assert.equal(patch?.homeScore,undefined);assert.equal(patch?.liveHomeScore,undefined);
  assert.equal(scorePatch(m,event('',2,2),now).played,undefined);
});
test('pre-kickoff default zero is not live; zero after kickoff is valid; missing update retains live score',()=>{
  const m=match({date:new Date(now+3600000).toISOString()});assert.equal(scorePatch(m,event('Not Started',0,0),now)?.liveHomeScore,undefined);
  const live=scorePatch(match(),event('1H',0,0),now);assert.equal(live.liveHomeScore,0);
  const current={...match(),...live};assert.equal(scorePatch(current,event('1H',null,null),now),null);
});
test('manual lock aliases are protected; removing all lock flags restores provider control',()=>{
  for(const flag of ['manualScoreLocked','manualScoreLock','manuelSkorKilitli'])assert.equal(scorePatch(match({[flag]:true}),event('FT',2,2),now),null);
  const patch=scorePatch(match({manualScoreLocked:false,manualScoreLock:false,manuelSkorKilitli:0}),event('FT',2,2),now);assert.equal(patch.homeScore,2);assert.equal(patch.played,true);
});
test('partial provider failure is not reported as a completed successful sync',async()=>{
  const db=database();db.data.matches.m2=match({id:'m2',apiId:'123457'});
  await assert.rejects(syncScores(db,user,payload,{now,fetchImpl:async url=>{if(url.includes('123457'))throw Error('offline');return {ok:true,json:async()=>({events:[event()]})}}}),e=>e.status===502);
  assert.equal(db.data.matches.m.liveHomeScore,1);assert.equal(db.data.matches.m2.liveHomeScore,undefined);assert.equal(db.data.settings.resultsLastAutoSyncAt,undefined);
});
function scoreDevice(){
  const bindings=new Map();let renders=0,hydrations=0;
  const state={matches:[match()],teams:[],predictions:[{matchId:'m',playerId:'u1',homePred:1,awayPred:0},{matchId:'m',playerId:'u2',homePred:2,awayPred:0},{matchId:'m',playerId:'u3',homePred:0,awayPred:1}],settings:{activeSeasonId:'s',activeWeekId:'w',currentTab:'predictions'}};
  const c={console,state,Date,window:{SkorxAuth:{admin:false}},useOnlineMode:true,isFirebaseReady:()=>true,isAuthenticated:()=>true,
    firebaseRealtimeBindingsInitialized:false,appBootstrapInProgress:false,firebaseRealtimeHydrationPromise:null,currentHydrationPromise:null,
    firebaseMatchSnapshotRevision:0,firebaseLatestMatchSnapshot:null,firebasePendingMatchWrites:new Set(),firebasePresenceCache:{},
    getFirebaseDb:()=>({ref:path=>({on:(_,fn)=>bindings.set(path,fn)})}),reconcileLocalMatchesWithFirebase:()=>({removed:0}),
    saveState:()=>{},renderAll:()=>{renders++},debounceFirebaseRealtimeRender:()=>{renders++},scheduleFirebaseRealtimeHydration:()=>{hydrations++},renderDashboardAutoSyncStatus:()=>{},
    getActiveSeasonId:()=> 's',getSeasonById:()=>({name:'2026-2027'}),getActiveSeasonLabel:()=> '2026-2027',
    sanitizeFirebaseKey:v=>v,firebaseSnapshotToArray:map=>Object.entries(map).map(([id,row])=>({...row,id})),
    ensureSeasonFromOnlineLabel:()=>({id:'s'}),getRegisteredWeekForSeason:()=>({id:'w'}),getWeekNumberById:()=>7,
    parseBooleanish:v=>v===true||v===1||v==='1'||v==='true',parseNumberOrEmpty:v=>v===null||v===undefined||v===''?'':Number(v),normalizeStoredDate:v=>v,
    normalizeText:v=>String(v).toLowerCase(),getTeamsBySeasonId:()=>[{name:'A'},{name:'B'}],applyMatchSceneOverridesToTeams:()=>{},syncWeekStatus:()=>{}};
  vm.createContext(c);
  vm.runInContext(section('function calcOutcome(','function getWeekPredictionLockTimestamp(')+section('function hasValidMatchScore(','function comparePredictionStandings(')+section('async function syncOnlineMatchesFromSheet(','async function fetchOnlineStandings(')+section('function matchScoreViewFingerprint()','async function syncSharedWeekScores(')+section('function ensureFirebaseRealtimeBridge()','let useOnlineMode'),c);
  c.ensureFirebaseRealtimeBridge();
  return {c,bindings,stats:()=>({renders,hydrations}),snapshot:map=>({val:()=>clone(map),exists:()=>true})};
}
test('two user devices receive shared score snapshots and compute identical live and final points without extra hydration',async()=>{
  const db=database();Object.assign(db.data.matches.m,{season:'2026-2027',weekNo:7});
  const first=scoreDevice(),second=scoreDevice();
  for(const device of [first,second])device.bindings.get('matches')(device.snapshot(db.data.matches));
  await syncScores(db,user,payload,{now,fetchImpl:provider(event('1H',1,0))});
  for(const device of [first,second])device.bindings.get('matches')(device.snapshot(db.data.matches));
  await new Promise(r=>setImmediate(r));
  for(const device of [first,second]){
    assert.deepEqual(Array.from(device.c.state.predictions,p=>p.points),[3,1,0]);assert.equal(device.c.state.matches[0].played,false);
    assert.equal(device.c.state.predictions[0].provisionalPoints,true);assert.equal(device.stats().hydrations,0);assert.equal(device.stats().renders,1);
    device.bindings.get('matches')(device.snapshot(db.data.matches));assert.equal(device.stats().renders,1);
  }
  await syncScores(db,admin,{...payload,force:true},{now,fetchImpl:provider(event('FT',2,0))});
  for(const device of [first,second])device.bindings.get('matches')(device.snapshot(db.data.matches));
  await new Promise(r=>setImmediate(r));
  for(const device of [first,second]){
    assert.deepEqual(Array.from(device.c.state.predictions,p=>p.points),[1,3,0]);assert.equal(device.c.state.matches[0].played,true);
    assert.equal(device.c.state.predictions[0].provisionalPoints,false);assert.equal(device.stats().renders,2);
  }
});
test('live score snapshot does not overwrite an unsaved prediction draft',async()=>{
  const device=scoreDevice();device.c.predictionDrafts={m_u1:{homePred:8,awayPred:''}};
  device.bindings.get('matches')(device.snapshot({m:{...match(),season:'2026-2027',weekNo:7}}));
  device.bindings.get('matches')(device.snapshot({m:{...match(),season:'2026-2027',weekNo:7,liveHomeScore:1,liveAwayScore:0,statusText:'1h'}}));
  await new Promise(r=>setImmediate(r));
  assert.equal(device.c.predictionDrafts.m_u1.homePred,8);assert.equal(device.c.predictionDrafts.m_u1.awayPred,'');assert.equal(device.c.state.predictions[0].homePred,1);
});
function requestDevice(adminRole=false){
  const timers=[],messages=[],calls=[];let reads=0;
  const c={console,Date,state:{matches:[],settings:{activeWeekId:'w'}},window:{SkorxAuth:{ready:true,admin:adminRole,request:async(action,payload)=>{calls.push({action,payload});return {success:true,checked:true,finishedAt:Date.now(),checkedCount:1,updatedCount:1}}}},
    document:{visibilityState:'visible'},getActiveSeasonId:()=> 's',getSeasonById:()=>({id:'s',name:'2026-2027'}),getWeekById:()=>({id:'w',number:7}),
    isAuthenticated:()=>true,isFirebaseReady:()=>true,shouldPublishMatchChanges:()=>true,autoResultsSyncPromise:null,
    firebaseRead:async()=>{reads++;return {}},syncOnlineMatchesFromSheet:async()=>true,saveState:()=>{},debounceFirebaseRealtimeRender:()=>{},renderDashboardAutoSyncStatus:()=>{},renderManualScoreCooldown:()=>{},
    setInterval:(fn,ms)=>{timers.push({fn,ms})},setTimeout:()=>{},getActionButtonFromArg:()=>null,dashboardScoreUpdatePromise:null,
    setAsyncButtonState:()=>{},startDashboardApiProgress:()=>{},finishDashboardApiProgress:(ok,message)=>messages.push({ok,message}),showAlert:async()=>{},formatManualScoreCooldown:()=> '10:00'};
  vm.createContext(c);vm.runInContext(section('const sharedScoreSyncTimes =','async function syncSelectedWeekFromApi(')+section('async function runDashboardWeekScoreUpdate(','async function syncDashboardWeek('),c);
  return {c,timers,messages,calls,stats:()=>({reads})};
}
test('dashboard admin manual checks repeatedly force server refresh; user preserves ten-minute automatic timer',async()=>{
  const f=requestDevice(true);await f.c.runDashboardWeekScoreUpdate();await f.c.runDashboardWeekScoreUpdate();
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(v=>v.payload.force===true));assert.equal(f.stats().reads,2);
  const u=requestDevice();assert.equal(u.timers.length,1);assert.equal(u.timers[0].ms,10*60000);
  await u.c.maybeAutoSyncResults();await u.c.maybeAutoSyncResults();assert.equal(u.calls.length,1);assert.equal(u.calls[0].payload.force,false);
});
test('failed dashboard API/shared read never shows successful completion',async()=>{
  for(const failure of ['api','read']){
    const f=requestDevice();if(failure==='api')f.c.window.SkorxAuth.request=async()=>{throw Error('offline')};else f.c.firebaseRead=async()=>{throw Error('read failed')};
    assert.equal(await f.c.runDashboardWeekScoreUpdate(),null);assert.equal(f.messages.length,1);assert.equal(f.messages[0].ok,false);
  }
});
test('server cooldown response is described as cached shared data, not a fresh API fetch',async()=>{
  const f=requestDevice();f.c.window.SkorxAuth.request=async()=>({success:true,checked:false,finishedAt:Date.now(),retryAfterMs:600000});
  await f.c.runDashboardWeekScoreUpdate();assert.ok(f.messages[0].message.includes('Yeni API isteği yapılmadı'));
});
test('manual result imported by user devices remains final and scores every prediction correctly',async()=>{
  const f=scoreDevice();f.bindings.get('matches')(f.snapshot({m:match()}));
  f.bindings.get('matches')(f.snapshot({m:{...match({played:true,homeScore:1,awayScore:0,manualScoreLocked:true}),season:'2026-2027',weekNo:7}}));
  await new Promise(r=>setImmediate(r));assert.equal(f.c.state.matches[0].manualScoreLocked,true);assert.deepEqual(Array.from(f.c.state.predictions,p=>p.points),[3,1,0]);assert.equal(f.c.state.predictions[0].provisionalPoints,false);
});
test('existing admin fixture API writer preserves a concurrent manual result while explicit manual edits still work',async()=>{
  const db=database({matches:{m:match({played:true,manualScoreLocked:true,homeScore:3,awayScore:1})}});
  const c={Date,window:{SkorxAuth:{admin:true}},getFirebaseDb:()=>db,sanitizeFirebaseKey:v=>v,getSeasonById:()=>({name:'2026-2027'}),getWeekNumberById:()=>7,
    parseBooleanish:v=>v===true||v===1||v==='1'||v==='true',firebaseWrite:async(p,value)=>{db.data.matches.m=clone(value);}};
  vm.createContext(c);vm.runInContext(section('async function firebaseApiPost(','window.seedFirebaseDefaults'),c);
  const apiMatch=match({played:true,homeScore:2,awayScore:2,manualScoreLocked:false});
  await c.firebaseApiPost('addMatches',{matches:[apiMatch],preserveManualScores:true});assert.equal(db.data.matches.m.homeScore,3);assert.equal(db.data.matches.m.manualScoreLocked,true);
  await c.firebaseApiPost('addMatches',{matches:[{...apiMatch,homeScore:4,manualScoreLocked:true}]});assert.equal(db.data.matches.m.homeScore,4);
});
