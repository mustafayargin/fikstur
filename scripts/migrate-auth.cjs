'use strict';
// Run locally, with credentials in environment variables. Dry-run is the default.
// No password, credential, or raw database dump is printed or stored by this tool.
const {services}=require('../server/firebase.cjs');
const p=require('../server/policy.cjs');
async function run({args=process.argv.slice(2),env=process.env,servicesFactory=services,log=console.log}={}){
 const apply=args.includes('--apply');
 const val=name=>args[args.indexOf(name)+1];
 if(!args.includes('--admin-player-id'))throw new Error('--admin-player-id gerekli. Mevcut admin kaydının kimliğini belirtin.');
 if(!env.ADMIN_EMAIL)throw new Error('ADMIN_EMAIL ortam değişkeni gerekli.');
 if(apply && !args.includes('--backup-confirmed'))throw new Error('Önce Firebase JSON yedeğini güvenli yere indirin; sonra --backup-confirmed ekleyin.');
 const {auth,db}=servicesFactory(),root=(await db.ref().get()).val()||{},users=root.users||{};
 if(root.serverPrivate?.authMigration?.version===1){
  if(apply)throw new Error('Geçiş daha önce tamamlanmış. Tekrar çalıştırmak yerine panelden hesap yönetin.');
  log('Geçiş daha önce tamamlanmış; veri değiştirilmedi.');return;
 }
 const adminId=p.key(val('--admin-player-id'));
 if(!users[adminId])throw new Error('Admin kayıt kimliği mevcut users içinde bulunamadı.');
 const seen=new Set();
 const entries=Object.entries(users);
 for(const [id,u] of entries){
  p.key(id);const username=p.normalizeName(u.kullaniciAdi||u.username||u.adSoyad);
  if(!username || seen.has(username))throw new Error('Boş veya çakışan kullanıcı adı var. Önce kullanıcı adlarını düzeltin.');
  seen.add(username);
 }
 let admin;
 try{admin=await auth.getUserByEmail(env.ADMIN_EMAIL.trim());}catch(e){if(e.code!=='auth/user-not-found')throw e;}
 if(!admin?.emailVerified || !admin.providerData.some(v=>v.providerId==='google.com'))throw new Error('Önce ayrı test dağıtımında kendi Gmail hesabınızla Google girişini bir kez deneyin. Yetki yok mesajı normal; sonra bu aracı çalıştırın.');
 if(admin.disabled)throw new Error('Google admin hesabı devre dışı.');
 log(`Mod: ${apply?'APPLY':'DRY-RUN'} | kullanıcı: ${entries.length} | admin kimliği: ${adminId}`);
 // Clean all archived password fields too. Do not restore the old dump after cutover.
 const sanitized=p.clean(root),updates={};
 for(const node of Object.keys(sanitized))if(!['authAccess','serverPrivate'].includes(node))updates[node]=sanitized[node];
 updates.authAccess={};
 for(const [id,u] of entries){
  const isAdmin=id===adminId,uid=isAdmin?admin.uid:p.accountUid(id);
  const profile={...p.clean(u),id,authUid:uid,rol:isAdmin?'admin':'user',panelAdmin:isAdmin,aktif:u.aktif!==false};
  let existing;try{existing=await auth.getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
  if(!isAdmin && existing && existing.email!==p.accountEmail(u.kullaniciAdi||u.username||u.adSoyad))throw new Error(`Hesap kimliği çakışıyor: ${id}`);
  // Random unknown password blocks use of the previously exposed plaintext password.
  // Admin issues a temporary password from the panel after migration.
  if(apply){
   if(!isAdmin && !existing)await auth.createUser({uid,email:p.accountEmail(u.kullaniciAdi||u.username||u.adSoyad),password:p.temporaryPassword(),displayName:String(u.adSoyad||u.kullaniciAdi),disabled:u.aktif===false});
   if(!isAdmin && existing){await auth.updateUser(uid,{password:p.temporaryPassword(),disabled:u.aktif===false});await auth.revokeRefreshTokens(uid);}
   await auth.setCustomUserClaims(uid,isAdmin?{admin:true}:{});
  }
  const prev=root.authAccess?.[uid]||{};
  updates.authAccess[uid]={...prev,playerId:id,role:isAdmin?'admin':'user',active:u.aktif!==false,mustChangePassword:!isAdmin,...(!isAdmin?{revokeTime:Math.floor(Date.now()/1000)}:{})};
  updates.users[id]=profile;
  log(`${id}: ${isAdmin?'Google admin':'Authentication kullanıcı'} | tahmin kimliği korunuyor`);
 }
 if(apply){updates['serverPrivate/authMigration']={version:1,completedAt:new Date().toISOString(),adminUid:admin.uid};await db.ref().update(updates);log('Geçiş tamamlandı. Rules dosyasını yayınlayın; ardından Google admin oturumunu kapatıp yeniden açın. Kullanıcılara panelden ayrı geçici şifre verin.');}
 else log('Veri değişmedi. Yedek ve bakım hazır olduğunda --apply --backup-confirmed ile çalıştırın.');
}
module.exports={run};
if (require.main === module) {
  run()
    .catch(e => {
      console.error('Geçiş durduruldu:', e.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { getApps, deleteApp } = require('firebase-admin/app');
      await Promise.all(getApps().map(app => deleteApp(app)));
    });
}
