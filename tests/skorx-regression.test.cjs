'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const authSource=fs.readFileSync(path.join(__dirname,'../secure-auth.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function predictionFixture(){
  const drafts={},ui={},owner={user:{id:'u'}};
  const state={settings:{activeWeekId:'w'},matches:[{id:'m',seasonId:'s',weekId:'w',played:false}],predictions:[{matchId:'m',playerId:'u',homePred:1,awayPred:0,remoteId:'r'}]};
  const context={console,state,useOnlineMode:true,window:{SkorxAuth:{session:owner}},isAuthenticated:()=>true,getActiveSeasonId:()=> 's',getSeasonById:()=>({name:'S'}),getWeekNumberById:()=>1,
    getPrediction:(m,p)=>state.predictions.find(row=>row.matchId===m&&row.playerId===p),getPredictionUiKey:(m,p)=>m+'_'+p,getPredictionDraft:(m,p)=>drafts[m+'_'+p],dedupeOnlinePredictionRows:r=>r,normalizeOnlinePredictionRows:r=>r.predictions,
    resolveMatchIdFromOnlineRow:r=>r.matchId,resolvePlayerIdFromOnlineRow:r=>r.playerId,parseNumberOrEmpty:v=>v===''?'':Number(v),calcPoints:()=>0,
    clearOnlinePredictionsForScope:()=>{state.predictions=[]},upsertLocalPredictionRecord:r=>{state.predictions=state.predictions.filter(p=>p.matchId!==r.matchId||p.playerId!==r.playerId);state.predictions.push({...r})},compactLocalPredictionRecords:()=>{},recalculateAllPoints:()=>{},saveState:()=>{},updateLastSyncLabel:()=>{},renderAll:()=>{},
    fetchOnlinePredictions:async()=>({predictions:[]}),apiPost:async()=>({success:true})};
  vm.createContext(context);
  vm.runInContext(section('// Public participation is separate','async function hydrateOnlineStateForSession('),context);
  return {context,state,drafts,ui};
}
const row=(homePred=1,awayPred=0)=>({id:'r',matchId:'m',playerId:'u',homePred,awayPred});
test('old response started before save cannot overwrite the acknowledged score',async()=>{
  const f=predictionFixture(),read=deferred();f.context.fetchOnlinePredictions=()=>read.promise;
  const pending=f.context.syncOnlinePredictions();
  await f.context.runPredictionWrite({matchId:'m',playerId:'u'},'savePrediction');
  f.state.predictions[0].homePred=3;
  read.resolve({predictions:[row()]});assert.equal(await pending,false);assert.equal(f.state.predictions[0].homePred,3);
});
test('response started during deletion cannot resurrect it after acknowledgment',async()=>{
  const f=predictionFixture(),read=deferred(),write=deferred();f.context.apiPost=()=>write.promise;
  const deleting=f.context.runPredictionWrite({matchId:'m',playerId:'u'},'deletePrediction');
  f.context.fetchOnlinePredictions=()=>read.promise;const pending=f.context.syncOnlinePredictions();
  write.resolve({success:true});await deleting;f.state.predictions=[];
  read.resolve({predictions:[row()]});assert.equal(await pending,false);assert.equal(f.state.predictions.length,0);
});
test('unsaved draft and pending save survive a concurrent remote snapshot',async()=>{
  const f=predictionFixture();f.drafts.m_u={homePred:5,awayPred:''};
  assert.equal(await f.context.syncOnlinePredictions({response:{predictions:[row(9,9)]}}),true);
  assert.equal(f.state.predictions[0].homePred,1);assert.equal(f.drafts.m_u.homePred,5);
  const write=deferred();f.context.apiPost=()=>write.promise;
  const writing=f.context.runPredictionWrite({matchId:'m',playerId:'u'},'savePrediction');
  delete f.drafts.m_u;
  await f.context.syncOnlinePredictions({response:{predictions:[row(9,9)]}});
  assert.equal(f.state.predictions[0].homePred,1);write.resolve({success:true});await writing;
});
test('fresh second-device updates and deletions apply when there is no local edit',async()=>{
  const f=predictionFixture();await f.context.syncOnlinePredictions({response:{predictions:[row(4,2)]}});
  assert.equal(f.state.predictions[0].homePred,4);
  await f.context.syncOnlinePredictions({response:{predictions:[]}});assert.equal(f.state.predictions.length,0);
});
test('same prediction writes are mutually exclusive; failed write releases barrier',async()=>{
  const f=predictionFixture(),write=deferred();f.context.apiPost=()=>write.promise;
  const writing=f.context.runPredictionWrite({matchId:'m',playerId:'u'},'savePrediction');
  await assert.rejects(f.context.runPredictionWrite({matchId:'m',playerId:'u'},'deletePrediction'));
  write.reject(Error('offline'));await assert.rejects(writing);
  f.context.apiPost=async()=>({success:true});assert.equal((await f.context.runPredictionWrite({matchId:'m',playerId:'u'},'savePrediction')).success,true);
});
test('snapshot from previous account is discarded',async()=>{
  const f=predictionFixture(),read=deferred();f.context.fetchOnlinePredictions=()=>read.promise;
  const pending=f.context.syncOnlinePredictions();f.context.window.SkorxAuth.session={user:{id:'other'}};
  read.resolve({predictions:[row(9,9)]});assert.equal(await pending,false);assert.equal(f.state.predictions[0].homePred,1);
});
function authFixture(code=authSource){
  let signouts=0,calls=0,forced=0,next=0;const timers=new Map();
  const user={uid:'uid-u',getIdToken:async(force)=>{if(force)forced++;return 'token';}};
  const auth={currentUser:user,setPersistence:async()=>{},onAuthStateChanged:cb=>{queueMicrotask(()=>cb(user));return ()=>{}},onIdTokenChanged:()=>{},signOut:async()=>{signouts++;auth.currentUser=null;}};
  const firebase={auth:()=>auth};firebase.auth.Auth={Persistence:{LOCAL:'local'}};
  const session={success:true,user:{id:'u',authUid:'uid-u',rol:'user'}};
  const context={console,window:{firebase},localStorage:{getItem:()=>null},document:{visibilityState:'visible'},setTimeout:fn=>{timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id),fetch:async()=>{calls++;return {status:200,ok:true,json:async()=>session}},setLoginFeedback:()=>{},predictionResponseFingerprint:rows=>JSON.stringify(rows),predictionSyncRevision:0,syncOnlinePredictions:async()=>true,debounceFirebaseRealtimeRender:()=>{}};
  vm.createContext(context);vm.runInContext(code,context);
  return {context,auth,user,session,timers,stats:()=>({calls,signouts,forced})};
}
test('restored session survives transient data/server failure',async()=>{
  const f=authFixture();await f.context.window.SkorxAuth.init();
  f.context.fetch=async()=>({status:500,ok:false,json:async()=>({success:false,message:'temporary'})});
  await assert.rejects(f.context.window.SkorxAuth.request('getPredictions'));
  assert.equal(f.stats().signouts,0);assert.equal(f.context.window.SkorxAuth.ready,true);
});
test('transient initial verification fails visibly without deleting Firebase identity',async()=>{
  const f=authFixture();f.context.fetch=async()=>{throw Error('offline')};
  await assert.rejects(f.context.window.SkorxAuth.init());assert.equal(f.stats().signouts,0);assert.equal(f.auth.currentUser,f.user);
});
test('401 refreshes token once; persistent invalid session closes identity',async()=>{
  const f=authFixture();await f.context.window.SkorxAuth.init();let attempts=0;
  f.context.fetch=async()=>({status:++attempts===1?401:200,ok:attempts>1,json:async()=>({success:attempts>1})});
  await f.context.window.SkorxAuth.request('getPredictions');assert.equal(f.stats().forced,1);assert.equal(f.stats().signouts,0);
  f.context.fetch=async()=>({status:401,ok:false,json:async()=>({success:false})});
  await assert.rejects(f.context.window.SkorxAuth.request('getPredictions'));assert.equal(f.stats().signouts,1);
});
test('origin 403 does not log out; explicit disabled account does',async()=>{
  const f=authFixture();await f.context.window.SkorxAuth.init();
  f.context.fetch=async()=>({status:403,ok:false,json:async()=>({success:false,message:'origin'})});
  await assert.rejects(f.context.window.SkorxAuth.request('session'));assert.equal(f.stats().signouts,0);
  f.context.fetch=async()=>({status:403,ok:false,json:async()=>({success:false,code:'SESSION_DENIED'})});
  await assert.rejects(f.context.window.SkorxAuth.request('session'));assert.equal(f.stats().signouts,1);
});
test('prediction polling uses one response without a second data read',async()=>{
  const f=authFixture();await f.context.window.SkorxAuth.init();let applied=0;
  f.context.syncOnlinePredictions=async options=>{assert.ok(options.response);applied++;return true};
  f.context.window.SkorxAuth.startPoll();const tick=[...f.timers.values()][0];await tick();
  assert.equal(f.stats().calls,2);assert.equal(applied,1); // one session + one poll
});
test('late previous-user API failure cannot sign out new account',async()=>{
  const f=authFixture();await f.context.window.SkorxAuth.init();const response=deferred();f.context.fetch=()=>response.promise;
  const pending=f.context.window.SkorxAuth.request('getPredictions');await Promise.resolve();
  f.auth.currentUser={getIdToken:async()=> 'new'};response.resolve({status:401,ok:false,json:async()=>({success:false})});
  await assert.rejects(pending);assert.equal(f.stats().signouts,0);
});
const {identify}=require('../server/service.cjs');
test('token verifier network failures are not mislabeled as invalid authentication',async()=>{
  await assert.rejects(identify({verifyIdToken:async()=>{throw Object.assign(Error('network'),{code:'app/network-error'})}},null,'token'),e=>e.code==='app/network-error'&&e.status!==401);
  await assert.rejects(identify({verifyIdToken:async()=>{throw Object.assign(Error('expired'),{code:'auth/id-token-expired'})}},null,'token'),e=>e.status===401);
});
function saveFixture(){
  const f=predictionFixture(),c=f.context;let scores={homePred:2,awayPred:1};const alerts=[];
  Object.assign(c,{predictionUiState:f.ui,predictionTimers:{},clearTimeout:()=>{},setTimeout:()=>1,
    capturePredictionViewport:()=>({}),isMatchLocked:()=>false,getCurrentRole:()=> 'user',canEditPrediction:()=>true,hasStoredPredictionRecord:()=>true,
    ensurePrediction:()=>f.state.predictions[0],getPredictionInputSnapshot:()=>scores,setPredictionDraft:(m,p,value)=>{f.drafts[m+'_'+p]={...value}},
    renderStandings:()=>{},renderMissingPredictions:()=>{},renderStats:()=>{},renderAdvancedStats:()=>{},schedulePredictionViewportRestore:()=>{},
    setPredictionUiState:(m,p,state)=>{f.ui[m+'_'+p]=state;if(state==='saved')delete f.drafts[m+'_'+p]},updatePredictionDeleteButton:()=>{},
    normalizeEntityId:v=>v,getPlayerById:()=>({id:'u',name:'User',username:'user'}),getAuthUser:()=>({id:'u',adSoyad:'User'}),findPlayerForSessionUser:()=>({id:'u'}),
    getCurrentUsername:()=> 'user',getActiveSeasonLabel:()=> 'S',dequeuePredictionRetry:()=>{},showAlert:message=>alerts.push(message),renderPredictions:()=>{}});
  f.state.settings.auth={playerId:'u'};
  c.saveOnlinePrediction=payload=>c.runPredictionWrite(payload,'savePrediction');
  vm.runInContext(section('window.savePrediction =','function getStandingTone'),c);
  return {...f,alerts,setScores:v=>{scores=v;}};
}
test('typing a newer draft during save preserves it after successful response; second save persists it',async()=>{
  const f=saveFixture(),write=deferred();f.context.apiPost=()=>write.promise;
  const saving=f.context.window.savePrediction('m','u');f.drafts.m_u={homePred:7,awayPred:3};
  write.resolve({success:true,id:'r'});await saving;
  assert.equal(f.state.predictions[0].homePred,2);assert.equal(f.drafts.m_u.homePred,7);assert.equal(f.ui.m_u,'dirty');
  f.setScores({homePred:7,awayPred:3});f.context.apiPost=async()=>({success:true,id:'r'});await f.context.window.savePrediction('m','u');
  assert.equal(f.state.predictions[0].homePred,7);assert.equal(f.ui.m_u,'saved');assert.equal(f.drafts.m_u,undefined);
});
test('offline save keeps draft, reports failure and never shows saved',async()=>{
  const f=saveFixture();f.context.apiPost=async()=>{throw Error('offline')};await f.context.window.savePrediction('m','u');
  assert.equal(f.ui.m_u,'error');assert.equal(f.drafts.m_u.homePred,2);assert.equal(f.alerts.length,1);
});
test('denied save is not shown as success',async()=>{
  const f=saveFixture();f.context.apiPost=async()=>({success:false,message:'locked'});await f.context.window.savePrediction('m','u');
  assert.equal(f.ui.m_u,'error');assert.equal(f.drafts.m_u.homePred,2);
});
test('session hydration reads complete scope once and reports prediction failure',async()=>{
  const calls=[],c={console,useOnlineMode:true,isAuthenticated:()=>true,setAppLoading:()=>{},setAppLoadingCheck:()=>{},
    firebaseRead:async path=>{calls.push(path);return {}},syncSeasonRegistryFromFirebase:async options=>{assert.ok(options.remoteMatches);calls.push('registry')},
    syncUsersFromSheet:async()=>{calls.push('users');return []},syncOnlineMatchesFromSheet:async options=>{assert.ok(options.remoteMatches);assert.equal(options.seasonLabel,'');calls.push('match-sync');return true},
    syncOnlinePredictions:async options=>{assert.equal(options.seasonId,null);calls.push('predictions');return true},validateFreshActiveSelection:()=>{},
    flushPendingPredictionQueue:async()=>({flushed:0}),updateLastSyncLabel:()=>{},recordAdminSyncActivity:()=>{},renderAll:()=>{calls.push('render')},window:{setTimeout:()=>{}},showAlert:()=>{}};
  vm.createContext(c);vm.runInContext(section('async function hydrateOnlineStateForSession(','let welcomeOverlayTimer'),c);
  assert.equal(await c.hydrateOnlineStateForSession(),true);
  assert.deepEqual(calls,['matches','registry','users','match-sync','predictions','render']);
  c.syncOnlinePredictions=async()=>false;assert.equal(await c.hydrateOnlineStateForSession(),false);
});
test('slow initial session check waits without granting cached authority or signing out',async()=>{
  const f=authFixture(),response=deferred();f.context.fetch=()=>response.promise;
  const initializing=f.context.window.SkorxAuth.init();await Promise.resolve();await Promise.resolve();
  assert.equal(f.context.window.SkorxAuth.ready,false);assert.equal(f.stats().signouts,0);
  response.resolve({status:200,ok:true,json:async()=>f.session});await initializing;
  assert.equal(f.context.window.SkorxAuth.ready,true);
});
test('cached session cannot authorize a different Firebase UID',async()=>{
  const f=authFixture();await f.context.window.SkorxAuth.init();f.auth.currentUser={uid:'other'};
  assert.equal(f.context.window.SkorxAuth.ready,false);assert.equal(f.context.window.SkorxAuth.admin,false);
});
test('Google admin remains signed in when data hydration fails',async()=>{
  const f=authFixture();let click,alerts=0;
  f.context.window.firebase.auth.GoogleAuthProvider=class {setCustomParameters(){}};
  f.auth.signInWithPopup=async()=>{};
  f.context.fetch=async()=>({status:200,ok:true,json:async()=>({...f.session,user:{...f.session.user,rol:'admin'}})});
  const button={disabled:false,addEventListener:(_,fn)=>{click=fn}};
  f.context.document.getElementById=()=>button;
  Object.assign(f.context,{state:{settings:{auth:{}}},BACKGROUND_ENTERED_AT_STORAGE_KEY:'background',markUserActivityForIdleLogout:()=>{},
    setAuthenticatedUser:()=>{},forceDefaultLandingAfterLogin:()=>{},switchTab:()=>{},saveState:()=>{},updateLoginOverlay:()=>{},applyRolePermissions:()=>{},ensureFirebaseRealtimeBridge:()=>{},runSessionHydrationWithFastOverlay:async()=>false,startPresenceTracking:()=>{},renderAll:()=>{},showAlert:async()=>{alerts++}});
  f.context.localStorage.removeItem=()=>{};
  f.context.window.SkorxAuth.bind();await click();
  assert.equal(f.context.window.SkorxAuth.admin,true);assert.equal(f.stats().signouts,0);assert.equal(alerts,1);
});
test('delete failure preserves record and draft; acknowledged delete clears them',async()=>{
  const f=predictionFixture(),c=f.context,button={innerText:'Sil',disabled:false};
  f.drafts.m_u={homePred:3,awayPred:1};
  Object.assign(c,{capturePredictionViewport:()=>({}),getLockedPredictionBlockReason:()=>null,document:{getElementById:()=>button},getPrediction:()=>f.state.predictions[0],showConfirm:async()=>true,clearTimeout:()=>{},predictionTimers:{},getCurrentUsername:()=> 'user',getActiveSeasonLabel:()=> 'S',
    setPredictionUiState:(m,p,state)=>{f.ui[m+'_'+p]=state},schedulePredictionViewportRestore:()=>{},clearPredictionDraft:(m,p)=>{delete f.drafts[m+'_'+p]},clearLocalPredictionRecord:()=>{f.state.predictions=[]},dequeuePredictionRetry:()=>{}});
  c.deleteOnlinePrediction=payload=>c.runPredictionWrite(payload,'deletePrediction');
  vm.runInContext(section('window.deletePredictionEntry =','if (typeof window.renderMissingPredictions'),c);
  c.apiPost=async()=>{throw Error('offline')};await c.window.deletePredictionEntry('m','u');
  assert.equal(f.ui.m_u,'deleteError');assert.equal(f.state.predictions.length,1);assert.equal(f.drafts.m_u.homePred,3);
  c.apiPost=async()=>({success:true});await c.window.deletePredictionEntry('m','u');
  assert.equal(f.ui.m_u,'deleted');assert.equal(f.state.predictions.length,0);assert.equal(f.drafts.m_u,undefined);
});
test('realtime bridge is bound once; initial/unchanged snapshots and heartbeat do not redraw',()=>{
  const bindings=new Map();let scheduled=0,renders=0;
  const c={console,firebaseRealtimeBindingsInitialized:false,isFirebaseReady:()=>true,isAuthenticated:()=>true,window:{SkorxAuth:{admin:false}},getFirebaseDb:()=>({ref:path=>({on:(_,fn)=>bindings.set(path,fn)})}),
    renderDashboardAutoSyncStatus:()=>{},appBootstrapInProgress:true,firebaseMatchSnapshotRevision:0,firebaseLatestMatchSnapshot:null,reconcileLocalMatchesWithFirebase:()=>({removed:0}),recalculateAllPoints:()=>{},saveState:()=>{},scheduleFirebaseRealtimeHydration:()=>{scheduled++},debounceFirebaseRealtimeRender:()=>{renders++},firebasePresenceCache:{},state:{settings:{currentTab:'predictions'}}};
  vm.createContext(c);vm.runInContext(section('function ensureFirebaseRealtimeBridge()','let useOnlineMode'),c);
  c.ensureFirebaseRealtimeBridge();const count=bindings.size;c.ensureFirebaseRealtimeBridge();assert.equal(bindings.size,count);
  const initial={val:()=>({a:1}),exists:()=>true},changed={val:()=>({a:2}),exists:()=>true};
  for(const fn of bindings.values()){fn(initial);fn(initial);}assert.equal(scheduled,0);assert.equal(renders,0);
  bindings.get('matches')(changed);assert.equal(scheduled,1);
  bindings.get('presence')(changed);assert.equal(renders,0);
});
test('normal user standings cache stays local; verified admin can persist it',async()=>{
  let writes=0;const c={state:{settings:{}},getLeagueStandingsCacheKey:()=> 's',saveState:()=>{},isFirebaseReady:()=>true,firebaseUpdate:async()=>{writes++},window:{SkorxAuth:{admin:false}}};
  vm.createContext(c);vm.runInContext(section('async function persistLeagueStandingsCache(','function renderLeagueStandingsModal('),c);
  const result=await c.persistLeagueStandingsCache('s',[{points:3}]);assert.equal(result.rows[0].points,3);assert.equal(writes,0);
  c.window.SkorxAuth.admin=true;await c.persistLeagueStandingsCache('s',[{points:3}]);assert.equal(writes,1);
});
test('unchanged card markup does not recreate root or overwrite live input/logo DOM',()=>{
  let replacements=0;const container={firstElementChild:null,set innerHTML(markup){replacements++;this.firstElementChild={markup}}};
  const c={WeakMap};vm.createContext(c);vm.runInContext(section('// Compare generated markup,','function renderFocusedUserPredictions('),c);
  const html='<article><input value="1"></article>';
  assert.equal(c.commitFocusedPredictionMarkup(container,html),true);const root=container.firstElementChild;root.liveInputValue='7';root.logoHydrated=true;
  for(let i=0;i<30;i++)assert.equal(c.commitFocusedPredictionMarkup(container,html),false);
  assert.equal(replacements,1);assert.equal(container.firstElementChild,root);assert.equal(root.liveInputValue,'7');assert.equal(root.logoHydrated,true);
  assert.equal(c.commitFocusedPredictionMarkup(container,'<article><input value="4"></article>'),true);assert.equal(replacements,2);
  container.firstElementChild={otherView:true};assert.equal(c.commitFocusedPredictionMarkup(container,'<article><input value="4"></article>'),true);
});
test('row and property order do not trigger a prediction refresh; changed scores do',()=>{
  const c={};vm.createContext(c);vm.runInContext(section('function predictionResponseFingerprint(','// Increment at both boundaries:'),c);
  const a=[{id:'a',homePred:1,awayPred:0},{id:'b',homePred:2,awayPred:1}];
  const b=[{awayPred:1,homePred:2,id:'b'},{awayPred:0,id:'a',homePred:1}];
  assert.equal(c.predictionResponseFingerprint(a),c.predictionResponseFingerprint(b));
  b[0].homePred=3;assert.notEqual(c.predictionResponseFingerprint(a),c.predictionResponseFingerprint(b));
});
test('banner countdown changes text without replacing controls',()=>{
  function textNode(value){return {nodeType:3,nodeName:'#text',nodeValue:value,cloneNode(){return textNode(this.nodeValue)}};}
  function element(name,value){return {nodeType:1,nodeName:name,childNodes:[textNode(value)],attributes:[],hasAttribute:()=>false,getAttribute:()=>null,removeAttribute:()=>{},setAttribute:()=>{},cloneNode(){return element(name,this.childNodes[0].nodeValue)}};}
  const strong=element('STRONG','10 saniye'),button=element('BUTTON','Bildirim');button.boundHandler={};
  const banner={childNodes:[strong,button],appendChild(){throw Error('unexpected append')},replaceChild(){throw Error('unexpected replacement')}};
  const c = { document: { createElement: () => ({
    set innerHTML(value) {
      const first = value.split('<strong>')[1].split('</strong>')[0];
      const second = value.split('<button>')[1].split('</button>')[0];
      this.content = { childNodes: [element('STRONG', first), element('BUTTON', second)] };
    }
  }) } };
  vm.createContext(c);vm.runInContext(section('function setPredictionBannerMarkup(','function renderPredictionLockBanner('),c);
  for(let i=9;i>=0;i--)c.setPredictionBannerMarkup(banner,`<strong>${i} saniye</strong><button>Bildirim</button>`);
  assert.equal(banner.childNodes[0],strong);assert.equal(banner.childNodes[1],button);assert.equal(strong.childNodes[0].nodeValue,'0 saniye');assert.ok(button.boundHandler);
});
test('participation endpoint exposes status without exposing future scores or raw fields',async()=>{
  const {execute}=require('../server/service.cjs');
  const root={matches:{remote:{id:'remote',seasonId:'s',weekId:'w',date:new Date(Date.now()+86400000).toISOString()}},settings:{weeksMeta:[{id:'w',seasonId:'s',number:1,status:'yayinlandi'}]},predictions:{own:{playerId:'u',sheetMatchId:'remote',homePred:1,awayPred:0},secret:{playerId:'v',sheetMatchId:'remote',homePred:4,awayPred:2,points:3,actorName:'SECRET',updatedAt:'SECRET'},duplicate:{playerId:'v',sheetMatchId:'remote',homePred:4,awayPred:2},partial:{playerId:'x',sheetMatchId:'remote',homePred:'',awayPred:1},orphan:{playerId:'y',sheetMatchId:'missing',homePred:2,awayPred:1}}};
  const service={db:{ref:path=>({get:async()=>({val:()=>root[path]})})}};
  const actor={playerId:'u',admin:false,access:{}};
  const result=await execute(service,actor,'getPredictions');
  assert.deepEqual(result.predictions.map(row=>row.id),['own']);
  assert.deepEqual(result.submissions,[{sheetMatchId:'remote',playerId:'u'},{sheetMatchId:'remote',playerId:'v'}]);
  assert.equal(JSON.stringify(result.submissions).includes('SECRET'),false);
  root.predictions={};assert.deepEqual((await execute(service,actor,'getPredictions')).submissions,[]);
  root.predictions={secret:{playerId:'v',sheetMatchId:'remote',homePred:4,awayPred:2}};
  root.settings.weeksMeta[0].status='hazirlaniyor';assert.deepEqual((await execute(service,actor,'getPredictions')).submissions,[]);
  root.settings.weeksMeta[0].status='yayinlandi';root.matches.remote.played=true;
  assert.equal((await execute(service,actor,'getPredictions')).predictions[0].homePred,4);
});
test('public participation lights avatars without creating score records and disappears after deletion',()=>{
  const f=predictionFixture();
  f.context.applyPredictionSubmissionPresence([{matchId:'m',playerId:'v'}]);
  assert.equal(f.context.hasSubmittedPrediction('m','v'),true);
  assert.equal(f.state.predictions.some(row=>row.playerId==='v'),false);
  f.context.applyPredictionSubmissionPresence([]);assert.equal(f.context.hasSubmittedPrediction('m','v'),false);
});
test('another user submission change refreshes participation even when visible scores stay identical',async()=>{
  const f=authFixture();await f.context.window.SkorxAuth.init();let submissions=[],applied=0;
  f.context.fetch=async()=>({status:200,ok:true,json:async()=>({success:true,predictions:[],submissions})});
  f.context.syncOnlinePredictions=async options=>{assert.ok(options.response);applied++;return true};
  f.context.window.SkorxAuth.startPoll();const tick=[...f.timers.values()][0];await tick();
  submissions=[{sheetMatchId:'remote',playerId:'v'}];await tick();assert.equal(applied,2);
  await tick();assert.equal(applied,2);
  submissions=[];await tick();assert.equal(applied,3);
});
