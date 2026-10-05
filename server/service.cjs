'use strict';
const p = require('./policy.cjs');
const read = async (db,path) => (await db.ref(path).get()).val();
async function identify(auth,db,token) {
  let decoded; try { decoded = await auth.verifyIdToken(token,true); } catch(error) {
    if (!['auth/id-token-expired','auth/id-token-revoked','auth/invalid-id-token','auth/argument-error','auth/user-disabled','auth/user-not-found'].includes(error.code)) throw error;
    throw new p.Fault(401,'Oturum geçersiz. Yeniden giriş yapın.');
  }
  const access = await read(db,`authAccess/${decoded.uid}`);
  if (!access || access.active !== true) throw Object.assign(new p.Fault(403,'Bu hesap uygulamaya yetkili değil.'),{publicCode:'SESSION_DENIED'});
  const profile = await read(db,`users/${p.key(access.playerId)}`);
  if (!profile || profile.aktif === false || profile.authUid !== decoded.uid) throw Object.assign(new p.Fault(403,'Hesabınız pasif veya eşleştirilmemiş.'),{publicCode:'SESSION_DENIED'});
  if (access.revokeTime && Number(decoded.auth_time) <= Number(access.revokeTime)) throw new p.Fault(401,'Oturum sonlandırılmış. Yeniden giriş yapın.');
  return {authTime:Number(decoded.auth_time),uid:decoded.uid,playerId:String(access.playerId),access,profile,admin:decoded.admin === true && access.role === 'admin'};
}
async function execute({auth,db},actor,action,payload={}) {
  if (action === 'session') return {success:true,user:{...p.clean(actor.profile),id:actor.playerId,playerId:actor.playerId,rol:actor.admin?'admin':'user',panelAdmin:actor.admin,authUid:actor.uid},mustChangePassword:actor.access.mustChangePassword === true};
  if (actor.access.mustChangePassword === true && action !== 'changePassword') throw new p.Fault(403,'Önce geçici şifrenizi değiştirin.');
  if (action === 'getSettings') {
    const settings = p.clean(await read(db,'settings') || {});
    for (const key of ['dataManagementTrash','auditLogs','connectionTest']) delete settings[key];
    return {success:true,settings};
  }
  if (action === 'registerFcmToken') {
    const token=String(payload.token || '');
    if(token.length<20 || token.length>4096)throw new p.Fault(400,'Bildirim tokenı geçersiz.');
    const deviceId=p.key(payload.deviceId || payload.deviceKey);
    const id=`device_${p.accountUid(`${actor.uid}:${deviceId}`).slice(6)}`;
    const existing=await read(db,'fcmTokens') || {},updates={};
    for(const [old,row]of Object.entries(existing))if(old!==id && row?.token===token)updates[`fcmTokens/${p.key(old)}`]=null;
    updates[`fcmTokens/${id}`]={token,deviceId,authUid:actor.uid,userId:actor.playerId,playerId:actor.playerId,displayName:actor.profile.adSoyad || actor.profile.kullaniciAdi,username:actor.profile.kullaniciAdi || '',role:actor.admin?'admin':'user',permission:'granted',userAgent:String(payload.userAgent || '').slice(0,500),platform:String(payload.platform || '').slice(0,100),updatedAt:new Date().toISOString()};
    await db.ref().update(updates);
    return {success:true};
  }
  if (action === 'changePassword') {
    if (actor.admin) throw new p.Fault(400,'Google hesabının şifresini Google üzerinden değiştirin.');
    if (Date.now()/1000 - actor.authTime > 300) throw new p.Fault(401,'Şifre değiştirmek için yeniden giriş yapın.');
    const next = p.password(payload.password || payload.sifre);
    await auth.updateUser(actor.uid,{password:next});
    // Existing ID tokens remain subject to revokeTime in rules and checkRevoked in API.
    await auth.revokeRefreshTokens(actor.uid);
    const revokeTime = Math.floor(Date.now()/1000);
    await db.ref(`authAccess/${actor.uid}`).update({mustChangePassword:false,revokeTime});
    return {success:true,message:'Şifre değişti. Yeni şifrenizle yeniden giriş yapın.'};
  }
  if (action === 'getPredictions') {
    const [predictions,matches,settings] = await Promise.all([read(db,'predictions'),read(db,'matches'),read(db,'settings')]);
    const visible = Object.entries(predictions || {}).filter(([,v])=>p.canReveal(actor,v,matches||{},settings||{})).map(([id,v])=>({...p.clean(v),id}));
    // Publish participation only; never a score, points, timestamp or raw record.
    const submissions = new Map();
    for (const row of Object.values(predictions || {})) {
      const home = row.homePred ?? row.tahminEv;
      const away = row.awayPred ?? row.tahminDep;
      if ([home,away].some(v => v === '' || v === null || v === undefined || !Number.isInteger(Number(v)) || Number(v)<0 || Number(v)>99)) continue;
      try {
        const [sheetMatchId,rawMatch] = p.resolveMatch(row,matches || {});
        const match = p.contextualMatch(rawMatch,settings || {});
        const week = Object.values(settings?.weeksMeta || {}).find(w => String(w.id)===match.weekId);
        if (!actor.admin && (!week || !['aktif','yayinlandi','tamamlandi'].includes(week.status))) continue;
        const playerId = String(row.playerId || row.kullaniciId || '');
        if (playerId) submissions.set(JSON.stringify([sheetMatchId,playerId]),{sheetMatchId,playerId});
      } catch { /* Orphan records cannot claim participation in a match. */ }
    }
    return {success:true,predictions:visible,submissions:[...submissions.values()]};
  }
  if (action === 'savePrediction' || action === 'deletePrediction') {
    const [matches,settings,preds,users] = await Promise.all([read(db,'matches'),read(db,'settings'),read(db,'predictions'),read(db,'users')]);
    const [remoteId,rawMatch] = p.resolveMatch(payload,matches||{});
    const match=p.contextualMatch(rawMatch,settings||{});
    const playerId = p.key(payload.playerId || payload.kullaniciId);
    if (!users?.[playerId]) throw new p.Fault(400,'Tahmin sahibi bulunamadı.');
    p.assertPredictionAllowed(actor,playerId,match,matches||{},settings||{});
    const linked = Object.entries(preds||{}).filter(([,v])=>{
      if(String(v.playerId || v.kullaniciId)!==playerId) return false;
      try { return p.resolveMatch(v,matches)[0]===remoteId; } catch { return false; }
    });
    const id = p.key(linked[0]?.[0] || `${remoteId}__${playerId}`);
    const updates = {};
    const now = new Date().toISOString();
    let record = null;
    if (action === 'savePrediction') {
      const score = v=>{ if(v==='' || v===null || v===undefined || !Number.isInteger(Number(v)) || Number(v)<0 || Number(v)>99) throw new p.Fault(400,'Tahmin skoru 0–99 arasında tam sayı olmalı.'); return Number(v); };
      const homePred=score(payload.homePred ?? payload.tahminEv),awayPred=score(payload.awayPred ?? payload.tahminDep);
      record={id,predictionId:id,matchId:String(linked[0]?.[1]?.matchId || payload.matchId || remoteId),localMatchId:String(payload.matchId || remoteId),sheetMatchId:remoteId,playerId,kullaniciId:playerId,season:match.season||match.sezon||'',sezon:match.sezon||match.season||'',seasonId:match.seasonId||'',weekId:match.weekId||'',weekNo:match.weekNo||match.haftaNo||'',haftaNo:match.haftaNo||match.weekNo||'',homeTeam:match.homeTeam||'',awayTeam:match.awayTeam||'',homePred,awayPred,tahminEv:homePred,tahminDep:awayPred,kullaniciAdi:users[playerId].kullaniciAdi||'',adSoyad:users[playerId].adSoyad||'',playerName:users[playerId].adSoyad||'',actorId:actor.playerId,actorName:actor.profile.adSoyad||'',actorRole:actor.admin?'admin':'user',updatedAt:now};
    }
    updates[`predictions/${id}`]=record;
    for(const [duplicate] of linked) if(duplicate!==id) updates[`predictions/${duplicate}`]=null;
    const logId=db.ref('predictionLogs').push().key;
    updates[`predictionLogs/${logId}`]={id:logId,type:'prediction',actionType:action==='deletePrediction'?'delete':linked.length?'update':'create',predictionId:id,playerId,matchId:record?.matchId||linked[0]?.[1]?.matchId||remoteId,sheetMatchId:remoteId,seasonId:match.seasonId||'',weekId:match.weekId||'',actorId:actor.playerId,actorName:actor.profile.adSoyad||'',actorRole:actor.admin?'admin':'user',oldRecord:linked[0]?.[1]||null,newRecord:record,createdAt:now};
    await db.ref().update(updates);
    return {success:true,id,predictionId:id,sheetMatchId:remoteId};
  }
  if (!actor.admin && action === 'updateUser' && String(payload.id) === actor.playerId && Object.keys(payload).every(k => ['id','supportedTeam'].includes(k))) {
    const supportedTeam=String(payload.supportedTeam || '').trim().slice(0,80);
    await db.ref(`users/${actor.playerId}`).update({supportedTeam,updatedAt:new Date().toISOString()});
    return {success:true,id:actor.playerId};
  }
  if (!actor.admin) throw new p.Fault(403,'Bu işlem için admin yetkisi gerekiyor.');
  if (action === 'forceLogout') {
    const id=p.key(payload.id),profile=await read(db,`users/${id}`);
    if(!profile?.authUid) throw new p.Fault(404,'Kullanıcı bulunamadı.');
    const access=await read(db,`authAccess/${profile.authUid}`);
    if(access?.role==='admin') throw new p.Fault(403,'Admin oturumu bu panelden kapatılamaz.');
    await auth.revokeRefreshTokens(profile.authUid);
    await db.ref().update({[`authAccess/${profile.authUid}/revokeTime`]:Math.floor(Date.now()/1000),[`users/${id}/forcedLogoutAt`]:new Date().toISOString(),[`presence/${id}`]:null});
    return {success:true};
  }
  if (action === 'addUser') {
    const name=String(payload.adSoyad||'').trim();
    const username=p.normalizeName(payload.kullaniciAdi||name);
    if(!name || name.length>80 || username.length<2 || username.length>60) throw new p.Fault(400,'Kullanıcı adı 2–60 karakter olmalı.');
    const users=await read(db,'users') || {};
    if(Object.values(users).some(u=>p.normalizeName(u.kullaniciAdi)===username)) throw new p.Fault(409,'Kullanıcı adı zaten var.');
    const id=p.key(payload.id || `player-${p.accountUid(username).slice(6,30)}`);
    if(users[id]) throw new p.Fault(409,'Kullanıcı kimliği zaten var.');
    const temp=payload.sifre?p.password(payload.sifre):p.temporaryPassword();
    const uid=p.accountUid(id);
    // Auth email/UID uniqueness also closes concurrent create races.
    await auth.createUser({uid,email:p.accountEmail(username),password:temp,displayName:name});
    const user={id,kullaniciAdi:username,adSoyad:name.toLocaleUpperCase('tr-TR'),rol:'user',panelAdmin:false,aktif:true,authUid:uid,supportedTeam:String(payload.supportedTeam||'').slice(0,80),seasonStates:payload.seasonStates||{},createdAt:new Date().toISOString()};
    try { await db.ref().update({[`users/${id}`]:user,[`authAccess/${uid}`]:{playerId:id,role:'user',active:true,mustChangePassword:true}}); }
    catch(error){ await auth.deleteUser(uid).catch(()=>{}); throw error; }
    return {success:true,id,user,temporaryPassword:temp};
  }
  if(action === 'updateUser' || action === 'deleteUser') {
    const id=p.key(payload.id),current=await read(db,`users/${id}`);
    if(!current || !current.authUid) throw new p.Fault(409,'Kullanıcı Authentication ile eşleştirilmemiş.');
    const target=await read(db,`authAccess/${current.authUid}`);
    if(target?.role==='admin') throw new p.Fault(403,'Admin hesabı bu ekrandan değiştirilemez.');
    if(payload.panelAdmin===true || payload.rol==='admin') throw new p.Fault(403,'Admin yetkisi bu panelden verilemez.');
    if(payload.kullaniciAdi && p.normalizeName(payload.kullaniciAdi)!==p.normalizeName(current.kullaniciAdi)) throw new p.Fault(400,'Giriş adını değiştirmek bu sürümde desteklenmiyor.');
    const updates={},next={...p.clean(current),authUid:current.authUid};
    let temp;
    if(payload.sifre || payload.resetPassword) {
      temp=payload.sifre?p.password(payload.sifre):p.temporaryPassword();
      await auth.updateUser(current.authUid,{password:temp});
      await auth.revokeRefreshTokens(current.authUid);
      updates[`authAccess/${current.authUid}/mustChangePassword`]=true;
      updates[`authAccess/${current.authUid}/revokeTime`]=Math.floor(Date.now()/1000);
    }
    if(action==='deleteUser' || Object.hasOwn(payload,'aktif')) {
      const active=action!=='deleteUser' && payload.aktif!==false;
      await auth.updateUser(current.authUid,{disabled:!active});
      if(!active) { await auth.revokeRefreshTokens(current.authUid); updates[`authAccess/${current.authUid}/revokeTime`]=Math.floor(Date.now()/1000); }
      next.aktif=active; updates[`authAccess/${current.authUid}/active`]=active;
    }
    for(const field of ['adSoyad','supportedTeam','seasonStates','seasonMemberships','activeSeasons']) if(Object.hasOwn(payload,field)) next[field]=payload[field];
    next.updatedAt=new Date().toISOString(); updates[`users/${id}`]=next;
    await db.ref().update(updates);
    return {success:true,id,user:next,...(temp?{temporaryPassword:temp}:{})};
  }
  throw new p.Fault(400,'Bilinmeyen işlem.');
}
module.exports={identify,execute};
