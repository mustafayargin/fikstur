// Tests connect only to the loopback demo emulator, never the production database.
for(const name of Object.keys(process.env)) if(/^(https?|all|wss?)_proxy$/i.test(name)) delete process.env[name];
const fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,get,set,update}=require('firebase/database');
const assert=require('node:assert/strict');
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-skorx',database:{host:'127.0.0.1',port:9009,rules:fs.readFileSync('database.rules.json','utf8')}});
 try{
  const now=Math.floor(Date.now()/1000),profile=id=>({id,authUid:`uid-${id}`,aktif:true,rol:id==='admin'?'admin':'user',panelAdmin:id==='admin'});
  await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database()),{users:{a:profile('a'),b:profile('b'),admin:profile('admin')},authAccess:{'uid-a':{playerId:'a',role:'user',active:true},'uid-b':{playerId:'b',role:'user',active:true},'uid-admin':{playerId:'admin',role:'admin',active:true}},matches:{m:{id:'m'}},predictions:{own:{id:'own',matchId:'m',playerId:'a'},other:{id:'other',matchId:'m',playerId:'b'}},settings:{weeksMeta:[{id:'w'}],dataManagementTrash:{private:{secret:'private'}}},fcmTokens:{deviceB:{authUid:'uid-b',playerId:'b',userId:'b'}},serverPrivate:{secret:'private'}}));
  const anon=env.unauthenticatedContext().database();
  const user=env.authenticatedContext('uid-a',{auth_time:now}).database();
  const admin=env.authenticatedContext('uid-admin',{auth_time:now,admin:true}).database();
  const forged=env.authenticatedContext('uid-a',{auth_time:now,admin:true}).database();
  let count=0;
  async function deny(db,path,value){await assertFails(value===undefined?get(ref(db,path)):set(ref(db,path),value));count++;}
  async function allow(db,path,value){await assertSucceeds(value===undefined?get(ref(db,path)):set(ref(db,path),value));count++;}
  for(const path of ['users','matches','predictions','settings','authAccess','fcmTokens'])await deny(anon,path);
  await allow(user,'users');await allow(user,'matches');await allow(user,'settings/weeksMeta');
  await deny(user,'settings');await deny(user,'settings/dataManagementTrash');await deny(user,'authAccess');await deny(admin,'authAccess');await deny(admin,'serverPrivate');
  await deny(user,'predictions');await allow(user,'predictions/own');await deny(user,'predictions/other');
  await deny(user,'matches/m',{id:'m',score:9});await deny(user,'predictions/own',{id:'own',matchId:'m',playerId:'a'});
  await deny(user,'users/a/rol','admin');await deny(forged,'matches/m',{id:'m'});
  await allow(admin,'matches/m',{id:'m',score:1});await allow(admin,'predictions');
  await deny(admin,'users/a/sifre','SHOULD_NOT_STORE');await deny(admin,'users/a/authUid','uid-admin');
  await deny(user,'presence/b/session',{id:'fake'});
  await allow(user,'presence/a/session',{id:'a',lastSeen:new Date().toISOString()});
  await deny(user,'fcmTokens/deviceB',{authUid:'uid-a',playerId:'a',userId:'a'});
  await allow(user,'fcmTokens/deviceA',{authUid:'uid-a',playerId:'a',userId:'a',token:'dummy'});
  await env.withSecurityRulesDisabled(ctx=>update(ref(ctx.database(),'authAccess/uid-a'),{mustChangePassword:true}));
  await deny(user,'matches');await deny(user,'predictions/own');
  await env.withSecurityRulesDisabled(ctx=>update(ref(ctx.database(),'authAccess/uid-a'),{mustChangePassword:false,revokeTime:now}));
  await deny(user,'matches');
  console.log(`Realtime Database emulator: ${count} access checks passed.`);
 }finally{await env.cleanup();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
