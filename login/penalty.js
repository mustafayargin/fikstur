/* Real authentication and Firebase sync live in app.js. This module owns only the scene. */
window.FiksturLoginScene = (() => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  let active = false;
  let generation = 0;
  let startedAt = 0;
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const duration = (normal, short) => reduced() ? short : normal;
  function visible(part) {
    $('arenaLoginForm').hidden = part !== 'form';
    $('arenaPenalty').hidden = part !== 'penalty';
    $('arenaPoster').hidden = part !== 'poster';
  }
  function start() {
    generation += 1;
    active = true;
    startedAt = Date.now();
    $('loginOverlay').classList.remove('hidden');
    $('arenaPenaltyResult').hidden = true;
    $('arenaRetry').hidden = true;
    $('penalty-scene').dataset.state = 'preparing';
    $('penalty-caption').textContent = 'Penaltı hazırlanıyor';
    $('arenaPenaltyTitle').textContent = 'Giriş kontrol ediliyor';
    $('arenaPenaltyMessage').textContent = 'Hesap doğrulanıyor...';
    visible('penalty');
    return generation;
  }
  async function decision(success, message = '') {
    const run = generation;
    await sleep(Math.max(0, duration(400, 100) - (Date.now() - startedAt)));
    if (run !== generation) return false;
    $('penalty-scene').dataset.state = success ? 'goal' : 'save';
    $('penalty-caption').textContent = 'Vuruş!';
    $('arenaPenaltyTitle').textContent = 'Penaltı kullanılıyor';
    await sleep(duration(950, 100));
    if (run !== generation) return false;
    $('arenaPenaltyTitle').textContent = success ? 'GOOOL!' : 'Kurtarış!';
    $('penalty-caption').textContent = success ? 'GOOOL!' : 'Kaleci yakaladı!';
    $('arenaPenaltyResult').textContent = success ? 'Giriş başarılı' : 'Giriş başarısız';
    $('arenaPenaltyResult').className = 'penalty-result ' + (success ? 'is-success' : 'is-error');
    $('arenaPenaltyResult').hidden = false;
    $('arenaPenaltyMessage').textContent = success ? 'Arena verileri hazırlanıyor...' : (message || 'Kullanıcı adı veya şifre hatalı.');
    await sleep(duration(1150, 550));
    if (run !== generation) return false;
    if (!success) abort(message || 'Kullanıcı adı veya şifre hatalı.');
    return true;
  }
  function progress(message) {
    if (active && !$('arenaPenalty').hidden && $('arenaPenaltyResult').textContent !== 'Giriş başarısız') {
      $('arenaPenaltyMessage').textContent = message;
    }
  }
  function poster(user) {
    if (!active) return;
    const name = String(user?.adSoyad || user?.name || user?.kullaniciAdi || 'Oyuncu').trim();
    const first = name.split(/\s+/)[0] || 'Oyuncu';
    $('arenaPosterName').textContent = name.toLocaleUpperCase('tr-TR');
    const filename = first.toLocaleLowerCase('tr-TR').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c').replace(/[^a-z0-9-]/g,'');
    const image = $('arenaPosterImage');
    image.hidden = true;
    $('arenaPosterFallback').hidden = false;
    image.onload = () => { image.hidden = false; $('arenaPosterFallback').hidden = true; };
    image.onerror = () => {
      const originalName = first.toLocaleLowerCase('tr-TR');
      if (filename !== originalName && !image.dataset.triedOriginal) {
        image.dataset.triedOriginal = '1';
        image.src = `images/welcome/${encodeURIComponent(originalName)}.png`;
      } else {
        image.hidden = true;
        $('arenaPosterFallback').hidden = false;
      }
    };
    delete image.dataset.triedOriginal;
    image.src = `images/welcome/${encodeURIComponent(filename)}.png`;
    visible('poster');
    $('arenaEnter').focus({preventScroll:true});
  }
  function abort(message) {
    generation += 1;
    active = false;
    visible('form');
    if (message) {
      $('loginStatus').textContent = message;
      $('loginStatus').classList.add('is-error');
      $('loginUsername').focus({preventScroll:true});
    }
  }
  function reset() {
    generation += 1;
    active = false;
    visible('form');
    $('arenaPenaltyResult').hidden = true;
    $('arenaRetry').hidden = true;
    $('penalty-scene').dataset.state = 'preparing';
    $('arenaPosterName').textContent = '';
    const image = $('arenaPosterImage');
    image.onload = null;
    image.onerror = null;
    image.hidden = true;
    image.removeAttribute('src');
    $('arenaPosterFallback').hidden = false;
    $('arenaAuthForm').hidden = false;
    $('arenaSignupPanel').hidden = true;
    $('arenaResetPanel').hidden = true;
  }
  function syncError() {
    if (!active) return;
    $('arenaPenaltyTitle').textContent = 'Giriş başarılı';
    $('arenaPenaltyResult').textContent = 'Veriler yüklenemedi';
    $('arenaPenaltyResult').className = 'penalty-result is-error';
    $('arenaPenaltyResult').hidden = false;
    $('arenaPenaltyMessage').textContent = 'Oturum açıldı fakat arena verileri hazırlanamadı. Bağlantınızı kontrol edip sayfayı yenileyin.';
    $('arenaRetry').hidden = false;
  }
  $('arenaRetry').addEventListener('click', () => window.location.reload());
  $('arenaEnter').addEventListener('click', () => {
    active = false;
    generation += 1;
    if (typeof window.updateLoginOverlay === 'function') window.updateLoginOverlay();
    else $('loginOverlay').classList.add('hidden');
    $('arenaEnter').blur();
  });
  return {start, decision, progress, poster, abort, reset, syncError, isActive: () => active};
})();
