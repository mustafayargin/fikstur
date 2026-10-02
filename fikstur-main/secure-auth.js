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
    for(let attempt=0;attempt<2;attempt++) {
      const token=await user.getIdToken(attempt===1);
      const response=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action,payload}),cache:'no-store'});
      let result;try{result=await response.json();}catch{throw new Error('Sunucu bağlantısı hazır değil. Tekrar deneyin.');}
      // A request from the previous account must never close or update a new session.
      if(auth().currentUser!==user)throw new Error('Oturum değişti. İşlemi yeniden deneyin.');
      if(response.status===401 && attempt===0)continue;
      if(!response.ok || !result.success) {
        const error=new Error(result.message||'İşlem tamamlanamadı.');
        error.status=response.status;
        if(response.status===401 || result.code==='SESSION_DENIED') {
          await signOut();
          if(typeof logoutUser==='function')logoutUser();
        }
        throw error;
      }
      return result;
    }
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
    try { if(auth().currentUser)session=await request('session'); }catch(error) { console.warn('Oturum doğrulaması tamamlanamadı:',error.message); throw error; }
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
    if(!result.mustChangePassword)return result;
    const email=auth().currentUser.email;
    const previousFocus=document.activeElement;
    return new Promise(resolve=>{
      const overlay=document.createElement('div');overlay.className='password-setup-overlay';
      overlay.innerHTML=`<form class="password-setup-card" role="dialog" aria-modal="true" aria-labelledby="passwordSetupTitle">
        <h2 id="passwordSetupTitle">Kendi şifrenizi oluşturun</h2>
        <p>En az 8 karakter kullanın. Kaydettikten sonra uygulama açılacak.</p>
        <label for="passwordSetupNew">Yeni şifre</label>
        <div class="password-setup-field"><input id="passwordSetupNew" type="password" autocomplete="new-password" minlength="8" maxlength="128" required><button type="button" data-eye="passwordSetupNew" aria-label="Şifreyi göster" aria-pressed="false">◉</button></div>
        <label for="passwordSetupRepeat">Şifre tekrarı</label>
        <div class="password-setup-field"><input id="passwordSetupRepeat" type="password" autocomplete="new-password" minlength="8" maxlength="128" required><button type="button" data-eye="passwordSetupRepeat" aria-label="Şifreyi göster" aria-pressed="false">◉</button></div>
        <p id="passwordSetupStatus" role="status" aria-live="polite"></p>
        <button id="passwordSetupSave" type="submit" disabled>Şifreyi kaydet ve devam et</button>
        <button id="passwordSetupCancel" type="button">Vazgeç</button>
      </form>`;
      document.body.appendChild(overlay);
      const form=overlay.querySelector('form'),first=overlay.querySelector('#passwordSetupNew'),repeat=overlay.querySelector('#passwordSetupRepeat'),status=overlay.querySelector('#passwordSetupStatus'),save=overlay.querySelector('#passwordSetupSave'),cancel=overlay.querySelector('#passwordSetupCancel');
      let saving=false,saved=false;
      const finish=value=>{first.value='';repeat.value='';overlay.remove();previousFocus?.focus();resolve(value);};
      const validate=()=>{
        const valid=first.value.length>=8 && first.value.length<=128 && first.value===repeat.value;
        save.disabled=saving||!valid;
        status.textContent=!first.value&&!repeat.value?'':first.value.length<8?'Şifre en az 8 karakter olmalı.':!repeat.value?'Şifrenizi tekrar yazın.':valid?'Şifreler eşleşiyor ✓':'Şifreler eşleşmiyor.';
        status.dataset.valid=String(valid);
      };
      first.addEventListener('input',validate);repeat.addEventListener('input',validate);
      overlay.querySelectorAll('[data-eye]').forEach(button=>button.addEventListener('click',()=>{
        const input=overlay.querySelector('#'+button.dataset.eye),visible=input.type==='password';
        input.type=visible?'text':'password';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Şifreyi gizle':'Şifreyi göster');
      }));
      cancel.addEventListener('click',async()=>{if(!saving){await signOut();finish(null);}});
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(saving||save.disabled)return;
        saving=true;save.disabled=true;cancel.disabled=true;first.readOnly=true;repeat.readOnly=true;
        status.textContent=saved?'Oturum açılıyor…':'Şifreniz kaydediliyor…';
        try{
          if(!saved){await request('changePassword',{password:first.value});saved=true;}
          // Revoked tokens use second precision. A fresh sign-in must occur after the cutoff.
          await new Promise(r=>setTimeout(r,1100));
          await auth().signInWithEmailAndPassword(email,first.value);
          const fresh=await request('session');
          if(fresh.mustChangePassword)throw new Error('Şifre değişikliği doğrulanamadı.');
          finish(fresh);
        }catch(error){
          status.textContent=saved?'Şifreniz kaydedildi, ancak oturum açılamadı. Devam etmek için yeniden deneyin.':error.message||'Şifre kaydedilemedi.';
          if(saved)save.textContent='Uygulamaya devam et';
          saving=false;save.disabled=false;cancel.disabled=false;first.readOnly=saved;repeat.readOnly=saved;
        }
      });
      overlay.addEventListener('keydown',event=>{
        if(event.key!=='Tab')return;
        const fields=Array.from(overlay.querySelectorAll('input,button')).filter(el=>!el.disabled);
        const start=fields[0],end=fields[fields.length-1];
        if(event.shiftKey&&document.activeElement===start){event.preventDefault();end.focus();}
        else if(!event.shiftKey&&document.activeElement===end){event.preventDefault();start.focus();}
      });
      first.focus();
    });
  }
  async function login(username,password) {
    busy=true;
    try{
      await auth().signInWithEmailAndPassword(await emailFor(username),password);
      const result=await finishPasswordChange(await request('session'));
      if(!result)return {success:false,message:'Şifre oluşturma iptal edildi.'};
      session=result;return result;
    }catch(error){return {success:false,message:error.code?.startsWith('auth/')?'Kullanıcı adı veya şifre hatalı.':error.message};}
    finally{busy=false;}
  }
  async function applySession(result) {
    session=result;
    setAuthenticatedUser({...result.user,sessionStartedAt:new Date().toISOString(),connectedAt:new Date().toISOString()});
    state.settings.auth.isAuthenticated=true;state.settings.auth.role=result.user.rol;
    forceDefaultLandingAfterLogin('auth-login');
    switchTab('dashboard',{skipPersistPrevious:true,skipViewportRestore:true});
    saveState();updateLoginOverlay();applyRolePermissions();
    localStorage.removeItem(BACKGROUND_ENTERED_AT_STORAGE_KEY);markUserActivityForIdleLogout();
    ensureFirebaseRealtimeBridge();startPoll();
    const loaded=await runSessionHydrationWithFastOverlay();startPresenceTracking();renderAll();
    if(!loaded)await showAlert('Giriş yapıldı ancak veriler yüklenemedi. Bağlantıyı kontrol edip Firebase Güncelle ile yeniden deneyin.');
  }
  async function googleLogin() {
    if(busy)return;busy=true;
    const button=document.getElementById('googleAdminLoginBtn');if(button)button.disabled=true;
    try{
      const provider=new window.firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
      await auth().signInWithPopup(provider);
      await auth().currentUser.getIdToken(true);
      const result=await request('session');
      if(result.user.rol!=='admin'){await signOut();throw new Error('Bu Google hesabına admin yetkisi tanımlanmamış.');}
      await applySession(result);
    }catch(error){if(session){await showAlert(error.message||'Veriler yüklenemedi.');return;}setLoginFeedback('error',error.code==='auth/popup-blocked'?'Google giriş penceresine izin verin.':error.message||'Google girişi tamamlanamadı.');}
    finally{busy=false;if(button)button.disabled=false;}
  }
  async function signOut(){
    session=null;stopPoll();if(signingOut)return;signingOut=true;
    try{await auth().signOut();}finally{signingOut=false;}
  }
  function stopPoll(){pollGeneration++;clearTimeout(pollTimer);pollTimer=null;previousPredictions=null;}
  let pollGeneration=0;
  function startPoll(){
    stopPoll();
    if(!session || session.user.rol==='admin')return;
    const generation=pollGeneration;
    const tick=async()=>{
      if(!session || generation!==pollGeneration)return;
      try{
        if(document.visibilityState!=='hidden'){
          const revision=predictionSyncRevision;
          const data=await request('getPredictions'),serialized=predictionResponseFingerprint(data.predictions);
          if(generation!==pollGeneration)return;
          if(serialized!==previousPredictions){
            const applied=await syncOnlinePredictions({seasonId:null,weekId:null,seasonLabel:'',weekNumber:'',response:data,revision,silent:true});
            if(applied){previousPredictions=serialized;debounceFirebaseRealtimeRender();}
          }
        }
      }catch(error){console.warn('Tahmin eşitlemesi bekliyor.');}
      if(session && generation===pollGeneration)pollTimer=setTimeout(tick,3000);
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
  window.SkorxAuth={init,login,request,manage,changeOwn,passwordPrompt,signOut,bind,startPoll,scrub,get session(){return session;},get ready(){return !!session && !!auth().currentUser && session.user.authUid===auth().currentUser.uid;},get admin(){return this.ready && session.user.rol==='admin';}};
})();
