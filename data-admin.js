/* Proje kayıt yönetimi. Sunucu yetkisi mevcut Firebase kurallarına bağlıdır. */
(() => {
  'use strict';
  const TRASH = 'settings/dataManagementTrash';
  const TYPES = {
    matches: { label: 'Maçlar', path: 'matches' },
    predictions: { label: 'Tahminler', path: 'predictions' },
    users: { label: 'Kullanıcılar', path: 'users' },
    predictionLogs: { label: 'Tahmin logları', path: 'predictionLogs' },
    notificationLogs: { label: 'Bildirim logları', path: 'notificationLogs' },
    auditLogs: { label: 'İşlem logları', path: 'settings/auditLogs' },
    trash: { label: 'Çöp kutusu', path: TRASH },
  };
  const PAGE_SIZE = 20;
  const LOG_LIMIT = 500;
  const model = { type: 'matches', maps: {}, loading: false, busy: false, loaded: false,
    page: 1, selected: new Set(), filters: { q: '', season: '', week: '', user: '', from: '', to: '' },
    error: '', note: '', refreshed: '', generation: 0, dialog: null, lastFocus: null, logMore: {}, logCursors: {} };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = value => String(value ?? '').trim();
  const fold = value => text(value).toLocaleLowerCase('tr-TR');
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const allowed = () => isAuthenticated() && getCurrentRole() === 'admin';
  function assertAccess() {
    if (!allowed()) throw new Error('Bu işlem için admin oturumu gerekli.');
    if (!isFirebaseReady()) throw new Error('Veritabanı bağlantısı hazır değil.');
  }
  const entries = map => Object.entries(map || {}).filter(([, value]) => value && typeof value === 'object');
  const matchIds = (key, value) => new Set([key, value.id, value.sheetMatchId, value.remoteMatchId, value.macId].filter(Boolean).map(String));
  function predictionMatchIds(pred) {
    return [pred.sheetMatchId, pred.remoteMatchId, pred.matchId, pred.localMatchId, pred.macId]
      .filter(id => id !== undefined && id !== null && text(id)).map(String);
  }
  function linkedPrediction(pred, ids) {
    return predictionMatchIds(pred).some(id => ids.has(id));
  }
  function findMatchEntry(pred, map) {
    // The device-local matchId may differ on every device. Check the stored
    // shared identity as well; never infer ownership just from a team name.
    const candidates = predictionMatchIds(pred);
    for (const id of candidates) {
      const found = entries(map).find(([key, value]) => matchIds(key, value).has(id));
      if (found) return found;
    }
    return null;
  }
  function findMatch(pred) {
    return findMatchEntry(pred, model.maps.matches)?.[1];
  }
  function findUser(id) {
    return entries(model.maps.users).find(([key, value]) => key === String(id) || String(value.id) === String(id))?.[1];
  }
  function dateLabel(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' }) : '—';
  }
  function userLabel(value) { return text(value?.adSoyad || value?.name || value?.kullaniciAdi || value?.username) || 'Kullanıcı'; }
  function matchLabel(value) { return `${text(value?.homeTeam || value?.evSahibi) || '?'} – ${text(value?.awayTeam || value?.deplasman) || '?'}`; }
  function row(key, value, type = model.type) {
    const m = type === 'predictions' ? findMatch(value) : null;
    const seasonId = value.seasonId || m?.seasonId;
    const season = text(value.season || value.sezon || m?.season || m?.sezon || (seasonId ? getSeasonById(seasonId)?.name : '') || value.summary?.season);
    const weekId = value.weekId || m?.weekId;
    const week = text(value.weekNo || value.haftaNo || m?.weekNo || m?.haftaNo || (weekId ? getWeekNumberById(weekId) : '') || value.summary?.week);
    const userId = text(value.playerId || value.kullaniciId || value.userId || value.actorId);
    const user = type === 'users' ? userLabel(value) : userLabel(findUser(userId) || { name: value.playerName || value.actorName || value.username || value.adSoyad });
    const rawDate = value.date || value.tarih || value.createdAt || value.updatedAt;
    const local = rawDate ? new Date(rawDate) : null;
    const day = local && !Number.isNaN(local.getTime()) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(local) : '';
    let title, subtitle, status;
    if (type === 'matches') {
      title = matchLabel(value); subtitle = dateLabel(rawDate);
      status = value.played || value.oynandiMi === 1 ? 'Sonuç işlendi' : 'Sonuç bekliyor';
    } else if (type === 'predictions') {
      title = m ? matchLabel(m) : text(value.matchLabel) ||
        ((value.homeTeam || value.evSahibi) && (value.awayTeam || value.deplasman) ? matchLabel(value) : 'Maç eşleştirilemedi');
      subtitle = user;
      status = `${value.homePred ?? value.tahminEv ?? '—'} – ${value.awayPred ?? value.tahminDep ?? '—'}`;
    } else if (type === 'users') {
      title = user; subtitle = text(value.kullaniciAdi || value.username); status = value.aktif === false ? 'Pasif' : 'Aktif';
    } else if (type === 'trash') {
      title = text(value.title) || 'Silinen kayıt'; subtitle = `${value.recordCount || 0} kayıt · ${dateLabel(value.createdAt)}`;
      status = 'Geri yüklenebilir';
    } else {
      title = text(value.actionLabel || value.title || value.matchLabel || value.type || value.actionType) || 'Log kaydı';
      subtitle = text(value.detail || value.message || value.body || value.matchLabel).slice(0, 240) || dateLabel(rawDate);
      status = text(value.status || value.actionType || value.type) || 'Kayıt';
    }
    return { key, value, type, title, subtitle, status, season, week, user, userId, rawDate, day };
  }
  function filteredRows() {
    return entries(model.maps[model.type]).map(([key, value]) => row(key, value)).filter(r => {
      const f = model.filters;
      return (!f.q || fold([r.key, r.title, r.subtitle, r.season, r.week, r.user, r.status].join(' ')).includes(fold(f.q))) &&
        (!f.season || r.season === f.season) && (!f.week || r.week === f.week) &&
        (!f.user || (r.type === 'users' ? r.key : r.userId) === f.user) &&
        (!f.from || (r.day && r.day >= f.from)) && (!f.to || (r.day && r.day <= f.to));
    }).sort((a, b) => (Date.parse(b.rawDate) || 0) - (Date.parse(a.rawDate) || 0) || a.title.localeCompare(b.title, 'tr'));
  }
  async function readMap(type) {
    if (['predictionLogs', 'notificationLogs', 'auditLogs'].includes(type)) {
      const snap = await getFirebaseDb().ref(TYPES[type].path).orderByChild('createdAt').limitToLast(LOG_LIMIT).get();
      const map = snap.val() || {};
      rememberLogCursor(type, map);
      return map;
    }
    return (await firebaseRead(TYPES[type].path)) || {};
  }
  function rememberLogCursor(type, map) {
    const ordered = entries(map).sort(([ak,a],[bk,b]) => {
      const at = text(a.createdAt), bt = text(b.createdAt);
      return at < bt ? -1 : at > bt ? 1 : ak < bk ? -1 : ak > bk ? 1 : 0;
    });
    model.logMore[type] = ordered.length >= LOG_LIMIT && !!ordered[0]?.[1]?.createdAt;
    model.logCursors[type] = ordered[0] ? { key: ordered[0][0], date: ordered[0][1].createdAt } : null;
  }
  async function loadOlderLogs() {
    const type = model.type, cursor = model.logCursors[type];
    if (!cursor || !model.logMore[type]) return;
    assertAccess();
    const snapshot = await getFirebaseDb().ref(TYPES[type].path).orderByChild('createdAt')
      .endBefore(cursor.date, cursor.key).limitToLast(LOG_LIMIT).get();
    assertAccess();
    const map = snapshot.val() || {};
    model.maps[type] = { ...map, ...model.maps[type] };
    rememberLogCursor(type, map);
    model.note = `${Object.keys(map).length} eski log daha yüklendi.`;
  }
  async function load(force = false) {
    assertAccess();
    if (model.loading) return;
    model.loading = true; model.error = ''; model.generation += 1;
    const generation = model.generation;
    const type = model.type;
    render();
    try {
      const needed = new Set([type]);
      if (type === 'matches' || type === 'predictions') { needed.add('matches'); needed.add('predictions'); needed.add('users'); }
      const results = await Promise.all([...needed].map(async kind => [kind, await readMap(kind)]));
      if (!allowed() || generation !== model.generation) return;
      for (const [kind, map] of results) model.maps[kind] = map;
      model.loaded = true; model.refreshed = dateLabel(new Date().toISOString());
      if (force) model.selected.clear();
    } catch (error) {
      model.error = error.message || 'Kayıtlar alınamadı.';
    } finally { model.loading = false; render(); }
  }
  const option = (value, label, selected) => `<option value="${escape(value)}"${String(selected) === String(value) ? ' selected' : ''}>${escape(label)}</option>`;
  function options(items, selected, all) { return option('', all, selected) + [...new Set(items.filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr',{numeric:true})).map(value => option(value,value,selected)).join(''); }
  function render() {
    const root = document.getElementById('dataManagementRoot');
    if (!root) return;
    if (!allowed()) { root.innerHTML = ''; model.maps = {}; model.loaded = false; model.selected.clear(); return; }
    // Background app redraws must not reset an unfinished edit form.
    if (model.dialog && root.querySelector('.dm-dialog')) return;
    const all = entries(model.maps[model.type]).map(([key,value]) => row(key,value));
    const rows = filteredRows();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    model.page = Math.min(Math.max(1,model.page),pages);
    const visible = rows.slice((model.page-1)*PAGE_SIZE,model.page*PAGE_SIZE);
    const logMode = /Logs$/.test(model.type);
    const activeElement = document.activeElement;
    const focusId = root.contains(activeElement) ? activeElement.id : '';
    const selection = activeElement?.selectionStart;
    root.innerHTML = `
      <div class="dm-head"><div><span class="dm-eyebrow">ADMIN ÇALIŞMA ALANI</span><h2>Veri Yönetimi</h2><p>Kaydı bul, incele ve kontrollü şekilde düzenle.</p></div>
      <button type="button" class="secondary dm-refresh" data-dm-action="refresh" ${model.loading || model.busy ? 'disabled' : ''}>↻ Yenile</button></div>
      <div class="dm-type-tabs" role="tablist" aria-label="Kayıt türü">${Object.entries(TYPES).map(([kind,meta]) => `<button type="button" role="tab" aria-selected="${kind===model.type}" class="${kind===model.type?'active':''}" data-dm-type="${kind}" ${model.loading||model.busy?'disabled':''}>${meta.label}</button>`).join('')}</div>
      <div class="dm-summary"><div><span>Bu görünümde</span><strong>${all.length}</strong></div><div><span>Filtre sonucu</span><strong>${rows.length}</strong></div><div><span>Seçilen</span><strong>${model.selected.size}</strong></div><div class="dm-last"><span>Son okuma</span><strong>${escape(model.refreshed || 'Henüz okunmadı')}</strong></div></div>
      <div class="dm-filters">
        <label class="dm-search">Ara<input id="dmSearch" data-dm-filter="q" type="search" placeholder="Takım, kişi, açıklama veya kayıt kimliği" value="${escape(model.filters.q)}"></label>
        <label>Sezon<select id="dmSeason" data-dm-filter="season">${options(all.map(r=>r.season),model.filters.season,'Tüm sezonlar')}</select></label>
        <label>Hafta<select id="dmWeek" data-dm-filter="week">${options(all.filter(r=>!model.filters.season||r.season===model.filters.season).map(r=>r.week),model.filters.week,'Tüm haftalar')}</select></label>
        <label>Kullanıcı<select id="dmUser" data-dm-filter="user">${option('','Tüm kullanıcılar',model.filters.user)}${Array.from(new Map(all.filter(r=>r.type==='users'||r.userId).map(r=>[r.type==='users'?r.key:r.userId,r.user])).entries()).sort((a,b)=>a[1].localeCompare(b[1],'tr')).map(([id,name])=>option(id,name,model.filters.user)).join('')}</select></label>
        <label>Başlangıç<input id="dmFrom" type="date" data-dm-filter="from" value="${escape(model.filters.from)}"></label>
        <label>Bitiş<input id="dmTo" type="date" data-dm-filter="to" value="${escape(model.filters.to)}"></label>
      </div>
      <div class="dm-toolbar">${logMode&&model.logMore[model.type]?`<button type="button" class="secondary small" data-dm-action="older-logs" ${model.busy?'disabled':''}>Daha eski ${LOG_LIMIT} logu yükle</button>`:''}<button type="button" class="secondary small" data-dm-action="reset">Filtreleri temizle</button><button type="button" class="secondary small" data-dm-action="export" ${rows.length?'':'disabled'}>Görünümü CSV indir</button>
      ${!['users','trash'].includes(model.type)?`<button type="button" class="danger small" data-dm-action="delete-selected" ${!model.selected.size||model.busy||model.loading?'disabled':''}>Seçilenleri çöp kutusuna taşı (${model.selected.size})</button>`:''}</div>
      <p class="dm-hint">${model.type==='users'?'Kullanıcıları pasife alarak geçmiş tahminlerini koruyabilirsin. Şifreler bu ekranda gösterilmez.':model.type==='trash'?'Geri yükleme, mevcut kayıtların üzerine yazmaz. Kalıcı silme yalnızca buradaki yedeği kaldırır.':logMode?`Loglar ${LOG_LIMIT} kayıtlık gruplar halinde okunur. Eski kayıtlar için “Daha eski logları yükle” düğmesini kullan; filtreler yüklenen kayıtlarda çalışır.`:'Silinen maç, bağlı tahminleriyle birlikte çöp kutusuna taşınır. Yayınlanmamış yerel taslaklar burada listelenmez.'}</p>
      <div id="dmStatus" class="dm-status ${model.error?'is-error':''}" role="status" aria-live="polite">${escape(model.error || (model.busy?'İşlem tamamlanıyor…':model.loading?'Kayıtlar okunuyor…':model.note))}</div>
      ${!model.loaded||model.loading?'<div class="dm-empty">Kayıtlar yükleniyor…</div>':!rows.length?'<div class="dm-empty"><strong>Kayıt bulunamadı</strong><span>Filtreleri temizleyebilir veya başka bir kayıt türü seçebilirsin.</span></div>':`
      <div class="dm-table-shell"><table class="dm-table"><thead><tr><th class="dm-check"><input id="dmSelectPage" type="checkbox" aria-label="Bu sayfadaki kayıtları seç" ${visible.length&&visible.every(r=>model.selected.has(r.key))?'checked':''} ${['users','trash'].includes(model.type)?'disabled':''}></th><th>Kayıt</th><th>Sezon / Hafta</th><th>Durum</th><th>İşlemler</th></tr></thead><tbody>${visible.map(r=>renderRow(r)).join('')}</tbody></table></div>`}
      <div class="dm-pagination"><span>${rows.length?`${(model.page-1)*PAGE_SIZE+1}–${Math.min(model.page*PAGE_SIZE,rows.length)} / ${rows.length} kayıt`:'0 kayıt'}</span><div><button type="button" class="secondary small" data-dm-action="prev" ${model.page<=1?'disabled':''}>Önceki</button><span>${model.page} / ${pages}</span><button type="button" class="secondary small" data-dm-action="next" ${model.page>=pages?'disabled':''}>Sonraki</button></div></div>
      <div id="dmDialogHost"></div>`;
    if (focusId) { const el = document.getElementById(focusId); el?.focus(); if (typeof selection==='number' && el?.setSelectionRange && el.type==='search') el.setSelectionRange(selection,selection); }
    if (model.dialog) renderDialog();
  }
  function renderRow(r) {
    const disabled = model.busy || model.loading ? 'disabled' : '';
    const attr = `data-dm-key="${escape(r.key)}"`;
    const controls = r.type==='trash'
      ? `<button class="small" type="button" data-dm-action="restore" ${attr} ${disabled}>Geri yükle</button><button class="small danger" type="button" data-dm-action="purge" ${attr} ${disabled}>Kalıcı sil</button>`
      : r.type==='users'
        ? `<button class="small secondary" type="button" data-dm-action="edit" ${attr} ${disabled}>Düzenle</button><button class="small secondary" type="button" data-dm-action="toggle-user" ${attr} ${disabled}>${r.value.aktif===false?'Aktifleştir':'Pasife al'}</button>`
        : `${['matches','predictions'].includes(r.type)?`<button class="small secondary" type="button" data-dm-action="edit" ${attr} ${disabled}>Düzenle</button>`:''}<button class="small danger" type="button" data-dm-action="delete" ${attr} ${disabled}>Çöp kutusuna taşı</button>`;
    return `<tr><td class="dm-check">${!['users','trash'].includes(r.type)?`<input type="checkbox" data-dm-select="${escape(r.key)}" aria-label="${escape(r.title)} kaydını seç" ${model.selected.has(r.key)?'checked':''} ${disabled}>`:''}</td>
      <td data-label="Kayıt"><strong>${escape(r.title)}</strong><span class="dm-subtitle">${escape(r.subtitle)}</span><code class="dm-id" title="${escape(r.key)}">${escape(r.key)}</code></td>
      <td data-label="Sezon / Hafta">${escape(r.season||'—')}<span class="dm-subtitle">${r.week?`${escape(r.week)}. hafta`:'—'}</span></td>
      <td data-label="Durum"><span class="dm-badge">${escape(r.status)}</span></td><td data-label="İşlemler"><div class="dm-actions"><button class="small secondary" type="button" data-dm-action="detail" ${attr}>İncele</button>${controls}</div></td></tr>`;
  }
  function openDialog(kind, r) { model.lastFocus = document.activeElement; model.dialog = { kind, row: r }; renderDialog(); }
  function closeDialog() { model.dialog=null; const host=document.getElementById('dmDialogHost'); if(host)host.innerHTML=''; model.lastFocus?.focus(); }
  function input(name,label,value,type='text') { return `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}" ${type==='number'?'min="0" max="99" step="1"':''} required></label>`; }
  function renderDialog() {
    const host=document.getElementById('dmDialogHost'); if(!host||!model.dialog)return;
    const {kind,row:r}=model.dialog;
    let content;
    if(kind==='edit') {
      if(r.type==='matches') {
        const v=r.value;
        const date=new Date(v.date||v.tarih);
        const localDate=!Number.isNaN(date.getTime())?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date).replace(' ','T'):'';
        content=input('homeTeam','Ev sahibi',v.homeTeam||v.evSahibi)+input('awayTeam','Deplasman',v.awayTeam||v.deplasman)+input('date','Maç tarihi ve saati (Türkiye)',localDate,'datetime-local')+'<p class="dm-hint">Skor ve oynandı durumu için Maçlar sayfasındaki sonuç işlemlerini kullan.</p>';
      } else if(r.type==='predictions') {
        content=input('homePred','Ev sahibi tahmini',r.value.homePred??r.value.tahminEv,'number')+input('awayPred','Deplasman tahmini',r.value.awayPred??r.value.tahminDep,'number');
      } else content=input('adSoyad','Ad soyad',r.value.adSoyad||r.value.name)+`<label>Desteklediği takım<input name="supportedTeam" value="${escape(r.value.supportedTeam||'')}"></label>`;
      content=`<form id="dmEditForm" class="dm-edit-form">${content}<div id="dmEditError" role="alert" class="dm-status is-error"></div><div class="dm-actions"><button type="button" class="secondary" data-dm-action="close-dialog">Vazgeç</button><button type="submit" ${model.busy?'disabled':''}>Kaydet</button></div></form>`;
    } else {
      const fields=[['Kayıt',r.title],['Kimlik',r.key],['Sezon',r.season||'—'],['Hafta',r.week||'—'],['Durum',r.status],['Tarih',dateLabel(r.rawDate)]];
      if(r.type==='matches') {
        const ids=matchIds(r.key,r.value);
        fields.push(['Bağlı tahmin',entries(model.maps.predictions).filter(([,p])=>linkedPrediction(p,ids)).length]);
      }
      if(r.type==='users')fields.push(['Rol',r.value.rol||r.value.role||'user']);
      if(r.type==='trash')fields.push(['İçerik',(r.value.records||[]).map(x=>x.path).join('\n')]);
      content=`<dl class="dm-details">${fields.map(([k,v])=>`<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl><button type="button" class="secondary" data-dm-action="close-dialog">Kapat</button>`;
    }
    host.innerHTML=`<div class="dm-dialog-backdrop"><section class="dm-dialog" role="dialog" aria-modal="true" aria-labelledby="dmDialogTitle"><div class="dm-dialog-head"><h3 id="dmDialogTitle">${kind==='edit'?'Kaydı düzenle':'Kayıt ayrıntıları'}</h3><button type="button" class="secondary small" aria-label="Pencereyi kapat" data-dm-action="close-dialog">✕</button></div><p>${escape(r.title)}</p>${content}</section></div>`;
    host.querySelector('input,button')?.focus();
  }
  function validPath(path) { return /^(matches|predictions|predictionLogs|notificationLogs)\/[^/.#$\[\]]+$/.test(path)||/^settings\/auditLogs\/[^/.#$\[\]]+$/.test(path); }
  async function buildDeleteBundle(type, keys) {
    if(!TYPES[type]||['users','trash'].includes(type))throw new Error('Bu tür çöp kutusuna taşınamaz.');
    if(!keys.length||keys.length>50)throw new Error('Tek işlemde 1–50 kayıt seçebilirsin.');
    const map=(await firebaseRead(TYPES[type].path))||{};
    const predictions=type==='matches'?(await firebaseRead('predictions'))||{}:{};
    const records=new Map(); const titles=[];
    for(const key of keys) {
      const value=map[key]; if(!value)throw new Error('Kayıt başka bir cihazda değişmiş veya silinmiş. Yenile ve tekrar dene.');
      const path=`${TYPES[type].path}/${key}`;if(!validPath(path))throw new Error('Geçersiz kayıt yolu.');
      records.set(path,{path,value});titles.push(row(key,value,type).title);
      if(type==='matches') {
        const ids=matchIds(key,value);
        for(const [id,pred]of entries(predictions))if(linkedPrediction(pred,ids))records.set(`predictions/${id}`,{path:`predictions/${id}`,value:pred});
      }
    }
    return {records:[...records.values()],title:titles.length===1?titles[0]:`${titles.length} ${TYPES[type].label.toLocaleLowerCase('tr-TR')} kaydı`,primaryCount:keys.length};
  }
  function audit(action,detail) {
    if(typeof window.writeAppAuditLogEntry==='function')Promise.resolve(window.writeAppAuditLogEntry({actionType:action,actionLabel:'Veri yönetimi',detail,entityType:'data-management'})).catch(console.warn);
  }
  async function deleteRecords(keys) {
    const bundle=await buildDeleteBundle(model.type,keys);
    const approved=await showConfirm(`${bundle.title}\n\n${bundle.primaryCount} seçili kayıt ve bağlı kayıtlarla birlikte toplam ${bundle.records.length} kayıt çöp kutusuna taşınacak. Diğer cihazlara yansıyacak.\n\nGeri yükleyebilirsin.`,{title:'Çöp kutusuna taşınsın mı?',type:'danger',confirmText:'Çöp kutusuna taşı'});
    if(!approved)return;
    assertAccess();
    const fresh=await buildDeleteBundle(model.type,keys);
    if(!equal(fresh.records,bundle.records))throw new Error('Onay sırasında kayıtlar değişti. Yenileyip tekrar dene.');
    const id=sanitizeFirebaseKey(uid('trash'));
    const first=row(keys[0],model.maps[model.type]?.[keys[0]]||{},model.type);
    const entry={id,type:model.type,title:bundle.title,createdAt:new Date().toISOString(),createdBy:getCurrentUsername?.()||'admin',recordCount:bundle.records.length,summary:{season:first.season,week:first.week},records:bundle.records};
    const updates={[`${TRASH}/${id}`]:entry};for(const record of bundle.records)updates[record.path]=null;
    assertAccess();
    await getFirebaseDb().ref().update(updates);
    if(model.type==='matches') {
      const ids=new Set(bundle.records.filter(x=>x.path.startsWith('matches/')).flatMap(x=>[...matchIds(x.path.split('/')[1],x.value)]));
      removeMatchesFromLocalState(state.matches.filter(m=>[m.id,m.sheetMatchId,m.remoteMatchId,m.macId].some(id=>ids.has(String(id)))).map(m=>m.id));
    } else if(model.type==='predictions') {
      const ids=new Set(bundle.records.map(x=>x.path.split('/')[1]));
      state.predictions=state.predictions.filter(p=>![p.id,p.remoteId,p.predictionId].some(id=>ids.has(String(id))));
    }
    recalculateAllPoints();saveState();audit('data_trash',`${bundle.title}: ${bundle.records.length} kayıt çöp kutusuna taşındı.`);
    model.note=`${bundle.records.length} kayıt çöp kutusuna taşındı.`;
    await afterMutation();
  }
  async function restore(key) {
    const entry=await firebaseRead(`${TRASH}/${key}`);
    if(!entry||!Array.isArray(entry.records)||!entry.records.length)throw new Error('Çöp kutusu kaydı bulunamadı.');
    if(entry.records.some(r=>!validPath(r.path)||!r.value||typeof r.value!=='object'))throw new Error('Bu çöp kutusu kaydı güvenli biçimde geri yüklenemiyor.');
    if(new Set(entry.records.map(r=>r.path)).size!==entry.records.length)throw new Error('Çöp kutusunda yinelenen kayıt yolları var.');
    if(!(await showConfirm(`${entry.title}\n\n${entry.records.length} kayıt geri yüklenecek. Mevcut kayıtların üzerine yazılmayacak.`,{title:'Kayıtlar geri yüklensin mi?',confirmText:'Geri yükle'})))return;
    assertAccess();
    if(!equal(await firebaseRead(`${TRASH}/${key}`),entry))throw new Error('Çöp kutusu kaydı değişti. Yenile ve tekrar dene.');
    const existing=await Promise.all(entry.records.map(r=>firebaseRead(r.path)));
    if(existing.some((r,index)=>r!==null&&!equal(r,entry.records[index].value)))throw new Error('Aynı kimlikle farklı kayıt zaten var. Üzerine yazmamak için geri yükleme durduruldu.');
    const matchRecords=entry.records.filter(r=>r.path.startsWith('matches/'));
    const archivedMatches=Object.fromEntries(matchRecords.map(r=>[r.path.split('/')[1],r.value]));
    const predictionRecords=entry.records.filter(r=>r.path.startsWith('predictions/'));
    const liveMatches=predictionRecords.length?(await firebaseRead('matches'))||{}:{};
    for(const r of predictionRecords) {
      if(!findMatchEntry(r.value, archivedMatches)&&!findMatchEntry(r.value, liveMatches)) {
        throw new Error('Tahminin bağlı olduğu maç bulutta veya bu yedekte yok. Önce maçı geri yükle.');
      }
    }
    let restored = 0;
    try {
      // Create-only transactions also protect against a concurrent new record
      // arriving after the preview reads. Existing records are never overwritten.
      for (const r of entry.records) {
        assertAccess();
        const result = await getFirebaseDb().ref(r.path).transaction(
          current => current === null ? r.value : undefined, undefined, false
        );
        if (!result.committed && !equal(result.snapshot?.val(), r.value)) throw new Error('Aynı kimlikle yeni kayıt oluştu; üzerine yazılmadı.');
        restored += 1;
      }
    } catch (error) {
      await load(true);
      throw new Error(`${restored} kayıt geri yüklendi. Çöp kutusu yedeği korunuyor. ${error.message}`);
    }
    assertAccess();
    await updateRecord(`${TRASH}/${key}`, entry, null);
    audit('data_restore',`${entry.title}: ${entry.records.length} kayıt geri yüklendi.`);
    model.note='Kayıtlar geri yüklendi.';await afterMutation();
  }
  async function purge(key) {
    const entry=await firebaseRead(`${TRASH}/${key}`);if(!entry)throw new Error('Kayıt bulunamadı.');
    if(!(await showConfirm(`${entry.title}\n\nÇöp kutusundaki ${entry.recordCount||0} kaydın yedeği kalıcı olarak silinecek. Bu işlem geri alınamaz.`,{title:'Yedek kalıcı silinsin mi?',type:'danger',confirmText:'Kalıcı sil'})))return;
    assertAccess();
    const result=await getFirebaseDb().ref(`${TRASH}/${key}`).transaction(current=>equal(current,entry)?null:undefined,undefined,false);
    if(!result.committed)throw new Error('Çöp kutusu kaydı değişti; kalıcı silme yapılmadı.');
    audit('data_purge',`${entry.title}: çöp kutusu yedeği kalıcı silindi.`);
    model.note='Çöp kutusu yedeği kalıcı silindi.';await afterMutation();
  }
  async function toggleUser(key) {
    const value=await firebaseRead(`users/${key}`);if(!value)throw new Error('Kullanıcı bulunamadı.');
    if(hasPanelAdminAccess(value))throw new Error('Admin hesapları bu ekrandan pasife alınamaz.');
    const active=value.aktif===false;
    if(!(await showConfirm(`${userLabel(value)} ${active?'aktifleştirilecek':'pasife alınacak'}. Geçmiş tahminleri korunacak.`,{title:'Kullanıcı durumu',confirmText:active?'Aktifleştir':'Pasife al'})))return;
    await window.SkorxAuth.manage('updateUser',{id:key,aktif:active});
    audit('data_user_status',`${userLabel(value)}: ${active?'aktif':'pasif'}.`);model.note='Kullanıcı durumu güncellendi.';await afterMutation();
  }
  async function updateRecord(path,expected,next) {
    assertAccess();
    const result=await getFirebaseDb().ref(path).transaction(current=>equal(current,expected)?next:undefined,undefined,false);
    if(!result.committed)throw new Error('Kayıt başka bir cihazda değişti. Yenile ve tekrar dene.');
  }
  async function saveEdit(form) {
    const r=model.dialog?.row;if(!r)return;
    const current=await firebaseRead(`${TYPES[r.type].path}/${r.key}`);
    if(!current||!equal(current,r.value))throw new Error('Kayıt değişti. Pencereyi kapatıp yenile.');
    const data=new FormData(form);let next={...current,updatedAt:new Date().toISOString()};
    if(r.type==='matches') {
      const home=text(data.get('homeTeam')),away=text(data.get('awayTeam')),date=text(data.get('date'));
      if(!home||!away||fold(home)===fold(away)||Number.isNaN(Date.parse(date)))throw new Error('Farklı iki takım ve geçerli tarih gir.');
      next={...next,homeTeam:home,awayTeam:away,evSahibi:home,deplasman:away,date,tarih:date};
    } else if(r.type==='predictions') {
      const home=Number(data.get('homePred')),away=Number(data.get('awayPred'));
      if(![home,away].every(n=>Number.isInteger(n)&&n>=0&&n<=99))throw new Error('Tahminler 0–99 arasında tam sayı olmalı.');
      next={...next,homePred:home,awayPred:away,tahminEv:home,tahminDep:away};
    } else { const name=text(data.get('adSoyad'));if(!name)throw new Error('Ad soyad boş olamaz.');next={...next,adSoyad:name.toLocaleUpperCase('tr-TR'),supportedTeam:text(data.get('supportedTeam'))}; }
    await updateRecord(`${TYPES[r.type].path}/${r.key}`,current,next);
    audit('data_edit',`${r.title}: kayıt düzenlendi.`);closeDialog();model.note='Kayıt güncellendi.';await afterMutation();
  }
  async function afterMutation() {
    // Refresh authoritative records before drawing the rest of the application.
    const success=await hydrateFromFirebaseRealtime('data-management');
    if(!success)model.note+=' Ana ekran eşitlemesi tamamlanamadı; Yenile ile tekrar dene.';
    if(model.type==='predictions') {
      const remote=(await firebaseRead('predictions'))||{};
      const keys=new Set(Object.keys(remote));
      state.predictions=state.predictions.filter(p=>!p.remoteId||keys.has(sanitizeFirebaseKey(p.remoteId)));
      recalculateAllPoints();saveState();
    }
    await load(true);
  }
  function exportCsv() {
    const rows=filteredRows();const lines=[['Kayıt','Kimlik','Sezon','Hafta','Kullanıcı','Durum','Tarih'],...rows.map(r=>[r.title,r.key,r.season,r.week,r.user,r.status,dateLabel(r.rawDate)])];
    const cell=v=>`"${String(v??'').replace(/^(\s*[=+@\-\t\r])/,"'$1").replace(/"/g,'""')}"`;
    const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(line=>line.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`veri-${model.type}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function run(fn) {
    if(model.busy)return;
    try {assertAccess();model.busy=true;model.error='';render();await fn();}
    catch(error){model.error=error.message||'İşlem tamamlanamadı.';}
    finally{model.busy=false;render();}
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-dm-action], [data-dm-type]');if(!target||!target.closest('#dataManagementRoot')||!allowed())return;
    if(target.dataset.dmType) {
      model.type=target.dataset.dmType;model.page=1;model.selected.clear();model.filters={q:'',season:'',week:'',user:'',from:'',to:''};model.note='';model.loaded=false;
      load(true).catch(error=>{model.error=error.message;render();});return;
    }
    const action=target.dataset.dmAction,key=target.dataset.dmKey;
    const r=key&&model.maps[model.type]?.[key]?row(key,model.maps[model.type][key]):null;
    if(action==='close-dialog')return closeDialog();
    if(action==='detail'||action==='edit'){if(r)openDialog(action,r);return;}
    if(action==='prev'||action==='next'){model.page+=action==='next'?1:-1;render();return;}
    if(action==='reset'){model.filters={q:'',season:'',week:'',user:'',from:'',to:''};model.page=1;model.selected.clear();render();return;}
    if(action==='export')return exportCsv();
    if(action==='refresh'){model.note='';load(true).catch(error=>{model.error=error.message;render();});return;}
    if(action==='older-logs')run(loadOlderLogs);
    if(action==='delete')run(()=>deleteRecords([key]));
    if(action==='delete-selected')run(()=>deleteRecords([...model.selected]));
    if(action==='restore')run(()=>restore(key));
    if(action==='purge')run(()=>purge(key));
    if(action==='toggle-user')run(()=>toggleUser(key));
  });
  document.addEventListener('input',event=>{
    const input=event.target;if(!input.matches('#dataManagementRoot [data-dm-filter]')||!allowed())return;
    model.filters[input.dataset.dmFilter]=input.value;if(input.dataset.dmFilter==='season')model.filters.week='';
    model.page=1;model.selected.clear();render();
  });
  document.addEventListener('change',event=>{
    const input=event.target;if(!input.closest('#dataManagementRoot')||!allowed())return;
    if(input.dataset.dmSelect){if(input.checked)model.selected.add(input.dataset.dmSelect);else model.selected.delete(input.dataset.dmSelect);render();}
    if(input.id==='dmSelectPage'){for(const r of filteredRows().slice((model.page-1)*PAGE_SIZE,model.page*PAGE_SIZE))input.checked?model.selected.add(r.key):model.selected.delete(r.key);render();}
  });
  document.addEventListener('submit',event=>{
    if(event.target.id!=='dmEditForm')return;event.preventDefault();
    if(!allowed()||model.busy)return;
    const form=event.target;model.busy=true;
    form.querySelector('button[type=submit]').disabled=true;
    saveEdit(form).catch(error=>{const el=document.getElementById('dmEditError');if(el)el.textContent=error.message;}).finally(()=>{model.busy=false;const button=document.querySelector('#dmEditForm button[type=submit]');if(button)button.disabled=false;else render();});
  });
  document.addEventListener('keydown',event=>{
    if(!model.dialog)return;
    if(event.key==='Escape'&&!model.busy){event.preventDefault();closeDialog();}
    if(event.key==='Tab'){
      const focusable=[...document.querySelectorAll('.dm-dialog button:not(:disabled), .dm-dialog input:not(:disabled)')];
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  window.renderDataManagement=()=>{render();if(allowed()&&!model.loaded&&!model.loading)load().catch(error=>{model.error=error.message;render();});};
  window.resetDataManagement=()=>{model.generation++;model.maps={};model.loaded=false;model.selected.clear();model.dialog=null;model.error='';model.note='';const root=document.getElementById('dataManagementRoot');if(root)root.innerHTML='';};
})();
