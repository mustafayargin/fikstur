/* Login view: only presentation. Authentication remains in app.js. */
(() => {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return;
  overlay.classList.add('arena-login');
  overlay.innerHTML = `<div class="arena-login__layout">
    <div class="arena-login__brand"><img src="images/login/logo.webp" alt="Maç Analiz Merkezi logosu"><h1>Maç Analiz Merkezi</h1><p>VERİYLE DAHA FAZLA FUTBOL</p></div>
    <div class="login-card" id="arenaLoginCard">
      <div class="arena-login__form" id="arenaLoginForm">
        <form id="arenaAuthForm" autocomplete="on">
        <h2>Panele Giriş Yap</h2>
        <label for="loginUsername">Kullanıcı adı</label>
        <input id="loginUsername" name="username" type="text" autocomplete="username" maxlength="100" placeholder="Kullanıcı adınızı girin">
        <label for="loginPassword">Şifre</label>
        <div class="arena-login__password"><input id="loginPassword" name="password" type="password" autocomplete="current-password" placeholder="Şifrenizi girin"><button type="button" id="arenaPasswordToggle" aria-label="Şifreyi göster">◉</button></div>
        <div class="arena-login__links"><button type="button" id="arenaForgot">Şifremi unuttum</button></div>
        <button class="arena-login__primary" id="loginBtn" type="submit">Giriş Yap</button>
        <p class="arena-login__status" id="loginStatus" role="status" aria-live="polite">Hazır.</p>
        <div class="arena-login__signup">Hesabın yok mu? <button type="button" id="arenaSignup">Kaydol</button></div>
        </form>
        <section id="arenaSignupPanel" class="arena-login__future" hidden>
          <h2 tabindex="-1">Kayıt ol</h2><p>Yeni kayıt işlemleri henüz açılmadı. Firebase Authentication geçişinde bu ekran etkinleşecek.</p>
          <button type="button" class="arena-login__back" data-arena-back>← Girişe dön</button>
        </section>
        <section id="arenaResetPanel" class="arena-login__future" hidden>
          <h2 tabindex="-1">Şifremi unuttum</h2><p>Şifre sıfırlama işlemleri henüz açılmadı. Yardım için yöneticiyle iletişime geçin.</p>
          <button type="button" class="arena-login__back" data-arena-back>← Girişe dön</button>
        </section>
      </div>
      <section id="arenaPenalty" class="arena-login__penalty" hidden aria-live="polite">
        <div id="penalty-scene" class="penalty-scene" data-state="preparing" aria-hidden="true">
          <svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="pitch-glow" x2="0" y2="1"><stop stop-color="#152c24"/><stop offset="1" stop-color="#081813"/></linearGradient><pattern id="goal-net" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#9eada9" stroke-opacity=".32" stroke-width=".8"/></pattern></defs>
            <rect width="400" height="240" rx="16" fill="#0b1116"/><path d="M48 98H352L400 240H0Z" fill="url(#pitch-glow)"/>
            <g fill="#ff6370" opacity=".45"><circle cx="35" cy="32" r="2"/><circle cx="55" cy="38" r="2"/><circle cx="76" cy="27" r="2"/><circle cx="100" cy="34" r="2"/><circle cx="320" cy="28" r="2"/><circle cx="344" cy="38" r="2"/><circle cx="367" cy="30" r="2"/></g>
            <path d="M70 100V26H330V100" fill="url(#goal-net)" stroke="#dde5e1" stroke-width="4" stroke-linejoin="round"/><path d="M70 100H330M47 135H353M47 135L30 190H370L353 135" fill="none" stroke="#c0d7ca" stroke-opacity=".3" stroke-width="1.5"/>
            <ellipse cx="200" cy="177" rx="4" ry="2" fill="#e4efe8"/>
            <g class="keeper"><ellipse cx="200" cy="108" rx="18" ry="4" fill="#0005"/><circle cx="200" cy="58" r="8" fill="#ddb696"/><path d="M193 67H207L212 87H188Z" fill="#f3c748"/><path d="M191 71L178 82M209 71L222 82" fill="none" stroke="#f3c748" stroke-width="7" stroke-linecap="round"/><circle cx="177" cy="83" r="5" fill="#f5f6f3"/><circle cx="223" cy="83" r="5" fill="#f5f6f3"/><path d="M193 87L185 104M207 87L215 104" fill="none" stroke="#182438" stroke-width="8" stroke-linecap="round"/></g>
            <g class="striker"><ellipse cx="203" cy="199" rx="19" ry="4" fill="#0006"/><circle cx="199" cy="119" r="9" fill="#ddb696"/><path d="M190 130H207L212 154H187Z" fill="#ed253c"/><path d="M190 133L180 148M208 133L218 145" fill="none" stroke="#ddb696" stroke-width="6" stroke-linecap="round"/><text x="199" y="145" text-anchor="middle" fill="white" font-size="10" font-family="Arial" font-weight="bold">9</text><path d="M192 155L187 177L185 194" fill="none" stroke="#e0bea3" stroke-width="7" stroke-linecap="round"/><path d="M180 195H192" stroke="#f4f4f4" stroke-width="6" stroke-linecap="round"/><g class="kick-leg"><path d="M205 155L217 171L214 190" fill="none" stroke="#e0bea3" stroke-width="7" stroke-linecap="round"/><path d="M209 191H221" stroke="#f4f4f4" stroke-width="6" stroke-linecap="round"/></g></g>
            <g class="shot-ball"><circle cx="200" cy="176" r="7" fill="#f7f9f8" stroke="#222e32" stroke-width="1"/><path d="m200 171 4 3-2 5h-4l-2-5Z" fill="#243038"/></g>
            <g class="goal-flash" fill="#ffdb68"><path d="m112 53 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z"/><circle cx="97" cy="44" r="2"/><circle cx="134" cy="75" r="2"/></g>
          </svg>
          <span id="penalty-caption" class="penalty-caption">Penaltı hazırlanıyor</span>
        </div>
        <h2 id="arenaPenaltyTitle">Giriş kontrol ediliyor</h2>
        <p id="arenaPenaltyResult" class="penalty-result" role="status" hidden></p>
        <p id="arenaPenaltyMessage">Oyuncu hazırlanıyor...</p>
        <button id="arenaRetry" class="arena-login__primary" type="button" hidden>Sayfayı yenile</button>
      </section>
      <section id="arenaPoster" class="arena-login__poster" hidden aria-labelledby="arenaPosterName">
        <span class="arena-login__season">SEZON ARENASI</span>
        <div class="arena-login__poster-frame"><img id="arenaPosterImage" alt="Kullanıcı posteri" hidden><span id="arenaPosterFallback" aria-hidden="true">⚽</span></div>
        <p class="arena-login__eyebrow">HOŞ GELDİN</p><h2 id="arenaPosterName"></h2><p>Arena seni bekliyor. Şimdi tahmin zamanı.</p>
        <button id="arenaEnter" class="arena-login__primary" type="button">Arenaya Gir →</button>
      </section>
    </div>
  </div>`;
  const $ = id => document.getElementById(id);
  $('arenaAuthForm').addEventListener('submit', event => event.preventDefault());
  $('arenaPasswordToggle').addEventListener('click', () => {
    const input = $('loginPassword');
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    $('arenaPasswordToggle').setAttribute('aria-label', visible ? 'Şifreyi gizle' : 'Şifreyi göster');
  });
  for (const [button, panel] of [['arenaForgot','arenaResetPanel'],['arenaSignup','arenaSignupPanel']]) {
    $(button).addEventListener('click', () => {
      $('arenaAuthForm').hidden = true;
      $(panel).hidden = false;
      $(panel).querySelector('h2').focus();
    });
  }
  document.querySelectorAll('[data-arena-back]').forEach(button => button.addEventListener('click', () => {
    $('arenaSignupPanel').hidden = true;
    $('arenaResetPanel').hidden = true;
    $('arenaAuthForm').hidden = false;
    $('loginUsername').focus();
  }));
  $('loginUsername').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('loginPassword').focus(); }
  });
})();
