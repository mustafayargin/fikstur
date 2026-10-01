/* Firebase Auth is the source of identity; localStorage never grants permission. */
(() => {
  'use strict';
  let session = null, signingOut = false, busy = false, pollTimer = null, previousPredictions = null;
  const normalize = v => String(v||'').trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/\s+/g,' ');
  async function emailFor(name) {
    const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalize(name)));
    return `u.${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}@accounts.skorx.invalid`;
  }
  const auth = () => window.firebase.auth();
  async function request(action,payload={}) {
    const user=auth().currentUser;
    if(!user) throw new Error('Giriş yapmanız gerekiyor.');
    const token=await user.getIdToken();
    const response=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action,payload}),cache:'no-store'});
    let result;try{result=await response.json();}catch{throw new Error('Sunucu bağlantısı hazır değil.');}
    if(!response.ok || !result.success) {
      if(response.status===401 || (response.status===403 && action==='session')) await signOut();
      throw new Error(result.message||'İşlem tamamlanamadı.');
    }
    return result;
  }
  function scrub(value) {
    if(Array.isArray(value))return value.map(scrub);
    if(!value || typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).filter(([k])=>!/^(sifre|password|adminPassword|temporaryPassword)$/i.test(k)).map(([k,v])=>[k,scrub(v)]));
  }
  function wipeOldCache() {
    for(const name of ['fikstur_tahmin_paneli_v4','fikstur_tahmin_paneli_v2']){
      try{const raw=localStorage.getItem(name);if(!raw)continue;const value=scrub(JSON.parse(raw));if(value.settings?.auth)value.settings.auth={isAuthenticated:false,role:'user',playerId:null,user:null};value.players=[];value.predictions=[];localStorage.setItem(name,JSON.stringify(value));}catch{localStorage.removeItem(name);}
    }
  }
  async function init() {
    await auth().setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    await new Promise(resolve=>{const unsub=auth().onAuthStateChanged(()=>{unsub();resolve();});});
    try { if(auth().currentUser)session=await request('session'); }catch { await signOut(); }
    auth().onIdTokenChanged(user=>{
      if(!user && session){session=null;stopPoll();if(typeof logoutUser==='function')logoutUser();}
    });
    if(session?.mustChangePassword)await signOut();
    return session;
  }
  async function passwordPrompt(message,title='Şifre değiştir') {
    return openAppModal({type:'prompt',title,message,inputValue:'',inputPlaceholder:'En az 8 karakter',inputType:'password'});
  }
  async function finishPasswordChange(result) {
    if(!result.mustChangePassword)return true;
    const next=await passwordPrompt('Geçici şifrenizi kullanmaya devam edemezsiniz. Kendinize en az 8 karakterlik yeni bir şifre belirleyin.');
    if(!next){await signOut();return false;}
    if(next.length<8){await showAlert('Şifre en az 8 karakter olmalı.');return finishPasswordChange(result);}
    const repeat=await passwordPrompt('Yeni şifrenizi tekrar yazın.');
    if(next!==repeat){await showAlert('Şifreler eşleşmedi.');return finishPasswordChange(result);}
    await request('changePassword',{password:next});
    await signOut();await showAlert('Şifreniz değişti. Yeni şifrenizle giriş yapın.');return false;
  }
  async function login(username,password) {
    busy=true;
    try{
      await auth().signInWithEmailAndPassword(await emailFor(username),password);
      const result=await request('session');
      if(!(await finishPasswordChange(result)))return {success:false,message:'Yeni şifrenizle giriş yapın.'};
      session=result;return result;
    }catch(error){await signOut();return {success:false,message:error.code?.startsWith('auth/')?'Kullanıcı adı veya şifre hatalı.':error.message};}
    finally{busy=false;}
  }
  async function applySession(result) {
    session=result;
    setAuthenticatedUser({...result.user,sessionStartedAt:new Date().toISOString(),connectedAt:new Date().toISOString()});
    state.settings.auth.isAuthenticated=true;state.settings.auth.role=result.user.rol;
    forceDefaultLandingAfterLogin('auth-login');saveState();updateLoginOverlay();applyRolePermissions();
    ensureFirebaseRealtimeBridge();startPoll();
    await hydrateFromFirebaseRealtime('login-auth');startPresenceTracking();renderAll();
  }
  async function googleLogin() {
    if(busy)return;busy=true;
    const button=document.getElementById('googleAdminLoginBtn');if(button)button.disabled=true;
    try{
      const provider=new window.firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
      await auth().signInWithPopup(provider);
      await auth().currentUser.getIdToken(true);
      const result=await request('session');
      if(result.user.rol!=='admin')throw new Error('Bu Google hesabına admin yetkisi tanımlanmamış.');
      await applySession(result);
    }catch(error){await signOut();setLoginFeedback('error',error.code==='auth/popup-blocked'?'Google giriş penceresine izin verin.':error.message||'Google girişi tamamlanamadı.');}
    finally{busy=false;if(button)button.disabled=false;}
  }
  async function signOut(){
    session=null;stopPoll();if(signingOut)return;signingOut=true;
    try{await auth().signOut();}finally{signingOut=false;}
  }
  function stopPoll(){clearTimeout(pollTimer);pollTimer=null;previousPredictions=null;}
  function startPoll(){
    stopPoll();
    if(!session || session.user.rol==='admin')return;
    const tick=async()=>{
      if(!session)return;
      try{
        if(document.visibilityState!=='hidden'){
          const data=await request('getPredictions'),serialized=JSON.stringify(data.predictions);
          if(serialized!==previousPredictions){previousPredictions=serialized;scheduleFirebaseRealtimeHydration('secure-predictions');}
        }
      }catch(error){console.warn('Tahmin eşitlemesi bekliyor.');}
      if(session)pollTimer=setTimeout(tick,3000);
    };
    pollTimer=setTimeout(tick,3000);
  }
  async function showTemporary(result){
    if(result.temporaryPassword){
      const closed=openAppModal({type:'info',title:'Geçici şifre — yalnızca şimdi gösterilir',message:`Geçici şifre: ${result.temporaryPassword}\n\nBu şifreyi kullanıcıya özel olarak iletin. İlk girişte değiştirmesi istenecek.`,confirmText:'Kaydettim, kapat'});
      const copy=document.createElement('button');
      copy.type='button';copy.id='temporaryPasswordCopyBtn';copy.textContent='Geçici şifreyi kopyala';
      copy.style.cssText='display:block;width:100%;padding:12px;margin-top:16px;border-radius:10px;cursor:pointer;';
      const copyPassword=async()=>{
        try{
          if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(result.temporaryPassword);
          else {
            const field=document.createElement('textarea');field.value=result.temporaryPassword;
            field.style.cssText='position:fixed;opacity:0;';document.body.appendChild(field);
            try{field.select();if(!document.execCommand('copy'))throw new Error('copy');}finally{field.value='';field.remove();}
          }
          copy.textContent='Kopyalandı ✓';
        }catch{copy.textContent='Kopyalanamadı; şifreyi seçip kopyalayın';}
      };
      copy.addEventListener('click',copyPassword);
      document.getElementById('appModalText')?.after(copy);
      try{await closed;}finally{
        copy.removeEventListener('click',copyPassword);copy.remove();
        const text=document.getElementById('appModalText');if(text)text.textContent='';
        result.temporaryPassword=undefined;
      }
    }
    return result;
  }
  async function manage(action,payload){return showTemporary(await request(action,payload));}
  async function changeOwn(){
    if(!session || session.user.rol==='admin')return;
    try{
      const old=await passwordPrompt('Mevcut şifrenizi yazın.','Kimliğinizi doğrulayın');if(!old)return;
      const user=auth().currentUser;
      await user.reauthenticateWithCredential(window.firebase.auth.EmailAuthProvider.credential(user.email,old));
      const next=await passwordPrompt('Yeni şifrenizi yazın.');if(!next)return;
      const repeat=await passwordPrompt('Yeni şifrenizi tekrar yazın.');if(next!==repeat)throw new Error('Şifreler eşleşmedi.');
      await request('changePassword',{password:next});await signOut();logoutUser();await showAlert('Şifreniz değişti. Yeniden giriş yapın.');
    }catch(error){await showAlert(error.code?.startsWith('auth/')?'Mevcut şifre doğrulanamadı.':error.message);}
  }
  function bind(){document.getElementById('googleAdminLoginBtn')?.addEventListener('click',googleLogin);startPoll();}
  wipeOldCache();
  window.SkorxAuth={init,login,request,manage,changeOwn,passwordPrompt,signOut,bind,startPoll,scrub,get session(){return session;},get ready(){return !!session && !!auth().currentUser;},get admin(){return !!session && session.user.rol==='admin' && !!auth().currentUser;}};
})();
