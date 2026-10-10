'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function section(a,b){const start=code.indexOf(a);return code.slice(start,code.indexOf(b,start));}
const kickoff=Date.parse('2026-10-09T17:00:00Z');
function fixture(minutes=52){
 let now=kickoff+minutes*60000;
 const c={console,Date:class extends Date {static now(){return now}},parseMatchDateTimestamp:v=>Date.parse(v),isMatchLocked:()=>false,
 uid:()=> 'new',getActiveSeasonId:()=> 's',formatPredictionLockCountdown:()=> 'countdown'};
 vm.createContext(c);
 vm.runInContext(section('function calcOutcome(','function getWeekPredictionLockTimestamp(')+section('function hasValidMatchScore(','function comparePredictionStandings(')+section('function applyApiEventToMatch(','function relocateMatchToApiWeek(')+section('function getPremiumMatchState(','function startDashboardClockRefresh('),c);
 return {c,setTime:minutes=>{now=kickoff+minutes*60000},match:{id:'m',date:new Date(kickoff).toISOString(),seasonId:'s',weekId:'w',played:false,homeScore:null,awayScore:null}};
}
const event=(statusText,homeScore,awayScore)=>({apiId:'event',homeTeam:'A',awayTeam:'B',statusText,homeScore,awayScore,postponed:false});
test('45/52 minutes are halftime; 60/75 are second half; no clock tick overwrites halftime with 45',()=>{
 const f=fixture();for(const [minute,phase,label]of [[0,'live',"1'"],[44,'live',"45'"],[45,'halftime','DEVRE ARASI'],[52,'halftime','DEVRE ARASI'],[59,'halftime','DEVRE ARASI'],[60,'live',"46'"],[75,'live',"61'"]]){
  f.setTime(minute);const runtime=f.c.getMatchRuntimeInfo(f.match);assert.equal(runtime.phase,phase);assert.equal(f.c.getMatchClockLabel(f.match,runtime),label);assert.equal(f.c.getPremiumMatchState(f.match).kicker,label);
 }
});
test('verified API halftime and second-half status override an incompatible estimated clock',()=>{
 const f=fixture(52);f.match.statusText='2h';assert.equal(f.c.getPremiumMatchState(f.match).kicker,'2. YARI');
 f.setTime(75);f.match.statusText='ht';assert.equal(f.c.getPremiumMatchState(f.match).kicker,'DEVRE ARASI');
});
test('API live 0-0 awards provisional points without marking the match final',()=>{
 const f=fixture(20);f.c.applyApiEventToMatch(f.match,event('1h',0,0));
 assert.equal(f.match.played,false);assert.equal(f.match.homeScore,null);assert.equal(f.match.liveHomeScore,0);assert.equal(f.c.getMatchDisplayScore(f.match).home,0);
 f.c.state={matches:[f.match],predictions:[{matchId:'m',homePred:0,awayPred:0,points:3}]};f.c.recalculateAllPoints();assert.equal(f.c.state.predictions[0].points,3);assert.equal(f.c.state.predictions[0].provisionalPoints,true);
});
test('halftime and second-half score changes remain live; FT transfers score to final result',()=>{
 const f=fixture(52);f.c.applyApiEventToMatch(f.match,event('ht',1,0));assert.equal(f.match.played,false);assert.equal(f.c.getMatchDisplayScore(f.match).home,1);
 f.setTime(75);f.c.applyApiEventToMatch(f.match,event('2h',2,1));assert.equal(f.match.played,false);assert.equal(f.c.getMatchDisplayScore(f.match).away,1);
 f.setTime(110);f.c.applyApiEventToMatch(f.match,event('ft',2,1));assert.equal(f.match.played,true);assert.equal(f.match.homeScore,2);assert.equal(f.match.awayScore,1);assert.equal(f.match.liveHomeScore,null);assert.equal(f.c.getMatchDisplayScore(f.match).final,true);
});
test('missing scores do not become invented 0-0; a previously received live score is retained',()=>{
 const f=fixture(20);f.c.applyApiEventToMatch(f.match,event('live',null,null));assert.equal(f.c.getMatchDisplayScore(f.match),null);
 f.c.applyApiEventToMatch(f.match,event('live',1,0));f.c.applyApiEventToMatch(f.match,event('live',null,null));assert.equal(f.c.getMatchDisplayScore(f.match).home,1);assert.equal(f.match.played,false);
});
test('pre-kickoff provider 0-0 is not a live score; postponed games clear stale live display',()=>{
 const f=fixture(-10);f.c.applyApiEventToMatch(f.match,event('not started',0,0));assert.equal(f.c.getMatchDisplayScore(f.match),null);
 f.setTime(20);f.c.applyApiEventToMatch(f.match,event('live',1,0));f.c.applyApiEventToMatch(f.match,{...event('postponed',null,null),postponed:true});assert.equal(f.c.getMatchDisplayScore(f.match),null);assert.equal(f.match.played,false);
});
test('manual locked final result is never overwritten by API live or final data',()=>{
 const f=fixture(20);Object.assign(f.match,{played:true,manualScoreLocked:true,homeScore:3,awayScore:2});
 for(const status of ['live','ft'])f.c.applyApiEventToMatch(f.match,event(status,0,0));assert.equal(f.match.homeScore,3);assert.equal(f.match.awayScore,2);assert.equal(f.match.played,true);
});
test('invalid or incomplete score values cannot become displayed live data',()=>{
 const f=fixture(20);for(const value of [null,undefined,'',NaN,-1,1.2])assert.equal(f.c.hasValidMatchScore(value,0),false);
 assert.equal(f.c.hasValidMatchScore(0,0),true);
});
test('live score and halftime survive Firebase transport into a second device without finishing the match',async()=>{
 const f=fixture(52),c=f.c;Object.assign(f.match,{homeTeam:'A',awayTeam:'B'});c.applyApiEventToMatch(f.match,event('ht',1,0));let payload;
 Object.assign(c,{window:{},useOnlineMode:true,getSeasonById:()=>({name:'S'}),getActiveSeasonLabel:()=> 'S',getWeekNumberById:()=>1,sanitizeFirebaseKey:v=>v,firebasePendingMatchWrites:new Set(),addOnlineMatches:async rows=>{payload=rows;return {success:true}},saveState:()=>{}});
 vm.runInContext(section('async function sendMatchesToSheet(','async function syncWeekMatchesToSheet('),c);
 await c.sendMatchesToSheet([f.match],{force:true});assert.equal(payload[0].liveHomeScore,1);assert.equal(payload[0].statusText,'ht');assert.equal(payload[0].played,false);assert.equal(payload[0].homeScore,'');
 const receiver=fixture(52),r=receiver.c;r.state={matches:[],teams:[],predictions:[],settings:{activeSeasonId:'s',activeWeekId:'w'}};
 Object.assign(r,{useOnlineMode:true,isFirebaseReady:()=>true,getSeasonById:()=>({name:'S'}),getActiveSeasonLabel:()=> 'S',firebasePendingMatchWrites:new Set(),sanitizeFirebaseKey:v=>v,firebaseMatchSnapshotRevision:0,firebaseLatestMatchSnapshot:null,
 firebaseSnapshotToArray:map=>Object.entries(map).map(([id,row])=>({...row,id})),reconcileLocalMatchesWithFirebase:()=>{},ensureSeasonFromOnlineLabel:()=>({id:'s'}),getRegisteredWeekForSeason:()=>({id:'w'}),getWeekNumberById:()=>1,
 parseBooleanish:v=>v===true||v===1,parseNumberOrEmpty:v=>v===null||v===undefined||v===''?'':Number(v),normalizeStoredDate:v=>v,normalizeText:v=>String(v).toLowerCase(),getTeamsBySeasonId:()=>[{name:'A'},{name:'B'}],applyMatchSceneOverridesToTeams:()=>{},syncWeekStatus:()=>{},saveState:()=>{},renderAll:()=>{}});
 vm.runInContext(section('async function syncOnlineMatchesFromSheet(','async function fetchOnlineStandings('),r);
 assert.equal(await r.syncOnlineMatchesFromSheet({remoteMatches:{m:payload[0]},silent:true}),true);
 assert.equal(r.state.matches[0].played,false);assert.equal(r.state.matches[0].homeScore,null);assert.equal(r.getMatchDisplayScore(r.state.matches[0]).home,1);assert.equal(r.getPremiumMatchState(r.state.matches[0]).kicker,'DEVRE ARASI');
});
test('match centre renders actual live 0-0, missing score message, and VS only before kickoff',()=>{
 const f=fixture(20),c=f.c,container={innerHTML:''};Object.assign(f.match,{homeTeam:'A',awayTeam:'B'});
 Object.assign(c,{getVisiblePlayersOrdered:()=>[],formatMatchCountdown:()=> 'time',formatDate:()=> 'date',getMatchSceneUrl:()=> '',MATCH_SCENE_DEFAULT:'',teamLogoHtml:()=> '',escapeHtml:v=>v,formatTime:()=> '20:00',getPrediction:()=>null,createGenericAvatarMarkup:()=>'',getPlayerById:()=>null,hydrateTeamLogosIn:()=>{},formatShortDateTime:()=>'',startDashboardClockRefresh:()=>{}});
 vm.runInContext(section('function renderDashboardMatchCards(','function buildDashboardMatchModalBody('),c);
 c.applyApiEventToMatch(f.match,event('live',0,0));c.renderDashboardMatchCards(container,[f.match]);assert.ok(container.innerHTML.includes('0 <span>-</span> 0'));assert.ok(!container.innerHTML.includes('>VS</span>'));
 f.match.liveHomeScore=null;f.match.liveAwayScore=null;c.renderDashboardMatchCards(container,[f.match]);assert.ok(container.innerHTML.includes('Skor verisi bekleniyor'));
 f.setTime(-10);f.match.statusText='';c.renderDashboardMatchCards(container,[f.match]);assert.ok(container.innerHTML.includes('>VS</span>'));
});
test('match centre exact/near counters follow live scoring and manual source remains visible',()=>{
 const f=fixture(20),c=f.c,container={innerHTML:''};Object.assign(f.match,{homeTeam:'A',awayTeam:'B'});
 const players=[{id:'u1',name:'One'},{id:'u2',name:'Two'},{id:'u3',name:'Three'}];
 c.state={matches:[f.match],predictions:[{matchId:'m',playerId:'u1',homePred:0,awayPred:0},{matchId:'m',playerId:'u2',homePred:1,awayPred:1},{matchId:'m',playerId:'u3',homePred:1,awayPred:0}]};
 Object.assign(c,{getVisiblePlayersOrdered:()=>players,formatMatchCountdown:()=> 'time',formatDate:()=> 'date',getMatchSceneUrl:()=> '',MATCH_SCENE_DEFAULT:'',teamLogoHtml:()=> '',escapeHtml:v=>v,formatTime:()=> '20:00',getPrediction:(_,id)=>c.state.predictions.find(p=>p.playerId===id),hasSubmittedPrediction:()=>true,createGenericAvatarMarkup:()=>'',getPlayerById:()=>null,hydrateTeamLogosIn:()=>{},formatShortDateTime:()=>'',startDashboardClockRefresh:()=>{}});
 vm.runInContext(section('function getDashboardPredictionTone(','function getDashboardMatchInsight(')+section('function renderDashboardMatchCards(','function buildDashboardMatchModalBody('),c);
 c.applyApiEventToMatch(f.match,event('1h',0,0));c.recalculateAllPoints();c.renderDashboardMatchCards(container,[f.match]);
 assert.ok(container.innerHTML.includes('<b>1</b><em>tam</em>'));assert.ok(container.innerHTML.includes('<b>1</b><em>yakın</em>'));assert.ok(container.innerHTML.includes('Canlı skor • puanlar geçici'));
 Object.assign(f.match,{played:true,manualScoreLocked:true,homeScore:1,awayScore:0});c.recalculateAllPoints();c.renderDashboardMatchCards(container,[f.match]);
 assert.ok(container.innerHTML.includes('Admin manuel girdi'));assert.ok(container.innerHTML.includes('<b>0</b><em>yakın</em>'));assert.equal(c.state.predictions[2].points,3);
});
test('a stale second-half flag no longer claims a live match forever or manufactures full time',()=>{
 const f=fixture(180);f.match.statusText='2h';f.match.liveHomeScore=2;f.match.liveAwayScore=2;
 assert.equal(f.c.getMatchVisualState(f.match),'finished-time');assert.equal(f.c.getPremiumMatchState(f.match).label,'SONUÇ BEKLİYOR');assert.equal(f.match.played,false);
 f.c.applyApiEventToMatch(f.match,event('',2,2));assert.equal(f.match.played,false);
 f.c.applyApiEventToMatch(f.match,event('FT',2,2));assert.equal(f.match.played,true);assert.equal(f.c.getPremiumMatchState(f.match).label,'BİTTİ');
});
