/* 06-notifications.js */

const PREDICTION_NOTIFICATION_STORAGE_KEY = "fikstur_prediction_notifications_enabled_v1";
const PREDICTION_NOTIFICATION_SENT_KEY = "fikstur_prediction_notifications_sent_v1";
const PREDICTION_NOTIFICATION_FCM_TOKEN_KEY = "fikstur_prediction_fcm_token_v1";
const PREDICTION_NOTIFICATION_CHECK_INTERVAL_MS = 60 * 1000;

const PREDICTION_NOTIFICATION_REMINDERS = [
  { id: "24h", label: "24 saat", ms: 24 * 60 * 60 * 1000 },
  { id: "3h", label: "3 saat", ms: 3 * 60 * 60 * 1000 },
  { id: "1h", label: "1 saat", ms: 60 * 60 * 1000 },
];

let predictionNotificationTimer = null;

function isPredictionNotificationSupported() {
  return "Notification" in window;
}

function hasValidFiksturVapidKey() {
  const key = String(window.FIKSTUR_FIREBASE_VAPID_KEY || "").trim();
  return key && !key.startsWith("BURAYA_");
}

function isPredictionNotificationEnabled() {
  return (
    isPredictionNotificationSupported() &&
    Notification.permission === "granted" &&
    localStorage.getItem(PREDICTION_NOTIFICATION_STORAGE_KEY) === "1"
  );
}

function getPredictionNotificationButtonHtml() {
  if (!isPredictionNotificationSupported()) {
    return `<small class="prediction-notification-note">Bu tarayıcı bildirim desteklemiyor.</small>`;
  }

  if (isPredictionNotificationEnabled()) {
    return `<small class="prediction-notification-note">🔔 Bildirimler açık</small>`;
  }

  return `<button class="prediction-notification-btn" type="button" data-action="enable-prediction-notifications">🔔 Bildirimleri aç</button>`;
}

function readPredictionNotificationSentMap() {
  try {
    return JSON.parse(localStorage.getItem(PREDICTION_NOTIFICATION_SENT_KEY) || "{}");
  } catch {
    return {};
  }
}

function writePredictionNotificationSentMap(map) {
  localStorage.setItem(PREDICTION_NOTIFICATION_SENT_KEY, JSON.stringify(map || {}));
}

function getNextPredictionLockTarget() {
  const seasonId = state?.settings?.activeSeasonId;
  const weeks = Array.isArray(state?.weeks) ? state.weeks : [];
  const now = Date.now();

  return weeks
    .filter((week) => !seasonId || String(week.seasonId) === String(seasonId))
    .map((week) => {
      const lockTs = getWeekPredictionLockTimestamp(week.id);
      return {
        week,
        lockTs,
        diff: typeof lockTs === "number" ? lockTs - now : null,
      };
    })
    .filter((item) => typeof item.lockTs === "number" && item.diff > 0)
    .sort((a, b) => a.lockTs - b.lockTs)[0] || null;
}

function showPredictionReminderNotification(target, reminder) {
  const weekNumber = target?.week?.number || getWeekNumberById(target?.week?.id) || "?";
  const title = "Tahmin zamanı yaklaşıyor";
  const body = `${weekNumber}. hafta tahminleri yaklaşık ${reminder.label} sonra kapanacak.`;

  try {
    new Notification(title, {
      body,
      tag: `prediction-reminder-${target.week.id}-${reminder.id}`,
      renotify: true,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
    });

  } catch (error) {
    console.warn("[Bildirim] Bildirim gösterilemedi:", error);
  }
}

function checkPredictionNotifications() {
  if (!isPredictionNotificationEnabled()) return;

  const target = getNextPredictionLockTarget();
  if (!target) {
    return;
  }

  const sentMap = readPredictionNotificationSentMap();
  let changed = false;

  PREDICTION_NOTIFICATION_REMINDERS.forEach((reminder) => {
    const key = `${target.week.id}_${reminder.id}`;
    const windowStart = reminder.ms - PREDICTION_NOTIFICATION_CHECK_INTERVAL_MS;
    const windowEnd = reminder.ms;

    if (sentMap[key]) return;
    if (target.diff <= windowEnd && target.diff > windowStart) {
      showPredictionReminderNotification(target, reminder);
      sentMap[key] = Date.now();
      changed = true;
    }
  });

  if (changed) writePredictionNotificationSentMap(sentMap);
}

function getFcmTokenOwnerInfo() {
  const authUser = getAuthUser?.() || state?.settings?.auth?.user || null;
  const player = getCurrentPlayer?.() || null;
  return {
    userId: authUser?.id || player?.id || state?.settings?.auth?.playerId || "anonymous",
    playerId: player?.id || state?.settings?.auth?.playerId || null,
    displayName:
      player?.adSoyad ||
      player?.name ||
      authUser?.adSoyad ||
      authUser?.name ||
      authUser?.kullaniciAdi ||
      "Bilinmeyen kullanıcı",
    role: authUser?.rol || state?.settings?.auth?.role || null,
  };
}

async function registerFiksturMessagingServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Bu tarayıcı service worker desteklemiyor.");
  }

  const swUrl = new URL("./firebase-messaging-sw.js", window.location.href).toString();


  const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js", {
    scope: "./",
  });

  await navigator.serviceWorker.ready;

  return registration;
}

async function saveFiksturFcmTokenToFirebase(token) {
  if (!token) return;

  const owner = getFcmTokenOwnerInfo();
  const safeTokenKey = sanitizeFirebaseKey?.(token) || token.replace(/[.#$\[\]/]/g, "_");

  const payload = {
    token,
    ...owner,
    permission: Notification.permission,
    userAgent: navigator.userAgent,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (typeof firebaseUpdate === "function") {
      await firebaseUpdate(`fcmTokens/${safeTokenKey}`, payload);
    } else if (window.firebase?.database) {
      await window.firebase.database().ref(`fcmTokens/${safeTokenKey}`).update(payload);
    } else {
      throw new Error("Firebase Database kayıt fonksiyonu bulunamadı.");
    }

    localStorage.setItem(PREDICTION_NOTIFICATION_FCM_TOKEN_KEY, token);

  } catch (error) {
    console.warn("[FCM] Token Firebase'e kaydedilemedi:", error);
    throw error;
  }
}

async function setupFiksturFcmToken() {


  if (!window.firebase?.messaging) {
    console.warn("[FCM] Firebase Messaging kütüphanesi bulunamadı.");
    return null;
  }

  if (typeof window.firebase.messaging.isSupported === "function") {
    const supported = await window.firebase.messaging.isSupported();

    if (!supported) {
      throw new Error("Bu tarayıcı Firebase Messaging desteklemiyor.");
    }
  }

  if (!hasValidFiksturVapidKey()) {
    console.warn("[FCM] VAPID key henüz girilmedi. index.html içindeki FIKSTUR_FIREBASE_VAPID_KEY alanını doldur.");
    return null;
  }

  const registration = await registerFiksturMessagingServiceWorker();
  const messaging = window.firebase.messaging();

  messaging.onMessage((payload) => {
    const title = payload?.notification?.title || "Tahmin Paneli";
    const body = payload?.notification?.body || "Yeni bildirimin var.";
    try {
      new Notification(title, {
        body,
        icon: payload?.notification?.icon || "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        data: payload?.data || {},
      });
    } catch (error) {
      console.warn("[FCM] Açık uygulama bildirimi gösterilemedi:", error);
    }
  });

  let token = null;
  try {
    token = await messaging.getToken({
      vapidKey: window.FIKSTUR_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
  } catch (error) {
    console.error("[FCM] getToken detaylı hata:", {
      code: error?.code,
      message: error?.message,
      name: error?.name,
      error,
    });
    throw error;
  }

  if (!token) {
    console.warn("[FCM] Token alınamadı. İzin verilmemiş veya tarayıcı desteklemiyor olabilir.");
    return null;
  }


  await saveFiksturFcmTokenToFirebase(token);
  return token;
}

async function enablePredictionNotifications() {
  if (!isPredictionNotificationSupported()) {
    alert("Bu tarayıcı bildirim desteklemiyor.");
    return;
  }

  if (!window.isSecureContext && location.hostname !== "localhost") {
    alert("Bildirim izni için site HTTPS üzerinden açılmalı. GitHub Pages yayını uygundur.");
    console.warn("[Bildirim] HTTPS olmadığı için izin istenemedi.");
    return;
  }

  let permission = Notification.permission;

  try {
    permission = await Notification.requestPermission();
  } catch (error) {
    console.warn("[Bildirim] İzin penceresi açılamadı:", error);
    alert("Bildirim izin penceresi açılamadı. Sayfayı yenileyip butona tekrar bas.");
    return;
  }


  if (permission !== "granted") {
    localStorage.removeItem(PREDICTION_NOTIFICATION_STORAGE_KEY);
    alert("Bildirim izni verilmedi. Tekrar denemek için Bildirimleri aç butonuna basabilirsin.");
    renderPredictionLockBanner?.(state?.settings?.activeWeekId);
    return;
  }

  localStorage.setItem(PREDICTION_NOTIFICATION_STORAGE_KEY, "1");

  try {
    const token = await setupFiksturFcmToken();
    if (token) {
      alert("Bildirimler açıldı ve bu cihaz Firebase'e kaydedildi.");
    } else {
      alert("Bildirim izni açıldı. FCM token için VAPID key girildikten sonra tekrar dene.");
    }
  } catch (error) {
    console.error("[FCM] Token alma sırasında hata oluştu:", {
      code: error?.code,
      message: error?.message,
      name: error?.name,
      error,
    });
    alert(`Bildirim izni açıldı ama Firebase token alınamadı. Hata: ${error?.code || error?.message || "Bilinmeyen hata"}`);
  }

  checkPredictionNotifications();
  renderPredictionLockBanner?.(state?.settings?.activeWeekId);
}

function bindPredictionNotificationHooks() {
  document.addEventListener("click", (event) => {
    const enableButton = event.target.closest?.('[data-action="enable-prediction-notifications"]');
    if (enableButton) {
      enablePredictionNotifications();
      return;
    }
  });

  clearInterval(predictionNotificationTimer);
  predictionNotificationTimer = setInterval(
    checkPredictionNotifications,
    PREDICTION_NOTIFICATION_CHECK_INTERVAL_MS,
  );

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkPredictionNotifications();
  });

  window.addEventListener("focus", checkPredictionNotifications);

  if (isPredictionNotificationSupported() && Notification.permission === "granted" && hasValidFiksturVapidKey()) {
    setTimeout(() => {
      setupFiksturFcmToken().catch((error) => {
        console.warn("[FCM] Otomatik token yenileme başarısız:", error);
      });
    }, 5000);
  }

  setTimeout(checkPredictionNotifications, 3000);

}

bindPredictionNotificationHooks();

/* Admin Bildirim Merkezi - Firebase Kuyruk Entegrasyonu */
const ADMIN_NOTIFICATION_DRAFT_KEY = "fikstur_admin_notification_draft_v1";
const ADMIN_NOTIFICATION_QUEUE_PATH = "adminNotificationQueue";
const ADMIN_NOTIFICATION_LOG_PATH = "notificationLogs";
const ADMIN_NOTIFICATION_SENT_PATH = "sentNotifications";
const ADMIN_NOTIFICATION_FCM_TOKEN_PATH = "fcmTokens";
const ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE = 10;
let adminNotificationHistoryRows = [];
let adminNotificationHistoryPage = 1;
let adminNotificationHistoryFilter = "all";
let adminNotificationLastTokenRows = [];
let adminNotificationLastUserRows = [];

const ADMIN_NOTIFICATION_ICONS = [
  { id: "default", emoji: "🔔", label: "Genel" },
  { id: "match", emoji: "⚽", label: "Maç" },
  { id: "cup", emoji: "🏆", label: "Sonuç" },
  { id: "alert", emoji: "🚨", label: "Acil" },
  { id: "announce", emoji: "📢", label: "Duyuru" },
  { id: "star", emoji: "⭐", label: "Öne Çıkan" },
];

function getAdminNotificationIconMeta(iconId) {
  return ADMIN_NOTIFICATION_ICONS.find((item) => item.id === iconId) || ADMIN_NOTIFICATION_ICONS[0];
}

function formatNotificationCenterDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getNotificationTargetLabel(target, row) {
  if (target === "active") return "Aktif kullanıcılar";
  if (target === "pending") return "Tahmini eksik olanlar";
  if (target === "custom") {
    const count = Array.isArray(row?.targetUserIds) ? row.targetUserIds.length : 0;
    return count ? `Seçili ${count} kişi` : "Seçili kişiler";
  }
  return "Tüm kullanıcılar";
}

function getNotificationPlayerDisplayName(player) {
  return String(
    player?.adSoyad ||
    player?.name ||
    player?.kullaniciAdi ||
    player?.username ||
    player?.id ||
    "İsimsiz"
  ).trim();
}

function normalizeNotificationArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") return Object.values(value).filter(Boolean);
  return [];
}

function getPlayerNotificationId(player) {
  return String(player?.id || player?.kullaniciAdi || player?.username || "").trim();
}

function normalizeFcmTokenRows(tokens) {
  return Object.entries(tokens || {}).map(([id, item]) => ({
    id,
    token: item?.token || id,
    userId: String(item?.userId || item?.playerId || "").trim(),
    playerId: String(item?.playerId || item?.userId || "").trim(),
    displayName: item?.displayName || item?.name || item?.userName || "Bilinmeyen kullanıcı",
    role: item?.role || "",
    permission: item?.permission || "unknown",
    updatedAt: item?.updatedAt || item?.createdAt || "",
    userAgent: item?.userAgent || "",
  })).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function getNotificationUserRows(tokenRows) {
  const tokenByUser = new Map();
  tokenRows.forEach((token) => {
    const keys = [token.userId, token.playerId].filter(Boolean);
    keys.forEach((key) => {
      if (!tokenByUser.has(key)) tokenByUser.set(key, []);
      tokenByUser.get(key).push(token);
    });
  });

  return getNotificationSelectablePlayers().map((player) => {
    const id = getPlayerNotificationId(player);
    const tokens = tokenByUser.get(id) || [];
    const grantedTokens = tokens.filter((token) => token.permission === "granted" || token.permission === "unknown");
    const lastToken = tokens[0] || null;
    return {
      id,
      name: getNotificationPlayerDisplayName(player),
      hasToken: tokens.length > 0,
      isOpen: grantedTokens.length > 0,
      tokenCount: tokens.length,
      lastSeen: lastToken?.updatedAt || "",
      permission: lastToken?.permission || "none",
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

function getNotificationDeliveryList(row) {
  const rawSuccess = normalizeNotificationArray(row?.successUsers || row?.sentUsers || row?.deliveredUsers || row?.successUserIds);
  const rawFailed = normalizeNotificationArray(row?.failedUsers || row?.errorUsers || row?.failedUserIds);
  const rawTargets = normalizeNotificationArray(row?.targetUserIds);
  return { rawSuccess, rawFailed, rawTargets };
}

function getNotificationUserNameById(userId) {
  const user = adminNotificationLastUserRows.find((item) => item.id === String(userId));
  return user?.name || String(userId || "Bilinmeyen kişi");
}

function getNotificationSelectablePlayers() {
  return (Array.isArray(state?.players) ? state.players : [])
    .filter((player) => String(getPlayerRole?.(player) || player?.role || "user").toLowerCase() !== "admin")
    .sort((a, b) => getNotificationPlayerDisplayName(a).localeCompare(getNotificationPlayerDisplayName(b), "tr"));
}

function getSelectedManualNotificationUserIds() {
  return Array.from(document.querySelectorAll('[data-notification-user-checkbox]:checked'))
    .map((input) => input.value)
    .filter(Boolean);
}

function renderManualNotificationUserPicker() {
  const wrap = document.getElementById("manualNotificationUserPicker");
  if (!wrap) return;

  const players = getNotificationSelectablePlayers();
  if (!players.length) {
    wrap.innerHTML = `<small class="notification-user-empty">Kişi listesi henüz yüklenmedi.</small>`;
    return;
  }

  wrap.innerHTML = players.map((player) => {
    const id = escapeHtml(String(player.id || player.kullaniciAdi || player.username || ""));
    const name = escapeHtml(getNotificationPlayerDisplayName(player));
    return `
      <label class="notification-user-chip">
        <input type="checkbox" value="${id}" data-notification-user-checkbox>
        <span>${name}</span>
      </label>
    `;
  }).join("");
}

function updateManualNotificationCustomTargetVisibility() {
  const target = document.getElementById("manualNotificationTarget")?.value || "all";
  const panel = document.getElementById("manualNotificationCustomTargetPanel");
  if (!panel) return;
  panel.hidden = target !== "custom";
  if (target === "custom") renderManualNotificationUserPicker();
}

function setNotificationText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getManualNotificationFormValues() {
  const target = document.getElementById("manualNotificationTarget")?.value || "all";
  const icon = document.getElementById("manualNotificationIcon")?.value || "default";
  const targetUserIds = target === "custom" ? getSelectedManualNotificationUserIds() : [];
  return {
    title: document.getElementById("manualNotificationTitle")?.value.trim() || "",
    message: document.getElementById("manualNotificationMessage")?.value.trim() || "",
    target,
    icon,
    targetUserIds,
  };
}

function updateManualNotificationPreview() {
  const preview = document.getElementById("manualNotificationPreview");
  const previewTitle = document.getElementById("manualNotificationPreviewTitle");
  const previewTarget = document.getElementById("manualNotificationPreviewTarget");
  const previewIcon = document.getElementById("manualNotificationPreviewIcon");
  const charCounter = document.getElementById("manualNotificationCharCounter");
  const { title, message, target, icon, targetUserIds } = getManualNotificationFormValues();
  const maxLength = 300;

  if (charCounter) {
    charCounter.textContent = `${message.length} / ${maxLength}`;
    charCounter.classList.toggle("is-warning", message.length >= 240 && message.length < maxLength);
    charCounter.classList.toggle("is-danger", message.length >= maxLength);
  }

  if (previewTarget) previewTarget.textContent = target === "custom" ? getNotificationTargetLabel(target, { targetUserIds }) : getNotificationTargetLabel(target);
  if (previewIcon) previewIcon.textContent = getAdminNotificationIconMeta(icon).emoji;
  if (previewTitle) previewTitle.textContent = title || "Başlık burada görünecek";
  if (!preview) return;

  if (!title && !message) {
    preview.textContent = "Mesaj yazıldığında telefonda nasıl görüneceğini buradan kontrol edebilirsin.";
    return;
  }

  preview.textContent = message || "Mesaj metni burada görünecek.";
}

function getNotificationStatusMeta(statusValue) {
  const status = String(statusValue || "pending").toLowerCase();
  if (["sent", "done", "processed", "success"].includes(status)) {
    return { className: "success", text: "🟢 Gönderildi" };
  }
  if (["error", "failed", "fail"].includes(status)) {
    return { className: "danger", text: "🔴 Başarısız" };
  }
  if (["pending", "queued", "draft"].includes(status)) {
    return { className: "warn", text: "🟡 Bekliyor" };
  }
  if (status === "processing") {
    return { className: "gray", text: "🔵 İşleniyor" };
  }
  if (["scheduled", "planned"].includes(status)) {
    return { className: "gray", text: "🔵 Zamanlandı" };
  }
  return { className: "gray", text: statusValue || "Bekliyor" };
}

async function readAdminNotificationCenterData() {
  const [queue, logs, sent, tokens] = await Promise.all([
    firebaseRead(ADMIN_NOTIFICATION_QUEUE_PATH).catch(() => null),
    firebaseRead(ADMIN_NOTIFICATION_LOG_PATH).catch(() => null),
    firebaseRead(ADMIN_NOTIFICATION_SENT_PATH).catch(() => null),
    firebaseRead(ADMIN_NOTIFICATION_FCM_TOKEN_PATH).catch(() => null),
  ]);
  return { queue: queue || {}, logs: logs || {}, sent: sent || {}, tokens: tokens || {} };
}

function normalizeNotificationRows(data) {
  const rows = [];

  Object.entries(data.queue || {}).forEach(([id, item]) => {
    rows.push({
      id,
      sourcePath: `${ADMIN_NOTIFICATION_QUEUE_PATH}/${id}`,
      canDelete: true,
      date: item.createdAt || item.updatedAt,
      type: item.type === "manual" ? "Manuel" : "Kuyruk",
      title: item.title || "Başlıksız",
      body: item.message || "",
      rawTarget: item.target || "all",
      icon: item.icon || "default",
      targetUserIds: normalizeNotificationArray(item.targetUserIds),
      message: `${item.title || "Başlıksız"} - ${item.message || ""}`,
      target: getNotificationTargetLabel(item.target, item),
      status: item.status || "pending",
      successCount: item.successCount || 0,
      errorCount: item.errorCount || 0,
      errorMessage: item.errorMessage || "",
      successUsers: normalizeNotificationArray(item.successUsers || item.sentUsers || item.deliveredUsers || item.successUserIds),
      failedUsers: normalizeNotificationArray(item.failedUsers || item.errorUsers || item.failedUserIds),
      raw: item,
    });
  });

  Object.entries(data.logs || {}).forEach(([id, item]) => {
    rows.push({
      id,
      sourcePath: `${ADMIN_NOTIFICATION_LOG_PATH}/${id}`,
      canDelete: true,
      date: item.createdAt || item.sentAt || item.finishedAt,
      type: item.type || "Log",
      title: item.title || item.message || "Bildirim kaydı",
      body: item.message || item.body || "",
      rawTarget: item.target || "all",
      icon: item.icon || "default",
      targetUserIds: normalizeNotificationArray(item.targetUserIds),
      message: item.message || item.title || "Bildirim kaydı",
      target: getNotificationTargetLabel(item.target, item),
      status: item.status || "done",
      successCount: item.successCount || 0,
      errorCount: item.errorCount || 0,
      errorMessage: item.errorMessage || "",
      successUsers: normalizeNotificationArray(item.successUsers || item.sentUsers || item.deliveredUsers || item.successUserIds),
      failedUsers: normalizeNotificationArray(item.failedUsers || item.errorUsers || item.failedUserIds),
      raw: item,
    });
  });

  Object.entries(data.sent || {}).forEach(([id, item]) => {
    rows.push({
      id,
      sourcePath: `${ADMIN_NOTIFICATION_SENT_PATH}/${id}`,
      canDelete: true,
      date: item.sentAt,
      type: item.weekNo ? "Otomatik hafta" : item.type ? `Otomatik ${item.type}` : "Otomatik",
      title: item.title || (item.weekNo ? `${item.weekNo}. hafta bildirimi` : "Maç hatırlatma bildirimi"),
      body: item.message || (item.weekNo ? `${item.weekNo}. hafta bildirimi gönderildi` : "Maç hatırlatma bildirimi gönderildi"),
      rawTarget: item.target || "all",
      icon: item.icon || "match",
      targetUserIds: normalizeNotificationArray(item.targetUserIds),
      message: item.weekNo ? `${item.weekNo}. hafta bildirimi gönderildi` : "Maç hatırlatma bildirimi gönderildi",
      target: getNotificationTargetLabel(item.target || "all", item),
      status: item.sent ? "sent" : "done",
      successCount: item.successCount || 0,
      errorCount: item.errorCount || 0,
      errorMessage: item.errorMessage || "",
      successUsers: normalizeNotificationArray(item.successUsers || item.sentUsers || item.deliveredUsers || item.successUserIds),
      failedUsers: normalizeNotificationArray(item.failedUsers || item.errorUsers || item.failedUserIds),
      raw: item,
    });
  });

  return rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function getCompactNotificationPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) pages.push("...");
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < totalPages - 1) pages.push("...");
  pages.push(totalPages);
  return pages;
}

function renderNotificationPagination(totalRows) {
  const wrap = document.getElementById("notificationHistoryPagination");
  const info = document.getElementById("notificationHistoryPageInfo");
  if (!wrap) return;

  const totalPages = Math.max(1, Math.ceil(totalRows / ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE));
  adminNotificationHistoryPage = Math.min(Math.max(1, adminNotificationHistoryPage), totalPages);

  if (info) {
    const start = totalRows ? (adminNotificationHistoryPage - 1) * ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE + 1 : 0;
    const end = Math.min(adminNotificationHistoryPage * ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE, totalRows);
    info.textContent = totalRows ? `${start}-${end} / ${totalRows} kayıt` : "0 kayıt";
  }

  if (totalPages <= 1) {
    wrap.innerHTML = "";
    return;
  }

  const pageButtons = getCompactNotificationPageNumbers(adminNotificationHistoryPage, totalPages).map((page) => {
    if (page === "...") return `<span class="notification-page-dots">…</span>`;
    const isActive = page === adminNotificationHistoryPage;
    return `<button class="notification-page-btn ${isActive ? "is-active" : ""}" type="button" data-notification-page="${page}" aria-label="${page}. sayfaya git">${page}</button>`;
  }).join("");

  wrap.innerHTML = `
    <button class="notification-page-btn" type="button" data-notification-page="prev" ${adminNotificationHistoryPage === 1 ? "disabled" : ""}>‹</button>
    ${pageButtons}
    <button class="notification-page-btn" type="button" data-notification-page="next" ${adminNotificationHistoryPage === totalPages ? "disabled" : ""}>›</button>
  `;
}


function getFilteredNotificationRows(rows) {
  const filter = adminNotificationHistoryFilter;
  if (filter === "sent") {
    return rows.filter((row) => ["sent", "done", "processed", "success"].includes(String(row.status || "").toLowerCase()));
  }
  if (filter === "pending") {
    return rows.filter((row) => ["pending", "queued", "draft", "processing", "scheduled", "planned"].includes(String(row.status || "").toLowerCase()));
  }
  if (filter === "failed") {
    return rows.filter((row) => ["error", "failed", "fail"].includes(String(row.status || "").toLowerCase()) || row.errorMessage);
  }
  if (filter === "manual") {
    return rows.filter((row) => String(row.type || "").toLowerCase().includes("manuel"));
  }
  return rows;
}

function updateNotificationHistoryFilterButtons() {
  document.querySelectorAll("[data-notification-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.notificationFilter === adminNotificationHistoryFilter);
  });
}

function renderNotificationHistoryRows(rows) {
  const tbody = document.getElementById("notificationHistoryBody");
  if (!tbody) return;

  adminNotificationHistoryRows = Array.isArray(rows) ? rows : [];
  updateNotificationHistoryFilterButtons();
  const visibleRows = getFilteredNotificationRows(adminNotificationHistoryRows);
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE));
  adminNotificationHistoryPage = Math.min(Math.max(1, adminNotificationHistoryPage), totalPages);

  if (!visibleRows.length) {
    tbody.innerHTML = `<tr><td colspan="6">Bu filtrede bildirim kaydı yok.</td></tr>`;
    renderNotificationPagination(0);
    return;
  }

  const startIndex = (adminNotificationHistoryPage - 1) * ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE;
  const pageRows = visibleRows.slice(startIndex, startIndex + ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE);

  tbody.innerHTML = pageRows.map((row) => {
    const status = String(row.status || "pending");
    const isPending = ["pending", "queued", "processing"].includes(status);
    const statusMeta = getNotificationStatusMeta(status);
    const iconMeta = getAdminNotificationIconMeta(row.icon);
    const extra = row.successCount ? ` (${row.successCount} başarılı)` : row.errorMessage ? ` - ${row.errorMessage}` : "";
    const titleAttr = isPending ? "Gönderilmeden önce bu kaydı kuyruktan sil" : "Bu geçmiş kaydını sil";
    return `
      <tr>
        <td>${escapeHtml(formatNotificationCenterDate(row.date))}</td>
        <td>${escapeHtml(row.type)}</td>
        <td class="notification-message-cell"><span class="notification-history-icon">${escapeHtml(iconMeta.emoji)}</span>${escapeHtml(row.message)}</td>
        <td>${escapeHtml(row.target)}</td>
        <td><span class="badge ${statusMeta.className}">${escapeHtml(statusMeta.text + extra)}</span></td>
        <td class="notification-row-actions">
          <button class="notification-detail-btn" type="button" data-notification-detail-path="${escapeHtml(row.sourcePath || "")}" title="Kime gitti / hata detaylarını gör">Detay</button>
          <button class="notification-repeat-btn" type="button" data-notification-repeat-path="${escapeHtml(row.sourcePath || "")}" title="Bu bildirimi forma tekrar doldur">Tekrar Gönder</button>
          <button class="notification-delete-btn" type="button" data-notification-delete-path="${escapeHtml(row.sourcePath || "")}" title="${escapeHtml(titleAttr)}">Sil</button>
        </td>
      </tr>
    `;
  }).join("");

  renderNotificationPagination(visibleRows.length);
}

function refillNotificationFormFromHistory(sourcePath) {
  const row = adminNotificationHistoryRows.find((item) => item.sourcePath === sourcePath);
  if (!row) {
    alert("Bildirim kaydı bulunamadı.");
    return;
  }

  const titleEl = document.getElementById("manualNotificationTitle");
  const msgEl = document.getElementById("manualNotificationMessage");
  const targetEl = document.getElementById("manualNotificationTarget");
  const iconEl = document.getElementById("manualNotificationIcon");

  if (titleEl) titleEl.value = row.title || "";
  if (msgEl) msgEl.value = row.body || row.message || "";
  if (targetEl) targetEl.value = row.rawTarget || "all";
  if (iconEl) iconEl.value = row.icon || "default";
  updateManualNotificationCustomTargetVisibility();
  if (Array.isArray(row.targetUserIds) && row.targetUserIds.length) {
    document.querySelectorAll('[data-notification-user-checkbox]').forEach((input) => {
      input.checked = row.targetUserIds.includes(input.value);
    });
  }
  updateManualNotificationPreview();
  document.querySelector(".notification-compose-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteNotificationHistoryItem(sourcePath) {
  if (getCurrentRole() !== "admin") {
    alert("Bu işlem sadece admin içindir.");
    return;
  }

  if (!sourcePath || !isFirebaseReady()) {
    alert("Firebase bağlantısı hazır değil. Kayıt silinemedi.");
    return;
  }

  const row = adminNotificationHistoryRows.find((item) => item.sourcePath === sourcePath);
  const status = String(row?.status || "");
  const isPending = ["pending", "queued", "processing"].includes(status);
  const message = isPending
    ? "Bu bildirim henüz gönderilmemiş görünüyor. Silersen cron-job artık bunu göndermeyecek. Silinsin mi?"
    : "Bu işlem sadece geçmiş kaydını siler; daha önce gönderilmiş bildirimi kullanıcı cihazlarından geri almaz. Silinsin mi?";

  if (!confirm(message)) return;

  await firebaseRemove(sourcePath);
  const totalAfterDelete = Math.max(0, adminNotificationHistoryRows.length - 1);
  const lastPageAfterDelete = Math.max(1, Math.ceil(totalAfterDelete / ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE));
  adminNotificationHistoryPage = Math.min(adminNotificationHistoryPage, lastPageAfterDelete);
  await renderNotificationCenter();
}


function renderNotificationAudiencePanel(tokenRows, userRows) {
  const list = document.getElementById("notificationAudienceList");
  const tokenTotal = tokenRows.length;
  const openUsers = userRows.filter((user) => user.isOpen).length;
  const closedUsers = Math.max(0, userRows.length - openUsers);

  setNotificationText("notificationTokenCountText", String(tokenTotal));
  setNotificationText("notificationOpenUserCountText", String(openUsers));
  setNotificationText("notificationClosedUserCountText", String(closedUsers));

  if (!list) return;
  if (!userRows.length) {
    list.innerHTML = `<div class="notification-audience-empty">Kullanıcı listesi henüz yüklenmedi.</div>`;
    return;
  }

  list.innerHTML = userRows.map((user) => `
    <div class="notification-audience-row ${user.isOpen ? "is-open" : "is-closed"}">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <small>${user.hasToken ? `${escapeHtml(String(user.tokenCount))} cihaz · son kayıt ${escapeHtml(formatNotificationCenterDate(user.lastSeen))}` : "Bu kullanıcıdan kayıtlı cihaz/token yok"}</small>
      </div>
      <span class="badge ${user.isOpen ? "success" : "gray"}">${user.isOpen ? "🔔 Açık" : "🔕 Kapalı"}</span>
    </div>
  `).join("");
}

function renderNotificationDetailModal(sourcePath) {
  const modal = document.getElementById("notificationDetailModal");
  const body = document.getElementById("notificationDetailBody");
  if (!modal || !body) return;

  const row = adminNotificationHistoryRows.find((item) => item.sourcePath === sourcePath);
  if (!row) {
    alert("Bildirim detayı bulunamadı.");
    return;
  }

  const statusMeta = getNotificationStatusMeta(row.status);
  const iconMeta = getAdminNotificationIconMeta(row.icon);
  const { rawSuccess, rawFailed, rawTargets } = getNotificationDeliveryList(row);
  const targetUsers = rawTargets.map((id) => getNotificationUserNameById(id));
  const successUsers = rawSuccess.map((item) => typeof item === "string" ? getNotificationUserNameById(item) : (item?.displayName || item?.name || getNotificationUserNameById(item?.userId || item?.playerId || item?.id)));
  const failedUsers = rawFailed.map((item) => typeof item === "string" ? getNotificationUserNameById(item) : (item?.displayName || item?.name || getNotificationUserNameById(item?.userId || item?.playerId || item?.id)));

  const makeList = (items, emptyText) => items.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<small class="notification-detail-empty">${escapeHtml(emptyText)}</small>`;

  body.innerHTML = `
    <div class="notification-detail-summary">
      <div><span>Tarih</span><strong>${escapeHtml(formatNotificationCenterDate(row.date))}</strong></div>
      <div><span>Durum</span><strong class="badge ${statusMeta.className}">${escapeHtml(statusMeta.text)}</strong></div>
      <div><span>Hedef</span><strong>${escapeHtml(row.target)}</strong></div>
      <div><span>İkon</span><strong>${escapeHtml(iconMeta.emoji)} ${escapeHtml(iconMeta.label)}</strong></div>
    </div>
    <div class="notification-detail-message">
      <strong>${escapeHtml(row.title || "Başlıksız")}</strong>
      <p>${escapeHtml(row.body || row.message || "Mesaj yok")}</p>
    </div>
    <div class="notification-detail-grid">
      <section>
        <h4>Seçili / hedef kullanıcılar</h4>
        ${makeList(targetUsers, row.rawTarget === "custom" ? "Seçili kişi bilgisi bulunamadı." : "Bu bildirim kişi bazlı seçilmemiş; hedef kitle genel.")}
      </section>
      <section>
        <h4>Başarılı kayıtlar</h4>
        ${makeList(successUsers, row.successCount ? `${row.successCount} başarılı gönderim var; kişi detayı logda tutulmamış.` : "Başarılı kişi detayı henüz logda yok.")}
      </section>
      <section>
        <h4>Başarısız kayıtlar</h4>
        ${makeList(failedUsers, row.errorMessage || row.errorCount ? `${row.errorCount || 1} hata var; kişi detayı logda tutulmamış.` : "Başarısız kayıt görünmüyor.")}
      </section>
    </div>
    ${row.errorMessage ? `<div class="notification-detail-error"><strong>Hata mesajı:</strong> ${escapeHtml(row.errorMessage)}</div>` : ""}
  `;

  modal.classList.add("is-open");
  modal.removeAttribute("hidden");
}

function closeNotificationDetailModal() {
  const modal = document.getElementById("notificationDetailModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("hidden", "hidden");
}

function updateNotificationSummary(rows) {
  const pendingCount = rows.filter((r) => ["pending", "queued", "draft", "processing"].includes(String(r.status || "").toLowerCase())).length;
  const successTotal = rows.reduce((sum, r) => sum + (Number(r.successCount) || 0), 0);
  const errorTotal = rows.reduce((sum, r) => sum + (Number(r.errorCount) || 0), 0);
  const lastRow = rows[0];
  const lastError = rows.find((r) => r.status === "error" || r.status === "failed" || r.errorMessage);

  setNotificationText("notificationPendingCountText", String(pendingCount));
  setNotificationText("notificationSuccessCountText", String(successTotal));
  setNotificationText("notificationErrorCountText", String(errorTotal));
  setNotificationText("notificationLastTitleText", lastRow ? (lastRow.title || lastRow.message || "Başlıksız") : "Henüz yok");
  setNotificationText("notificationLastCronText", lastRow ? formatNotificationCenterDate(lastRow.date) : "Henüz kayıt yok");
  setNotificationText("notificationLastCronMeta", lastRow ? `${lastRow.type} · ${lastRow.status}` : "GitHub Action çalışınca buraya yazılacak.");
  setNotificationText("notificationLastErrorText", lastError ? `Son hata: ${lastError.errorMessage || "Hata var"}` : "Son hata: Yok");
  setNotificationText("notificationFirebaseStatus", isFirebaseReady() ? "Bağlı" : "Kapalı");

  const fbBadge = document.getElementById("notificationFirebaseStatusBadge");
  if (fbBadge) {
    fbBadge.textContent = isFirebaseReady() ? "Firebase bağlı" : "Firebase kapalı";
    fbBadge.className = `badge ${isFirebaseReady() ? "success" : "warn"}`;
  }

  const queueBadge = document.getElementById("notificationQueueStatusBadge");
  if (queueBadge) {
    queueBadge.textContent = pendingCount ? `${pendingCount} bekleyen` : "Kuyruk boş";
    queueBadge.className = `badge ${pendingCount ? "warn" : "gray"}`;
  }
}

async function renderNotificationCenter() {
  if (!document.getElementById("tab-notifications")) return;
  renderManualNotificationUserPicker();
  updateManualNotificationCustomTargetVisibility();
  updateManualNotificationPreview();

  const draft = (() => {
    try { return JSON.parse(localStorage.getItem(ADMIN_NOTIFICATION_DRAFT_KEY) || "null"); } catch { return null; }
  })();
  if (draft && !document.getElementById("manualNotificationTitle")?.value && !document.getElementById("manualNotificationMessage")?.value) {
    const titleEl = document.getElementById("manualNotificationTitle");
    const msgEl = document.getElementById("manualNotificationMessage");
    const targetEl = document.getElementById("manualNotificationTarget");
    const iconEl = document.getElementById("manualNotificationIcon");
    if (titleEl) titleEl.value = draft.title || "";
    if (msgEl) msgEl.value = draft.message || "";
    if (targetEl) targetEl.value = draft.target || "all";
    if (iconEl) iconEl.value = draft.icon || "default";
    updateManualNotificationCustomTargetVisibility();
    if (Array.isArray(draft.targetUserIds)) {
      document.querySelectorAll('[data-notification-user-checkbox]').forEach((input) => {
        input.checked = draft.targetUserIds.includes(input.value);
      });
    }
    updateManualNotificationPreview();
  }

  if (!isFirebaseReady()) {
    adminNotificationLastTokenRows = [];
    adminNotificationLastUserRows = [];
    renderNotificationAudiencePanel([], getNotificationUserRows([]));
    renderNotificationHistoryRows([]);
    updateNotificationSummary([]);
    return;
  }

  try {
    const data = await readAdminNotificationCenterData();
    const rows = normalizeNotificationRows(data);
    const tokenRows = normalizeFcmTokenRows(data.tokens);
    const userRows = getNotificationUserRows(tokenRows);
    adminNotificationLastTokenRows = tokenRows;
    adminNotificationLastUserRows = userRows;
    renderNotificationAudiencePanel(tokenRows, userRows);
    renderNotificationHistoryRows(rows);
    updateNotificationSummary(rows);
  } catch (error) {
    console.error("Bildirim merkezi yüklenemedi:", error);
    setNotificationText("notificationLastErrorText", error.message || "Yüklenemedi");
  }
}

async function queueManualNotification() {
  if (getCurrentRole() !== "admin") {
    alert("Bu işlem sadece admin içindir.");
    return;
  }

  if (!isFirebaseReady()) {
    alert("Firebase bağlantısı hazır değil. Bildirim kuyruğuna alınamadı.");
    return;
  }

  const { title, message, target, icon, targetUserIds } = getManualNotificationFormValues();
  if (!title || !message) {
    alert("Başlık ve mesaj metni zorunlu kanka.");
    return;
  }

  if (target === "custom" && !targetUserIds.length) {
    alert("Özel gönderim için en az 1 kişi seçmelisin kanka.");
    return;
  }

  const id = sanitizeFirebaseKey(`manual_${Date.now()}`);
  const now = new Date().toISOString();
  const payload = {
    id,
    type: "manual",
    status: "pending",
    title,
    message,
    target,
    icon,
    iconEmoji: getAdminNotificationIconMeta(icon).emoji,
    targetUserIds,
    targetMode: target === "custom" ? "selectedUsers" : target,
    createdAt: now,
    createdBy: getCurrentUsername() || "admin",
  };

  await firebaseWrite(`${ADMIN_NOTIFICATION_QUEUE_PATH}/${id}`, payload);
  localStorage.removeItem(ADMIN_NOTIFICATION_DRAFT_KEY);

  const titleEl = document.getElementById("manualNotificationTitle");
  const msgEl = document.getElementById("manualNotificationMessage");
  if (titleEl) titleEl.value = "";
  if (msgEl) msgEl.value = "";
  document.querySelectorAll('[data-notification-user-checkbox]').forEach((input) => { input.checked = false; });
  updateManualNotificationPreview();
  await renderNotificationCenter();
  alert("Bildirim Firebase kuyruğuna alındı. Cron-job çalışınca gönderilecek.");
}


async function cleanupOldNotificationHistory() {
  if (getCurrentRole() !== "admin") {
    alert("Bu işlem sadece admin içindir.");
    return;
  }
  if (!isFirebaseReady()) {
    alert("Firebase bağlantısı hazır değil. Temizleme yapılamadı.");
    return;
  }

  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const oldRows = adminNotificationHistoryRows.filter((row) => {
    if (["pending", "queued", "processing"].includes(String(row.status || "").toLowerCase())) return false;
    const time = new Date(row.date || 0).getTime();
    return time && time < cutoff && row.sourcePath;
  });

  if (!oldRows.length) {
    alert("30 günden eski silinecek kayıt bulunamadı kanka.");
    return;
  }

  if (!confirm(`${oldRows.length} adet eski geçmiş kaydı silinecek. Bekleyen bildirimlere dokunulmayacak. Devam edilsin mi?`)) return;

  await Promise.all(oldRows.map((row) => firebaseRemove(row.sourcePath)));
  adminNotificationHistoryPage = 1;
  await renderNotificationCenter();
  alert("Eski bildirim geçmişi temizlendi.");
}

function saveManualNotificationDraft() {
  const values = getManualNotificationFormValues();
  localStorage.setItem(ADMIN_NOTIFICATION_DRAFT_KEY, JSON.stringify(values));
  alert("Taslak bu cihazda kaydedildi kanka.");
}

function bindAdminNotificationCenterEvents() {
  if (window.__adminNotificationCenterBound) return;
  window.__adminNotificationCenterBound = true;

  document.addEventListener("input", (event) => {
    if (["manualNotificationTitle", "manualNotificationMessage"].includes(event.target?.id) || event.target?.matches?.('[data-notification-user-checkbox]')) {
      updateManualNotificationPreview();
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target?.id === "manualNotificationTarget") {
      updateManualNotificationCustomTargetVisibility();
      updateManualNotificationPreview();
    }
    if (event.target?.id === "manualNotificationIcon") updateManualNotificationPreview();
    if (event.target?.matches?.('[data-notification-user-checkbox]')) updateManualNotificationPreview();
  });

  document.addEventListener("click", async (event) => {
    const draftButton = event.target.closest?.("#saveManualNotificationDraftBtn");
    const queueButton = event.target.closest?.("#queueManualNotificationBtn");
    const deleteButton = event.target.closest?.("[data-notification-delete-path]");
    const detailButton = event.target.closest?.("[data-notification-detail-path]");
    const detailCloseButton = event.target.closest?.("[data-notification-detail-close]");
    const detailBackdrop = event.target.classList?.contains("notification-detail-modal") ? event.target : null;
    const repeatButton = event.target.closest?.("[data-notification-repeat-path]");
    const pageButton = event.target.closest?.("[data-notification-page]");
    const filterButton = event.target.closest?.("[data-notification-filter]");
    const cleanupButton = event.target.closest?.("#cleanupOldNotificationsBtn");
    const selectAllButton = event.target.closest?.("#selectAllNotificationUsersBtn");
    const clearSelectedButton = event.target.closest?.("#clearNotificationUsersBtn");

    if (detailCloseButton || detailBackdrop) {
      event.preventDefault();
      closeNotificationDetailModal();
      return;
    }

    if (detailButton) {
      event.preventDefault();
      renderNotificationDetailModal(detailButton.dataset.notificationDetailPath);
      return;
    }

    if (draftButton) {
      event.preventDefault();
      saveManualNotificationDraft();
      return;
    }

    if (selectAllButton) {
      event.preventDefault();
      document.querySelectorAll('[data-notification-user-checkbox]').forEach((input) => { input.checked = true; });
      updateManualNotificationPreview();
      return;
    }

    if (clearSelectedButton) {
      event.preventDefault();
      document.querySelectorAll('[data-notification-user-checkbox]').forEach((input) => { input.checked = false; });
      updateManualNotificationPreview();
      return;
    }

    if (filterButton) {
      event.preventDefault();
      adminNotificationHistoryFilter = filterButton.dataset.notificationFilter || "all";
      adminNotificationHistoryPage = 1;
      renderNotificationHistoryRows(adminNotificationHistoryRows);
      return;
    }

    if (cleanupButton) {
      event.preventDefault();
      cleanupButton.disabled = true;
      try {
        await cleanupOldNotificationHistory();
      } catch (error) {
        console.error("Eski bildirim geçmişi temizlenemedi:", error);
        alert(`Eski bildirim geçmişi temizlenemedi: ${error.message || error}`);
      } finally {
        cleanupButton.disabled = false;
      }
      return;
    }

    if (repeatButton) {
      event.preventDefault();
      refillNotificationFormFromHistory(repeatButton.dataset.notificationRepeatPath);
      return;
    }

    if (deleteButton) {
      event.preventDefault();
      deleteButton.disabled = true;
      try {
        await deleteNotificationHistoryItem(deleteButton.dataset.notificationDeletePath);
      } catch (error) {
        console.error("Bildirim kaydı silinemedi:", error);
        alert(`Bildirim kaydı silinemedi: ${error.message || error}`);
      } finally {
        deleteButton.disabled = false;
      }
      return;
    }

    if (pageButton) {
      event.preventDefault();
      const totalPages = Math.max(1, Math.ceil(getFilteredNotificationRows(adminNotificationHistoryRows).length / ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE));
      const target = pageButton.dataset.notificationPage;
      if (target === "prev") adminNotificationHistoryPage = Math.max(1, adminNotificationHistoryPage - 1);
      else if (target === "next") adminNotificationHistoryPage = Math.min(totalPages, adminNotificationHistoryPage + 1);
      else adminNotificationHistoryPage = Math.min(totalPages, Math.max(1, Number(target) || 1));
      renderNotificationHistoryRows(adminNotificationHistoryRows);
      return;
    }

    if (queueButton) {
      event.preventDefault();
      queueButton.disabled = true;
      try {
        await queueManualNotification();
      } catch (error) {
        console.error("Bildirim kuyruğa alınamadı:", error);
        alert(`Bildirim kuyruğa alınamadı: ${error.message || error}`);
      } finally {
        queueButton.disabled = false;
      }
    }
  });
}

window.renderNotificationCenter = renderNotificationCenter;
window.updateManualNotificationPreview = updateManualNotificationPreview;
window.queueManualNotification = queueManualNotification;
window.saveManualNotificationDraft = saveManualNotificationDraft;
window.cleanupOldNotificationHistory = cleanupOldNotificationHistory;
window.renderNotificationDetailModal = renderNotificationDetailModal;
window.closeNotificationDetailModal = closeNotificationDetailModal;
window.deleteNotificationHistoryItem = deleteNotificationHistoryItem;
window.refillNotificationFormFromHistory = refillNotificationFormFromHistory;

bindAdminNotificationCenterEvents();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bindAdminNotificationCenterEvents();
    renderNotificationCenter().catch((error) => console.warn("Bildirim merkezi ilk yükleme hatası:", error));
  });
} else {
  renderNotificationCenter().catch((error) => console.warn("Bildirim merkezi ilk yükleme hatası:", error));
}
