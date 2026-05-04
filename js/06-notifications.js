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

  if (Notification?.permission === "granted" && hasValidFiksturVapidKey()) {
    setTimeout(() => {
      setupFiksturFcmToken().catch((error) => {
        console.warn("[FCM] Otomatik token yenileme başarısız:", error);
      });
    }, 5000);
  }

  setTimeout(checkPredictionNotifications, 3000);

}

bindPredictionNotificationHooks();
