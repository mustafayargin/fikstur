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

function getNotificationTargetLabel(target) {
  if (target === "active") return "Aktif kullanıcılar";
  if (target === "pending") return "Tahmini eksik olanlar";
  return "Tüm kullanıcılar";
}

function setNotificationText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getManualNotificationFormValues() {
  return {
    title: document.getElementById("manualNotificationTitle")?.value.trim() || "",
    message: document.getElementById("manualNotificationMessage")?.value.trim() || "",
    target: document.getElementById("manualNotificationTarget")?.value || "all",
  };
}

function updateManualNotificationPreview() {
  const preview = document.getElementById("manualNotificationPreview");
  if (!preview) return;
  const { title, message, target } = getManualNotificationFormValues();
  if (!title && !message) {
    preview.textContent = "Başlık ve mesaj yazıldığında burada göndermeden önce kontrol edilecek.";
    return;
  }
  preview.textContent = `${title || "Başlıksız bildirim"} — ${message || "Mesaj metni boş"} (${getNotificationTargetLabel(target)})`;
}

async function readAdminNotificationCenterData() {
  const [queue, logs, sent] = await Promise.all([
    firebaseRead(ADMIN_NOTIFICATION_QUEUE_PATH).catch(() => null),
    firebaseRead(ADMIN_NOTIFICATION_LOG_PATH).catch(() => null),
    firebaseRead(ADMIN_NOTIFICATION_SENT_PATH).catch(() => null),
  ]);
  return { queue: queue || {}, logs: logs || {}, sent: sent || {} };
}

function normalizeNotificationRows(data) {
  const rows = [];

  Object.entries(data.queue || {}).forEach(([id, item]) => {
    rows.push({
      id,
      date: item.createdAt || item.updatedAt,
      type: item.type === "manual" ? "Manuel" : "Kuyruk",
      message: `${item.title || "Başlıksız"} - ${item.message || ""}`,
      target: getNotificationTargetLabel(item.target),
      status: item.status || "pending",
      successCount: item.successCount || 0,
      errorCount: item.errorCount || 0,
      errorMessage: item.errorMessage || "",
    });
  });

  Object.entries(data.logs || {}).forEach(([id, item]) => {
    rows.push({
      id,
      date: item.createdAt || item.sentAt || item.finishedAt,
      type: item.type || "Log",
      message: item.message || item.title || "Bildirim kaydı",
      target: getNotificationTargetLabel(item.target),
      status: item.status || "done",
      successCount: item.successCount || 0,
      errorCount: item.errorCount || 0,
      errorMessage: item.errorMessage || "",
    });
  });

  Object.entries(data.sent || {}).forEach(([id, item]) => {
    rows.push({
      id,
      date: item.sentAt,
      type: item.weekNo ? "Otomatik hafta" : item.type ? `Otomatik ${item.type}` : "Otomatik",
      message: item.weekNo ? `${item.weekNo}. hafta bildirimi gönderildi` : "Maç hatırlatma bildirimi gönderildi",
      target: "Tüm kullanıcılar",
      status: item.sent ? "sent" : "done",
      successCount: item.successCount || 0,
      errorCount: item.errorCount || 0,
      errorMessage: item.errorMessage || "",
    });
  });

  return rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function renderNotificationHistoryRows(rows) {
  const tbody = document.getElementById("notificationHistoryBody");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5">Henüz bildirim kaydı yok.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.slice(0, 12).map((row) => {
    const status = String(row.status || "pending");
    const badgeClass = status === "sent" || status === "done" || status === "processed" ? "success" : status === "error" || status === "failed" ? "danger" : "gray";
    const statusText = status === "pending" ? "Bekliyor" : status === "processing" ? "İşleniyor" : status === "sent" || status === "done" || status === "processed" ? "Gönderildi" : status === "error" || status === "failed" ? "Hata" : status;
    const extra = row.successCount ? ` (${row.successCount} başarılı)` : row.errorMessage ? ` - ${row.errorMessage}` : "";
    return `
      <tr>
        <td>${escapeHtml(formatNotificationCenterDate(row.date))}</td>
        <td>${escapeHtml(row.type)}</td>
        <td>${escapeHtml(row.message)}</td>
        <td>${escapeHtml(row.target)}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(statusText + extra)}</span></td>
      </tr>
    `;
  }).join("");
}

function updateNotificationSummary(rows) {
  const pendingCount = rows.filter((r) => ["pending", "queued", "draft"].includes(String(r.status || ""))).length;
  const successTotal = rows.reduce((sum, r) => sum + (Number(r.successCount) || 0), 0);
  const lastRow = rows[0];
  const lastError = rows.find((r) => r.status === "error" || r.status === "failed" || r.errorMessage);

  setNotificationText("notificationPendingCountText", String(pendingCount));
  setNotificationText("notificationSuccessCountText", String(successTotal));
  setNotificationText("notificationLastCronText", lastRow ? formatNotificationCenterDate(lastRow.date) : "Henüz kayıt yok");
  setNotificationText("notificationLastCronMeta", lastRow ? `${lastRow.type} · ${lastRow.status}` : "GitHub Action çalışınca buraya yazılacak.");
  setNotificationText("notificationLastErrorText", lastError ? (lastError.errorMessage || "Hata var") : "Yok");
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
  updateManualNotificationPreview();

  const draft = (() => {
    try { return JSON.parse(localStorage.getItem(ADMIN_NOTIFICATION_DRAFT_KEY) || "null"); } catch { return null; }
  })();
  if (draft && !document.getElementById("manualNotificationTitle")?.value && !document.getElementById("manualNotificationMessage")?.value) {
    const titleEl = document.getElementById("manualNotificationTitle");
    const msgEl = document.getElementById("manualNotificationMessage");
    const targetEl = document.getElementById("manualNotificationTarget");
    if (titleEl) titleEl.value = draft.title || "";
    if (msgEl) msgEl.value = draft.message || "";
    if (targetEl) targetEl.value = draft.target || "all";
    updateManualNotificationPreview();
  }

  if (!isFirebaseReady()) {
    renderNotificationHistoryRows([]);
    updateNotificationSummary([]);
    return;
  }

  try {
    const data = await readAdminNotificationCenterData();
    const rows = normalizeNotificationRows(data);
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

  const { title, message, target } = getManualNotificationFormValues();
  if (!title || !message) {
    alert("Başlık ve mesaj metni zorunlu kanka.");
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
    createdAt: now,
    createdBy: getCurrentUsername() || "admin",
  };

  await firebaseWrite(`${ADMIN_NOTIFICATION_QUEUE_PATH}/${id}`, payload);
  localStorage.removeItem(ADMIN_NOTIFICATION_DRAFT_KEY);

  const titleEl = document.getElementById("manualNotificationTitle");
  const msgEl = document.getElementById("manualNotificationMessage");
  if (titleEl) titleEl.value = "";
  if (msgEl) msgEl.value = "";
  updateManualNotificationPreview();
  await renderNotificationCenter();
  alert("Bildirim Firebase kuyruğuna alındı. Cron-job çalışınca gönderilecek.");
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
    if (["manualNotificationTitle", "manualNotificationMessage"].includes(event.target?.id)) {
      updateManualNotificationPreview();
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target?.id === "manualNotificationTarget") updateManualNotificationPreview();
  });

  document.addEventListener("click", async (event) => {
    const draftButton = event.target.closest?.("#saveManualNotificationDraftBtn");
    const queueButton = event.target.closest?.("#queueManualNotificationBtn");

    if (draftButton) {
      event.preventDefault();
      saveManualNotificationDraft();
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

bindAdminNotificationCenterEvents();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bindAdminNotificationCenterEvents();
    renderNotificationCenter().catch((error) => console.warn("Bildirim merkezi ilk yükleme hatası:", error));
  });
} else {
  renderNotificationCenter().catch((error) => console.warn("Bildirim merkezi ilk yükleme hatası:", error));
}
