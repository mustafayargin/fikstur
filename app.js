window.__ALLOW_MATCH_WRITE__ = false;
const STORAGE_KEY = "fikstur_tahmin_paneli_v4";
const DB_NAME = "fiksturLocalDb";
const DB_STORE = "handles";
const HANDLE_KEY = "backupHandle";
const LEAGUE_ID = 4339; // Turkish Super Lig on TheSportsDB
const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzcyAI06Rou8EZNr-_5FV21Km53d6BEizVsrd_auXHTRus4gxQe25QT-9CJyOgH7iU-/exec";

const FIREBASE_DEFAULT_USERS = [
  {
    id: "admin-root",
    kullaniciAdi: "admin",
    sifre: "1234",
    adSoyad: "ADMIN",
    rol: "admin",
    aktif: true,
  },
  {
    id: "player-mustafa",
    kullaniciAdi: "mustafa",
    sifre: "1234",
    adSoyad: "MUSTAFA",
    rol: "user",
    aktif: true,
  },
  {
    id: "player-veli",
    kullaniciAdi: "veli",
    sifre: "1234",
    adSoyad: "VELI",
    rol: "user",
    aktif: true,
  },
];

function getFirebaseConfig() {
  return window.FIKSTUR_FIREBASE_CONFIG || null;
}

function isFirebaseConfigured() {
  const cfg = getFirebaseConfig();
  if (!cfg) return false;
  return Object.values(cfg).every(
    (value) => value && !String(value).startsWith("BURAYA_"),
  );
}

function getFirebaseDb() {
  if (!isFirebaseConfigured()) return null;
  if (!window.firebase || typeof window.firebase.initializeApp !== "function")
    return null;
  try {
    if (!window.__fiksturFirebaseApp) {
      window.__fiksturFirebaseApp = window.firebase.apps?.length
        ? window.firebase.app()
        : window.firebase.initializeApp(getFirebaseConfig());
    }
    return window.firebase.database(window.__fiksturFirebaseApp);
  } catch (error) {
    console.error("Firebase başlatılamadı:", error);
    return null;
  }
}

function isFirebaseReady() {
  return !!getFirebaseDb();
}

function sanitizeFirebaseKey(value) {
  return String(value || "")
    .replace(/[.#$\[\]\/]/g, "_")
    .trim();
}

function makePredictionRecordId(matchId, playerId) {
  return sanitizeFirebaseKey(`${matchId}__${playerId}`);
}

function firebaseSnapshotToArray(value) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([id, item]) => ({
    id: item?.id || id,
    ...(item || {}),
  }));
}

async function firebaseRead(path) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase henüz yapılandırılmadı.");
  const snapshot = await db.ref(path).get();
  return snapshot.exists() ? snapshot.val() : null;
}

async function firebaseWrite(path, value) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase henüz yapılandırılmadı.");
  await db.ref(path).set(value);
  return true;
}

async function firebaseUpdate(path, value) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase henüz yapılandırılmadı.");
  await db.ref(path).update(value);
  return true;
}

async function firebaseRemove(path) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase henüz yapılandırılmadı.");
  await db.ref(path).remove();
  return true;
}

async function ensureFirebaseDefaults() {
  if (!isFirebaseReady()) return { success: false, skipped: true };

  const users = (await firebaseRead("users")) || {};
  const matches = (await firebaseRead("matches")) || {};
  const predictions = (await firebaseRead("predictions")) || {};
  const settings = (await firebaseRead("settings")) || {};

  if (!Object.keys(users).length || settings?.init === true) {
    const seededUsers = {};
    FIREBASE_DEFAULT_USERS.forEach((user) => {
      seededUsers[sanitizeFirebaseKey(user.id)] = {
        ...user,
        aktif: true,
      };
    });
    await firebaseWrite("users", seededUsers);
  }

  if (!Object.keys(matches).length) {
    await firebaseWrite("matches", matches);
  }

  if (!Object.keys(predictions).length) {
    await firebaseWrite("predictions", predictions);
  }

  if (!settings || settings.init === true || !Object.keys(settings).length) {
    await firebaseWrite("settings", {
      init: false,
      source: "firebase",
      createdAt: new Date().toISOString(),
      defaultUsersSeeded: true,
      seasonsMeta: [],
    });
  } else if (!Array.isArray(settings.seasonsMeta)) {
    await firebaseUpdate("settings", {
      seasonsMeta: [],
    });
  }

  return { success: true };
}

async function firebaseApiGet(action, params = {}) {
  switch (action) {
    case "getUsers": {
      await ensureFirebaseDefaults();
      const users = firebaseSnapshotToArray(await firebaseRead("users"));
      return { success: true, users };
    }
    case "getMatches": {
      const sezon = String(params.sezon || "").trim();
      const haftaNo = String(params.haftaNo || "").trim();
      let matches = firebaseSnapshotToArray(await firebaseRead("matches"));
      if (sezon) {
        matches = matches.filter(
          (item) => String(item.season || item.sezon || "").trim() === sezon,
        );
      }
      if (haftaNo) {
        matches = matches.filter(
          (item) =>
            String(item.weekNo || item.haftaNo || "").trim() === haftaNo,
        );
      }
      return { success: true, matches };
    }
    case "getPredictions": {
      const sezon = String(params.sezon || "").trim();
      const haftaNo = String(params.haftaNo || "").trim();
      let predictions = firebaseSnapshotToArray(
        await firebaseRead("predictions"),
      );
      if (sezon) {
        predictions = predictions.filter(
          (item) => String(item.season || item.sezon || "").trim() === sezon,
        );
      }
      if (haftaNo) {
        predictions = predictions.filter(
          (item) =>
            String(item.weekNo || item.haftaNo || "").trim() === haftaNo,
        );
      }
      return { success: true, predictions };
    }
    case "getStandings":
      return { success: true, rows: [] };
    default:
      throw new Error(`Firebase GET aksiyonu tanımlı değil: ${action}`);
  }
}

async function firebaseApiPost(action, payload = {}) {
  switch (action) {
    case "login": {
      await ensureFirebaseDefaults();
      const username = normalizeLoginName(
        payload.kullaniciAdi || payload.username || "",
      );
      const password = String(payload.sifre || payload.password || "");
      const users = firebaseSnapshotToArray(await firebaseRead("users"));
      const user = users.find(
        (item) =>
          normalizeLoginName(
            item.kullaniciAdi || item.username || item.adSoyad || "",
          ) === username &&
          String(item.sifre || item.password || "") === password &&
          item.aktif !== false,
      );
      if (!user) {
        return { success: false, message: "Kullanıcı adı veya şifre hatalı." };
      }
      return { success: true, user };
    }
    case "addUser": {
      const usersMap = (await firebaseRead("users")) || {};

      const rawDisplayName = String(
        payload.adSoyad ||
          payload.name ||
          payload.kullaniciAdi ||
          payload.username ||
          "",
      )
        .trim()
        .toUpperCase();

      const rawUsername = normalizeLoginName(
        payload.kullaniciAdi ||
          payload.username ||
          payload.adSoyad ||
          payload.name ||
          "user",
      );

      const id = sanitizeFirebaseKey(
        payload.id ||
          buildPlayerKeyFromName(rawDisplayName || rawUsername, usersMap),
      );

      if (usersMap[id]) {
        return {
          success: false,
          message: "Bu kullanıcı anahtarı zaten var. Farklı bir isim deneyin.",
        };
      }

      const record = {
        id,
        kullaniciAdi: rawUsername,
        sifre: String(payload.sifre || payload.password || "1234"),
        adSoyad: rawDisplayName,
        rol:
          String(payload.rol || "user").toLowerCase() === "admin"
            ? "admin"
            : "user",
        aktif: true,
        createdAt: new Date().toISOString(),
      };

      await firebaseWrite(`users/${id}`, record);
      return { success: true, id, user: record };
    }
    case "updateUser": {
      const id = sanitizeFirebaseKey(payload.id);
      if (!id) return { success: false, message: "Kullanıcı id gerekli." };
      const current = (await firebaseRead(`users/${id}`)) || { id };
      const next = {
        ...current,
        ...(payload.adSoyad
          ? { adSoyad: String(payload.adSoyad).trim().toUpperCase() }
          : {}),
        ...(payload.kullaniciAdi
          ? { kullaniciAdi: normalizeLoginName(payload.kullaniciAdi) }
          : {}),
        ...(payload.sifre ? { sifre: String(payload.sifre) } : {}),
        ...(payload.rol
          ? {
              rol:
                String(payload.rol).toLowerCase() === "admin"
                  ? "admin"
                  : "user",
            }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, "aktif")
          ? { aktif: payload.aktif !== false }
          : {}),
        ...(payload.seasonStates ? { seasonStates: payload.seasonStates } : {}),
        ...(payload.seasonMemberships
          ? { seasonMemberships: payload.seasonMemberships }
          : {}),
        ...(payload.activeSeasons
          ? { activeSeasons: payload.activeSeasons }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      await firebaseWrite(`users/${id}`, next);
      return { success: true, id, user: next };
    }
    case "deleteUser": {
      const id = sanitizeFirebaseKey(payload.id);
      if (!id) return { success: false, message: "Kullanıcı id gerekli." };
      const current = (await firebaseRead(`users/${id}`)) || null;
      if (current && String(current.rol || "user").toLowerCase() === "admin") {
        return {
          success: false,
          message: "Admin kullanıcısı silinemez.",
        };
      }
      await firebaseRemove(`users/${id}`);
      const predictions = firebaseSnapshotToArray(
        await firebaseRead("predictions"),
      );
      await Promise.all(
        predictions
          .filter((item) => String(item.playerId) === String(id))
          .map((item) =>
            firebaseRemove(
              `predictions/${sanitizeFirebaseKey(item.id || makePredictionRecordId(item.matchId, item.playerId))}`,
            ),
          ),
      );
      return { success: true };
    }
    case "addMatches": {
      const rawMatches =
        typeof payload.matches === "string"
          ? JSON.parse(payload.matches || "[]")
          : payload.matches || [];
      for (const match of rawMatches) {
        if (!match?.id) continue;
        const id = sanitizeFirebaseKey(match.id);
        const seasonLabel =
          match.season ||
          match.sezon ||
          getSeasonById(match.seasonId)?.name ||
          "";
        const weekNo =
          match.weekNo ||
          match.haftaNo ||
          getWeekNumberById(match.weekId) ||
          "";
        await firebaseWrite(`matches/${id}`, {
          ...match,
          id,
          season: seasonLabel,
          sezon: seasonLabel,
          weekNo,
          haftaNo: weekNo,
          updatedAt: new Date().toISOString(),
        });
      }
      return { success: true };
    }
    case "savePrediction": {
      const id = sanitizeFirebaseKey(
        payload.predictionId ||
          payload.id ||
          makePredictionRecordId(payload.matchId, payload.playerId),
      );
      const record = {
        ...payload,
        id,
        season: payload.season || payload.sezon || "",
        sezon: payload.sezon || payload.season || "",
        weekNo: payload.weekNo || payload.haftaNo || "",
        haftaNo: payload.haftaNo || payload.weekNo || "",
        playerId: String(payload.playerId || payload.kullaniciId || ""),
        matchId: String(payload.matchId || ""),
        homePred: payload.homePred,
        awayPred: payload.awayPred,
        tahminEv: payload.tahminEv ?? payload.homePred,
        tahminDep: payload.tahminDep ?? payload.awayPred,
        updatedAt: new Date().toISOString(),
      };
      await firebaseWrite(`predictions/${id}`, record);
      return { success: true, id, predictionId: id };
    }
    case "deletePrediction": {
      const id = sanitizeFirebaseKey(
        payload.predictionId ||
          payload.id ||
          makePredictionRecordId(payload.matchId, payload.playerId),
      );
      await firebaseRemove(`predictions/${id}`);
      return { success: true, id };
    }
    default:
      throw new Error(`Firebase POST aksiyonu tanımlı değil: ${action}`);
  }
}

async function runFirebaseConnectionTest() {
  if (!isFirebaseReady()) {
    throw new Error(
      "Önce index.html içindeki Firebase config alanlarını doldur.",
    );
  }
  await ensureFirebaseDefaults();
  const stamp = new Date().toISOString();
  await firebaseWrite("settings/connectionTest", {
    ok: true,
    timestamp: stamp,
    message: "Firebase bağlantısı başarılı.",
  });
  return { success: true, timestamp: stamp };
}

window.testFirebaseConnection = runFirebaseConnectionTest;
window.seedFirebaseDefaults = ensureFirebaseDefaults;

function getOnlineSourceLabel() {
  return isFirebaseReady() ? "Firebase" : "Firebase";
}

let firebaseRealtimeBindingsInitialized = false;
let firebaseRealtimeRenderTimer = null;
let firebaseRealtimeHydrationPromise = null;

let firebasePresenceCache = {};
let presenceHeartbeatTimer = null;
let presenceConnectedRef = null;
let presenceSessionRef = null;
let presenceUserRef = null;
let presenceSessionId = null;
let forceLogoutUserRef = null;
let forceLogoutListener = null;

function formatAdminPanelDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getCurrentPresenceUserId() {
  const authUser =
    (typeof getAuthUser === "function" ? getAuthUser() : null) || null;
  const rawId =
    authUser?.id || authUser?.playerId || state?.settings?.auth?.playerId || "";
  return rawId ? sanitizeFirebaseKey(String(rawId)) : "";
}

function getPresenceUserMeta() {
  const authUser =
    (typeof getAuthUser === "function" ? getAuthUser() : null) ||
    state?.settings?.auth?.user ||
    null;
  const player =
    (typeof getCurrentPlayer === "function" ? getCurrentPlayer() : null) ||
    (typeof findPlayerForSessionUser === "function"
      ? findPlayerForSessionUser(authUser)
      : null) ||
    null;

  return {
    id: getCurrentPresenceUserId(),
    name:
      player?.name ||
      authUser?.adSoyad ||
      authUser?.name ||
      authUser?.kullaniciAdi ||
      authUser?.username ||
      "",
    username:
      player?.username || authUser?.kullaniciAdi || authUser?.username || "",
    role:
      String(
        authUser?.rol || player?.role || state?.settings?.auth?.role || "user",
      ).toLowerCase() === "admin"
        ? "admin"
        : "user",
  };
}

function getPlayerRole(player) {
  const rawRole = String(
    player?.role || player?.rol || player?.kullaniciRol || "user",
  ).toLowerCase();
  if (rawRole === "admin") return "admin";

  const rawUsername = String(player?.username || player?.kullaniciAdi || "")
    .trim()
    .toLowerCase();
  if (rawUsername === "admin") return "admin";

  return "user";
}

function getOnlineThresholdMs() {
  return 35000;
}

function isPresenceSessionOnline(session) {
  if (!session || session.online === false) return false;
  const ts = new Date(session.lastSeen || session.connectedAt || 0).getTime();
  if (!ts) return false;
  return Date.now() - ts <= getOnlineThresholdMs();
}

function getPresenceStatusForUser(userId) {
  const record =
    firebasePresenceCache?.[sanitizeFirebaseKey(String(userId || ""))] || {};

  const sessions = Object.values(record.sessions || {}).filter(Boolean);

  const validSessions = sessions.filter((session) => {
    const ts = new Date(session.lastSeen || session.connectedAt || 0).getTime();
    if (!ts) return false;
    if (session.online !== true) return false;
    return Date.now() - ts <= getOnlineThresholdMs();
  });

  const latestSession =
    [...sessions].sort(
      (a, b) =>
        new Date(b.lastSeen || b.connectedAt || 0).getTime() -
        new Date(a.lastSeen || a.connectedAt || 0).getTime(),
    )[0] || null;

  return {
    isOnline: validSessions.length > 0,
    onlineCount: validSessions.length,
    lastSeen:
      latestSession?.lastSeen ||
      latestSession?.connectedAt ||
      record.lastSeen ||
      "",
    name: record.name || latestSession?.name || "",
    username: record.username || latestSession?.username || "",
    role: record.role || latestSession?.role || "user",
  };
}

function stopPresenceTracking(options = {}) {
  clearInterval(presenceHeartbeatTimer);
  presenceHeartbeatTimer = null;

  const stoppedAt = new Date().toISOString();
  const presenceMeta = getPresenceUserMeta();

  if (presenceConnectedRef?.off) {
    try {
      presenceConnectedRef.off("value");
    } catch {}
  }
  presenceConnectedRef = null;

  if (presenceSessionRef) {
    if (options.removeSession !== false) {
      presenceSessionRef.remove().catch(() => {});
    } else {
      presenceSessionRef
        .update({
          online: false,
          lastSeen: stoppedAt,
        })
        .catch(() => {});
    }
  }

  if (presenceUserRef) {
    presenceUserRef
      .update({
        online: false,
        lastSeen: stoppedAt,
        name: presenceMeta.name || "",
        username: presenceMeta.username || "",
        role: presenceMeta.role || "user",
      })
      .catch(() => {});
  }

  presenceSessionRef = null;
  presenceUserRef = null;
  presenceSessionId = null;

  if (forceLogoutUserRef && forceLogoutListener) {
    try {
      forceLogoutUserRef.off("value", forceLogoutListener);
    } catch {}
  }
  forceLogoutUserRef = null;
  forceLogoutListener = null;
}

function ensureForcedLogoutWatcher() {
  if (!isFirebaseReady() || !isAuthenticated()) return;
  const userId = getCurrentPresenceUserId();
  if (!userId) return;

  const db = getFirebaseDb();
  if (!db) return;

  if (forceLogoutUserRef && forceLogoutListener) {
    try {
      forceLogoutUserRef.off("value", forceLogoutListener);
    } catch {}
  }

  forceLogoutUserRef = db.ref(`users/${userId}`);
  forceLogoutListener = (snapshot) => {
    const userData = snapshot?.val?.() || null;
    const sessionStartedAt =
      getAuthUser?.()?.sessionStartedAt ||
      state?.settings?.auth?.user?.sessionStartedAt ||
      "";
    const forcedLogoutAt = userData?.forcedLogoutAt || "";

    if (!userData) return;
    if (userData.aktif === false) {
      stopPresenceTracking();
      showAlert("Oturumun sistem tarafından kapatıldı.", {
        title: "Çıkış yapıldı",
        type: "warning",
      });
      logoutUser();
      return;
    }

    if (
      forcedLogoutAt &&
      sessionStartedAt &&
      new Date(forcedLogoutAt).getTime() > new Date(sessionStartedAt).getTime()
    ) {
      stopPresenceTracking();
      showAlert(
        "Admin seni sistemden çıkardı. Tekrar giriş yapman gerekiyor.",
        {
          title: "Oturum kapatıldı",
          type: "warning",
        },
      );
      logoutUser();
    }
  };

  forceLogoutUserRef.on("value", forceLogoutListener);
}

function startPresenceTracking() {
  if (!isFirebaseReady() || !isAuthenticated()) return;
  const userId = getCurrentPresenceUserId();
  if (!userId) return;

  stopPresenceTracking({ removeSession: false });

  const db = getFirebaseDb();
  if (!db) return;

  const authUser = getAuthUser?.() || state?.settings?.auth?.user || {};
  const sessionStartedAt =
    authUser.sessionStartedAt || new Date().toISOString();

  if (
    state?.settings?.auth?.user &&
    !state.settings.auth.user.sessionStartedAt
  ) {
    state.settings.auth.user.sessionStartedAt = sessionStartedAt;
  }
  if (
    typeof currentSessionUser !== "undefined" &&
    currentSessionUser &&
    !currentSessionUser.sessionStartedAt
  ) {
    currentSessionUser.sessionStartedAt = sessionStartedAt;
  }

  presenceSessionId =
    sessionStorage.getItem(`fikstur_presence_${userId}`) || uid("session");
  sessionStorage.setItem(`fikstur_presence_${userId}`, presenceSessionId);

  presenceUserRef = db.ref(`presence/${userId}`);
  presenceSessionRef = db.ref(
    `presence/${userId}/sessions/${presenceSessionId}`,
  );
  presenceConnectedRef = db.ref(".info/connected");

  const heartbeat = () => {
    const meta = getPresenceUserMeta();
    const now = new Date().toISOString();
    if (!presenceSessionRef) return;
    presenceSessionRef
      .update({
        online: true,
        lastSeen: now,
        connectedAt: authUser.connectedAt || now,
        sessionStartedAt,
        name: meta.name || "",
        username: meta.username || "",
        role: meta.role || "user",
      })
      .catch(() => {});

    presenceUserRef
      ?.update({
        online: true,
        lastSeen: now,
        connectedAt: authUser.connectedAt || now,
        sessionStartedAt,
        name: meta.name || "",
        username: meta.username || "",
        role: meta.role || "user",
      })
      .catch(() => {});
  };

  presenceConnectedRef.on("value", (snapshot) => {
    if (!presenceSessionRef) return;

    if (snapshot.val() === true) {
      presenceSessionRef.onDisconnect().remove();
      presenceUserRef?.onDisconnect().update({
        online: false,
        lastSeen: new Date().toISOString(),
      });
      heartbeat();
      return;
    }

    const disconnectedAt = new Date().toISOString();
    presenceSessionRef
      .update({
        online: false,
        lastSeen: disconnectedAt,
      })
      .catch(() => {});
    presenceUserRef
      ?.update({
        online: false,
        lastSeen: disconnectedAt,
      })
      .catch(() => {});
  });

  heartbeat();
  clearInterval(presenceHeartbeatTimer);
  presenceHeartbeatTimer = setInterval(heartbeat, 25000);

  ensureForcedLogoutWatcher();
}
function registerPresenceWindowHooks() {
  if (window.__presenceWindowHooksBound) return;
  window.__presenceWindowHooksBound = true;

  window.addEventListener("pagehide", () => {
    stopPresenceTracking({ removeSession: true });
    clearRememberedSession();
  });

  window.addEventListener("beforeunload", () => {
    stopPresenceTracking({ removeSession: true });
    clearRememberedSession();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      const hiddenAt = new Date().toISOString();
      if (presenceSessionRef) {
        presenceSessionRef
          .update({
            online: false,
            lastSeen: hiddenAt,
          })
          .catch(() => {});
      }
      presenceUserRef
        ?.update({
          online: false,
          lastSeen: hiddenAt,
        })
        .catch(() => {});
      return;
    }

    if (
      document.visibilityState === "visible" &&
      isFirebaseReady() &&
      isAuthenticated()
    ) {
      startPresenceTracking();
    }
  });
}
function debounceFirebaseRealtimeRender() {
  clearTimeout(firebaseRealtimeRenderTimer);
  firebaseRealtimeRenderTimer = setTimeout(() => {
    renderAll();
  }, 180);
}

async function hydrateFromFirebaseRealtime(source = "manual") {
  if (!isFirebaseReady()) return false;
  if (firebaseRealtimeHydrationPromise) return firebaseRealtimeHydrationPromise;

  firebaseRealtimeHydrationPromise = (async () => {
    try {
      await ensureFirebaseDefaults();
      await syncSeasonRegistryFromFirebase();
      await syncUsersFromSheet({ silent: true });
      await syncOnlineMatchesFromSheet({
        silent: true,
        seasonLabel: "",
        replaceRemoteScope: true,
      });
      await syncOnlinePredictions({
        silent: true,
        seasonId: null,
        weekId: null,
        seasonLabel: "",
        weekNumber: "",
      });
      if (isAuthenticated()) startPresenceTracking();
      recordAdminSyncActivity({
        lastAction: `Canlı ${getOnlineSourceLabel()} verisi alındı (${source}).`,
        success: true,
      });
      debounceFirebaseRealtimeRender();
      return true;
    } catch (error) {
      console.warn("Firebase canlı veri eşitleme uyarısı:", error);
      return false;
    } finally {
      firebaseRealtimeHydrationPromise = null;
    }
  })();

  return firebaseRealtimeHydrationPromise;
}

function ensureFirebaseRealtimeBridge() {
  if (!isFirebaseReady() || firebaseRealtimeBindingsInitialized) return;
  const db = getFirebaseDb();
  if (!db) return;

  ["users", "matches", "predictions", "settings"].forEach((path) => {
    db.ref(path).on("value", () => {
      hydrateFromFirebaseRealtime(path);
    });
  });

  db.ref("presence").on("value", (snapshot) => {
    firebasePresenceCache = snapshot.exists() ? snapshot.val() || {} : {};
    debounceFirebaseRealtimeRender();
  });

  firebaseRealtimeBindingsInitialized = true;
}

let useOnlineMode = true;
const DEFAULT_TEAM_NAMES = [
  "Adana Demirspor",
  "Alanyaspor",
  "Antalyaspor",
  "Başakşehir",
  "Beşiktaş",
  "Bodrum FK",
  "Çaykur Rizespor",
  "Eyüpspor",
  "Fenerbahçe",
  "Galatasaray",
  "Gaziantep FK",
  "Göztepe",
  "Hatayspor",
  "Kasımpaşa",
  "Kayserispor",
  "Konyaspor",
  "Samsunspor",
  "Sivasspor",
  "Trabzonspor",
];

const TEAM_COLORS = [
  ["#f97316", "#ea580c"],
  ["#16a34a", "#f59e0b"],
  ["#ef4444", "#ffffff"],
  ["#2563eb", "#7c3aed"],
  ["#111827", "#ffffff"],
  ["#10b981", "#065f46"],
  ["#06b6d4", "#0284c7"],
  ["#a855f7", "#ec4899"],
  ["#facc15", "#1d4ed8"],
  ["#f59e0b", "#dc2626"],
  ["#ef4444", "#111827"],
  ["#f59e0b", "#dc2626"],
  ["#16a34a", "#ef4444"],
  ["#1d4ed8", "#ef4444"],
  ["#ea580c", "#facc15"],
  ["#16a34a", "#f1f5f9"],
  ["#dc2626", "#ffffff"],
  ["#ef4444", "#ffffff"],
  ["#7c3aed", "#06b6d4"],
  ["#3b82f6", "#1d4ed8"],
  ["#14b8a6", "#0f766e"],
  ["#f97316", "#7c2d12"],
];

const DEFAULT_TEAM_SLUGS = {
  "Adana Demirspor": "adana-demirspor",
  Alanyaspor: "alanyaspor",
  Antalyaspor: "antalyaspor",
  Başakşehir: "basaksehir",
  Beşiktaş: "besiktas",
  "Bodrum FK": "bodrum-fk",
  "Çaykur Rizespor": "caykur-rizespor",
  Eyüpspor: "eyupspor",
  Fenerbahçe: "fenerbahce",
  Galatasaray: "galatasaray",
  "Gaziantep FK": "gaziantep-fk",
  Göztepe: "goztepe",
  Hatayspor: "hatayspor",
  Kasımpaşa: "kasimpasa",
  Kayserispor: "kayserispor",
  Konyaspor: "konyaspor",
  Samsunspor: "samsunspor",
  Sivasspor: "sivasspor",
  Trabzonspor: "trabzonspor",
};

let previousLeaderName = null;
let backupHandle = null;
let localBackupStatus = "Sadece tarayıcı hafızası aktif.";
const LAST_SYNC_LABEL_STORAGE_KEY = "fikstur_last_sync_label_v1";
const PREDICTION_QUEUE_STORAGE_KEY = "fikstur_prediction_queue_v1";
const ADMIN_SYNC_DIAGNOSTICS_STORAGE_KEY = "fikstur_admin_sync_diagnostics_v1";

let appModalResolver = null;

let appBootLoading = false;
let currentHydrationPromise = null;
let currentManualRefreshPromise = null;

const APP_LOADING_DEFAULT_STATE = {
  title: "Veriler yükleniyor",
  message:
    "Lütfen bekleyin, maçlar ve tahminler Firebase üzerinden getiriliyor...",
  percent: 0,
  stepLabel: "Bağlantı hazırlanıyor...",
  showSuccess: false,
};

function getAppLoadingElements() {
  return {
    overlay: document.getElementById("appLoadingOverlay"),
    title: document.getElementById("appLoadingTitle"),
    message: document.getElementById("appLoadingMessage"),
    percent: document.getElementById("appLoadingPercent"),
    stepLabel: document.getElementById("appLoadingStepLabel"),
    progressBar: document.getElementById("appLoadingProgressBar"),
    spinner: document.getElementById("appLoadingSpinner"),
    success: document.getElementById("appLoadingSuccess"),
    checks: {
      login: document.getElementById("loadingCheckLogin"),
      users: document.getElementById("loadingCheckUsers"),
      matches: document.getElementById("loadingCheckMatches"),
      predictions: document.getElementById("loadingCheckPredictions"),
    },
  };
}

function resetAppLoadingState() {
  const els = getAppLoadingElements();
  if (!els.overlay) return;

  if (els.title) els.title.textContent = APP_LOADING_DEFAULT_STATE.title;
  if (els.message) els.message.textContent = APP_LOADING_DEFAULT_STATE.message;
  if (els.percent)
    els.percent.textContent = `${APP_LOADING_DEFAULT_STATE.percent}%`;
  if (els.stepLabel)
    els.stepLabel.textContent = APP_LOADING_DEFAULT_STATE.stepLabel;
  if (els.progressBar)
    els.progressBar.style.width = `${APP_LOADING_DEFAULT_STATE.percent}%`;
  if (els.spinner) els.spinner.classList.remove("hidden");
  if (els.success) els.success.classList.add("hidden");

  if (els.checks.login) {
    els.checks.login.className = "app-loading-checkitem pending";
    els.checks.login.textContent = "Giriş bekleniyor";
  }
  if (els.checks.users) {
    els.checks.users.className = "app-loading-checkitem pending";
    els.checks.users.textContent = "Kullanıcılar hazırlanıyor";
  }
  if (els.checks.matches) {
    els.checks.matches.className = "app-loading-checkitem pending";
    els.checks.matches.textContent = "Maç verileri yükleniyor";
  }
  if (els.checks.predictions) {
    els.checks.predictions.className = "app-loading-checkitem pending";
    els.checks.predictions.textContent = "Tahminler yükleniyor";
  }
}

function setAppLoading(show, options = {}) {
  const els = getAppLoadingElements();
  if (!els.overlay) return;

  if (!show) {
    els.overlay.classList.remove("show");
    return;
  }

  els.overlay.classList.add("show");

  if (options.reset) resetAppLoadingState();

  if (options.title && els.title) els.title.textContent = options.title;
  if (options.message && els.message) els.message.textContent = options.message;
  if (options.stepLabel && els.stepLabel)
    els.stepLabel.textContent = options.stepLabel;

  if (typeof options.percent === "number") {
    const safePercent = Math.max(0, Math.min(100, Math.round(options.percent)));
    if (els.percent) els.percent.textContent = `${safePercent}%`;
    if (els.progressBar) els.progressBar.style.width = `${safePercent}%`;
  }

  if (typeof options.showSuccess === "boolean") {
    if (els.spinner)
      els.spinner.classList.toggle("hidden", options.showSuccess);
    if (els.success)
      els.success.classList.toggle("hidden", !options.showSuccess);
  }
}

function setAppLoadingCheck(key, state = "pending", text = "") {
  const els = getAppLoadingElements();
  const target = els.checks[key];
  if (!target) return;
  target.className = `app-loading-checkitem ${state}`;
  if (text) target.textContent = text;
}

function hasRenderableCachedData() {
  try {
    return Array.isArray(state.matches) && state.matches.length > 0;
  } catch {
    return false;
  }
}

function runSessionHydrationWithFastOverlay({
  loadingMessage = "Kayıtlı veriler açılıyor. Lütfen veriler tamamen yüklenene kadar bekleyin...",
  sessionRestore = false,
  suppressOverlay = false,
} = {}) {
  if (!useOnlineMode || !isAuthenticated()) return Promise.resolve(false);
  if (currentHydrationPromise) return currentHydrationPromise;

  const hasCache = hasRenderableCachedData();
  const shouldHideOverlay = suppressOverlay && sessionRestore && hasCache;

  if (!shouldHideOverlay) {
    setAppLoading(true, {
      reset: true,
      title: "Veriler hazırlanıyor",
      message: loadingMessage,
      stepLabel: hasCache
        ? "Kayıtlı veriler bulundu. Güncel veriler kontrol ediliyor..."
        : "Bağlantı hazırlanıyor...",
      percent: hasCache ? 8 : 3,
      showSuccess: false,
    });
  }

  currentHydrationPromise = hydrateOnlineStateForSession({
    sessionRestore,
    suppressLoadingOverlay: shouldHideOverlay,
  })
    .catch((error) => {
      console.warn("Arka plan senkron uyarısı:", error);
      setAppLoading(true, {
        title: "Yükleme tamamlanamadı",
        message: error?.message || "Veriler alınırken bir hata oluştu.",
        stepLabel: "Tekrar deneyebilirsin.",
        percent: 100,
        showSuccess: false,
      });
      setAppLoadingCheck("predictions", "pending", "Yükleme tamamlanamadı");
      return false;
    })
    .finally(() => {
      currentHydrationPromise = null;
    });

  return currentHydrationPromise;
}

function getCurrentSyncScopeOptions() {
  const seasonId = getActiveSeasonId();
  const weekId = state.settings.activeWeekId;
  return {
    seasonId,
    weekId,
    seasonLabel: getSeasonById(seasonId)?.name || "",
    weekNumber: weekId ? getWeekNumberById(weekId) : "",
  };
}

function getHeaderSyncButtons() {
  return Array.from(document.querySelectorAll('[data-role="global-sync-btn"]'));
}

function setHeaderSyncButtonsVisualState(mode = "idle") {
  const labels = {
    loading: { loading: "Eşitleniyor..." },
    success: { success: "Güncellendi ✓" },
    error: { error: "Tekrar dene" },
    idle: {},
  };

  getHeaderSyncButtons().forEach((button) => {
    setAsyncButtonState(button, mode, labels[mode] || {});
  });
}

async function refreshSessionData(triggerButton = null) {
  if (!useOnlineMode || !isAuthenticated()) {
    showAlert("Veri çekebilmek için önce giriş yapmalısın.", {
      title: "Oturum gerekli",
      type: "warning",
    });
    return false;
  }

  if (currentManualRefreshPromise) return currentManualRefreshPromise;

  if (currentHydrationPromise) {
    setHeaderSyncButtonsVisualState("loading");
    try {
      const result = await currentHydrationPromise;
      setHeaderSyncButtonsVisualState(result ? "success" : "error");
      return result;
    } catch (error) {
      setHeaderSyncButtonsVisualState("error");
      throw error;
    }
  }

  const scope = getCurrentSyncScopeOptions();
  setHeaderSyncButtonsVisualState("loading");
  if (triggerButton) {
    setAsyncButtonState(triggerButton, "loading", {
      loading: "Eşitleniyor...",
    });
  }

  currentManualRefreshPromise = (async () => {
    try {
      const queueResult = await flushPendingPredictionQueue({
        renderAfterFlush: false,
      });

      const [userResult, matchResult, predictionResult] =
        await Promise.allSettled([
          syncUsersFromSheet({ silent: true }),
          syncOnlineMatchesFromSheet({ ...scope, silent: true }),
          syncOnlinePredictions({ ...scope, silent: true }),
        ]);

      const failed = [userResult, matchResult, predictionResult].filter(
        (item) => item.status === "rejected",
      );

      if (failed.length) {
        throw failed[0].reason || new Error("Google verileri alınamadı.");
      }

      recalculateAllPoints();
      saveState(true);
      updateLastSyncLabel();
      renderAll();
      if (typeof updateSessionCard === "function") updateSessionCard();
      if (typeof recordAdminSyncActivity === "function") {
        recordAdminSyncActivity({
          lastAction: queueResult?.flushed
            ? `${queueResult.flushed} bekleyen kayıt gönderildi ve veriler yenilendi.`
            : "Veriler kullanıcı tarafından yenilendi.",
          success: true,
        });
      }

      setHeaderSyncButtonsVisualState("success");
      showAlert(
        queueResult?.flushed
          ? `Veriler güncellendi. ${queueResult.flushed} bekleyen tahmin de Google'a gönderildi.`
          : "Veriler Firebase ile eşitlendi.",
        {
          title: "Güncelleme tamamlandı",
          type: "success",
        },
      );
      return true;
    } catch (error) {
      console.error("Manuel veri yenileme başarısız:", error);
      setHeaderSyncButtonsVisualState("error");
      showAlert(
        error?.message || "Veriler alınırken bir sorun oluştu. Tekrar dene.",
        {
          title: "Güncelleme başarısız",
          type: "error",
        },
      );
      return false;
    } finally {
      currentManualRefreshPromise = null;
    }
  })();

  return currentManualRefreshPromise;
}

function ensureHeaderSyncButtons() {
  document.querySelectorAll(".page-header").forEach((header) => {
    const panel = header.closest(".tab-panel");
    const isPredictionsHeader = panel?.id === "tab-predictions";
    let actions = header.querySelector(".header-actions");
    const existingButtons = header.querySelectorAll(
      '[data-role="global-sync-btn"]',
    );

    existingButtons.forEach((btn, index) => {
      if (index > 0 || !isPredictionsHeader) btn.remove();
    });

    if (!isPredictionsHeader) {
      if (actions?.querySelector("#dashboardSeasonSelect")) {
        actions.classList.add("dashboard-top-actions");
      } else {
        actions?.classList.remove("dashboard-top-actions");
      }
      return;
    }

    if (!actions) {
      actions = document.createElement("div");
      actions.className = "header-actions";
      header.appendChild(actions);
    }

    let btn = actions.querySelector('[data-role="global-sync-btn"]');

    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary header-sync-btn minimal-sync-btn";
      btn.dataset.role = "global-sync-btn";
      btn.setAttribute("aria-label", "Verileri yenile");
      btn.title = "Tahmin verilerini yenile";
      btn.innerHTML =
        '<span class="sync-btn-icon" aria-hidden="true">↻</span><span>Yenile</span>';
    }

    if (!actions.contains(btn)) {
      actions.appendChild(btn);
    }

    if (actions.querySelector("#dashboardSeasonSelect")) {
      actions.classList.add("dashboard-top-actions");
    } else {
      actions.classList.remove("dashboard-top-actions");
    }
  });
}

function bindAdminPanelTableScroll() {
  document.querySelectorAll(".firebase-admin-table-scroll").forEach((shell) => {
    if (shell._dragScrollBound) return;
    shell._dragScrollBound = true;

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    let dragging = false;

    const stopDrag = () => {
      if (pointerId !== null) {
        try {
          shell.releasePointerCapture(pointerId);
        } catch (error) {}
      }
      pointerId = null;
      dragging = false;
      shell.classList.remove("is-dragging");
    };

    shell.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target.closest("button, input, select, textarea, label, a"))
        return;

      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startScrollLeft = shell.scrollLeft;
      startScrollTop = shell.scrollTop;
      dragging = false;
      try {
        shell.setPointerCapture(pointerId);
      } catch (error) {}
    });

    shell.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!dragging && (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6)) {
        dragging = true;
        shell.classList.add("is-dragging");
      }
      if (!dragging) return;
      shell.scrollLeft = startScrollLeft - deltaX;
      shell.scrollTop = startScrollTop - deltaY;
      event.preventDefault();
    });

    shell.addEventListener("pointerup", stopDrag);
    shell.addEventListener("pointercancel", stopDrag);
    shell.addEventListener("lostpointercapture", stopDrag);
  });
}
function getLastSyncLabel() {
  try {
    return localStorage.getItem(LAST_SYNC_LABEL_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function updateLastSyncLabel(date = new Date()) {
  const label = new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
  try {
    localStorage.setItem(LAST_SYNC_LABEL_STORAGE_KEY, label);
  } catch {}
  return label;
}

function getSyncSummaryText() {
  const lastSyncLabel = getLastSyncLabel();
  return lastSyncLabel
    ? `Son senkron: ${lastSyncLabel}`
    : "Henüz senkron yapılmadı.";
}
function getPendingPredictionQueue() {
  try {
    const raw = localStorage.getItem(PREDICTION_QUEUE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistPendingPredictionQueue(queue) {
  try {
    localStorage.setItem(PREDICTION_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch {}
  persistAdminSyncDiagnostics({ queuedCountSnapshot: queue.length });
  updateAdminSyncPanel();
}

function getPredictionQueueKey(item) {
  return [item.season, item.weekNo, item.playerId, item.matchId].join("__");
}

function getPredictionQueueAction(item) {
  return String(item?.action || "save").toLowerCase();
}

function enqueuePredictionRetry(payload) {
  const queue = getPendingPredictionQueue().filter(
    (item) => getPredictionQueueKey(item) !== getPredictionQueueKey(payload),
  );
  queue.push({ ...payload, queuedAt: new Date().toISOString() });
  persistPendingPredictionQueue(queue);
}

function dequeuePredictionRetry(payload) {
  const queue = getPendingPredictionQueue().filter(
    (item) => getPredictionQueueKey(item) !== getPredictionQueueKey(payload),
  );
  persistPendingPredictionQueue(queue);
}

async function flushPendingPredictionQueue(options = {}) {
  if (!useOnlineMode || !isAuthenticated()) return { flushed: 0, failed: 0 };

  const queue = getPendingPredictionQueue();
  if (!queue.length) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const failedItems = [];

  for (const item of queue) {
    const queuedPlayer = getPlayerById(item.playerId);
    const queuedMatch = state.matches.find(
      (match) => String(match.id) === String(item.matchId),
    );

    if (
      queuedPlayer &&
      queuedMatch &&
      getPlayerRole(queuedPlayer) !== "admin" &&
      !isPlayerActiveForSeason(queuedPlayer, queuedMatch.seasonId)
    ) {
      failed += 1;
      continue;
    }
    try {
      const action = getPredictionQueueAction(item);
      if (action === "delete") {
        const result = await deleteOnlinePrediction(item);
        if (!result?.success)
          throw new Error(
            result?.message || "Kuyruktaki silme işlemi tamamlanamadı.",
          );

        flushed += 1;
        clearLocalPredictionRecord(item.matchId, item.playerId);
        setPredictionUiState(item.matchId, item.playerId, "deleted");
        continue;
      }

      const result = await saveOnlinePrediction(item);
      if (!result?.success)
        throw new Error(result?.message || "Kuyruktaki kayıt yazılamadı.");

      flushed += 1;

      const pred = getPrediction(item.matchId, item.playerId);
      if (pred) {
        pred.remoteId =
          result.id || result.predictionId || pred.remoteId || pred.id;
      }

      const currentMatch = state.matches.find(
        (match) => match.id === item.matchId,
      );
      const currentPlayer = getPlayerById(item.playerId);
      if (currentMatch && currentPlayer) {
        upsertLocalPredictionRecord({
          matchId: item.matchId,
          playerId: item.playerId,
          homePred: parseNumberOrEmpty(item.homePred),
          awayPred: parseNumberOrEmpty(item.awayPred),
          points: currentMatch.played
            ? calcPoints(
                item.homePred,
                item.awayPred,
                currentMatch.homeScore,
                currentMatch.awayScore,
              )
            : 0,
          remoteId: result.id || result.predictionId || pred?.remoteId || null,
          username: currentPlayer?.username || item.kullaniciAdi || "",
        });

        const uiButton = document.getElementById(
          `pred_btn_${item.matchId}_${item.playerId}`,
        );
        if (uiButton)
          setPredictionUiState(item.matchId, item.playerId, "saved");
      }
    } catch (error) {
      failed += 1;
      failedItems.push(item);
      console.warn("Bekleyen tahmin tekrar gönderilemedi:", error);
    }
  }

  persistPendingPredictionQueue(failedItems);
  if (flushed) saveState(true);

  if (options.renderAfterFlush && flushed) {
    renderAll();
  }

  return { flushed, failed };
}

function getAdminSyncDiagnostics() {
  try {
    const raw = localStorage.getItem(ADMIN_SYNC_DIAGNOSTICS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      lastAction: parsed?.lastAction || "Hazır.",
      lastSuccessLabel:
        parsed?.lastSuccessLabel || getLastSyncLabel() || "Henüz yok",
      lastError: parsed?.lastError || "Yok",
      updatedMatchCount: Number(parsed?.updatedMatchCount || 0),
      queuedCountSnapshot: Number(
        parsed?.queuedCountSnapshot || getPendingPredictionQueue().length || 0,
      ),
    };
  } catch {
    return {
      lastAction: "Hazır.",
      lastSuccessLabel: getLastSyncLabel() || "Henüz yok",
      lastError: "Yok",
      updatedMatchCount: 0,
      queuedCountSnapshot: getPendingPredictionQueue().length,
    };
  }
}

function persistAdminSyncDiagnostics(partial = {}) {
  const nextValue = {
    ...getAdminSyncDiagnostics(),
    ...partial,
    queuedCountSnapshot:
      partial.queuedCountSnapshot ?? getPendingPredictionQueue().length,
  };
  try {
    localStorage.setItem(
      ADMIN_SYNC_DIAGNOSTICS_STORAGE_KEY,
      JSON.stringify(nextValue),
    );
  } catch {}
  return nextValue;
}

function updateAdminSyncPanel() {
  const diagnostics = getAdminSyncDiagnostics();
  const queuedCount = getPendingPredictionQueue().length;
  const syncText = getSyncSummaryText();

  const map = {
    adminSyncLastAction: diagnostics.lastAction || "Hazır.",
    adminSyncLastSuccess: diagnostics.lastSuccessLabel || "Henüz yok",
    adminSyncQueueCount: String(queuedCount),
    adminSyncUpdatedMatches: String(diagnostics.updatedMatchCount || 0),
    adminSyncLastError: diagnostics.lastError || "Yok",
    adminSyncFooter: `${syncText} • Bekleyen kayıt: ${queuedCount}`,
  };

  Object.entries(map).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });
}

function recordAdminSyncActivity(partial = {}) {
  const payload = {
    ...partial,
    queuedCountSnapshot: getPendingPredictionQueue().length,
  };

  if (payload.success) {
    payload.lastSuccessLabel =
      getLastSyncLabel() ||
      new Intl.DateTimeFormat("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date());
    payload.lastError = "Yok";
  }

  persistAdminSyncDiagnostics(payload);
  updateAdminSyncPanel();
}

function closeAppModal() {
  const modal = document.getElementById("appModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.dataset.mode = "";
}

function resolveAppModal(payload) {
  if (typeof appModalResolver === "function") {
    const resolver = appModalResolver;
    appModalResolver = null;
    resolver(payload);
  }
  closeAppModal();
}

function openAppModal({
  type = "info",
  title = "Bilgi",
  message = "",
  confirmText = "Tamam",
  cancelText = "Vazgeç",
  inputValue = "",
  inputPlaceholder = "",
}) {
  const modal = document.getElementById("appModal");
  const icon = document.getElementById("appModalIcon");
  const titleEl = document.getElementById("appModalTitle");
  const messageEl = document.getElementById("appModalText");
  const inputWrap = document.getElementById("appModalInputWrap");
  const input = document.getElementById("appModalInput");
  const cancelBtn = document.getElementById("appModalCancelBtn");
  const confirmBtn = document.getElementById("appModalConfirmBtn");
  if (
    !modal ||
    !icon ||
    !titleEl ||
    !messageEl ||
    !inputWrap ||
    !input ||
    !cancelBtn ||
    !confirmBtn
  ) {
    if (type === "prompt")
      return Promise.resolve(window.prompt(message, inputValue));
    if (type === "confirm") return Promise.resolve(window.confirm(message));
    window.alert(message);
    return Promise.resolve(true);
  }

  if (appModalResolver) {
    appModalResolver(type === "prompt" ? null : false);
    appModalResolver = null;
  }

  const icons = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    danger: "🗑️",
    prompt: "✏️",
    confirm: "❓",
  };
  modal.dataset.mode = type;
  icon.textContent = icons[type] || "ℹ️";
  titleEl.textContent = title;
  messageEl.textContent = message;
  confirmBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;
  cancelBtn.style.display =
    type === "info" || type === "success" ? "none" : "inline-flex";
  inputWrap.style.display = type === "prompt" ? "block" : "none";
  input.value = inputValue || "";
  input.placeholder = inputPlaceholder || "";
  modal.classList.remove("hidden");

  return new Promise((resolve) => {
    appModalResolver = resolve;
    setTimeout(() => {
      if (type === "prompt") {
        input.focus();
        input.select();
      } else {
        confirmBtn.focus();
      }
    }, 10);
  });
}

function showAlert(message, options = {}) {
  return openAppModal({
    type: options.type || "info",
    title: options.title || "Bilgi",
    message,
    confirmText: options.confirmText || "Tamam",
  });
}

function showConfirm(message, options = {}) {
  return openAppModal({
    type: options.type || "confirm",
    title: options.title || "Onay",
    message,
    confirmText: options.confirmText || "Evet",
    cancelText: options.cancelText || "Vazgeç",
  });
}

function showPrompt(message, defaultValue = "", options = {}) {
  return openAppModal({
    type: "prompt",
    title: options.title || "Bilgi Girişi",
    message,
    inputValue: defaultValue,
    inputPlaceholder: options.placeholder || "",
    confirmText: options.confirmText || "Kaydet",
    cancelText: options.cancelText || "Vazgeç",
  });
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function buildPlayerKeyFromName(name, existingUsers = {}) {
  const baseSlug = slugify(name);
  const safeBase = baseSlug || "oyuncu";

  let candidate = sanitizeFirebaseKey(`player-${safeBase}`);
  let counter = 2;

  while (existingUsers[candidate]) {
    candidate = sanitizeFirebaseKey(`player-${safeBase}-${counter}`);
    counter += 1;
  }

  return candidate;
}
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function on(id, eventName, handler) {
  document.getElementById(id)?.addEventListener(eventName, handler);
}
function buildApiUrl(action, params = {}) {
  const url = new URL(GOOGLE_SCRIPT_URL);
  url.searchParams.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  return url;
}

function jsonpRequest(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonp_cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      try {
        delete window[callbackName];
      } catch {}
      script.remove();
    };

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Veri isteği yüklenemedi."));
    };

    const url = buildApiUrl(action, { ...params, callback: callbackName });
    script.src = url.toString();
    document.body.appendChild(script);

    setTimeout(() => {
      if (window[callbackName]) {
        cleanup();
        reject(new Error("Veri isteği zaman aşımına uğradı."));
      }
    }, 30000);
  });
}

async function apiGet(action, params = {}) {
  if (isFirebaseReady()) {
    return await firebaseApiGet(action, params);
  }
  return await jsonpRequest(action, params);
}

async function apiPost(action, payload = {}) {
  if (isFirebaseReady()) {
    return await firebaseApiPost(action, payload);
  }
  return await jsonpRequest(action, { ...payload, action });
}

async function loginWithGoogleSheet(kullaniciAdi, sifre) {
  return await apiPost("login", { kullaniciAdi, sifre });
}

async function fetchOnlineMatches(sezon = "", haftaNo = "") {
  return await apiGet("getMatches", { sezon, haftaNo });
}

async function fetchOnlinePredictions(sezon = "", haftaNo = "") {
  return await apiGet("getPredictions", { sezon, haftaNo });
}
function normalizeOnlineMatchRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function parseBooleanish(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return ["true", "1", "evet", "yes", "played", "tamamlandi", "bitti"].includes(
    normalized,
  );
}

function normalizeStoredDate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mi = String(parsed.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function ensureSeasonFromOnlineLabel(seasonLabel, fallbackLeagueName = "") {
  const normalizedLabel = String(seasonLabel || "").trim();
  if (!normalizedLabel) return getSeasonById(getActiveSeasonId()) || null;

  const season = state.seasons.find(
    (item) => normalizeText(item.name) === normalizeText(normalizedLabel),
  );

  if (season && fallbackLeagueName && !season.leagueName) {
    season.leagueName = fallbackLeagueName;
  }

  return season || null;
}
function removeMatchesFromLocalState(matchIds = []) {
  const normalizedIds = new Set(matchIds.map((id) => String(id)));
  if (!normalizedIds.size) return;

  state.matches = state.matches.filter(
    (match) => !normalizedIds.has(String(match.id)),
  );
  state.predictions = state.predictions.filter(
    (pred) => !normalizedIds.has(String(pred.matchId)),
  );

  const remainingWeekIds = new Set(state.matches.map((match) => match.weekId));
  state.weeks = state.weeks.filter((week) => remainingWeekIds.has(week.id));

  const remainingSeasonIds = new Set(state.weeks.map((week) => week.seasonId));
  state.seasons = state.seasons.filter((season) =>
    remainingSeasonIds.has(season.id),
  );

  const remainingTeamKeys = new Set(
    state.matches.flatMap((match) => [
      `${match.seasonId}__${normalizeText(match.homeTeam)}`,
      `${match.seasonId}__${normalizeText(match.awayTeam)}`,
    ]),
  );
  state.teams = state.teams.filter((team) =>
    remainingTeamKeys.has(`${team.seasonId}__${normalizeText(team.name)}`),
  );

  ensureActiveSelections();
}

function pruneLocalMatchesAgainstRemote(rows = [], requestedSeasonLabel = "") {
  const remoteRows = Array.isArray(rows) ? rows : [];
  const affectedSeasonLabels = new Set(
    remoteRows
      .map(
        (row) =>
          row.season || row.sezon || row.seasonName || row.sezonAdi || "",
      )
      .filter(Boolean)
      .map((value) => normalizeText(value)),
  );

  if (requestedSeasonLabel) {
    affectedSeasonLabels.add(normalizeText(requestedSeasonLabel));
  }

  if (
    !affectedSeasonLabels.size &&
    !requestedSeasonLabel &&
    !remoteRows.length
  ) {
    state.matches = [];
    state.predictions = [];
    state.weeks = [];
    state.teams = [];
    state.seasons = [];
    ensureActiveSelections();
    return;
  }

  const remoteKeysBySeason = new Map();

  remoteRows.forEach((row) => {
    const seasonLabel = normalizeText(
      row.season ||
        row.sezon ||
        row.seasonName ||
        row.sezonAdi ||
        requestedSeasonLabel ||
        "",
    );
    if (!seasonLabel) return;
    if (!remoteKeysBySeason.has(seasonLabel)) {
      remoteKeysBySeason.set(seasonLabel, new Set());
    }

    const keys = remoteKeysBySeason.get(seasonLabel);
    const weekNo = String(
      row.weekNo || row.haftaNo || row.week || row.hafta || "",
    );
    const homeTeam = normalizeText(row.homeTeam || row.evSahibi || "");
    const awayTeam = normalizeText(row.awayTeam || row.deplasman || "");
    const remoteId = String(row.id || row.sheetMatchId || row.macId || "");

    if (remoteId) keys.add(`id:${remoteId}`);
    keys.add(`fp:${weekNo}__${homeTeam}__${awayTeam}`);
  });

  const removedMatchIds = state.matches
    .filter((match) => {
      const seasonLabel = normalizeText(
        getSeasonById(match.seasonId)?.name || "",
      );
      if (!affectedSeasonLabels.has(seasonLabel)) return false;

      const seasonKeys = remoteKeysBySeason.get(seasonLabel) || new Set();
      const remoteId = String(
        match.sheetMatchId || match.remoteMatchId || match.macId || "",
      );
      const fingerprint = `fp:${getWeekNumberById(match.weekId)}__${normalizeText(match.homeTeam)}__${normalizeText(match.awayTeam)}`;

      if (remoteId && seasonKeys.has(`id:${remoteId}`)) return false;
      if (seasonKeys.has(fingerprint)) return false;
      return true;
    })
    .map((match) => String(match.id));

  removeMatchesFromLocalState(removedMatchIds);
}

async function syncOnlineMatchesFromSheet(options = {}) {
  if (!useOnlineMode) return false;

  const requestedSeasonId = options.seasonId || getActiveSeasonId();
  const requestedSeasonLabel =
    options.seasonLabel ||
    getSeasonById(requestedSeasonId)?.name ||
    getActiveSeasonLabel() ||
    "";

  try {
    let response = await fetchOnlineMatches(requestedSeasonLabel || "", "");
    let rows = normalizeOnlineMatchRows(response);

    if (!rows.length && requestedSeasonLabel) {
      response = await fetchOnlineMatches("", "");
      rows = normalizeOnlineMatchRows(response);
    }

    if (options.replaceRemoteScope !== false) {
      pruneLocalMatchesAgainstRemote(rows, requestedSeasonLabel || "");
    }

    if (!rows.length) {
      recalculateAllPoints();
      saveState(true);
      if (!options.silent) renderAll();
      return false;
    }

    const touchedWeekIds = new Set();
    let lastSeasonId = requestedSeasonId || null;

    rows.forEach((row) => {
      const rowSeasonLabel =
        row.season ||
        row.sezon ||
        row.seasonName ||
        row.sezonAdi ||
        requestedSeasonLabel ||
        "";
      const season = ensureSeasonFromOnlineLabel(
        rowSeasonLabel,
        row.leagueName || row.ligAdi || "",
      );
      const seasonId = season?.id || requestedSeasonId;
      if (!seasonId) return;
      lastSeasonId = seasonId;

      const weekNo = Number(
        row.weekNo || row.haftaNo || row.week || row.hafta || 0,
      );
      if (!weekNo) return;

      const week = ensureWeekForSeason(seasonId, weekNo);
      if (!week) return;

      touchedWeekIds.add(week.id);

      const homeTeam = row.homeTeam || row.evSahibi || "";
      const awayTeam = row.awayTeam || row.deplasman || "";
      if (!homeTeam || !awayTeam) return;

      let existing = state.matches.find(
        (match) =>
          match.seasonId === seasonId &&
          (String(
            match.sheetMatchId || match.remoteMatchId || match.macId || "",
          ) === String(row.id || row.sheetMatchId || row.macId || "") ||
            (Number(getWeekNumberById(match.weekId)) === weekNo &&
              normalizeText(match.homeTeam) === normalizeText(homeTeam) &&
              normalizeText(match.awayTeam) === normalizeText(awayTeam))),
      );

      const playedFlag = parseBooleanish(
        row.played ?? row.oynandiMi ?? row.isPlayed ?? row.macOynandi ?? false,
      );

      const homeScore = parseNumberOrEmpty(
        row.homeScore ?? row.evGol ?? row.home_score,
      );
      const awayScore = parseNumberOrEmpty(
        row.awayScore ?? row.depGol ?? row.away_score,
      );
      const played = playedFlag || (homeScore !== "" && awayScore !== "");
      const normalizedDate = normalizeStoredDate(row.date || row.tarih || "");

      if (!existing) {
        existing = {
          id: uid("match"),
          seasonId,
          weekId: week.id,
          homeTeam,
          awayTeam,
          date: normalizedDate,
          played: played,
          homeScore: homeScore === "" ? null : homeScore,
          awayScore: awayScore === "" ? null : awayScore,
          apiId: row.apiId || "",
          postponed: false,
          wasPostponed: false,
          statusText: "",
          sheetMatchId: String(row.id || row.sheetMatchId || row.macId || ""),
        };
        state.matches.push(existing);
      } else {
        existing.weekId = week.id;
        existing.homeTeam = homeTeam;
        existing.awayTeam = awayTeam;
        existing.date = normalizedDate || existing.date || "";
        existing.apiId = row.apiId || existing.apiId || "";
        existing.sheetMatchId = String(
          row.id ||
            row.sheetMatchId ||
            row.macId ||
            existing.sheetMatchId ||
            "",
        );
        existing.played = played;
        existing.homeScore = homeScore === "" ? null : homeScore;
        existing.awayScore = awayScore === "" ? null : awayScore;
      }

      if (
        !getTeamsBySeasonId(seasonId).some(
          (t) => normalizeText(t.name) === normalizeText(homeTeam),
        )
      ) {
        state.teams.push({
          id: uid("team"),
          seasonId,
          name: homeTeam,
          slug: DEFAULT_TEAM_SLUGS[homeTeam] || slugify(homeTeam),
        });
      }

      if (
        !getTeamsBySeasonId(seasonId).some(
          (t) => normalizeText(t.name) === normalizeText(awayTeam),
        )
      ) {
        state.teams.push({
          id: uid("team"),
          seasonId,
          name: awayTeam,
          slug: DEFAULT_TEAM_SLUGS[awayTeam] || slugify(awayTeam),
        });
      }
    });

    if (!state.settings.activeSeasonId && lastSeasonId) {
      state.settings.activeSeasonId = lastSeasonId;
    }
    if (!state.settings.activeWeekId && state.settings.activeSeasonId) {
      state.settings.activeWeekId =
        getWeeksBySeasonId(state.settings.activeSeasonId)[0]?.id || null;
    }

    touchedWeekIds.forEach((weekId) => syncWeekStatus(weekId));
    recalculateAllPoints();
    saveState(true);
    if (!options.silent) renderAll();
    return true;
  } catch (error) {
    console.error("Online maçlar yüklenemedi:", error);
    return false;
  }
}
async function fetchOnlineStandings(sezon = "") {
  return await apiGet("getStandings", { sezon });
}

async function saveOnlinePrediction(payload) {
  const player = getPlayerById(payload.playerId);
  const match = state.matches.find(
    (item) => String(item.id) === String(payload.matchId),
  );

  if (
    player &&
    match &&
    getPlayerRole(player) !== "admin" &&
    !isPlayerActiveForSeason(player, match.seasonId)
  ) {
    return {
      success: false,
      message: "Bu kullanıcı bu sezonda tahmin giremez.",
    };
  }

  return await apiPost("savePrediction", payload);
}

async function deleteOnlinePrediction(payload) {
  return await apiPost("deletePrediction", payload);
}

async function addOnlineMatches(matches) {
  const serializedMatches = JSON.stringify(matches || []);
  return await apiPost("addMatches", { matches: serializedMatches });
}

async function fetchOnlineUsers(includeInactive = false) {
  return await apiGet(
    "getUsers",
    includeInactive ? { includeInactive: 1 } : {},
  );
}

async function addOnlineUser(payload) {
  return await apiPost("addUser", payload);
}

async function updateOnlineUser(payload) {
  return await apiPost("updateUser", payload);
}

async function deleteOnlineUser(payload) {
  return await apiPost("deleteUser", payload);
}

function normalizeSeasonRegistryItem(item) {
  if (!item) return null;
  const id = String(item.id || "").trim();
  const name = String(item.name || "").trim();
  const leagueName = String(item.leagueName || "").trim();
  if (!id || !name) return null;
  return { id, name, leagueName };
}

async function syncSeasonRegistryFromFirebase() {
  if (!isFirebaseReady()) return [];
  const settings = (await firebaseRead("settings")) || {};
  const rawList = Array.isArray(settings.seasonsMeta)
    ? settings.seasonsMeta
    : [];
  const seasonList = rawList.map(normalizeSeasonRegistryItem).filter(Boolean);
  const remoteIds = new Set(seasonList.map((item) => String(item.id)));

  state.seasons = seasonList.map((item) => ({ ...item }));
  state.teams = state.teams.filter((team) =>
    remoteIds.has(String(team.seasonId)),
  );
  state.weeks = state.weeks.filter((week) =>
    remoteIds.has(String(week.seasonId)),
  );
  const validWeekIds = new Set(state.weeks.map((week) => String(week.id)));
  state.matches = state.matches.filter(
    (match) =>
      remoteIds.has(String(match.seasonId)) &&
      validWeekIds.has(String(match.weekId)),
  );
  const validMatchIds = new Set(state.matches.map((match) => String(match.id)));
  state.predictions = state.predictions.filter((pred) =>
    validMatchIds.has(String(pred.matchId)),
  );

  if (
    state.settings.activeSeasonId &&
    !remoteIds.has(String(state.settings.activeSeasonId))
  ) {
    state.settings.activeSeasonId = seasonList[0]?.id || null;
  }
  if (!state.settings.activeSeasonId && seasonList.length) {
    state.settings.activeSeasonId = seasonList[0].id;
  }
  return seasonList;
}

async function persistSeasonRegistryToFirebase() {
  if (!isFirebaseReady()) return false;
  const seasonsMeta = state.seasons
    .map((season) => ({
      id: String(season.id || "").trim(),
      name: String(season.name || "").trim(),
      leagueName: String(season.leagueName || "").trim(),
    }))
    .filter((season) => season.id && season.name);

  await firebaseUpdate("settings", {
    seasonsMeta,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

async function syncUsersFromSheet(options = {}) {
  if (!useOnlineMode) return [];
  const result = await fetchOnlineUsers();
  if (!result?.success || !Array.isArray(result.users)) {
    throw new Error(result?.message || "Kullanıcı listesi alınamadı.");
  }
  const users = result.users.map((user) => ({
    id: String(user.id),
    name: user.adSoyad || user.kullaniciAdi || "",
    password: user.sifre || "1234",
    username: user.kullaniciAdi || "",
    role:
      String(user.rol || "user").toLowerCase() === "admin" ? "admin" : "user",
    aktif: user.aktif !== false,
    seasonStates:
      user.seasonStates || user.seasonMemberships || user.activeSeasons || {},
  }));
  state.players = users;
  const authUser = getAuthUser();
  if (authUser) {
    const matched = findPlayerForSessionUser(authUser);
    state.settings.auth.playerId = matched ? matched.id : null;
  }
  saveState(true);
  if (!options.silent) renderPlayers();
  return users;
}

async function sendMatchesToSheet(matches, options = {}) {
  const forceWrite = !!options.force;
  if (!forceWrite && !window.__ALLOW_MATCH_WRITE__) {
    console.log("Firebase write engellendi (auto sync)");
    return null;
  }
  if (!useOnlineMode || !Array.isArray(matches) || !matches.length) return null;

  const payloadMatches = matches
    .map((match) => ({
      id:
        match.sheetMatchId ||
        match.remoteMatchId ||
        match.macId ||
        match.id ||
        "",
      sheetMatchId:
        match.sheetMatchId ||
        match.remoteMatchId ||
        match.macId ||
        match.id ||
        "",
      macId:
        match.sheetMatchId ||
        match.remoteMatchId ||
        match.macId ||
        match.id ||
        "",
      season:
        getSeasonById(match.seasonId)?.name || getActiveSeasonLabel() || "",
      sezon:
        getSeasonById(match.seasonId)?.name || getActiveSeasonLabel() || "",
      weekNo: getWeekNumberById(match.weekId),
      haftaNo: getWeekNumberById(match.weekId),
      homeTeam: match.homeTeam || "",
      awayTeam: match.awayTeam || "",
      evSahibi: match.homeTeam || "",
      deplasman: match.awayTeam || "",
      date: match.date || "",
      tarih: match.date || "",
      apiId: match.apiId || "",
      played: !!match.played,
      oynandiMi: match.played ? 1 : 0,
      homeScore: match.homeScore ?? "",
      awayScore: match.awayScore ?? "",
      evGol: match.homeScore ?? "",
      depGol: match.awayScore ?? "",
    }))
    .filter(
      (item) => item.sezon && item.haftaNo && item.evSahibi && item.deplasman,
    );

  if (!payloadMatches.length) return null;
  return await addOnlineMatches(payloadMatches);
}

async function syncWeekMatchesToSheet(weekId) {
  const matches = getMatchesByWeekId(weekId);
  if (!matches.length) return null;
  return await sendMatchesToSheet(matches, { force: true });
}

async function syncSeasonMatchesToSheet(seasonId) {
  const matches = getMatchesBySeasonId(seasonId);
  if (!matches.length) return null;
  return await sendMatchesToSheet(matches, { force: true });
}

function isMobileView() {
  return window.innerWidth <= 720;
}

function ensureAuthState(stateObj) {
  stateObj.settings = stateObj.settings || {};
  stateObj.settings.auth = {
    adminUsername: "admin",
    adminPassword: "1234",
    isAuthenticated: false,
    role: "admin",
    playerId: null,
    user: null,
    ...(stateObj.settings.auth || {}),
  };
  stateObj.players = (stateObj.players || []).map((player) => ({
    ...player,
    password: player.password || "1234",
  }));
}

function getCurrentRole() {
  if (getAuthUser()?.rol === "user") return "user";
  return state.settings?.auth?.role === "user" ? "user" : "admin";
}

function getCurrentPlayerId() {
  const value = state.settings?.auth?.playerId;
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function getCurrentPlayer() {
  const playerId = getCurrentPlayerId();
  return playerId ? getPlayerById(playerId) : null;
}

function isAuthenticated() {
  return !!state.settings?.auth?.isAuthenticated;
}

function setCurrentRole(role) {
  if (!currentSessionUser) return;
  currentSessionUser.rol = role === "user" ? "user" : "admin";
  applyRolePermissions();
}

function isReadOnlyMode() {
  return getCurrentRole() === "user";
}

function canEditPrediction(playerId, seasonId = getActiveSeasonId()) {
  if (getCurrentRole() === "admin") return true;

  const currentPlayerId = getCurrentPlayerId();
  const normalizedPlayerId = normalizeEntityId(playerId);
  const normalizedCurrentPlayerId = normalizeEntityId(currentPlayerId);

  if (!normalizedPlayerId || !normalizedCurrentPlayerId) return false;
  if (normalizedPlayerId !== normalizedCurrentPlayerId) return false;

  const currentPlayer = getPlayerById(normalizedCurrentPlayerId);
  if (!currentPlayer) return false;

  return isPlayerActiveForSeason(currentPlayer, seasonId);
}

function getPredictionOutcomeClass(pred, match) {
  const hasPrediction = pred.homePred !== "" && pred.awayPred !== "";
  if (!hasPrediction) return "prediction-empty";
  if (!match?.played) return "prediction-pending";
  if ((pred.points || 0) === 3) return "prediction-exact";
  if ((pred.points || 0) === 1) return "prediction-close";
  return "prediction-miss";
}

function getVisiblePlayersOrdered() {
  const activeSeasonId = getActiveSeasonId();
  const players = [...state.players].filter(
    (player) =>
      getPlayerRole(player) !== "admin" &&
      isPlayerActiveForSeason(player, activeSeasonId),
  );
  const currentPlayerId = getCurrentPlayerId();
  if (getCurrentRole() !== "user" || !currentPlayerId) return players;
  return players.sort((a, b) => {
    if (a.id === currentPlayerId) return -1;
    if (b.id === currentPlayerId) return 1;
    return a.name.localeCompare(b.name, "tr");
  });
}

function normalizeSeasonStateMap(value = {}) {
  const output = {};
  if (!value || typeof value !== "object") return output;
  Object.entries(value).forEach(([seasonId, isActive]) => {
    const normalizedSeasonId = String(seasonId || "").trim();
    if (!normalizedSeasonId) return;
    output[normalizedSeasonId] = isActive !== false;
  });
  return output;
}

function getPlayerSeasonStateMap(player) {
  return normalizeSeasonStateMap(
    player?.seasonStates ||
      player?.seasonMemberships ||
      player?.activeSeasons ||
      {},
  );
}

function isPlayerActiveForSeason(player, seasonId = getActiveSeasonId()) {
  if (!player) return false;
  if (getPlayerRole(player) === "admin") return false;
  const normalizedSeasonId = String(seasonId || "").trim();
  if (!normalizedSeasonId) return true;
  const seasonStates = getPlayerSeasonStateMap(player);
  if (!Object.keys(seasonStates).length) return true;
  return seasonStates[normalizedSeasonId] !== false;
}

function createDefaultSeasonStateMap(defaultValue = true) {
  const output = {};
  state.seasons.forEach((season) => {
    const seasonId = String(season.id || "").trim();
    if (!seasonId) return;
    output[seasonId] = defaultValue;
  });
  return output;
}

function normalizeLoginName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/\s+/g, " ");
}

function normalizeEntityId(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim();
  return normalized;
}

function parseNumberOrEmpty(value) {
  if (value === "" || value === null || value === undefined) return "";
  const num = Number(value);
  return Number.isNaN(num) ? "" : num;
}

function getAuthUser() {
  return currentSessionUser || state.settings?.auth?.user || null;
}

function getCurrentUsername() {
  return getAuthUser()?.kullaniciAdi || "";
}

function findPlayerForSessionUser(user = getAuthUser()) {
  if (!user) return null;
  const playerList = state.players || [];
  const candidates = [
    user.playerId,
    user.id,
    user.kisiId,
    user.playerSheetId,
    user.sheetPlayerId,
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));

  let matched = playerList.find((item) => candidates.includes(String(item.id)));
  if (matched) return matched;

  const normalizedNames = [
    user.adSoyad,
    user.name,
    user.kullaniciAdi,
    user.username,
  ]
    .filter(Boolean)
    .map((value) => normalizeText(value));

  matched = playerList.find((item) => {
    const playerName = normalizeText(item.name);
    return normalizedNames.includes(playerName);
  });

  return matched || null;
}

function setAuthenticatedUser(user) {
  currentSessionUser = user || null;
  state.settings.auth.user = user || null;

  if (!user) {
    state.settings.auth.playerId = null;
    return;
  }

  const matchedPlayer = findPlayerForSessionUser(user);
  state.settings.auth.playerId = matchedPlayer ? matchedPlayer.id : null;
}

function getActiveSeasonLabel() {
  return getSeasonById(getActiveSeasonId())?.name || "";
}

function clearOnlinePredictionsForScope(seasonId, weekId = null) {
  const scopedMatchIds = new Set(
    weekId
      ? getMatchesByWeekId(weekId).map((match) => match.id)
      : getMatchesBySeasonId(seasonId).map((match) => match.id),
  );

  state.predictions = state.predictions.filter((pred) => {
    const match = state.matches.find((item) => item.id === pred.matchId);
    if (!match) return true;
    if (match.seasonId !== seasonId) return true;
    if (weekId && !scopedMatchIds.has(pred.matchId)) return true;
    return false;
  });
}

function upsertLocalPredictionRecord({
  matchId,
  playerId,
  homePred,
  awayPred,
  points,
  remoteId = null,
  username = "",
}) {
  if (!matchId || !playerId) return null;
  let pred = getPrediction(matchId, playerId);
  if (!pred) {
    pred = {
      id: remoteId || uid("pred"),
      remoteId: remoteId || null,
      matchId,
      playerId,
      homePred: "",
      awayPred: "",
      points: 0,
    };
    state.predictions.push(pred);
  }

  pred.id = remoteId || pred.id || uid("pred");
  pred.remoteId = remoteId || pred.remoteId || null;
  pred.homePred = parseNumberOrEmpty(homePred);
  pred.awayPred = parseNumberOrEmpty(awayPred);
  pred.points = Number(points || 0);
  if (username) pred.username = username;
  return pred;
}

function resolveMatchIdFromOnlineRow(row) {
  const directMatchCandidates = [
    row.matchId,
    row.localMatchId,
    row.sheetMatchId,
    row.macId,
    row.match_id,
    row.eventId,
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));

  if (directMatchCandidates.length) {
    const directMatch = state.matches.find((item) => {
      const candidates = [
        item.id,
        item.sheetMatchId,
        item.remoteMatchId,
        item.macId,
      ]
        .filter(
          (value) => value !== null && value !== undefined && value !== "",
        )
        .map((value) => String(value));
      return directMatchCandidates.some((candidate) =>
        candidates.includes(candidate),
      );
    });
    if (directMatch) return String(directMatch.id);
  }

  const seasonLabel =
    row.season || row.sezon || row.seasonName || row.sezonAdi || "";
  const weekNo = Number(
    row.weekNo || row.haftaNo || row.week || row.hafta || 0,
  );
  const homeTeam =
    row.homeTeam || row.evSahibi || row.home || row.home_name || "";
  const awayTeam =
    row.awayTeam || row.deplasman || row.away || row.away_name || "";

  const matched = state.matches.find((match) => {
    const sameSeason =
      !seasonLabel ||
      normalizeText(getSeasonById(match.seasonId)?.name) ===
        normalizeText(seasonLabel);
    const sameWeek =
      !weekNo || Number(getWeekNumberById(match.weekId)) === weekNo;
    const sameHome =
      !homeTeam || normalizeText(match.homeTeam) === normalizeText(homeTeam);
    const sameAway =
      !awayTeam || normalizeText(match.awayTeam) === normalizeText(awayTeam);
    return sameSeason && sameWeek && sameHome && sameAway;
  });

  return matched ? matched.id : null;
}

function resolvePlayerIdFromOnlineRow(row) {
  const directPlayerCandidates = [
    row.playerId,
    row.kisiId,
    row.player_id,
    row.userId,
    row.kullaniciId,
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));

  if (directPlayerCandidates.length) {
    const matched = state.players.find((item) =>
      directPlayerCandidates.includes(String(item.id)),
    );
    if (matched) return String(matched.id);
  }

  const playerName =
    row.playerName ||
    row.adSoyad ||
    row.name ||
    row.kullaniciAdi ||
    row.username ||
    "";
  if (!playerName) return null;
  const matched = state.players.find(
    (item) => normalizeText(item.name) === normalizeText(playerName),
  );
  return matched ? matched.id : null;
}

function normalizeOnlinePredictionRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.predictions)) return payload.predictions;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function getUnsyncedPredictionDraftsForScope(seasonId, weekId = null) {
  const scopedMatchIds = new Set(
    weekId
      ? getMatchesByWeekId(weekId).map((match) => match.id)
      : getMatchesBySeasonId(seasonId).map((match) => match.id),
  );

  return state.predictions
    .filter((pred) => {
      const match = state.matches.find((item) => item.id === pred.matchId);
      if (!match) return false;
      if (match.seasonId !== seasonId) return false;
      if (weekId && !scopedMatchIds.has(pred.matchId)) return false;
      if (pred.remoteId) return false;
      return pred.homePred !== "" || pred.awayPred !== "";
    })
    .map((pred) => ({ ...pred }));
}

async function syncOnlinePredictions(options = {}) {
  if (!useOnlineMode || !isAuthenticated()) return false;

  const seasonId = Object.prototype.hasOwnProperty.call(options, "seasonId")
    ? options.seasonId
    : getActiveSeasonId();
  const weekId = Object.prototype.hasOwnProperty.call(options, "weekId")
    ? options.weekId
    : state.settings.activeWeekId;
  const seasonLabel = Object.prototype.hasOwnProperty.call(
    options,
    "seasonLabel",
  )
    ? options.seasonLabel
    : getSeasonById(seasonId)?.name || "";
  const weekNumber = Object.prototype.hasOwnProperty.call(options, "weekNumber")
    ? options.weekNumber
    : weekId
      ? getWeekNumberById(weekId)
      : "";

  try {
    const response = await fetchOnlinePredictions(
      seasonLabel || "",
      weekNumber || "",
    );
    const rows = normalizeOnlinePredictionRows(response);
    const localDrafts = seasonId
      ? getUnsyncedPredictionDraftsForScope(seasonId, weekId || null)
      : [];

    if (seasonId) {
      clearOnlinePredictionsForScope(seasonId, weekId || null);
    } else {
      state.predictions = [];
    }

    rows.forEach((row) => {
      const matchId = resolveMatchIdFromOnlineRow(row);
      const playerId = resolvePlayerIdFromOnlineRow(row);
      if (!matchId || !playerId) return;

      const match = state.matches.find((item) => item.id === matchId);
      const homePred = parseNumberOrEmpty(
        row.homePred ??
          row.evTahmin ??
          row.home_prediction ??
          row.tahminEv ??
          row.tahminEvGol,
      );
      const awayPred = parseNumberOrEmpty(
        row.awayPred ??
          row.depTahmin ??
          row.away_prediction ??
          row.tahminDep ??
          row.tahminDepGol,
      );
      const points =
        match && match.played
          ? calcPoints(homePred, awayPred, match.homeScore, match.awayScore)
          : Number(row.points || row.puan || 0);

      upsertLocalPredictionRecord({
        matchId,
        playerId,
        homePred,
        awayPred,
        points,
        remoteId:
          row.id || row.predictionId || row.kayitId || row.tahminId || null,
        username: row.kullaniciAdi || row.username || "",
      });
    });

    localDrafts.forEach((draft) => {
      upsertLocalPredictionRecord(draft);
    });

    recalculateAllPoints();
    saveState(true);
    updateLastSyncLabel();
    if (!options.silent) renderAll();
    return true;
  } catch (error) {
    console.error("Online tahminler yüklenemedi:", error);
    return false;
  }
}

async function hydrateOnlineStateForSession(options = {}) {
  if (!useOnlineMode || !isAuthenticated()) return false;

  try {
    const normalizedOptions = { ...options, silent: true };
    const isSessionRestore = !!normalizedOptions.sessionRestore;
    const suppressLoadingOverlay = !!normalizedOptions.suppressLoadingOverlay;
    const updateLoadingUi = !suppressLoadingOverlay;

    if (updateLoadingUi) {
      setAppLoading(true, {
        title: isSessionRestore ? "Oturum açılıyor" : "Giriş başarılı",
        message: isSessionRestore
          ? "Kayıtlı oturum bulunuyor. Veriler hazırlanıyor, lütfen bekleyin."
          : "Verilerin yüklenmesini bekleyin. Yükleme bitmeden işlem yapmayın.",
        stepLabel: isSessionRestore
          ? "Kayıtlı oturum doğrulanıyor..."
          : "Veri bağlantısı kuruluyor...",
        percent: 12,
        showSuccess: !isSessionRestore,
      });
      setAppLoadingCheck(
        "login",
        isSessionRestore ? "active" : "done",
        isSessionRestore
          ? "Kayıtlı oturum doğrulanıyor..."
          : "Giriş başarılı oldu",
      );
      setAppLoadingCheck("users", "active", "Kullanıcılar kontrol ediliyor...");
    }

    const [userSyncResult, matchSyncResult] = await Promise.allSettled([
      syncUsersFromSheet({ silent: true }),
      syncOnlineMatchesFromSheet(normalizedOptions),
    ]);

    if (userSyncResult.status === "rejected") {
      console.warn("Kullanıcı senkron uyarısı:", userSyncResult.reason);
      if (updateLoadingUi) {
        setAppLoadingCheck(
          "users",
          "pending",
          "Kullanıcı listesi alınamadı, mevcut liste korunuyor",
        );
      }
    } else if (updateLoadingUi) {
      setAppLoadingCheck("users", "done", "Kullanıcı listesi hazır");
    }

    if (isSessionRestore && updateLoadingUi) {
      setAppLoadingCheck("login", "done", "Kayıtlı oturum hazır");
    }

    if (updateLoadingUi) {
      setAppLoading(true, {
        title: "Veriler yükleniyor",
        message: "Maçlar ve haftalar hazırlanıyor...",
        stepLabel: "Maç verileri işleniyor...",
        percent: 48,
        showSuccess: false,
      });
      setAppLoadingCheck("matches", "active", "Maç verileri yükleniyor...");
    }

    if (matchSyncResult.status === "rejected") {
      throw matchSyncResult.reason;
    }

    if (!matchSyncResult.value) {
      await syncOnlineMatchesFromSheet({
        ...normalizedOptions,
        seasonLabel: "",
      });
    }

    if (updateLoadingUi) {
      setAppLoadingCheck("matches", "done", "Maç verileri hazır");
      setAppLoading(true, {
        message: "Tahminler ve bekleyen kayıtlar eşitleniyor...",
        stepLabel: "Tahminler yükleniyor...",
        percent: 74,
        showSuccess: false,
      });
      setAppLoadingCheck("predictions", "active", "Tahminler yükleniyor...");
    }

    await syncOnlinePredictions(normalizedOptions);

    if (updateLoadingUi) {
      setAppLoading(true, {
        message: "Bekleyen tahminler Firebase ile eşitleniyor...",
        stepLabel: "Son kontroller yapılıyor...",
        percent: 90,
        showSuccess: false,
      });
    }

    const queueResult = await flushPendingPredictionQueue();
    updateLastSyncLabel();
    recordAdminSyncActivity({
      lastAction: queueResult.flushed
        ? `${queueResult.flushed} bekleyen tahmin eşitlendi.`
        : "Oturum verileri yenilendi.",
      success: true,
    });

    renderAll();

    if (updateLoadingUi) {
      setAppLoadingCheck(
        "predictions",
        "done",
        queueResult.flushed
          ? `Tahminler hazır • ${queueResult.flushed} bekleyen kayıt gönderildi`
          : "Tahminler hazır",
      );
      setAppLoading(true, {
        title: "Hazır",
        message: "Tüm veriler güncellendi. Panel kullanıma hazır.",
        stepLabel: "Yükleme tamamlandı.",
        percent: 100,
        showSuccess: true,
      });

      window.setTimeout(() => {
        setAppLoading(false);
      }, 700);
    }

    if (queueResult.flushed) {
      showAlert(
        `${queueResult.flushed} bekleyen tahmin Firebase ile eşitlendi.`,
        {
          title: "Bekleyen Kayıtlar Gönderildi",
          type: "success",
        },
      );
    }
    return true;
  } catch (error) {
    console.error("Oturum verileri yüklenemedi:", error);
    if (updateLoadingUi) {
      setAppLoading(true, {
        title: "Yükleme tamamlanamadı",
        message:
          error?.message || "Firebase verileri alınırken bir sorun oluştu.",
        stepLabel: "Tekrar giriş yapabilir veya sayfayı yenileyebilirsin.",
        percent: 100,
        showSuccess: false,
      });
    }
    return false;
  }
}

function updateSessionCard() {
  const isAuth = isAuthenticated();
  const isAdmin = getCurrentRole() === "admin";
  const currentName = isAuth
    ? isAdmin
      ? currentSessionUser?.name || "Admin"
      : getCurrentPlayer()?.name || currentSessionUser?.name || "Kullanıcı"
    : "Giriş yapılmadı";
  const online = isAuth ? navigator.onLine : false;
  const statusText = online ? "Online" : "Offline";
  const roleText = !isAuth ? "Misafir" : isAdmin ? "Admin" : "Kullanıcı";

  const mappings = [
    ["desktopAccountName", currentName],
    ["mobileAccountName", currentName],
    ["desktopAccountStatus", statusText],
    ["mobileAccountStatus", statusText],
    ["desktopAccountRole", roleText],
    ["mobileAccountRole", roleText],
  ];
  mappings.forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });

  ["desktopAccountDot", "mobileAccountDot"].forEach((id) => {
    const dot = document.getElementById(id);
    if (!dot) return;
    dot.classList.toggle("is-online", online);
    dot.classList.toggle("is-offline", !online);
  });

  const logoutBtn = document.getElementById("logoutBtn");
  const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
  if (logoutBtn) logoutBtn.disabled = !isAuth;
  if (mobileLogoutBtn) mobileLogoutBtn.disabled = !isAuth;

  const desktopChangeBtn = document.getElementById("desktopChangePasswordBtn");
  const mobileChangeBtn = document.getElementById("mobileChangePasswordBtn");
  const showPassword = isAuth && !isAdmin;
  if (desktopChangeBtn) desktopChangeBtn.hidden = !showPassword;
  if (mobileChangeBtn) mobileChangeBtn.hidden = !showPassword;
}

function closeAccountMenus() {
  const desktopMenu = document.getElementById("desktopAccountMenu");
  const mobileMenu = document.getElementById("mobileAccountMenu");
  const desktopBtn = document.getElementById("desktopAccountBtn");
  const mobileBtn = document.getElementById("mobileAccountBtn");
  if (desktopMenu) desktopMenu.hidden = true;
  if (mobileMenu) mobileMenu.hidden = true;
  desktopBtn?.classList.remove("is-open");
  mobileBtn?.classList.remove("is-open");
}

function toggleAccountMenu(type = "mobile") {
  const isMobileMenu = type === "mobile";
  const menu = document.getElementById(
    isMobileMenu ? "mobileAccountMenu" : "desktopAccountMenu",
  );
  const btn = document.getElementById(
    isMobileMenu ? "mobileAccountBtn" : "desktopAccountBtn",
  );
  const otherMenu = document.getElementById(
    isMobileMenu ? "desktopAccountMenu" : "mobileAccountMenu",
  );
  const otherBtn = document.getElementById(
    isMobileMenu ? "desktopAccountBtn" : "mobileAccountBtn",
  );
  if (!menu || !btn) return;
  const willOpen = menu.hidden;
  if (otherMenu) otherMenu.hidden = true;
  otherBtn?.classList.remove("is-open");
  menu.hidden = !willOpen;
  btn.classList.toggle("is-open", willOpen);
}

function closeMobileAdminMenu() {
  const sheet = document.getElementById("mobileAdminMenuSheet");
  const trigger = document.getElementById("mobileAdminMenuBtn");
  if (!sheet) return;
  sheet.hidden = true;
  sheet.classList.remove("open");
  trigger?.classList.remove("is-open");
}

function toggleMobileAdminMenu(forceOpen = null) {
  const sheet = document.getElementById("mobileAdminMenuSheet");
  const trigger = document.getElementById("mobileAdminMenuBtn");
  if (!sheet || getCurrentRole() !== "admin") return;
  const willOpen = typeof forceOpen === "boolean" ? forceOpen : sheet.hidden;
  sheet.hidden = !willOpen;
  sheet.classList.toggle("open", willOpen);
  trigger?.classList.toggle("is-open", willOpen);
}

async function changeOwnPassword() {
  if (!isAuthenticated() || getCurrentRole() === "admin") return;
  const player = getCurrentPlayer();
  if (!player) return;
  const password = await showPrompt(
    "Yeni şifreni yaz:",
    player.password || "1234",
    {
      title: "Şifre değiştir",
      placeholder: "Örn: 1234",
    },
  );
  if (!password?.trim()) return;

  if (useOnlineMode) {
    try {
      const result = await updateOnlineUser({
        id: player.id,
        sifre: password.trim(),
      });
      if (!result?.success) {
        showAlert(result?.message || "Şifre güncellenemedi.", {
          title: "Kayıt Hatası",
          type: "warning",
        });
        return;
      }
      await syncUsersFromSheet();
    } catch (error) {
      console.error("Kendi şifre güncelleme hatası:", error);
      showAlert(error?.message || "Şifre güncellenemedi.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
      return;
    }
  } else {
    player.password = password.trim();
  }

  if (currentSessionUser) currentSessionUser.password = password.trim();
  if (state?.settings?.auth?.user)
    state.settings.auth.user.password = password.trim();
  saveState(true);
  updateSessionCard();
  closeAccountMenus();
  renderAll();
  showAlert("Şifren başarıyla güncellendi.", {
    title: "İşlem tamam",
    type: "success",
  });
}

function clearLoginErrorState() {
  const status = document.getElementById("loginStatus");
  const card = document.querySelector("#loginOverlay .login-card");
  const usernameInput = document.getElementById("loginUsername");
  const passwordInput = document.getElementById("loginPassword");

  status?.classList.remove("is-error", "is-success");
  card?.classList.remove("is-error", "shake");
  usernameInput?.classList.remove("input-error");
  passwordInput?.classList.remove("input-error");
}

function setLoginFeedback(type = "idle", message = "Hazır.") {
  const status = document.getElementById("loginStatus");
  const card = document.querySelector("#loginOverlay .login-card");
  const usernameInput = document.getElementById("loginUsername");
  const passwordInput = document.getElementById("loginPassword");

  clearLoginErrorState();

  if (status) status.textContent = message;

  if (type === "error") {
    status?.classList.add("is-error");
    card?.classList.add("is-error", "shake");
    usernameInput?.classList.add("input-error");
    passwordInput?.classList.add("input-error");
    window.setTimeout(() => card?.classList.remove("shake"), 480);
    return;
  }

  if (type === "success") {
    status?.classList.add("is-success");
  }
}

function setLoginSubmitting(isSubmitting = false) {
  const button = document.getElementById("loginBtn");
  const usernameInput = document.getElementById("loginUsername");
  const passwordInput = document.getElementById("loginPassword");

  if (button) {
    button.disabled = isSubmitting;
    button.classList.toggle("btn-loading", isSubmitting);
    button.textContent = isSubmitting ? "Giriş yapılıyor" : "Giriş Yap";
  }

  if (usernameInput) usernameInput.disabled = isSubmitting;
  if (passwordInput) passwordInput.disabled = isSubmitting;
}

function resetLoginForm() {
  const usernameInput = document.getElementById("loginUsername");
  const passwordInput = document.getElementById("loginPassword");
  if (usernameInput) usernameInput.value = "";
  if (passwordInput) passwordInput.value = "";
}
function setLoginScrollLock(isLocked) {
  const scrollY = window.__loginScrollY || 0;

  if (isLocked) {
    window.__loginScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add("login-locked");
    document.body.classList.add("login-locked");
    document.body.style.top = `-${window.__loginScrollY}px`;
    return;
  }

  document.documentElement.classList.remove("login-locked");
  document.body.classList.remove("login-locked");
  document.body.style.top = "";
  window.scrollTo(0, window.__loginScrollY || 0);
}

function clearRememberedSession() {
  try {
    state.settings.auth.isAuthenticated = false;
    state.settings.auth.role = "admin";
    state.settings.auth.playerId = null;
    state.settings.auth.user = null;
    currentSessionUser = null;
    saveState(true);
  } catch (error) {
    console.warn("Oturum temizleme uyarısı:", error);
  }
}
function updateLoginOverlay() {
  const overlay = document.getElementById("loginOverlay");
  if (!overlay) return;

  const auth = isAuthenticated();

  overlay.classList.toggle("hidden", auth);
  setLoginScrollLock(!auth);

  if (!auth) {
    resetLoginForm();
    clearLoginErrorState();
    setLoginSubmitting(false);
    setLoginFeedback("idle", "Hazır.");
  }

  updateSessionCard();
}
function closeLoginOverlay() {
  state.settings.auth.isAuthenticated = true;
  saveState(true);
  updateLoginOverlay();
  updateAdminSyncToggleButton();
}
function logoutUser() {
  closeAccountMenus();
  stopPresenceTracking({ removeSession: true });

  currentSessionUser = null;
  state.settings.auth.isAuthenticated = false;
  state.settings.auth.role = "admin";
  state.settings.auth.playerId = null;
  state.settings.auth.user = null;

  saveState(true);
  updateLoginOverlay();
  updateAdminSyncToggleButton();
  applyRolePermissions();
  renderAll();
}

async function loginUser() {
  const username =
    document.getElementById("loginUsername")?.value?.trim() || "";
  const password = document.getElementById("loginPassword")?.value || "";

  if (!username) {
    setLoginFeedback("error", "Kullanıcı adı gerekli.");
    document.getElementById("loginUsername")?.focus();
    resetLoginForm();
    return;
  }

  if (!password) {
    setLoginFeedback("error", "Şifre gerekli.");
    document.getElementById("loginPassword")?.focus();
    resetLoginForm();
    return;
  }

  setLoginSubmitting(true);
  setLoginFeedback("idle", "Giriş kontrol ediliyor...");

  try {
    const result = await loginWithGoogleSheet(username, password);

    if (!result?.success || !result?.user) {
      resetLoginForm();
      setLoginFeedback(
        "error",
        result?.message || "Kullanıcı adı veya şifre hatalı.",
      );
      document.getElementById("loginUsername")?.focus();
      return;
    }

    const nextUser = {
      id:
        result.user.id !== undefined && result.user.id !== null
          ? String(result.user.id)
          : null,
      playerId:
        result.user.playerId !== undefined &&
        result.user.playerId !== null &&
        result.user.playerId !== ""
          ? String(result.user.playerId)
          : result.user.kisiId !== undefined &&
              result.user.kisiId !== null &&
              result.user.kisiId !== ""
            ? String(result.user.kisiId)
            : null,
      kullaniciAdi: result.user.kullaniciAdi || "",
      adSoyad: result.user.adSoyad || result.user.name || "",
      rol: result.user.rol || "user",
      sessionStartedAt: new Date().toISOString(),
      connectedAt: new Date().toISOString(),
    };

    const role = nextUser.rol;

    state.settings.auth.isAuthenticated = true;
    state.settings.auth.role = role;
    setAuthenticatedUser(nextUser);

    setLoginFeedback(
      "success",
      role === "admin"
        ? "Admin girişi başarılı."
        : `${nextUser.adSoyad || nextUser.kullaniciAdi} olarak giriş yapıldı.`,
    );
    resetLoginForm();
    saveState(true);
    closeLoginOverlay();
    applyRolePermissions();
    startPresenceTracking();

    await runSessionHydrationWithFastOverlay({
      loadingMessage: "Kayıtlı veriler açılıyor, güncel bilgiler yükleniyor...",
    });
  } catch (error) {
    console.error("Login hatası:", error);
    resetLoginForm();
    setLoginFeedback("error", "Sunucu bağlantı hatası oluştu.");
    document.getElementById("loginUsername")?.focus();
  } finally {
    setLoginSubmitting(false);
  }
}

function closeLandscapeSidebar() {}

function updateNavSelection(tabName) {
  document
    .querySelectorAll(".nav-tab")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.tab === tabName),
    );
  document
    .querySelectorAll(".mobile-nav-btn")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.tab === tabName),
    );
  document
    .querySelectorAll(".mobile-admin-menu-item[data-tab]")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.tab === tabName),
    );
}

let predictionViewportRestoreToken = 0;

function isPredictionsTabActive() {
  return (state.settings.currentTab || "dashboard") === "predictions";
}

function getWindowScrollPosition() {
  return {
    x: window.pageXOffset || window.scrollX || 0,
    y: window.pageYOffset || window.scrollY || 0,
  };
}

function getPredictionViewportShell() {
  return (
    document.querySelector("#predictionsTable .predictions-scroll-shell") ||
    document.querySelector("#predictionsTable .mobile-prediction-list") ||
    document.querySelector("#predictionsTable")
  );
}

function capturePredictionViewport(options = {}) {
  if (!isPredictionsTabActive()) return null;

  const activeElement = document.activeElement;
  const shell = getPredictionViewportShell();
  const scrollPos = getWindowScrollPosition();
  const activeInput =
    activeElement && activeElement.matches?.('input[data-pred-role="input"]')
      ? activeElement
      : null;

  const focusId = Object.prototype.hasOwnProperty.call(options, "focusId")
    ? options.focusId
    : activeInput?.id ||
      `pred_home_${options.matchId || ""}_${options.playerId || ""}`;

  return {
    windowX: scrollPos.x,
    windowY: scrollPos.y,
    shellLeft: shell?.scrollLeft ?? 0,
    shellTop: shell?.scrollTop ?? 0,
    focusId,
    matchId: options.matchId || activeInput?.dataset?.matchId || "",
    playerId: options.playerId || activeInput?.dataset?.playerId || "",
    selectionStart:
      typeof activeInput?.selectionStart === "number"
        ? activeInput.selectionStart
        : null,
    selectionEnd:
      typeof activeInput?.selectionEnd === "number"
        ? activeInput.selectionEnd
        : null,
  };
}

function restorePredictionViewport(snapshot) {
  if (!snapshot || !isPredictionsTabActive()) return;

  const shell = getPredictionViewportShell();
  window.scrollTo(snapshot.windowX || 0, snapshot.windowY || 0);

  if (shell) {
    if (typeof snapshot.shellLeft === "number")
      shell.scrollLeft = snapshot.shellLeft;
    if (typeof snapshot.shellTop === "number")
      shell.scrollTop = snapshot.shellTop;
  }

  let focusTarget = null;

  if (snapshot.focusId) {
    focusTarget = document.getElementById(snapshot.focusId);
  }

  if (focusTarget && !focusTarget.disabled) {
    try {
      focusTarget.focus({ preventScroll: true });
    } catch (error) {
      focusTarget.focus();
    }

    if (
      typeof snapshot.selectionStart === "number" &&
      typeof snapshot.selectionEnd === "number" &&
      typeof focusTarget.setSelectionRange === "function"
    ) {
      try {
        focusTarget.setSelectionRange(
          snapshot.selectionStart,
          snapshot.selectionEnd,
        );
      } catch (error) {}
    }
  }
}

function schedulePredictionViewportRestore(snapshot) {
  if (!snapshot || !isPredictionsTabActive()) return;

  predictionViewportRestoreToken += 1;
  const token = predictionViewportRestoreToken;
  let frameCount = 0;

  const restoreStep = () => {
    if (token !== predictionViewportRestoreToken) return;
    restorePredictionViewport(snapshot);
    frameCount += 1;
    if (frameCount < 4) {
      requestAnimationFrame(restoreStep);
    }
  };

  requestAnimationFrame(restoreStep);
}
function simulateOutsideTapAfterPredictionSave() {
  let sink = document.getElementById("prediction-focus-sink");

  if (!sink) {
    sink = document.createElement("button");
    sink.id = "prediction-focus-sink";
    sink.type = "button";
    sink.tabIndex = -1;
    sink.setAttribute("aria-hidden", "true");
    sink.style.position = "fixed";
    sink.style.left = "0";
    sink.style.top = "0";
    sink.style.width = "1px";
    sink.style.height = "1px";
    sink.style.opacity = "0";
    sink.style.pointerEvents = "none";
    sink.style.padding = "0";
    sink.style.border = "0";
    document.body.appendChild(sink);
  }

  const active = document.activeElement;
  if (active && typeof active.blur === "function") {
    active.blur();
  }

  requestAnimationFrame(() => {
    try {
      sink.focus({ preventScroll: true });
    } catch (error) {
      sink.focus();
    }

    if (
      document.activeElement &&
      typeof document.activeElement.blur === "function"
    ) {
      document.activeElement.blur();
    }
  });
}
function applyRolePermissions() {
  const role = getCurrentRole();
  const authReady = isAuthenticated();
  document.body.dataset.role = role;
  document
    .querySelectorAll(".role-chip")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.role === role),
    );
  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden-by-role", role !== "admin");
  });

  const mobileAdminMenuBtn = document.getElementById("mobileAdminMenuBtn");
  const mobileBottomNav = document.getElementById("mobileBottomNav");
  if (mobileAdminMenuBtn) {
    mobileAdminMenuBtn.classList.toggle("hidden-by-role", role !== "admin");
  }
  mobileBottomNav?.classList.toggle("is-admin", role === "admin");
  if (role !== "admin") closeMobileAdminMenu();

  const currentTab = state.settings.currentTab || "dashboard";
  if (
    role !== "admin" &&
    ["players", "backup", "seasons", "weeks", "matches"].includes(currentTab)
  ) {
    switchTab("dashboard");
    return;
  }

  document
    .querySelectorAll(
      "#tab-seasons button, #tab-seasons input, #tab-seasons select, #tab-weeks button, #tab-weeks input, #tab-weeks select, #tab-matches button, #tab-matches input, #tab-matches select, #tab-players button, #tab-players input, #tab-players select, #tab-backup button, #tab-backup input, #tab-backup select",
    )
    .forEach((el) => {
      if (role === "admin" && authReady) {
        el.disabled = false;
        el.classList.remove("readonly-control");
        return;
      }
      el.disabled = true;
      el.classList.add("readonly-control");
    });

  document
    .querySelectorAll(
      "#tab-dashboard button, #tab-dashboard input, #tab-dashboard select, #tab-standings button, #tab-standings input, #tab-standings select, #tab-stats button, #tab-stats input, #tab-stats select",
    )
    .forEach((el) => {
      if (role === "admin" && authReady) {
        el.disabled = false;
        el.classList.remove("readonly-control");
        return;
      }
      const allow = [
        "dashboardSeasonSelect",
        "dashboardWeekSelect",
        "standingsSeasonSelect",
        "standingsWeekSelect",
        "statsSeasonSelect",
      ].includes(el.id);
      el.disabled = !allow;
      el.classList.toggle("readonly-control", !allow);
    });
}

function mobileMatchScore(match) {
  if (!match.played) return "Skor bekleniyor";
  return `${match.homeScore} - ${match.awayScore}`;
}

function renderMobileDashboardMatches(container, matches) {
  if (!matches.length) {
    container.innerHTML = createEmptyState("Bu haftada henüz maç yok.");
    return;
  }
  container.innerHTML = `<div class="mobile-scorecards">${matches
    .map((match) => {
      const badge = getMatchBadge(match);
      const visual = getMatchVisualState(match);
      return `
      <article class="mobile-scorecard ${match.played ? "played-row" : ""} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}">
        <div class="mobile-scorecard-top">
          <span class="badge ${badge.cls}">${badge.text}</span>
          <span class="small-meta">${formatDate(match.date)}</span>
        </div>
        <div class="mobile-scorecard-teams">
          <div class="mobile-team">${teamLogoHtml(match.homeTeam, match.seasonId)}<strong>${escapeHtml(match.homeTeam)}</strong></div>
          <div class="mobile-score-main">${mobileMatchScore(match)}</div>
          <div class="mobile-team mobile-team-away">${teamLogoHtml(match.awayTeam, match.seasonId)}<strong>${escapeHtml(match.awayTeam)}</strong></div>
        </div>
      </article>
    `;
    })
    .join("")}</div>`;
}

function bindPredictionActionElements(root = document) {
  const scope = root || document;

  scope.querySelectorAll('input[data-pred-role="input"]').forEach((input) => {
    input.oninput = (e) => {
      const target = e.currentTarget;
      const { matchId, playerId } = target.dataset || {};
      if (!matchId || !playerId) return;

      const isAwayInput = target.id === `pred_away_${matchId}_${playerId}`;

      const viewportSnapshot = capturePredictionViewport({
        matchId,
        playerId,
        focusId: isAwayInput ? null : target.id,
      });

      window.queuePredictionSave(matchId, playerId, false, viewportSnapshot);

      if (!isAwayInput) {
        schedulePredictionViewportRestore(viewportSnapshot);
      }
    };
  });

  scope
    .querySelectorAll('button[data-pred-role="save-btn"]')
    .forEach((button) => {
      button.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget;
        if (target.disabled) return false;
        const { matchId, playerId } = target.dataset || {};
        if (!matchId || !playerId) return false;
        window.queuePredictionSave(matchId, playerId, true);
        return false;
      };
      button.onpointerdown = (e) => {
        e.stopPropagation();
      };
    });

  scope
    .querySelectorAll('button[data-pred-role="delete-btn"]')
    .forEach((button) => {
      button.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget;
        if (target.disabled) return false;
        const { matchId, playerId } = target.dataset || {};
        if (!matchId || !playerId || !window.deletePredictionEntry)
          return false;
        await window.deletePredictionEntry(matchId, playerId);
        return false;
      };
      button.onpointerdown = (e) => {
        e.stopPropagation();
      };
    });
}

function renderMobilePredictions(container, matches) {
  if (!container) return;
  const currentPlayerId = getCurrentPlayerId();
  const players = getVisiblePlayersOrdered();

  container.innerHTML = `<div class="mobile-prediction-list">${matches
    .map((match) => {
      const locked = isMatchLocked(match);
      const lockedForUi = locked && getCurrentRole() !== "admin";
      const badge = getMatchBadge(match);
      const visual = getMatchVisualState(match);

      return `
      <article class="mobile-prediction-card premium-card ${match.played ? "played-row" : ""} ${locked ? "locked-match" : "open-match"} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}">
        <div class="mobile-prediction-header premium-header">
          <div class="mobile-prediction-match">${matchCell(match)}</div>
          <div class="mobile-prediction-subline premium-subline">
            <span class="badge ${badge.cls}">${badge.text}</span>
            <span class="small-meta premium-date">${formatDate(match.date)}</span>
            ${match.played ? `<span class="result-chip premium-result-chip">Gerçek skor: ${match.homeScore}-${match.awayScore}</span>` : locked ? `<span class="result-chip warning-chip premium-result-chip">Tahmin kapandı</span>` : `<span class="result-chip premium-result-chip soft-chip">Tahmin açık</span>`}
          </div>
        </div>
        <div class="mobile-user-predictions">${players
          .map((player) => {
            const pred = ensurePrediction(match.id, player.id);
            const hasPrediction = pred.homePred !== "" || pred.awayPred !== "";
            const canEdit = canEditPrediction(player.id, match.seasonId);
            const statusClass = hasPrediction
              ? "filled-prediction"
              : "empty-prediction";
            const lockedClass =
              lockedForUi || !canEdit
                ? "locked-cell locked-mobile-card"
                : "editable-cell";
            const ownClass =
              player.id === currentPlayerId ? "own-player-card" : "";
            const outcomeClass = getPredictionOutcomeClass(pred, match);
            const uiKey = getPredictionUiKey(match.id, player.id);
            const uiState = predictionUiState[uiKey] || "idle";
            const isSaving = uiState === "saving";
            const isOwnPlayer = player.id === currentPlayerId;
            const isAdmin = getCurrentRole() === "admin";

            const statusText = getPredictionBaseStatus(match.id, player.id);
            const showDeleteAction = hasPrediction || pred.remoteId || isSaving;
            const scoreDisplay =
              pred.homePred !== "" || pred.awayPred !== ""
                ? `${pred.homePred !== "" ? pred.homePred : "-"} - ${pred.awayPred !== "" ? pred.awayPred : "-"}`
                : "--";
            const showSaveAction =
              canEdit && shouldShowPredictionSaveAction(match.id, player.id);
            if (!isOwnPlayer && !isAdmin) {
              return `
              <div class="mobile-other-prediction premium-user-card compact-user-row ${pointLabel(pred.points)} ${outcomeClass} ${statusClass}">
                <div class="compact-user-main">
                  <strong>${escapeHtml(player.name)}</strong>
                  <span class="compact-score-pill">${scoreDisplay}</span>
                </div>
                <div class="compact-user-meta">
                  <span class="mini-points premium-points compact-points">${`${pred.points || 0} puan`}</span>
                  <div class="prediction-status-chip ${outcomeClass} compact-status" id="pred_status_${match.id}_${player.id}">
                    ${statusText}
                  </div>
                </div>
              </div>
            `;
            }

            return `
            <div class="mobile-user-prediction premium-user-card ${pointLabel(pred.points)} ${outcomeClass} ${statusClass} ${lockedClass} ${ownClass}">
              <div class="mobile-user-head premium-user-head">
                <strong>${escapeHtml(player.name)}${isOwnPlayer ? '<span class="own-pill">Sen</span>' : isAdmin ? '<span class="own-pill">Yönet</span>' : ""}</strong>
                <span class="mini-points premium-points">${locked ? "🔒 Kilitli" : `${pred.points || 0} puan`}</span>
              </div>

              <div class="score-inputs compact-inputs center-mode premium-score-inputs pred-score-row own-pred-score-row">
                <input
                  type="number"
                  min="0"
                  value="${pred.homePred}"
                  id="pred_home_${match.id}_${player.id}"
                  data-pred-role="input"
                  data-match-id="${match.id}"
                  data-player-id="${player.id}"
                  ${lockedForUi || !canEdit ? "disabled" : ""}                  oninput="window.queuePredictionSave && window.queuePredictionSave('${match.id}','${player.id}')"
                />
                <span class="premium-dash">-</span>
                <input
                  type="number"
                  min="0"
                  value="${pred.awayPred}"
                  id="pred_away_${match.id}_${player.id}"
                  data-pred-role="input"
                  data-match-id="${match.id}"
                  data-player-id="${player.id}"
                  ${lockedForUi || !canEdit ? "disabled" : ""}                  oninput="window.queuePredictionSave && window.queuePredictionSave('${match.id}','${player.id}')"
                />
              </div>

              ${lockedForUi ? `<div class="mobile-lock-warning">🔒 Tahmin kapandı</div>` : ""}
              <div class="pred-action-area own-pred-action-area">
                ${
                  canEdit
                    ? `
                  <div class="mobile-save-row pred-btn-slot prediction-button-row ${showSaveAction || showDeleteAction ? "" : "is-collapsed"}">
                    <button
                      class="prediction-mobile-save-btn ${showSaveAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_btn_${match.id}_${player.id}"
                      data-pred-role="save-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      ${lockedForUi ? "disabled" : ""}                      onclick="if(!this.disabled && window.queuePredictionSave){ event.preventDefault(); event.stopPropagation(); window.queuePredictionSave('${match.id}','${player.id}', true); } return false;"
                    >
                    ${lockedForUi ? "🔒 Kilitli" : getPredictionSaveLabel(match.id, player.id)}                    </button>
                    <button
                      class="prediction-mobile-save-btn danger prediction-delete-btn ${showDeleteAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_delete_${match.id}_${player.id}"
                      data-pred-role="delete-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      ${lockedForUi ? "disabled" : ""}
                      onclick="if(!this.disabled && window.deletePredictionEntry){ event.preventDefault(); event.stopPropagation(); window.deletePredictionEntry('${match.id}','${player.id}'); } return false;"
                    >
                      Sil
                    </button>
                  </div>
                `
                    : `<div class="pred-btn-slot"></div>`
                }

                <div class="pred-status-slot">
                  <div class="prediction-status-chip ${outcomeClass}" id="pred_status_${match.id}_${player.id}">
                    ${statusText}
                  </div>
                </div>
              </div>
            </div>
          `;
          })
          .join("")}</div>
      </article>
    `;
    })
    .join("")}</div>`;

  bindPredictionActionElements(container);
  saveState(true);
}

function standingsRowsMobile(rows, showPredictionCount = true, options = {}) {
  const leaderId = options.leaderId || null;
  return `<div class="mobile-standings-list">${rows
    .map(
      (row, i) => `
    <article class="mobile-standing-card ${i === 0 ? "leader-row" : ""} podium-${Math.min(i + 1, 4)} ${row.id === leaderId ? "weekly-leader-row" : ""}">
      <div class="mobile-standing-top">
        <span class="standing-rank">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}</span>
        <strong>${escapeHtml(row.name)}</strong>
        <span class="standing-total">${row.total} puan</span>
      </div>
      <div class="mobile-standing-stats">
        <span>Tam skor: ${row.exact}</span>
        <span>Yakın: ${row.resultOnly}</span>
        ${showPredictionCount ? `<span>Tahmin: ${row.predictionCount}</span>` : `<span>Hafta puanı: ${row.total}</span>`}
        ${row.id === leaderId ? `<span class="weekly-leader-pill">${options.weeklyMode ? "Haftalık lider" : "Lider"}</span>` : ""}
      </div>
    </article>`,
    )
    .join("")}</div>`;
}

function createInitialState() {
  return {
    seasons: [],
    teams: [],
    players: [],
    weeks: [],
    matches: [],
    predictions: [],
    settings: {
      activeSeasonId: null,
      activeWeekId: null,
      celebratedChampions: {},
      currentTab: "dashboard",
      predictionShareMode: false,
      predictionShareView: "pre",
      predictionShareCompact: true,
      predictionShareFadeEmpty: false,
    },
  };
}

function ensureDefaultSeason(stateObj) {
  if (!stateObj.settings) stateObj.settings = {};
  if (!Array.isArray(stateObj.seasons)) stateObj.seasons = [];
  if (stateObj.seasons.length && !stateObj.settings.activeSeasonId) {
    stateObj.settings.activeSeasonId = stateObj.seasons[0].id;
  }
}

function migrateLegacyState(parsed) {
  const next = createInitialState();
  if (parsed.seasons?.length) {
    return {
      ...next,
      ...parsed,
      settings: { ...next.settings, ...(parsed.settings || {}) },
    };
  }

  const legacy = {
    ...next,
    ...parsed,
    settings: { ...next.settings, ...(parsed.settings || {}) },
  };
  const seasonId = uid("season");
  legacy.seasons = [
    {
      id: seasonId,
      name: parsed?.seasonName || "Aktarılan Sezon",
      leagueName: parsed?.leagueName || "",
      migrated: true,
    },
  ];
  legacy.settings.activeSeasonId = seasonId;
  const teamNames = [
    ...new Set(
      [
        ...(parsed.matches || []).flatMap((m) => [m.homeTeam, m.awayTeam]),
      ].filter(Boolean),
    ),
  ];
  legacy.teams = teamNames.map((name) => ({
    id: uid("team"),
    seasonId,
    name,
    slug: DEFAULT_TEAM_SLUGS[name] || slugify(name),
  }));
  legacy.weeks = (parsed.weeks || []).map((w) => ({ ...w, seasonId }));
  legacy.matches = (parsed.matches || []).map((m) => ({ ...m, seasonId }));
  return legacy;
}

function loadState() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem("fikstur_tahmin_paneli_v2");
    if (!raw) {
      const fresh = createInitialState();
      ensureAuthState(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw);
    const migrated = migrateLegacyState(parsed);
    return migrated;
  } catch {
    const fallback = createInitialState();
    return fallback;
  }
}

let state = loadState();
ensureAuthState(state);
currentSessionUser = state.settings?.auth?.user || null;
if (currentSessionUser && !state.settings?.auth?.playerId) {
  const matchedPlayer = findPlayerForSessionUser(currentSessionUser);
  if (matchedPlayer) state.settings.auth.playerId = matchedPlayer.id;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getSeasonById(id) {
  return state.seasons.find((s) => s.id === id);
}
function getWeekById(id) {
  return state.weeks.find((w) => w.id === id);
}
function getPlayerById(id) {
  return state.players.find((p) => String(p.id) === String(id));
}
function getTeamById(id) {
  return state.teams.find((t) => t.id === id);
}
function getActiveSeasonId() {
  return state.settings.activeSeasonId || state.seasons[0]?.id || null;
}
function getWeeksBySeasonId(seasonId) {
  return state.weeks
    .filter((w) => w.seasonId === seasonId)
    .sort((a, b) => a.number - b.number);
}
function getMatchesByWeekId(weekId) {
  return state.matches
    .filter((m) => m.weekId === weekId)
    .sort(
      (a, b) =>
        (a.date || "").localeCompare(b.date || "") ||
        a.homeTeam.localeCompare(b.homeTeam, "tr"),
    );
}
function getApiSeasonLabel() {
  const season = getSeasonById(getActiveSeasonId());
  const weekInput = document.getElementById("weekApiSeasonText");
  const seasonInput = document.getElementById("apiSeasonText");
  return (
    weekInput?.value.trim() ||
    seasonInput?.value.trim() ||
    season?.name ||
    ""
  ).trim();
}

function clearLocalPredictionRecord(matchId, playerId) {
  const normalizedMatchId = normalizeEntityId(matchId);
  const normalizedPlayerId = normalizeEntityId(playerId);
  state.predictions = state.predictions.filter(
    (pred) =>
      !(
        normalizeEntityId(pred.matchId) === normalizedMatchId &&
        normalizeEntityId(pred.playerId) === normalizedPlayerId
      ),
  );
}
function getMatchesBySeasonId(seasonId) {
  return state.matches.filter((m) => m.seasonId === seasonId);
}
function getTeamsBySeasonId(seasonId) {
  return state.teams
    .filter((t) => t.seasonId === seasonId)
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}
function getPrediction(matchId, playerId) {
  const normalizedMatchId = normalizeEntityId(matchId);
  const normalizedPlayerId = normalizeEntityId(playerId);
  return state.predictions.find(
    (p) =>
      normalizeEntityId(p.matchId) === normalizedMatchId &&
      normalizeEntityId(p.playerId) === normalizedPlayerId,
  );
}

function ensureActiveSelections() {
  const activeSeasonId = getActiveSeasonId();
  if (!state.settings.activeSeasonId && activeSeasonId) {
    state.settings.activeSeasonId = activeSeasonId;
  }

  const seasonId = getActiveSeasonId();
  const seasonWeeks = getWeeksBySeasonId(seasonId);

  if (!seasonWeeks.length) {
    state.settings.activeWeekId = null;
    return;
  }

  const exists = seasonWeeks.some((w) => w.id === state.settings.activeWeekId);
  const preferredWeekId = getPreferredWeekIdForSeason(seasonId);

  if (!exists || !state.settings.activeWeekId) {
    state.settings.activeWeekId = preferredWeekId;
  }
}

async function setActiveSeason(seasonId) {
  state.settings.activeSeasonId = seasonId || null;
  state.settings.activeWeekId = getPreferredWeekIdForSeason(seasonId);
  saveState();
  renderAll();
  await syncOnlinePredictions({
    seasonId,
    weekId: state.settings.activeWeekId,
  });
}

async function setActiveWeek(weekId) {
  state.settings.activeWeekId = weekId || null;
  const week = getWeekById(weekId);
  if (week?.seasonId) state.settings.activeSeasonId = week.seasonId;
  saveState();
  renderAll();
  await syncOnlinePredictions({
    seasonId: state.settings.activeSeasonId,
    weekId,
  });
}

function teamStyle(name) {
  const index = Math.max(0, DEFAULT_TEAM_NAMES.indexOf(name));
  const [a, b] =
    TEAM_COLORS[
      index >= 0
        ? index % TEAM_COLORS.length
        : Math.abs(name.length) % TEAM_COLORS.length
    ];
  return `background: linear-gradient(135deg, ${a}, ${b});`;
}

function teamInitials(name) {
  return String(name)
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getTeamMetaByName(name, seasonId = getActiveSeasonId()) {
  return (
    getTeamsBySeasonId(seasonId).find((t) => t.name === name) ||
    state.teams.find((t) => t.name === name) || {
      name,
      slug: DEFAULT_TEAM_SLUGS[name] || slugify(name),
    }
  );
}

const remoteTeamLogoUrlCache = new Map();
const remoteTeamLogoPromiseCache = new Map();

const TEAM_REMOTE_SEARCH_ALIASES = {
  Başakşehir: ["Istanbul Basaksehir", "Basaksehir"],
  "İstanbul Başakşehir": ["Istanbul Basaksehir", "Basaksehir"],
  Beşiktaş: ["Besiktas", "Besiktas JK"],
  "Çaykur Rizespor": ["Rizespor", "Caykur Rizespor"],
  Eyüpspor: ["Eyupspor"],
  "Fatih Karagümrük": ["Fatih Karagumruk"],
  "Fatih Karagümrük SK": ["Fatih Karagumruk"],
  Fenerbahçe: ["Fenerbahce"],
  Galatasaray: ["Galatasaray SK"],
  "Gaziantep FK": ["Gaziantep", "Gaziantep FK"],
  Gençlerbirliği: ["Genclerbirligi"],
  Göztepe: ["Goztepe", "Goztepe Izmir"],
  İstanbulspor: ["Istanbulspor"],
  Kasımpaşa: ["Kasimpasa"],
  Kocaelispor: ["Kocaelispor"],
  Sivasspor: ["Sivasspor"],
  Trabzonspor: ["Trabzonspor"],
};

function normalizeTeamSearchToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\b(sk|jk|fk|as|a s|spor kulubu|spor|kulubu|club|fc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getTeamRemoteSearchNames(teamName) {
  const aliases = TEAM_REMOTE_SEARCH_ALIASES[teamName] || [];
  return [
    ...new Set(
      [
        teamName,
        ...aliases,
        String(teamName || "")
          .replace(/İ/g, "I")
          .replace(/ı/g, "i"),
        String(teamName || "")
          .replace(/FK$/i, "")
          .trim(),
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ];
}

async function fetchRemoteTeamLogoUrl(teamName) {
  const cacheKey = normalizeTeamSearchToken(teamName);
  if (!cacheKey) return "";
  if (remoteTeamLogoUrlCache.has(cacheKey))
    return remoteTeamLogoUrlCache.get(cacheKey) || "";
  if (remoteTeamLogoPromiseCache.has(cacheKey))
    return remoteTeamLogoPromiseCache.get(cacheKey);

  const request = (async () => {
    const wanted = normalizeTeamSearchToken(teamName);
    for (const searchName of getTeamRemoteSearchNames(teamName)) {
      try {
        const response = await fetch(
          `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(searchName)}`,
        );
        if (!response.ok) continue;
        const payload = await response.json();
        const teams = Array.isArray(payload?.teams) ? payload.teams : [];
        const matched =
          teams.find((item) => {
            const hay = [
              item?.strTeam,
              item?.strTeamShort,
              item?.strAlternate,
              item?.strLeague,
            ]
              .map(normalizeTeamSearchToken)
              .join(" ");
            return (
              hay.includes(wanted) ||
              wanted.includes(normalizeTeamSearchToken(item?.strTeam))
            );
          }) || teams[0];
        const logoUrl =
          matched?.strBadge || matched?.strTeamBadge || matched?.strLogo || "";
        if (logoUrl) {
          remoteTeamLogoUrlCache.set(cacheKey, logoUrl);
          return logoUrl;
        }
      } catch (error) {
        console.warn("Uzak logo aranamadı:", teamName, error);
      }
    }
    remoteTeamLogoUrlCache.set(cacheKey, "");
    return "";
  })();

  remoteTeamLogoPromiseCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    remoteTeamLogoPromiseCache.delete(cacheKey);
  }
}

async function hydrateTeamLogoImage(img) {
  if (
    !img ||
    img.dataset.remoteLoading === "1" ||
    img.dataset.remoteResolved === "1"
  )
    return;
  img.dataset.remoteLoading = "1";
  const fallback = img.nextElementSibling;
  try {
    const remoteUrl = await fetchRemoteTeamLogoUrl(
      img.dataset.teamName || img.alt || "",
    );
    if (remoteUrl) {
      img.src = remoteUrl;
      img.style.display = "block";
      img.dataset.remoteResolved = "1";
      if (fallback) fallback.style.display = "none";
      return;
    }
  } catch (error) {
    console.warn("Logo yükleme hatası:", error);
  } finally {
    img.dataset.remoteLoading = "0";
  }
  img.dataset.remoteResolved = "1";
}

function handleTeamLogoError(img) {
  if (!img) return;
  img.style.display = "none";
  img.dataset.logoFailed = "1";
  const fallback = img.nextElementSibling;
  if (fallback) fallback.style.display = "grid";
  hydrateTeamLogoImage(img);
}

function hydrateTeamLogosIn(container = document) {
  container.querySelectorAll?.(".team-logo-img").forEach((img) => {
    if (img.complete && img.naturalWidth > 0) return;
    if (img.dataset.logoFailed === "1") {
      hydrateTeamLogoImage(img);
    }
  });
}

function teamLogoHtml(teamName, seasonId, extraClass = "") {
  const team = getTeamMetaByName(teamName, seasonId);
  const slug = team.slug || slugify(teamName);
  const localSrc = `logos/${slug}.png`;
  const explicitRemote =
    team.logoUrl || team.logo || team.badge || team.image || "";
  return `
    <span class="team-logo-wrap ${extraClass}">
      <img class="team-logo-img" src="${explicitRemote || localSrc}" data-local-src="${localSrc}" data-team-name="${escapeHtml(teamName)}" alt="${escapeHtml(teamName)} logosu" onerror="window.handleTeamLogoError && window.handleTeamLogoError(this);" />
      <span class="team-logo fallback-logo" style="display:none; ${teamStyle(teamName)}">${teamInitials(teamName)}</span>
    </span>
  `;
}

function formatDate(date) {
  if (!date) return "Tarih yok";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "Tarih yok";
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createEmptyState(message = "Burada henüz gösterilecek veri yok.") {
  return `<div class="empty-state">${message}</div>`;
}

function calcOutcome(home, away) {
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

function calcPoints(predHome, predAway, realHome, realAway) {
  if (
    [predHome, predAway, realHome, realAway].some(
      (v) => v === null || v === "" || Number.isNaN(Number(v)),
    )
  )
    return 0;
  predHome = Number(predHome);
  predAway = Number(predAway);
  realHome = Number(realHome);
  realAway = Number(realAway);
  if (predHome === realHome && predAway === realAway) return 3;
  return calcOutcome(predHome, predAway) === calcOutcome(realHome, realAway)
    ? 1
    : 0;
}

function getWeekPredictionLockTimestamp(weekId) {
  if (!weekId) return null;
  const matches = getMatchesByWeekId(weekId);
  if (!matches.length) return null;

  const datedMatches = matches
    .map((item) => new Date(item.date).getTime())
    .filter((ts) => !Number.isNaN(ts))
    .sort((a, b) => a - b);

  if (!datedMatches.length) return null;
  return datedMatches[0] - 10 * 60 * 1000;
}

let predictionLockTimerInterval = null;
let predictionLockRerenderPending = false;

function clearPredictionLockTimer() {
  if (predictionLockTimerInterval) {
    clearInterval(predictionLockTimerInterval);
    predictionLockTimerInterval = null;
  }
}

function formatPredictionLockCountdown(diffMs) {
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}g`);
  parts.push(`${String(hours).padStart(2, "0")}sa`);
  parts.push(`${String(minutes).padStart(2, "0")}dk`);
  parts.push(`${String(seconds).padStart(2, "0")}sn`);
  return parts.join(" ");
}

function renderPredictionLockBanner(weekId) {
  const banner = document.getElementById("predictionLockBanner");
  if (!banner) return;

  clearPredictionLockTimer();

  if (!weekId) {
    banner.className = "prediction-lock-banner is-hidden";
    banner.innerHTML = "";
    return;
  }

  const lockTs = getWeekPredictionLockTimestamp(weekId);
  if (lockTs === null) {
    banner.className = "prediction-lock-banner is-hidden";
    banner.innerHTML = "";
    return;
  }

  const isAdmin = getCurrentRole() === "admin";

  const updateBanner = () => {
    const diff = lockTs - Date.now();

    if (diff <= 0) {
      if (isAdmin) {
        banner.className = "prediction-lock-banner admin";
        banner.innerHTML =
          "<strong>🔓 Admin modu açık</strong><span>Tahmin süresi kullanıcılar için doldu. Admin olarak düzenlemeye devam edebilirsin.</span>";
      } else {
        banner.className = "prediction-lock-banner closed";
        banner.innerHTML =
          "<strong>🔒 Tahminler kilitlendi</strong><span>Bu hafta için yeni tahmin ve silme işlemleri kapalı.</span>";
      }
      return;
    }

    const countdown = formatPredictionLockCountdown(diff);
    const toneClass = diff <= 60 * 60 * 1000 ? "warning" : "open";
    banner.className = `prediction-lock-banner ${isAdmin ? "admin" : toneClass}`;

    if (isAdmin) {
      banner.innerHTML = `<strong>🔓 Admin görünümü · ${countdown}</strong><span>Kullanıcılar için haftalık kilit bu sürenin sonunda devreye girer.</span>`;
      return;
    }

    banner.innerHTML = `<strong>⏳ Tahmin vermek için kalan süre: ${countdown}</strong><span>Haftanın ilk maçına 10 dk kala tüm tahminler otomatik kilitlenir.</span>`;
  };

  updateBanner();
  predictionLockTimerInterval = setInterval(updateBanner, 1000);
}

function isMatchLocked(match) {
  if (getCurrentRole() === "admin") return false;
  if (match.played) return true;

  const weekLockTs = getWeekPredictionLockTimestamp(match.weekId);
  if (weekLockTs !== null) return Date.now() >= weekLockTs;

  if (!match.date) return false;
  const ts = new Date(match.date).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() >= ts;
}

function ensurePrediction(matchId, playerId) {
  const normalizedMatchId = normalizeEntityId(matchId);
  const normalizedPlayerId = normalizeEntityId(playerId);
  let pred = getPrediction(normalizedMatchId, normalizedPlayerId);
  if (!pred) {
    pred = {
      id: uid("pred"),
      remoteId: null,
      matchId: normalizedMatchId,
      playerId: normalizedPlayerId,
      homePred: "",
      awayPred: "",
      points: 0,
    };
    state.predictions.push(pred);
  }
  return pred;
}

function pointLabel(points) {
  if (points === 3) return "exact";
  if (points === 1) return "close";
  return "none";
}

function getWeekNumberById(weekId) {
  return getWeekById(weekId)?.number || 0;
}
function isWeekCompleted(weekId) {
  const matches = getMatchesByWeekId(weekId);
  if (!matches.length) return false;
  return matches.every((match) => match.played);
}

function getPreferredWeekIdForSeason(seasonId) {
  const weeks = getWeeksBySeasonId(seasonId).sort(
    (a, b) => Number(a.number) - Number(b.number),
  );

  if (!weeks.length) return null;

  const firstIncompleteWeek = weeks.find((week) => !isWeekCompleted(week.id));
  if (firstIncompleteWeek) return firstIncompleteWeek.id;

  return weeks[weeks.length - 1].id;
}
function ensureWeekForSeason(seasonId, weekNumber) {
  if (!weekNumber) return null;
  let week = getWeeksBySeasonId(seasonId).find(
    (w) => Number(w.number) === Number(weekNumber),
  );
  if (!week) {
    week = {
      id: uid("week"),
      seasonId,
      number: Number(weekNumber),
      status: "hazirlaniyor",
    };
    state.weeks.push(week);
  }
  return week;
}

function isPostponedStatus(statusText = "") {
  const value = String(statusText || "").toLowerCase();
  return ["postponed", "delayed", "deferred", "suspended"].some((token) =>
    value.includes(token),
  );
}

function getMatchVisualState(match) {
  if (match.played && match.wasPostponed) return "played-postponed";
  if (match.played) return "played";
  if (match.postponed) return "postponed";
  const statusText = String(match.statusText || "").toLowerCase();
  if (statusText.includes("live") || statusText.includes("in play"))
    return "live";
  if (isMatchLocked(match)) return "locked";
  return "waiting";
}

function getMatchBadge(match) {
  const visual = getMatchVisualState(match);
  if (visual === "played-postponed")
    return { text: "Ertelendi / Oynandı", cls: "info" };
  if (visual === "played") return { text: "Bitti", cls: "" };
  if (visual === "postponed") return { text: "Ertelendi", cls: "warn" };
  if (visual === "live") return { text: "Canlı", cls: "red" };
  if (visual === "locked") return { text: "🔒 Kilitli", cls: "red" };
  return { text: "Bekliyor", cls: "warn" };
}

function recalculateAllPoints() {
  state.predictions = state.predictions.map((pred) => {
    const match = state.matches.find((m) => m.id === pred.matchId);
    const points =
      match && match.played
        ? calcPoints(
            pred.homePred,
            pred.awayPred,
            match.homeScore,
            match.awayScore,
          )
        : 0;
    return { ...pred, points };
  });
}

function getGeneralStandings(seasonId = getActiveSeasonId()) {
  const matchIds = getMatchesBySeasonId(seasonId).map((m) => m.id);

  return state.players
    .filter((player) => getPlayerRole(player) !== "admin")
    .map((player) => {
      const preds = state.predictions.filter(
        (p) => p.playerId === player.id && matchIds.includes(p.matchId),
      );

      const predictionCount = preds.filter(
        (p) => p.homePred !== "" && p.awayPred !== "",
      ).length;

      return {
        id: player.id,
        name: player.name,
        total: preds.reduce((sum, p) => sum + (p.points || 0), 0),
        exact: preds.filter((p) => p.points === 3).length,
        resultOnly: preds.filter((p) => p.points === 1).length,
        predictionCount,
      };
    })
    .filter((player) => player.predictionCount > 0)
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.exact - a.exact ||
        b.resultOnly - a.resultOnly ||
        a.name.localeCompare(b.name, "tr"),
    );
}
function getWeeklyStandings(weekId) {
  const matchIds = getMatchesByWeekId(weekId).map((m) => m.id);

  return state.players
    .filter((player) => getPlayerRole(player) !== "admin")
    .map((player) => {
      const preds = state.predictions.filter(
        (p) => p.playerId === player.id && matchIds.includes(p.matchId),
      );

      const predictionCount = preds.filter(
        (p) => p.homePred !== "" && p.awayPred !== "",
      ).length;

      return {
        id: player.id,
        name: player.name,
        total: preds.reduce((sum, p) => sum + (p.points || 0), 0),
        exact: preds.filter((p) => p.points === 3).length,
        resultOnly: preds.filter((p) => p.points === 1).length,
        predictionCount,
      };
    })
    .filter((player) => player.predictionCount > 0)
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.exact - a.exact ||
        b.resultOnly - a.resultOnly ||
        a.name.localeCompare(b.name, "tr"),
    );
}

function countMissingPredictions(weekId) {
  let count = 0;
  getMatchesByWeekId(weekId).forEach((match) => {
    state.players.forEach((player) => {
      const pred = getPrediction(match.id, player.id);
      if (!pred || pred.homePred === "" || pred.awayPred === "") count += 1;
    });
  });
  return count;
}

function getSeasonInsights(seasonId = getActiveSeasonId()) {
  const standings = getGeneralStandings(seasonId);
  const matches = getMatchesBySeasonId(seasonId);
  const playedMatches = matches.filter((m) => m.played);
  const allPreds = state.predictions.filter((p) =>
    matches.some((m) => m.id === p.matchId),
  );
  const bestExact = standings[0]
    ? [...standings].sort((a, b) => b.exact - a.exact || b.total - a.total)[0]
    : null;
  const bestResult = standings[0]
    ? [...standings].sort(
        (a, b) => b.resultOnly - a.resultOnly || b.total - a.total,
      )[0]
    : null;
  const mostPredictions = standings[0]
    ? [...standings].sort(
        (a, b) => b.predictionCount - a.predictionCount || b.total - a.total,
      )[0]
    : null;
  const averagePoints = allPreds.length
    ? allPreds.reduce((sum, p) => sum + (p.points || 0), 0) / allPreds.length
    : 0;
  return {
    standings,
    totalMatches: matches.length,
    playedMatches: playedMatches.length,
    averagePoints: averagePoints.toFixed(2),
    bestExact,
    bestResult,
    mostPredictions,
  };
}

function getChampion(seasonId = getActiveSeasonId()) {
  const seasonMatches = getMatchesBySeasonId(seasonId);
  if (!seasonMatches.length || seasonMatches.some((m) => !m.played))
    return null;
  return getGeneralStandings(seasonId)[0] || null;
}

function renderSeasonOptions(select, includePlaceholder = false) {
  const seasons = [...state.seasons].sort((a, b) =>
    a.name.localeCompare(b.name, "tr"),
  );
  select.innerHTML = includePlaceholder
    ? '<option value="">Sezon seç</option>'
    : "";
  seasons.forEach((season) => {
    const selected = season.id === getActiveSeasonId() ? "selected" : "";
    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${season.id}" ${selected}>${escapeHtml(season.name)}</option>`,
    );
  });
}

function renderWeekOptions(select, seasonId, includePlaceholder = false) {
  const weeks = getWeeksBySeasonId(seasonId).sort(
    (a, b) => Number(a.number) - Number(b.number),
  );
  const preferredWeekId = getPreferredWeekIdForSeason(seasonId);

  select.innerHTML = includePlaceholder
    ? '<option value="">Hafta seç</option>'
    : "";

  weeks.forEach((week) => {
    const selected = week.id === state.settings.activeWeekId ? "selected" : "";
    const completedMark = isWeekCompleted(week.id) ? " ✅" : "";
    const currentMark = week.id === preferredWeekId ? " 🟢" : "";

    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${week.id}" ${selected}>${week.number}. Hafta${completedMark}${currentMark}</option>`,
    );
  });
}

function renderTeamOptions(select, seasonId, includePlaceholder = true) {
  const teams = getTeamsBySeasonId(seasonId);
  select.innerHTML = includePlaceholder
    ? '<option value="">Takım seç</option>'
    : "";
  teams.forEach((team) => {
    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeHtml(team.name)}">${escapeHtml(team.name)}</option>`,
    );
  });
}

function renderSelects() {
  const seasonSelectIds = [
    "dashboardSeasonSelect",
    "seasonManagerSelect",
    "weekSeasonSelect",
    "matchSeasonSelect",
    "predictionSeasonSelect",
    "standingsSeasonSelect",
    "statsSeasonSelect",
  ];
  seasonSelectIds.forEach((id) =>
    renderSeasonOptions(document.getElementById(id), false),
  );
  const activeSeasonId = getActiveSeasonId();
  [
    "dashboardWeekSelect",
    "weekActiveSelect",
    "matchWeekSelect",
    "matchesFilterWeek",
    "predictionWeekSelect",
    "standingsWeekSelect",
  ].forEach((id) =>
    renderWeekOptions(document.getElementById(id), activeSeasonId, false),
  );
  renderTeamOptions(document.getElementById("homeTeam"), activeSeasonId, true);
  renderTeamOptions(document.getElementById("awayTeam"), activeSeasonId, true);
}

function buildMatchMetaHtml(match, options = {}) {
  const { alwaysShowStatus = false, extraClass = "" } = options;
  const locked = isMatchLocked(match);
  const badge = getMatchBadge(match);
  const resultHtml = match.played
    ? `<div class="result-chip">Gerçek skor: ${match.homeScore}-${match.awayScore}</div>`
    : locked
      ? `<div class="result-chip warning-chip">Tahmin kapandı</div>`
      : alwaysShowStatus
        ? `<div class="result-chip soft-chip">Tahmin açık</div>`
        : "";

  return `
  <div class="match-meta-stack ${extraClass}">
  <div class="match-meta-one-line">
    <span class="small-meta match-date-line">${formatDate(match.date)}</span>
    <span class="badge ${badge.cls}">${badge.text}</span>
    ${resultHtml}
  </div>
</div>
  `;
}

function matchCell(match, options = {}) {
  const visual = getMatchVisualState(match);
  const {
    showMeta = false,
    metaClass = "",
    alwaysShowStatus = false,
  } = options;
  return `
    <div class="fixture-cell ${visual === "postponed" ? "fixture-postponed" : visual === "played-postponed" ? "fixture-rescheduled-played" : ""}">
      <div class="team-inline home-team">
        ${teamLogoHtml(match.homeTeam, match.seasonId)}
        <span class="team-name" title="${escapeHtml(match.homeTeam)}">${escapeHtml(match.homeTeam)}</span>
      </div>
      <span class="versus-tag">-</span>
      <div class="team-inline away-team">
        ${teamLogoHtml(match.awayTeam, match.seasonId)}
        <span class="team-name" title="${escapeHtml(match.awayTeam)}">${escapeHtml(match.awayTeam)}</span>
      </div>
    </div>
    ${showMeta ? buildMatchMetaHtml(match, { extraClass: metaClass, alwaysShowStatus }) : ""}
  `;
}

function renderDashboardSyncCard() {
  const season = getSeasonById(getActiveSeasonId());
  const week = getWeekById(state.settings.activeWeekId);
  const seasonBadge = document.getElementById("dashboardActiveSeasonBadge");
  const weekBadge = document.getElementById("dashboardActiveWeekBadge");
  const status = document.getElementById("dashboardSyncStatus");
  if (seasonBadge)
    seasonBadge.textContent = `Aktif sezon: ${season?.name || "-"}`;
  if (weekBadge)
    weekBadge.textContent = `Aktif hafta: ${week ? `${week.number}. Hafta` : "-"}`;
  if (status && isFirebaseReady()) {
    status.textContent = `Veri kaynağı: ${getOnlineSourceLabel()} • ${getSyncSummaryText()}`;
  }
}

function buildFirebaseAdminSummary() {
  const activeSeasonId = getActiveSeasonId();
  const activeWeekId = state.settings.activeWeekId;
  const activeWeekMatches = activeWeekId
    ? getMatchesByWeekId(activeWeekId)
    : [];
  const activeWeekMatchIds = new Set(activeWeekMatches.map((item) => item.id));
  const activeWeekPredictions = state.predictions.filter((item) =>
    activeWeekMatchIds.has(item.matchId),
  );
  const lastPrediction =
    [...state.predictions]
      .filter((item) => item.updatedAt || item.remoteId || item.id)
      .sort(
        (a, b) =>
          new Date(b.updatedAt || 0).getTime() -
          new Date(a.updatedAt || 0).getTime(),
      )[0] || null;

  return {
    source: getOnlineSourceLabel(),
    playerCount: state.players.length,
    seasonCount: state.seasons.length,
    weekCount: activeSeasonId ? getWeeksBySeasonId(activeSeasonId).length : 0,
    matchCount: state.matches.length,
    activeWeekMatchCount: activeWeekMatches.length,
    predictionCount: state.predictions.filter(
      (item) => item.homePred !== "" && item.awayPred !== "",
    ).length,
    activeWeekPredictionCount: activeWeekPredictions.filter(
      (item) => item.homePred !== "" && item.awayPred !== "",
    ).length,
    queueCount: getPendingPredictionQueue().length,
    lastPrediction,
  };
}

function renderFirebaseAdminPanel() {
  const panel = document.getElementById("firebaseAdminPanel");
  if (!panel) return;

  if (!isAuthenticated() || getCurrentRole() !== "admin") {
    panel.innerHTML = "";
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");

  const summary = buildFirebaseAdminSummary();

  panel.innerHTML = `
    <section class="card firebase-admin-card collapsible-card is-open" id="firebaseAdminCard">
      <div class="card-header firebase-admin-head collapsible-card-header">
        <div>
          <h3>Firebase Yönetim Özeti</h3>
          <div class="small-meta">Canlı veri özeti ve hızlı kontrol ekranı</div>
        </div>
        <div class="inline-actions wrap-actions">
          <button type="button" class="secondary small" id="firebaseAdminRefreshBtn" onclick="refreshFirebaseAdminPanel(this)">Yenile</button>
          <button type="button" class="secondary small" id="firebaseAdminTestBtn" onclick="testFirebaseAdminConnection(this)">Bağlantı Testi</button>
          <button type="button" class="secondary card-collapse-btn" id="firebaseAdminToggleBtn" onclick="toggleFirebaseAdminCard()" aria-expanded="true" aria-controls="firebaseAdminCardBody" title="Daralt / genişlet"><span class="collapse-arrow" aria-hidden="true">⌄</span></button>
        </div>
      </div>
      <div class="collapsible-card-body" id="firebaseAdminCardBody">
      <div class="firebase-admin-stat-grid">
        <div class="firebase-admin-stat"><span>Kaynak</span><strong>${escapeHtml(summary.source)}</strong></div>
        <div class="firebase-admin-stat"><span>Kullanıcı</span><strong>${summary.playerCount}</strong></div>
        <div class="firebase-admin-stat"><span>Toplam maç</span><strong>${summary.matchCount}</strong></div>
        <div class="firebase-admin-stat"><span>Aktif hafta maç</span><strong>${summary.activeWeekMatchCount}</strong></div>
        <div class="firebase-admin-stat"><span>Toplam tahmin</span><strong>${summary.predictionCount}</strong></div>
        <div class="firebase-admin-stat"><span>Aktif hafta tahmin</span><strong>${summary.activeWeekPredictionCount}</strong></div>
        <div class="firebase-admin-stat"><span>Bekleyen sıra</span><strong>${summary.queueCount}</strong></div>
        <div class="firebase-admin-stat"><span>Aktif sezon hafta</span><strong>${summary.weekCount}</strong></div>
      </div>

      <div class="status-note firebase-admin-status" id="firebaseAdminPanelStatus">Son tahmin: ${summary.lastPrediction ? formatAdminPanelDateTime(summary.lastPrediction.updatedAt) : "Henüz yok"}</div>
      <div class="firebase-admin-focus-card">
        <div class="firebase-admin-focus-head">
          <div>
            <div class="firebase-admin-focus-title">Kişi oturumları artık Kişiler sayfasında</div>
            <div class="small-meta">Online / offline ve son giriş bilgilerini kartların içinde canlı olarak takip edebilirsin.</div>
          </div>
          <button type="button" class="secondary small" onclick="switchTab('players')">Kişiler sayfasına git</button>
        </div>
      </div>
      </div>
    </section>
  `;
}

async function refreshFirebaseAdminPanel(buttonOrEvent) {
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const status = document.getElementById("firebaseAdminPanelStatus");
  setAsyncButtonState(actionButton, "loading", { loading: "Yenileniyor..." });
  if (status)
    status.textContent = `${getOnlineSourceLabel()} verileri yenileniyor...`;
  try {
    await hydrateFromFirebaseRealtime("manuel");
    renderFirebaseAdminPanel();
    bindAdminPanelTableScroll();
    if (status)
      status.textContent = `${getOnlineSourceLabel()} verileri güncellendi • ${formatAdminPanelDateTime(new Date().toISOString())}`;
    setAsyncButtonState(actionButton, "success", { success: "Hazır" });
  } catch (error) {
    if (status) status.textContent = error?.message || "Panel yenilenemedi.";
    setAsyncButtonState(actionButton, "error", { error: "Hata" });
  }
}

async function testFirebaseAdminConnection(buttonOrEvent) {
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const status = document.getElementById("firebaseAdminPanelStatus");
  setAsyncButtonState(actionButton, "loading", { loading: "Test ediliyor..." });
  try {
    const result = await runFirebaseConnectionTest();
    if (status)
      status.textContent = `Bağlantı başarılı • ${formatAdminPanelDateTime(result.timestamp)}`;
    showAlert("Firebase bağlantısı başarılı.", {
      title: "Bağlantı Testi",
      type: "success",
    });
    setAsyncButtonState(actionButton, "success", { success: "Başarılı" });
  } catch (error) {
    if (status)
      status.textContent = error?.message || "Bağlantı testi başarısız.";
    showAlert(error?.message || "Firebase bağlantı testi başarısız.", {
      title: "Bağlantı Hatası",
      type: "warning",
    });
    setAsyncButtonState(actionButton, "error", { error: "Hata" });
  }
}

async function syncDashboardWeek() {
  const season = getSeasonById(getActiveSeasonId());
  const week = getWeekById(state.settings.activeWeekId);
  const status = document.getElementById("dashboardSyncStatus");
  if (!season || !week)
    return showAlert("Önce aktif sezon ve aktif hafta seçmelisin.", {
      title: "Eksik seçim",
      type: "warning",
    });
  if (status)
    status.textContent = `${season.name} / ${week.number}. hafta için seçili hafta güncellemesi başlatıldı...`;
  recordAdminSyncActivity({
    lastAction: `${season.name} / ${week.number}. hafta güncellemesi başladı...`,
  });
  try {
    await syncSelectedWeekFromApi();
    const weekStatus =
      document.getElementById("weekApiStatus")?.textContent ||
      "Aktif hafta güncellendi.";
    if (status) status.textContent = `${weekStatus} • ${getSyncSummaryText()}`;
    recordAdminSyncActivity({
      lastAction: `${season.name} / ${week.number}. hafta API'den güncellendi.`,
      success: true,
    });
  } catch (error) {
    if (status)
      status.textContent = `Akıllı hafta güncelleme hatası: ${error.message}`;
    recordAdminSyncActivity({
      lastAction: "Akıllı hafta güncellemesi başarısız oldu.",
      lastError: error.message,
    });
  }
}

async function syncDashboardSeason() {
  const season = getSeasonById(getActiveSeasonId());
  const status = document.getElementById("dashboardSyncStatus");
  if (!season)
    return showAlert("Önce aktif sezon seçmelisin.", {
      title: "Eksik seçim",
      type: "warning",
    });
  if (status)
    status.textContent = `${season.name} sezonu için API'den veri çekiliyor...`;
  recordAdminSyncActivity({
    lastAction: `${season.name} sezon güncellemesi başladı...`,
  });
  try {
    await importFixturesFromApi(true);
    const apiStatus =
      document.getElementById("apiStatus")?.textContent || "Sezon güncellendi.";
    if (status) status.textContent = `${apiStatus} • ${getSyncSummaryText()}`;
    recordAdminSyncActivity({
      lastAction: `${season.name} sezonu API'den güncellendi.`,
      success: true,
    });
  } catch (error) {
    if (status)
      status.textContent = `Akıllı sezon güncelleme hatası: ${error.message}`;
    recordAdminSyncActivity({
      lastAction: "Akıllı sezon güncellemesi başarısız oldu.",
      lastError: error.message,
    });
  }
}

function renderStats() {
  const activeSeasonId = getActiveSeasonId();
  const activeWeekId = state.settings.activeWeekId;
  const matches = activeWeekId ? getMatchesByWeekId(activeWeekId) : [];
  const season = getSeasonById(activeSeasonId);
  const leader = getGeneralStandings(activeSeasonId)[0];
  const cards = [
    { label: "Aktif Sezon", value: escapeHtml(season?.name || "-") },
    { label: "Kişi Sayısı", value: String(getVisiblePlayersOrdered().length) },
    { label: "Haftadaki Maç", value: String(matches.length) },
    {
      label: "Oynanmış Maç",
      value: String(matches.filter((m) => m.played).length),
    },
    {
      label: "Eksik Tahmin",
      value: String(activeWeekId ? countMissingPredictions(activeWeekId) : 0),
    },
    {
      label: "Lider",
      value: leader
        ? `${escapeHtml(leader.name)} (${leader.total})<span class="leader-badge">👑 1.</span>`
        : "-",
    },
  ];
  document.getElementById("statsGrid").innerHTML = cards
    .map(
      ({ label, value }) => `
    <div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>
  `,
    )
    .join("");

  if (leader && previousLeaderName && previousLeaderName !== leader.name)
    showLeaderToast(`${leader.name} liderliği aldı!`);
  previousLeaderName = leader?.name || null;
}

function renderPlayers() {
  const container = document.getElementById("playersList");
  if (!state.players.length) {
    container.innerHTML = createEmptyState("Henüz kişi eklenmedi.");
    return;
  }

  const seasonCards = [...state.seasons].sort((a, b) =>
    b.name.localeCompare(a.name, "tr"),
  );

  container.innerHTML = `
    <div class="players-premium-grid">
      ${state.players
        .map((player) => {
          const isAdminUser = getPlayerRole(player) === "admin";
          const seasonStates = getPlayerSeasonStateMap(player);
          const predictionCount = state.predictions.filter(
            (p) =>
              p.playerId === player.id &&
              p.homePred !== "" &&
              p.awayPred !== "",
          ).length;

          const seasonMembershipMarkup = isAdminUser
            ? `
              <div class="player-admin-note">
                Admin tüm sezon yönetim ekranlarını görür, tahmin tablosunda oyuncu olarak listelenmez.
              </div>
            `
            : seasonCards.length
              ? `
                <div class="player-season-chip-grid">
                  ${seasonCards
                    .map((season) => {
                      const checked = seasonStates[season.id] !== false;
                      return `
                        <label class="season-member-chip ${checked ? "is-active" : "is-passive"}">
                          <input type="checkbox" ${checked ? "checked" : ""} onchange="togglePlayerSeasonState('${player.id}', '${season.id}', this.checked)" />
                          <span>${escapeHtml(season.name)}</span>
                        </label>
                      `;
                    })
                    .join("")}
                </div>
              `
              : `<div class="player-empty-seasons">Önce sezon ekle. Sezonlar oluştukça burada kutular çıkacak.</div>`;

          const presence = getPresenceStatusForUser(player.id);
          const statusClass = presence.isOnline ? "is-online" : "is-offline";
          const statusText = presence.isOnline ? "Online" : "Offline";

          return `
            <div class="player-premium-card ${isAdminUser ? "is-admin" : ""} ${statusClass}">
              <div class="player-card-glow"></div>

              <div class="player-card-top">
                <div class="player-card-title-row">
                  <div>
                    <div class="player-card-name">${escapeHtml(player.name)}</div>
                    <div class="player-card-username">@${escapeHtml(player.username || player.name)}</div>
                  </div>
                  <div class="player-card-top-right">
                  ${isAdminUser ? '<span class="player-role-badge">Admin</span>' : ""}
                  <div class="player-presence-pill ${statusClass}">
                    <span class="player-presence-dot"></span>
                    <strong>${statusText}</strong>
                  </div>
                </div>
                </div>

                <div class="player-card-stats">
                  <div class="player-stat-pill player-stat-pill-wide">
                    <span class="player-stat-label">Son giriş</span>
                    <strong>${presence.lastSeen ? formatAdminPanelDateTime(presence.lastSeen) : "Henüz giriş yok"}</strong>
                  </div>
                  <div class="player-stat-pill">
                    <span class="player-stat-label">Şifre</span>
                    <strong>${escapeHtml(player.password || "1234")}</strong>
                  </div>
                  <div class="player-stat-pill">
                    <span class="player-stat-label">Tahmin</span>
                    <strong>${predictionCount}</strong>
                  </div>
                </div>
              </div>

              <div class="player-card-seasons">
                <div class="player-card-section-title">Sezon katılımı</div>
                ${seasonMembershipMarkup}
              </div>

              <div class="player-card-actions">
                <button class="small secondary" onclick="renamePlayer('${player.id}', this)">Düzenle</button>
                <button class="small secondary" onclick="changePlayerPassword('${player.id}', this)">Ş. Değiştir</button>
                ${isAdminUser ? "" : `<button class="small secondary" onclick="forceLogoutUserSession('${player.id}', this)">Sistemden At</button>`}
                ${isAdminUser ? "" : `<button class="small danger" onclick="removePlayer('${player.id}', this)">Sil</button>`}
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

window.togglePlayerSeasonState = async function (playerId, seasonId, isActive) {
  if (isReadOnlyMode()) {
    return showAlert("Kullanıcı görünümünde sezon katılımı değiştirilemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  }
  const player = getPlayerById(playerId);
  const season = getSeasonById(seasonId);
  if (!player || !season) return;
  if (getPlayerRole(player) === "admin") {
    renderPlayers();
    return showAlert("Admin kullanıcı sezon kutuları ile yönetilmez.", {
      title: "Bilgi",
      type: "warning",
    });
  }

  const nextSeasonStates = {
    ...createDefaultSeasonStateMap(true),
    ...getPlayerSeasonStateMap(player),
    [seasonId]: isActive !== false,
  };

  player.seasonStates = nextSeasonStates;

  if (useOnlineMode) {
    try {
      const result = await updateOnlineUser({
        id: player.id,
        seasonStates: nextSeasonStates,
      });
      if (!result?.success) {
        throw new Error(result?.message || "Sezon katılımı kaydedilemedi.");
      }
      await syncUsersFromSheet({ silent: true });
    } catch (error) {
      showAlert(error?.message || "Sezon katılımı Firebase'e yazılamadı.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
    }
  }

  saveState(true);
  renderAll();
};

window.renamePlayer = async function (id, buttonOrEvent) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde kişi düzenlenemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const player = getPlayerById(id);
  if (!player) return;
  const name = await showPrompt("Yeni kişi adını yaz:", player.name || "", {
    title: "Kişi düzenle",
    placeholder: "Örn: MUSTAFA",
  });
  if (!name?.trim()) return;

  if (useOnlineMode) {
    setAsyncButtonState(actionButton, "loading", {
      loading: "Kaydediliyor...",
      success: "Kaydedildi",
    });
    try {
      const result = await updateOnlineUser({
        id: player.id,
        adSoyad: name.trim().toUpperCase(),
      });
      if (!result?.success) {
        showAlert(result?.message || "Kullanıcı güncellenemedi.", {
          title: "Kayıt Hatası",
          type: "warning",
        });
        setAsyncButtonState(actionButton, "error", { error: "Hata" });
        return;
      }
      await syncUsersFromSheet();
      renderAll();
      setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
      return;
    } catch (error) {
      console.error("Kullanıcı güncelleme hatası:", error);
      showAlert(error?.message || "Firebase güncellemesi başarısız.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
      setAsyncButtonState(actionButton, "error", { error: "Hata" });
      return;
    }
  }

  player.name = name.trim().toUpperCase();
  saveState();
  renderAll();
  setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
};
window.changePlayerPassword = async function (id, buttonOrEvent) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde şifre değiştirilemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const player = getPlayerById(id);
  if (!player) return;
  const password = await showPrompt(
    "Yeni kullanıcı şifresini yaz:",
    player.password || "1234",
    {
      title: "Şifre değiştir",
      placeholder: "Örn: 1234",
    },
  );
  if (!password?.trim()) return;

  if (useOnlineMode) {
    setAsyncButtonState(actionButton, "loading", {
      loading: "Kaydediliyor...",
      success: "Kaydedildi",
    });
    try {
      const result = await updateOnlineUser({
        id: player.id,
        sifre: password.trim(),
      });
      if (!result?.success) {
        showAlert(result?.message || "Şifre güncellenemedi.", {
          title: "Kayıt Hatası",
          type: "warning",
        });
        setAsyncButtonState(actionButton, "error", { error: "Hata" });
        return;
      }
      await syncUsersFromSheet();
      renderAll();
      setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
      return;
    } catch (error) {
      console.error("Şifre güncelleme hatası:", error);
      showAlert(error?.message || "Firebase güncellemesi başarısız.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
      setAsyncButtonState(actionButton, "error", { error: "Hata" });
      return;
    }
  }

  player.password = password.trim();
  saveState();
  renderAll();
  setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
};
window.removePlayer = async function (id, buttonOrEvent) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde kişi silinemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const player = getPlayerById(id);
  if (!player) return;
  if (getPlayerRole(player) === "admin") {
    return showAlert("Admin kullanıcısı silinemez.", {
      title: "İşlem kapalı",
      type: "warning",
    });
  }
  if (
    !(await showConfirm(
      `${player.name} kaydını ve tüm tahminlerini silmek istiyor musun?`,
      { title: "Kişi silinsin mi?", type: "danger", confirmText: "Sil" },
    ))
  )
    return;

  if (useOnlineMode) {
    setAsyncButtonState(actionButton, "loading", {
      loading: "Siliniyor...",
      success: "Silindi",
    });
    try {
      const result = await deleteOnlineUser({ id: player.id });
      if (!result?.success) {
        showAlert(result?.message || "Kullanıcı silinemedi.", {
          title: "Kayıt Hatası",
          type: "warning",
        });
        setAsyncButtonState(actionButton, "error", { error: "Hata" });
        return;
      }
      state.predictions = state.predictions.filter(
        (p) => String(p.playerId) !== String(id),
      );
      await syncUsersFromSheet();
      renderAll();
      setAsyncButtonState(actionButton, "success", { success: "Silindi" });
      return;
    } catch (error) {
      console.error("Kullanıcı silme hatası:", error);
      showAlert(error?.message || "Firebase silme işlemi başarısız.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
      setAsyncButtonState(actionButton, "error", { error: "Hata" });
      return;
    }
  }

  state.players = state.players.filter((p) => String(p.id) !== String(id));
  state.predictions = state.predictions.filter(
    (p) => String(p.playerId) !== String(id),
  );
  saveState();
  renderAll();
  setAsyncButtonState(actionButton, "success", { success: "Silindi" });
};

function renderSeasons() {
  const seasonId = getActiveSeasonId();
  const container = document.getElementById("seasonTeamsList");
  const teams = getTeamsBySeasonId(seasonId);
  const season = getSeasonById(seasonId);
  if (!season) {
    container.innerHTML = createEmptyState(
      "Önce lig adıyla birlikte bir sezon oluştur.",
    );
    return;
  }

  const seasonRows = [...state.seasons]
    .sort((a, b) => b.name.localeCompare(a.name, "tr"))
    .map(
      (item) => `
    <div class="excel-list-row week-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="small-meta">${escapeHtml(item.leagueName || "Lig belirtilmedi")}</div>
      </div>
      <span class="badge gray">${getTeamsBySeasonId(item.id).length} takım</span>
      <div class="inline-actions compact">
        <button class="small secondary" onclick="setActiveSeason('${item.id}')">Seç</button>
        <button class="small danger" onclick="removeSeason('${item.id}')">Sil</button>
      </div>
    </div>
  `,
    )
    .join("");

  const teamRows = teams.length
    ? `<div class="season-team-card-grid">${teams
        .map(
          (team) => `
      <div class="season-team-card">
        <div class="season-team-card-top">
          <div class="season-team-card-logo">${teamLogoHtml(team.name, seasonId)}</div>
          <div>
            <div class="season-team-card-name">${escapeHtml(team.name)}</div>
            <div class="small-meta">Sezon: ${escapeHtml(season.name)}</div>
          </div>
        </div>
        <label class="field inline-field">
          <span>Logo dosya adı</span>
          <input type="text" value="${escapeHtml(team.slug || "")}" oninput="markSeasonTeamSlugDraft('${team.id}', this.value)" placeholder="örn: galatasaray" />
        </label>
        <div class="inline-actions compact wrap-actions">
          <button class="small secondary" onclick="saveSeasonTeamSlug('${team.id}', this)">Logo adını kaydet</button>
          <button class="small secondary" onclick="renameSeasonTeam('${team.id}')">Adı düzenle</button>
          <button class="small danger" onclick="removeSeasonTeam('${team.id}')">Sil</button>
        </div>
      </div>
    `,
        )
        .join("")}</div>`
    : createEmptyState("Bu sezonda henüz takım yok.");

  container.innerHTML = `
    <div class="stack-actions">
      <div class="excel-list season-list-scroll">${seasonRows}</div>
      <div class="card-subtitle">${escapeHtml(season.name)} takımları</div>
      ${teamRows}
    </div>
  `;
}

window.markSeasonTeamSlugDraft = function (teamId, value) {
  const team = getTeamById(teamId);
  if (!team) return;
  team._draftSlug = String(value || "").trim();
};

window.saveSeasonTeamSlug = async function (teamId, buttonOrEvent) {
  if (isReadOnlyMode()) {
    return showAlert("Kullanıcı görünümünde takım logosu düzenlenemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  }
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const team = getTeamById(teamId);
  if (!team) return;
  const nextSlug = String(
    team._draftSlug || team.slug || slugify(team.name) || "",
  ).trim();
  if (!nextSlug) {
    return showAlert("Logo dosya adı boş olamaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  }
  team.slug = nextSlug;
  delete team._draftSlug;
  saveState(true);
  renderAll();
  setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
};

window.removeSeason = async function (id) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde sezon silinemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  if (!state.seasons.length) return;
  const season = getSeasonById(id);
  if (!season) return;
  if (
    !(await showConfirm(
      `${season.name} sezonunu ve içindeki tüm hafta, maç, takım verilerini silmek istiyor musun?`,
      { title: "Sezon silinsin mi?", type: "danger", confirmText: "Sil" },
    ))
  ) {
    return;
  }

  const matchIds = getMatchesBySeasonId(id).map((m) => String(m.id));

  if (useOnlineMode && isFirebaseReady()) {
    try {
      const matchesMap = (await firebaseRead("matches")) || {};
      const predictionsMap = (await firebaseRead("predictions")) || {};
      const usersMap = (await firebaseRead("users")) || {};
      const remoteMatches = firebaseSnapshotToArray(matchesMap);
      const remotePredictions = firebaseSnapshotToArray(predictionsMap);
      const remoteUsers = firebaseSnapshotToArray(usersMap);

      const remoteMatchesToDelete = remoteMatches.filter((item) => {
        const sameSeasonName =
          normalizeText(item.season || item.sezon || "") ===
          normalizeText(season.name || "");
        return sameSeasonName;
      });

      const remoteMatchIdsToDelete = new Set(
        remoteMatchesToDelete.map((item) =>
          String(item.id || item.sheetMatchId || item.macId || "").trim(),
        ),
      );

      const remotePredictionsToDelete = remotePredictions.filter((pred) =>
        remoteMatchIdsToDelete.has(String(pred.matchId || "").trim()),
      );

      for (const match of remoteMatchesToDelete) {
        const matchKey = sanitizeFirebaseKey(
          match.id || match.sheetMatchId || match.macId || "",
        );
        if (matchKey) await firebaseRemove(`matches/${matchKey}`);
      }

      for (const pred of remotePredictionsToDelete) {
        const predKey = sanitizeFirebaseKey(
          pred.id || makePredictionRecordId(pred.matchId, pred.playerId),
        );
        if (predKey) await firebaseRemove(`predictions/${predKey}`);
      }

      for (const user of remoteUsers) {
        const seasonStates = normalizeSeasonStateMap(
          user.seasonStates ||
            user.seasonMemberships ||
            user.activeSeasons ||
            {},
        );
        if (!Object.prototype.hasOwnProperty.call(seasonStates, id)) continue;
        delete seasonStates[id];
        const userKey = sanitizeFirebaseKey(user.id || "");
        if (userKey) {
          await firebaseUpdate(`users/${userKey}`, {
            seasonStates,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      console.warn("Sezonun Firebase temizliği tamamlanamadı:", error);
    }
  }

  state.seasons = state.seasons.filter((s) => s.id !== id);
  state.teams = state.teams.filter((t) => t.seasonId !== id);
  state.weeks = state.weeks.filter((w) => w.seasonId !== id);
  state.matches = state.matches.filter((m) => m.seasonId !== id);
  state.predictions = state.predictions.filter(
    (p) => !matchIds.includes(String(p.matchId)),
  );
  state.players = state.players.map((player) => {
    const seasonStates = getPlayerSeasonStateMap(player);
    if (!Object.prototype.hasOwnProperty.call(seasonStates, id)) return player;
    const nextStates = { ...seasonStates };
    delete nextStates[id];
    return { ...player, seasonStates: nextStates };
  });

  delete state.settings.celebratedChampions[id];
  state.settings.activeSeasonId = state.seasons[0]?.id || null;
  state.settings.activeWeekId =
    getWeeksBySeasonId(state.settings.activeSeasonId)[0]?.id || null;
  saveState(true);
  if (useOnlineMode && isFirebaseReady()) {
    try {
      await persistSeasonRegistryToFirebase();
      await hydrateFromFirebaseRealtime("season-delete");
    } catch (error) {
      console.warn("Sezon listesi Firebase'de güncellenemedi:", error);
    }
  }
  renderAll();
};

window.renameSeasonTeam = async function (teamId) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde takım düzenlenemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  const team = getTeamById(teamId);
  if (!team) return;
  const name = await showPrompt("Yeni takım adı:", team.name, {
    title: "Takım düzenle",
    placeholder: "Takım adı",
  });
  if (!name?.trim()) return;
  const slug = await showPrompt("Logo dosya adı:", team.slug || slugify(name), {
    title: "Logo dosya adı",
    placeholder: "örn: fenerbahce",
  });
  team.name = name.trim();
  team.slug = (slug || slugify(name)).trim();
  saveState();
  renderAll();
};

window.removeSeasonTeam = async function (teamId) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde takım silinemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  const team = getTeamById(teamId);
  if (!team) return;
  const seasonMatches = getMatchesBySeasonId(team.seasonId).filter(
    (m) => m.homeTeam === team.name || m.awayTeam === team.name,
  );
  if (
    seasonMatches.length &&
    !(await showConfirm(
      `${team.name} bu sezon maçlarda kullanılmış. Yine de silmek istiyor musun?`,
      { title: "Takım silinsin mi?", type: "danger", confirmText: "Sil" },
    ))
  )
    return;
  state.teams = state.teams.filter((t) => t.id !== teamId);
  saveState();
  renderAll();
};

function renderWeeks() {
  const seasonId = getActiveSeasonId();
  const container = document.getElementById("weeksList");
  const weeks = getWeeksBySeasonId(seasonId);
  if (!weeks.length)
    return (container.innerHTML = createEmptyState("Henüz hafta eklenmedi."));
  container.innerHTML = `<div class="excel-list week-list-scroll">${weeks
    .map(
      (week) => `
    <div class="excel-list-row week-row">
      <div><strong>${week.number}. Hafta</strong><div class="small-meta">${getMatchesByWeekId(week.id).length} maç</div></div>
      <span class="badge ${week.status === "tamamlandi" ? "" : week.status === "hazirlaniyor" ? "warn" : "gray"}">${escapeHtml(week.status)}</span>
      <div class="inline-actions compact">
        <button class="small secondary" onclick="setActiveWeek('${week.id}')">Aktif Yap</button>
        <button class="small secondary" onclick="changeWeekStatus('${week.id}')">Durum</button>
        <button class="small danger" onclick="removeWeek('${week.id}')">Sil</button>
      </div>
    </div>`,
    )
    .join("")}</div>`;
}

window.changeWeekStatus = async function (id) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde hafta durumu değiştirilemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  const week = getWeekById(id);
  if (!week) return;
  const status = await showPrompt(
    "Yeni durum: aktif / hazirlaniyor / tamamlandi",
    week.status || "aktif",
    {
      title: "Hafta durumu değiştir",
      placeholder: "aktif / hazirlaniyor / tamamlandi",
    },
  );
  if (!status || !["aktif", "hazirlaniyor", "tamamlandi"].includes(status))
    return showAlert("Geçerli bir durum gir.", {
      title: "Geçersiz değer",
      type: "warning",
    });
  week.status = status;
  saveState();
  renderAll();
};
window.removeWeek = async function (id) {
  if (isReadOnlyMode()) {
    return showAlert("Kullanıcı görünümünde hafta silinemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  }

  const week = getWeekById(id);
  if (!week) return;

  if (
    !(await showConfirm(
      `${week.number}. haftayı ve bu haftadaki tüm maç/tahminleri silmek istiyor musun?`,
      { title: "Hafta silinsin mi?", type: "danger", confirmText: "Sil" },
    ))
  ) {
    return;
  }

  const weekMatches = getMatchesByWeekId(id);
  const matchIds = weekMatches.map((m) => String(m.id));

  try {
    if (useOnlineMode && isFirebaseReady()) {
      const matchesMap = (await firebaseRead("matches")) || {};
      const predictionsMap = (await firebaseRead("predictions")) || {};

      const remoteMatches = firebaseSnapshotToArray(matchesMap);
      const remotePredictions = firebaseSnapshotToArray(predictionsMap);

      const remoteMatchRecordsToDelete = remoteMatches.filter((item) => {
        const sameWeekNo =
          String(item.weekNo ?? item.haftaNo ?? "") ===
          String(week.number ?? "");
        const sameSeason =
          String(item.season ?? item.sezon ?? "") ===
          String(getSeasonById(week.seasonId)?.name ?? "");

        const sameMatchById = matchIds.includes(String(item.id ?? ""));
        const sameMatchBySheetId = weekMatches.some(
          (m) =>
            String(m.sheetMatchId ?? m.remoteMatchId ?? m.macId ?? "") !== "" &&
            String(m.sheetMatchId ?? m.remoteMatchId ?? m.macId ?? "") ===
              String(item.id ?? item.sheetMatchId ?? item.macId ?? ""),
        );

        return (
          sameMatchById || sameMatchBySheetId || (sameWeekNo && sameSeason)
        );
      });

      const remoteMatchIdsToDelete = remoteMatchRecordsToDelete.map((item) =>
        String(item.id ?? ""),
      );

      const remotePredictionRecordsToDelete = remotePredictions.filter((pred) =>
        remoteMatchIdsToDelete.includes(String(pred.matchId ?? "")),
      );

      for (const match of remoteMatchRecordsToDelete) {
        await firebaseRemove(`matches/${sanitizeFirebaseKey(match.id)}`);
      }

      for (const pred of remotePredictionRecordsToDelete) {
        const predKey = sanitizeFirebaseKey(
          pred.id || makePredictionRecordId(pred.matchId, pred.playerId),
        );
        await firebaseRemove(`predictions/${predKey}`);
      }
    }

    state.weeks = state.weeks.filter((w) => w.id !== id);
    state.matches = state.matches.filter((m) => m.weekId !== id);
    state.predictions = state.predictions.filter(
      (p) => !matchIds.includes(String(p.matchId)),
    );

    if (state.settings.activeWeekId === id) {
      state.settings.activeWeekId =
        getWeeksBySeasonId(getActiveSeasonId()).find((w) => w.id !== id)?.id ||
        null;
    }

    saveState();
    renderAll();

    showAlert(`${week.number}. hafta ve bağlı maç/tahminler silindi.`, {
      title: "Silme tamamlandı",
      type: "success",
    });
  } catch (error) {
    console.error("Hafta silme hatası:", error);
    showAlert(
      error?.message || "Firebase üzerinden hafta kayıtları silinemedi.",
      {
        title: "Silme hatası",
        type: "error",
      },
    );
  }
};

function renderMatches(
  containerId = "matchesList",
  weekId = state.settings.activeWeekId,
) {
  const container = document.getElementById(containerId);
  if (!weekId)
    return (container.innerHTML = createEmptyState("Önce bir hafta ekle."));
  const matches = getMatchesByWeekId(weekId);
  if (!matches.length)
    return (container.innerHTML = createEmptyState(
      "Bu haftada henüz maç yok.",
    ));
  const isDashboard = containerId === "dashboardMatches";
  if (isDashboard && isMobileView()) {
    renderMobileDashboardMatches(container, matches);
    return;
  }
  container.innerHTML = `
    <div class="excel-table compact-table ${isDashboard ? "dashboard-fixtures" : ""}">
      <div class="excel-thead ${isDashboard ? "dashboard-head" : ""}">
        <div>Maç</div><div>Skor</div><div>Durum</div><div>Tarih</div><div>Sonuç</div>${isDashboard ? "" : "<div>İşlem</div>"}
      </div>
      <div class="excel-tbody">${matches
        .map((match) => {
          const badge = getMatchBadge(match);
          const visual = getMatchVisualState(match);
          return `
        <div class="excel-tr match-tr ${match.played ? "played-row" : ""} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}">
          <div>${matchCell(match)}</div>
          <div><span class="score-box slim">${match.played ? `${match.homeScore} - ${match.awayScore}` : "- -"}</span></div>
          <div><span class="badge ${badge.cls}">${badge.text}</span></div>
          <div class="small-meta">${formatDate(match.date)}</div>
          <div>
            <div class="score-inputs compact-inputs">
              <input type="number" min="0" id="homeScore_${match.id}" value="${match.played ? match.homeScore : ""}" oninput="queueResultSave('${match.id}')" />
              <span>-</span>
              <input type="number" min="0" id="awayScore_${match.id}" value="${match.played ? match.awayScore : ""}" oninput="queueResultSave('${match.id}')" />
              <span class="auto-save-note">Otomatik</span>
            </div>
          </div>
          ${isDashboard ? "" : `<div><button class="small danger" onclick="removeMatch('${match.id}')">Sil</button></div>`}
        </div>`;
        })
        .join("")}</div>
    </div>`;
}

const resultSaveTimers = {};
window.queueResultSave = function (matchId) {
  clearTimeout(resultSaveTimers[matchId]);
  resultSaveTimers[matchId] = setTimeout(() => saveResult(matchId), 350);
};
window.saveResult = async function (matchId) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde skor işlenemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return;
  const homeScore = document.getElementById(`homeScore_${matchId}`)?.value;
  const awayScore = document.getElementById(`awayScore_${matchId}`)?.value;
  if (homeScore === "" || awayScore === "") return;

  match.homeScore = Number(homeScore);
  match.awayScore = Number(awayScore);
  match.played = true;
  recalculateAllPoints();
  saveState();
  renderAll();

  if (!useOnlineMode) return;

  try {
    window.__ALLOW_MATCH_WRITE__ = true;
    await sendMatchesToSheet([match], { force: true });
    await syncOnlineMatchesFromSheet({
      seasonId: match.seasonId,
      seasonLabel: getSeasonById(match.seasonId)?.name || "",
      silent: true,
    });
    recalculateAllPoints();
    saveState();
    renderAll();
  } catch (error) {
    console.error("Skor Firebase senkron hatası:", error);
    showAlert(
      "Skor yerelde kaydedildi ama Firebase'e yazılırken hata oluştu.",
      {
        title: "Senkron hatası",
        type: "warning",
      },
    );
  } finally {
    window.__ALLOW_MATCH_WRITE__ = false;
  }
};
window.forceLogoutUserSession = async function (playerId) {
  if (!isFirebaseReady()) {
    return showAlert("Bu özellik için Firebase açık olmalı.", {
      title: "Özellik kullanılamıyor",
      type: "warning",
    });
  }

  const player = getPlayerById(playerId);
  if (!player) return;
  if (getPlayerRole(player) === "admin") {
    return showAlert("Admin kullanıcısı sistemden çıkarılamaz.", {
      title: "İşlem engellendi",
      type: "warning",
    });
  }

  if (
    !(await showConfirm(
      `${player.name} kullanıcısını sistemden çıkarmak istiyor musun?`,
      {
        title: "Kullanıcı çıkarılsın mı?",
        type: "danger",
        confirmText: "Çıkar",
      },
    ))
  )
    return;

  try {
    await firebaseUpdate(`users/${sanitizeFirebaseKey(player.id)}`, {
      forcedLogoutAt: new Date().toISOString(),
    });
    await firebaseRemove(`presence/${sanitizeFirebaseKey(player.id)}`);
    showAlert(`${player.name} sistemden çıkarıldı.`, {
      title: "İşlem tamamlandı",
      type: "success",
    });
  } catch (error) {
    console.error("Kullanıcı sistemden çıkarılamadı:", error);
    showAlert(error?.message || "Kullanıcı sistemden çıkarılamadı.", {
      title: "İşlem başarısız",
      type: "error",
    });
  }
};

window.removeMatch = async function (matchId) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde maç silinemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return;
  if (
    !(await showConfirm(
      `${match.homeTeam} - ${match.awayTeam} maçını silmek istiyor musun?`,
      { title: "Maç silinsin mi?", type: "danger", confirmText: "Sil" },
    ))
  )
    return;

  try {
    if (useOnlineMode && isFirebaseReady()) {
      const predictionsMap = (await firebaseRead("predictions")) || {};
      const remotePredictions = firebaseSnapshotToArray(predictionsMap).filter(
        (pred) =>
          String(pred.matchId || "") ===
            String(
              match.sheetMatchId ||
                match.remoteMatchId ||
                match.macId ||
                match.id ||
                "",
            ) || String(pred.matchId || "") === String(match.id),
      );

      await firebaseRemove(
        `matches/${sanitizeFirebaseKey(match.sheetMatchId || match.remoteMatchId || match.macId || match.id)}`,
      );

      for (const pred of remotePredictions) {
        await firebaseRemove(
          `predictions/${sanitizeFirebaseKey(pred.id || makePredictionRecordId(pred.matchId, pred.playerId))}`,
        );
      }
    }

    removeMatchesFromLocalState([matchId]);
    saveState();
    renderAll();
    showAlert("Maç ve bağlı tahminler silindi.", {
      title: "Silme tamamlandı",
      type: "success",
    });
  } catch (error) {
    console.error("Maç silme hatası:", error);
    showAlert(error?.message || "Maç Firebase üzerinden silinemedi.", {
      title: "Silme hatası",
      type: "error",
    });
  }
};

function isPredictionShareMode() {
  return !!state.settings.predictionShareMode;
}

function getPredictionShareView() {
  return state.settings.predictionShareView === "post" ? "post" : "pre";
}

function isPredictionShareCompact() {
  return state.settings.predictionShareCompact !== false;
}

function isPredictionShareFadeEmpty() {
  return !!state.settings.predictionShareFadeEmpty;
}

function togglePredictionShareMode() {
  state.settings.predictionShareMode = !state.settings.predictionShareMode;
  saveState();
  updatePredictionShareModeButton();
}

function setPredictionShareView(view) {
  state.settings.predictionShareView = view === "post" ? "post" : "pre";
  saveState();
  updatePredictionShareModeButton();
}

function setPredictionShareCompact(enabled) {
  state.settings.predictionShareCompact = !!enabled;
  saveState();
  updatePredictionShareModeButton();
}

function setPredictionShareFadeEmpty(enabled) {
  state.settings.predictionShareFadeEmpty = !!enabled;
  saveState();
  updatePredictionShareModeButton();
}

function canUsePredictionShareMode() {
  return !isMobileView() || getCurrentRole() === "admin";
}

function updatePredictionShareModeButton() {
  const btn = document.getElementById("toggleShareModeBtn");
  if (!btn) return;
  const allowed = canUsePredictionShareMode();
  if (!allowed && state.settings.predictionShareMode) {
    state.settings.predictionShareMode = false;
    saveState();
  }
  const active = allowed && isPredictionShareMode();
  const mobileAdminTools = isMobileView() && getCurrentRole() === "admin";
  btn.textContent = mobileAdminTools
    ? `Paylaşım Araçları: ${active ? "Açık" : "Kapalı"}`
    : `Paylaşım Modu: ${active ? "Açık" : "Kapalı"}`;
  btn.classList.toggle("is-active", active);
  btn.classList.toggle("hidden", !allowed);
  btn.setAttribute("aria-hidden", allowed ? "false" : "true");

  const toolbar = document.getElementById("predictionShareToolbar");
  if (toolbar) {
    toolbar.classList.toggle("hidden", !active || !allowed);
    toolbar.setAttribute("aria-hidden", active && allowed ? "false" : "true");
  }

  const preBtn = document.getElementById("shareViewPreBtn");
  const postBtn = document.getElementById("shareViewPostBtn");
  const compactToggle = document.getElementById("shareCompactToggle");
  const fadeEmptyToggle = document.getElementById("shareHideEmptyToggle");
  const view = getPredictionShareView();
  if (preBtn) preBtn.classList.toggle("is-active", view === "pre");
  if (postBtn) postBtn.classList.toggle("is-active", view === "post");
  if (compactToggle) compactToggle.checked = isPredictionShareCompact();
  if (fadeEmptyToggle) fadeEmptyToggle.checked = isPredictionShareFadeEmpty();
}

function getPredictionDisplayValue(pred) {
  const home = pred?.homePred;
  const away = pred?.awayPred;
  const hasHome = home !== "" && home !== null && home !== undefined;
  const hasAway = away !== "" && away !== null && away !== undefined;
  if (!hasHome || !hasAway) return "—";
  return `${home} - ${away}`;
}

function downloadBlobFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function getTeamPalette(name) {
  const index = Math.max(0, DEFAULT_TEAM_NAMES.indexOf(name));
  return (
    TEAM_COLORS[
      index >= 0
        ? index % TEAM_COLORS.length
        : Math.abs(String(name || "").length) % TEAM_COLORS.length
    ] || ["#38bdf8", "#22c55e"]
  );
}

function truncateCanvasText(ctx, text, maxWidth) {
  const safe = String(text || "");
  if (!safe) return "";
  if (ctx.measureText(safe).width <= maxWidth) return safe;
  let output = safe;
  while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}…`;
}

function fillRoundedRect(
  ctx,
  x,
  y,
  width,
  height,
  radius,
  fillStyle,
  strokeStyle = "",
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
}

const shareLogoImageCache = new Map();

function getTeamLogoCandidateSources(teamName, seasonId = getActiveSeasonId()) {
  const team = getTeamMetaByName(teamName, seasonId);
  const slug = team?.slug || DEFAULT_TEAM_SLUGS[teamName] || slugify(teamName);
  const remoteCached =
    remoteTeamLogoUrlCache.get(normalizeTeamSearchToken(teamName)) || "";
  return [
    slug ? `logos/${slug}.png` : "",
    team?.logoUrl || "",
    team?.logo || "",
    team?.badge || "",
    team?.image || "",
    remoteCached,
  ].filter(Boolean);
}

function loadCanvasImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function getTeamLogoImage(teamName, seasonId = getActiveSeasonId()) {
  const cacheKey = `${seasonId || "global"}__${teamName || ""}`;
  if (shareLogoImageCache.has(cacheKey)) {
    return shareLogoImageCache.get(cacheKey);
  }

  for (const src of getTeamLogoCandidateSources(teamName, seasonId)) {
    const img = await loadCanvasImage(src);
    if (img) {
      shareLogoImageCache.set(cacheKey, img);
      return img;
    }
  }

  const remoteUrl = await fetchRemoteTeamLogoUrl(teamName);
  if (remoteUrl) {
    const remoteImg = await loadCanvasImage(remoteUrl);
    if (remoteImg) {
      shareLogoImageCache.set(cacheKey, remoteImg);
      return remoteImg;
    }
  }

  shareLogoImageCache.set(cacheKey, null);
  return null;
}

async function drawTeamBadgeOnCanvas(
  ctx,
  teamName,
  x,
  y,
  size,
  seasonId = getActiveSeasonId(),
) {
  const logoImg = await getTeamLogoImage(teamName, seasonId);
  if (logoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.fill();
    ctx.clip();
    const inset = Math.max(3, Math.round(size * 0.08));
    ctx.drawImage(
      logoImg,
      x + inset,
      y + inset,
      size - inset * 2,
      size - inset * 2,
    );
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 0.75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const [colorA, colorB] = getTeamPalette(teamName);
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, colorA);
  gradient.addColorStop(1, colorB);
  fillRoundedRect(
    ctx,
    x,
    y,
    size,
    size,
    size / 2,
    gradient,
    "rgba(255,255,255,0.18)",
  );
  ctx.fillStyle = "#f8fafc";
  ctx.font = `800 ${Math.max(14, Math.round(size * 0.32))}px Inter, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(teamInitials(teamName), x + size / 2, y + size / 2 + 1);
  ctx.textAlign = "left";
}

function drawPredictionShareHeader(
  ctx,
  x,
  y,
  width,
  title,
  subtitle,
  pageText,
) {
  const headGradient = ctx.createLinearGradient(x, y, x + width, y + 80);
  headGradient.addColorStop(0, "rgba(15,23,42,0.96)");
  headGradient.addColorStop(1, "rgba(12,36,74,0.96)");
  fillRoundedRect(
    ctx,
    x,
    y,
    width,
    88,
    24,
    headGradient,
    "rgba(148,163,184,0.16)",
  );
  ctx.fillStyle = "#38bdf8";
  ctx.font = "800 22px Inter, Arial, sans-serif";
  ctx.fillText("PAYLAŞIM EKRANI", x + 24, y + 28);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "900 42px Inter, Arial, sans-serif";
  ctx.fillText(title, x + 24, y + 62);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 18px Inter, Arial, sans-serif";
  ctx.fillText(subtitle, x + 360, y + 62);
  fillRoundedRect(
    ctx,
    x + width - 150,
    y + 22,
    126,
    40,
    20,
    "rgba(15,23,42,0.88)",
    "rgba(255,255,255,0.16)",
  );
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "800 18px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(pageText, x + width - 87, y + 47);
  ctx.textAlign = "left";
}

function getShareCellPalette(pred, match, shareView) {
  const hasPrediction = pred && pred.homePred !== "" && pred.awayPred !== "";
  if (!hasPrediction) {
    return {
      bg: "rgba(15,23,42,0.72)",
      border: "rgba(148,163,184,0.12)",
      accent: "#94a3b8",
      label: shareView === "pre" ? "—" : "Boş",
    };
  }
  if (!match.played || shareView === "pre") {
    return {
      bg: "rgba(15,23,42,0.82)",
      border: "rgba(56,189,248,0.22)",
      accent: "#e2e8f0",
      label: "Tahmin",
    };
  }
  const pts = Number(pred.points || 0);
  if (pts >= 3) {
    return {
      bg: "rgba(16,185,129,0.18)",
      border: "rgba(16,185,129,0.34)",
      accent: "#dcfce7",
      label: "Tam skor",
    };
  }
  if (pts >= 1) {
    return {
      bg: "rgba(245,158,11,0.18)",
      border: "rgba(245,158,11,0.34)",
      accent: "#fef3c7",
      label: "Yakın",
    };
  }
  return {
    bg: "rgba(239,68,68,0.16)",
    border: "rgba(239,68,68,0.32)",
    accent: "#fee2e2",
    label: "0 puan",
  };
}

async function createPredictionShareExportCanvas(
  matches,
  players,
  options = {},
) {
  const shareView = options.shareView === "post" ? "post" : "pre";
  const seasonName = getSeasonById(getActiveSeasonId())?.name || "Sezon";
  const weekNumber = getWeekNumberById(state.settings.activeWeekId) || "?";
  const pageIndex = Number(options.pageIndex || 0);
  const totalPages = Number(options.totalPages || 1);
  const weeklyStandings =
    shareView === "post" ? getWeeklyStandings(state.settings.activeWeekId) : [];
  const summaryRows =
    shareView === "post"
      ? players.map((player) => {
          const row = weeklyStandings.find((item) => item.id === player.id) || {
            id: player.id,
            total: 0,
            exact: 0,
            resultOnly: 0,
          };
          return { ...row, id: player.id, name: player.name };
        })
      : [];

  const rankingMap = new Map(
    [...summaryRows]
      .sort(
        (a, b) =>
          Number(b.total || 0) - Number(a.total || 0) ||
          Number(b.exact || 0) - Number(a.exact || 0) ||
          Number(b.resultOnly || 0) - Number(a.resultOnly || 0),
      )
      .map((row, index) => [row.id, index + 1]),
  );

  const margin = 28;
  const headerH = 106;
  const tableHeadH = 54;
  const rowH = shareView === "post" ? 88 : 78;
  const footerH = 18;
  const matchColW = shareView === "post" ? 560 : 540;
  const playerColW = shareView === "post" ? 152 : 140;
  const summaryW = shareView === "post" ? 340 : 0;
  const width = margin * 2 + matchColW + players.length * playerColW + summaryW;
  const height =
    margin * 2 + headerH + tableHeadH + matches.length * rowH + footerH;

  const canvas = document.createElement("canvas");
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, "#031124");
  bgGradient.addColorStop(0.55, "#071833");
  bgGradient.addColorStop(1, "#04101e");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  drawPredictionShareHeader(
    ctx,
    margin,
    margin,
    width - margin * 2,
    `${weekNumber}. Hafta`,
    seasonName,
    `${pageIndex + 1}/${totalPages}`,
  );

  const tableX = margin;
  const tableY = margin + headerH;
  const tableW = matchColW + players.length * playerColW;
  const panelH = tableHeadH + matches.length * rowH;

  fillRoundedRect(
    ctx,
    tableX,
    tableY,
    tableW,
    panelH,
    22,
    "rgba(15,23,42,0.86)",
    "rgba(148,163,184,0.16)",
  );
  fillRoundedRect(
    ctx,
    tableX,
    tableY,
    tableW,
    tableHeadH,
    22,
    "rgba(17,24,39,0.94)",
    "",
  );
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "800 22px Inter, Arial, sans-serif";
  ctx.fillText("MAÇ", tableX + 18, tableY + 34);

  players.forEach((player, index) => {
    const cellX = tableX + matchColW + index * playerColW;
    fillRoundedRect(
      ctx,
      cellX + 12,
      tableY + 10,
      playerColW - 24,
      34,
      17,
      "rgba(30,41,59,0.96)",
      "rgba(148,163,184,0.18)",
    );
    ctx.fillStyle = "#f8fafc";
    ctx.font = "900 18px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      String(player.name || "").toUpperCase(),
      cellX + playerColW / 2,
      tableY + 32,
    );
    ctx.textAlign = "left";
  });

  for (const [rowIndex, match] of matches.entries()) {
    const rowY = tableY + tableHeadH + rowIndex * rowH;
    const isOdd = rowIndex % 2 === 1;
    fillRoundedRect(
      ctx,
      tableX,
      rowY,
      matchColW,
      rowH,
      0,
      isOdd ? "rgba(15,23,42,0.68)" : "rgba(12,18,34,0.76)",
      "rgba(148,163,184,0.08)",
    );

    const leftX = tableX + 18;
    const badgeSize = 40;
    const centerScoreW = 92;
    const leftTeamMaxW = 150;
    const rightTeamMaxW = 150;
    const centerX = tableX + matchColW / 2;

    await drawTeamBadgeOnCanvas(
      ctx,
      match.homeTeam,
      leftX,
      rowY + 20,
      badgeSize,
    );
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 18px Inter, Arial, sans-serif";
    ctx.fillText(
      truncateCanvasText(ctx, match.homeTeam, leftTeamMaxW),
      leftX + badgeSize + 12,
      rowY + 42,
    );

    const rightBadgeX = tableX + matchColW - 18 - badgeSize;
    await drawTeamBadgeOnCanvas(
      ctx,
      match.awayTeam,
      rightBadgeX,
      rowY + 20,
      badgeSize,
    );
    const awayText = truncateCanvasText(ctx, match.awayTeam, rightTeamMaxW);
    const awayWidth = ctx.measureText(awayText).width;
    ctx.fillText(awayText, rightBadgeX - 12 - awayWidth, rowY + 42);

    const scoreValue = match.played
      ? `${match.homeScore ?? 0} - ${match.awayScore ?? 0}`
      : shareView === "pre"
        ? formatDate(match.date).replace(",", "")
        : "- -";

    fillRoundedRect(
      ctx,
      centerX - centerScoreW / 2,
      rowY + 10,
      centerScoreW,
      40,
      16,
      "rgba(37, 51, 79, 0.94)",
      "rgba(148,163,184,0.18)",
    );
    ctx.fillStyle = "#ffffff";
    ctx.font = match.played
      ? "900 24px Inter, Arial, sans-serif"
      : "700 14px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    if (match.played) {
      ctx.fillText(scoreValue, centerX, rowY + 36);
    } else {
      const [datePart, timePart] = scoreValue.split(" ");
      ctx.fillText(datePart || "", centerX, rowY + 28);
      ctx.font = "700 13px Inter, Arial, sans-serif";
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText(timePart || "", centerX, rowY + 44);
    }
    ctx.textAlign = "left";

    if (shareView === "post") {
      fillRoundedRect(
        ctx,
        centerX - 46,
        rowY + 56,
        92,
        20,
        10,
        "rgba(15,23,42,0.92)",
        "rgba(148,163,184,0.12)",
      );
      ctx.fillStyle = match.played ? "#bfdbfe" : "#94a3b8";
      ctx.font = "700 11px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        match.played ? "Fikstür skoru" : "Bekleniyor",
        centerX,
        rowY + 70,
      );
      ctx.textAlign = "left";
    }

    players.forEach((player, colIndex) => {
      const cellX = tableX + matchColW + colIndex * playerColW;
      const pred = ensurePrediction(match.id, player.id);
      const palette = getShareCellPalette(pred, match, shareView);
      fillRoundedRect(
        ctx,
        cellX,
        rowY,
        playerColW,
        rowH,
        0,
        palette.bg,
        "rgba(148,163,184,0.08)",
      );
      fillRoundedRect(
        ctx,
        cellX + 10,
        rowY + 10,
        playerColW - 20,
        rowH - 20,
        16,
        "rgba(2,6,23,0.12)",
        palette.border,
      );
      ctx.fillStyle = palette.accent;
      ctx.font = "900 28px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        getPredictionDisplayValue(pred),
        cellX + playerColW / 2,
        rowY + 38,
      );
      ctx.font = "800 13px Inter, Arial, sans-serif";
      ctx.fillStyle = shareView === "post" ? palette.accent : "#bfdbfe";
      const status =
        shareView === "post"
          ? palette.label
          : pred.homePred !== "" && pred.awayPred !== ""
            ? "Tahmin var"
            : "Tahmin yok";
      ctx.fillText(status, cellX + playerColW / 2, rowY + 58);
      if (shareView === "post") {
        ctx.font = "900 13px Inter, Arial, sans-serif";
        ctx.fillStyle = Number(pred.points || 0) > 0 ? "#ffffff" : "#cbd5e1";
        ctx.fillText(
          `${pred.homePred !== "" && pred.awayPred !== "" ? Number(pred.points || 0) : 0}P`,
          cellX + playerColW / 2,
          rowY + 74,
        );
      }
      ctx.textAlign = "left";
    });
  }

  if (shareView === "post") {
    const sumX = margin + tableW + 18;
    const sumWidth = summaryW - 18;
    const summaryCardH = 78;
    const summaryGap = 10;
    const sumHeight = Math.min(
      panelH,
      84 + summaryRows.length * (summaryCardH + summaryGap),
    );
    fillRoundedRect(
      ctx,
      sumX,
      tableY,
      sumWidth,
      sumHeight,
      22,
      "rgba(248,250,252,0.96)",
      "rgba(148,163,184,0.22)",
    );
    ctx.fillStyle = "#0f172a";
    ctx.font = "900 24px Inter, Arial, sans-serif";
    ctx.fillText("Puan Özeti", sumX + 16, tableY + 32);
    ctx.fillStyle = "#475569";
    ctx.font = "700 13px Inter, Arial, sans-serif";
    ctx.fillText("Bu sayfadaki kullanıcılar", sumX + 16, tableY + 52);

    summaryRows.forEach((row, index) => {
      const rank = rankingMap.get(row.id) || index + 1;
      const cardY = tableY + 68 + index * (summaryCardH + summaryGap);
      const cardX = sumX + 12;
      const cardW = sumWidth - 24;
      const rankFill =
        rank === 1
          ? "rgba(16,185,129,0.20)"
          : rank === 2
            ? "rgba(245,158,11,0.18)"
            : rank === 3
              ? "rgba(59,130,246,0.18)"
              : "rgba(15,23,42,0.06)";
      const rankStroke =
        rank === 1
          ? "rgba(16,185,129,0.34)"
          : rank === 2
            ? "rgba(245,158,11,0.32)"
            : rank === 3
              ? "rgba(59,130,246,0.30)"
              : "rgba(148,163,184,0.18)";

      fillRoundedRect(
        ctx,
        cardX,
        cardY,
        cardW,
        summaryCardH,
        16,
        rankFill,
        rankStroke,
      );
      fillRoundedRect(
        ctx,
        cardX + 12,
        cardY + 12,
        28,
        28,
        14,
        rank === 1
          ? "#10b981"
          : rank === 2
            ? "#f59e0b"
            : rank === 3
              ? "#3b82f6"
              : "#334155",
        "",
      );
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 14px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(rank), cardX + 26, cardY + 31);
      ctx.textAlign = "left";

      ctx.fillStyle = "#0f172a";
      ctx.font = "900 16px Inter, Arial, sans-serif";
      const summaryName = truncateCanvasText(
        ctx,
        String(row.name || "").toUpperCase(),
        cardW - 68,
      );
      ctx.fillText(summaryName, cardX + 50, cardY + 24);

      const chips = [
        {
          label: `Hafta ${row.total || 0}P`,
          x: cardX + 50,
          y: cardY + 40,
          w: 84,
          fill: "rgba(16,185,129,0.14)",
          stroke: "rgba(16,185,129,0.26)",
          text: "#047857",
        },
        {
          label: `Tam ${row.exact || 0}`,
          x: cardX + 142,
          y: cardY + 40,
          w: 68,
          fill: "rgba(56,189,248,0.14)",
          stroke: "rgba(56,189,248,0.24)",
          text: "#0369a1",
        },
        {
          label: `Yakın ${row.resultOnly || 0}`,
          x: cardX + 218,
          y: cardY + 40,
          w: 78,
          fill: "rgba(245,158,11,0.14)",
          stroke: "rgba(245,158,11,0.24)",
          text: "#b45309",
        },
      ];

      chips.forEach((chip) => {
        fillRoundedRect(
          ctx,
          chip.x,
          chip.y,
          chip.w,
          24,
          12,
          chip.fill,
          chip.stroke,
        );
        ctx.fillStyle = chip.text;
        ctx.font = "800 11px Inter, Arial, sans-serif";
        ctx.fillText(chip.label, chip.x + 9, chip.y + 16);
      });
    });
  }

  ctx.fillStyle = "rgba(148,163,184,0.72)";
  ctx.font = "700 12px Inter, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(
    `Oluşturuldu: ${formatDate(new Date())}`,
    width - margin,
    height - 8,
  );
  ctx.textAlign = "left";

  return canvas;
}

async function exportPredictionShareImage() {
  const button = document.getElementById("downloadShareImageBtn");
  if (button) {
    button.classList.add("is-busy");
    button.textContent = "Hazırlanıyor...";
  }
  try {
    const weekId = state.settings.activeWeekId;
    if (!weekId) {
      await showAlert("Önce bir hafta seçmelisin.", {
        title: "Hafta gerekli",
        type: "warning",
      });
      return;
    }
    const matches = getMatchesByWeekId(weekId);
    const players = getVisiblePlayersOrdered();
    if (!matches.length || !players.length) {
      await showAlert(
        "Görsel oluşturmak için maç ve kullanıcı verisi gerekli.",
        { title: "Veri eksik", type: "warning" },
      );
      return;
    }

    const shareView = getPredictionShareView();
    const playersPerPage = shareView === "post" ? 6 : 7;
    const totalPages = Math.max(1, Math.ceil(players.length / playersPerPage));
    const weekLabel = `${getWeekNumberById(weekId) || "hafta"}`;
    const downloaded = [];

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      const chunk = players.slice(
        pageIndex * playersPerPage,
        pageIndex * playersPerPage + playersPerPage,
      );
      const canvas = await createPredictionShareExportCanvas(matches, chunk, {
        shareView,
        pageIndex,
        totalPages,
      });
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("PNG dosyası oluşturulamadı.");
      const suffix = totalPages > 1 ? `-sayfa-${pageIndex + 1}` : "";
      const fileName = `tahmin-paylasim-${shareView === "post" ? "mac-sonrasi" : "mac-oncesi"}-hafta-${weekLabel}${suffix}.png`;
      downloadBlobFile(blob, fileName);
      downloaded.push(fileName);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    await showAlert(
      totalPages > 1
        ? `${downloaded.length} görsel indirildi. Dosya adlarında sayfa numarası var.`
        : "Paylaşım görseli indirildi.",
      { title: "Hazır", type: "success" },
    );
  } catch (error) {
    console.error("Paylaşım görseli oluşturulamadı:", error);
    await showAlert(
      error?.message || "Görsel oluşturulurken bir hata oluştu.",
      {
        title: "İndirme başarısız",
        type: "error",
      },
    );
  } finally {
    if (button) {
      button.classList.remove("is-busy");
      button.textContent = "Görsel İndir";
    }
  }
}

function renderPredictionShareTable(container, matches, players) {
  const currentPlayerId = getCurrentPlayerId();
  const shareView = getPredictionShareView();
  const compactMode = isPredictionShareCompact();
  const fadeEmpty = isPredictionShareFadeEmpty();

  const headerPlayers = players
    .map((player) => {
      const ownClass =
        player.id === currentPlayerId ? " own-player-column" : "";
      return `<div class="player-head-col share-player-head${ownClass}"><span class="player-head-pill">${escapeHtml(player.name)}</span></div>`;
    })
    .join("");

  const rows = matches
    .map((match) => {
      const locked = isMatchLocked(match);
      const visual = getMatchVisualState(match);

      const playerCols = players
        .map((player) => {
          const pred = ensurePrediction(match.id, player.id);
          const outcomeClass = getPredictionOutcomeClass(pred, match);
          const ownClass =
            player.id === currentPlayerId ? " own-player-cell" : "";
          const value = getPredictionDisplayValue(pred);
          const isEmpty = value === "—";
          const emptyClass = isEmpty ? " share-empty" : "";
          const fadedClass = fadeEmpty && isEmpty ? " share-empty-faded" : "";
          const hasPoints = match.played && !isEmpty;
          const bottomLabel =
            shareView === "post"
              ? hasPoints
                ? `${pred.points || 0}P`
                : ""
              : locked && !match.played
                ? "🔒 Kilitli"
                : "";

          return `
      <div class="prediction-cell share-prediction-cell ${outcomeClass}${ownClass}${emptyClass}${fadedClass}">
        <div class="share-score-value">${value}</div>
        ${bottomLabel ? `<div class="mini-points share-mini-note">${bottomLabel}</div>` : `<div class="share-mini-note share-mini-note--empty"></div>`}
      </div>`;
        })
        .join("");

      return `
        <div class="prediction-grid-row share-grid-row ${compactMode ? "share-grid-row-compact" : ""} ${match.played ? "played-row" : ""} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}">
          <div class="match-sticky-cell share-match-cell">
            ${matchCell(match, { showMeta: true, metaClass: "share-match-meta", alwaysShowStatus: true })}
          </div>
          ${playerCols}
        </div>`;
    })
    .join("");

  container.innerHTML = `<div class="excel-predictions share-mode-table ${compactMode ? "share-mode-compact" : ""} share-view-${shareView}" style="--player-count:${players.length};"><div class="prediction-grid-head share-grid-head"><div>Maç</div>${headerPlayers}</div><div class="prediction-grid-body">${rows}</div></div>`;
  hydrateTeamLogosIn(container);
}

function renderPredictions() {
  const viewportSnapshot = capturePredictionViewport();
  const container = document.getElementById("predictionsTable");
  if (!container) return;
  const weekId = state.settings.activeWeekId;

  renderPredictionLockBanner(weekId);

  if (!weekId) {
    container.innerHTML = createEmptyState("Önce bir hafta seç.");
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

  const matches = getMatchesByWeekId(weekId);
  const players = getVisiblePlayersOrdered();

  if (!matches.length || !players.length) {
    container.innerHTML = createEmptyState(
      "Tahmin girmek için en az bir hafta, bir maç ve bir kişi olmalı.",
    );
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

  if (isMobileView()) {
    renderMobilePredictions(container, matches);
    hydrateTeamLogosIn(container);
    updatePredictionShareModeButton();
    bindPredictionActionElements(container);
    saveState(true);
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

  const currentPlayerId = getCurrentPlayerId();

  const headerPlayers = players
    .map((player) => {
      const ownClass =
        player.id === currentPlayerId ? " own-player-column" : "";
      const ownBadge =
        player.id === currentPlayerId
          ? '<span class="own-pill">Sen</span>'
          : "";
      return `<div class="player-head-col${ownClass}"><span class="player-head-pill">${escapeHtml(player.name)}${ownBadge}</span></div>`;
    })
    .join("");

  const rows = matches
    .map((match) => {
      const locked = isMatchLocked(match);
      const badge = getMatchBadge(match);
      const visual = getMatchVisualState(match);

      const playerCols = players
        .map((player) => {
          const pred = ensurePrediction(match.id, player.id);
          const canEdit = canEditPrediction(player.id);
          const hasPrediction =
            pred &&
            pred.homePred !== "" &&
            pred.homePred !== null &&
            pred.homePred !== undefined &&
            pred.awayPred !== "" &&
            pred.awayPred !== null &&
            pred.awayPred !== undefined;
          const outcomeClass = getPredictionOutcomeClass(pred, match);
          const ownClass =
            player.id === currentPlayerId ? " own-player-cell" : "";
          const uiKey = getPredictionUiKey(match.id, player.id);
          const isSaving = predictionUiState[uiKey] === "saving";

          const statusText = getPredictionBaseStatus(match.id, player.id);
          const showDeleteAction = hasPrediction || pred.remoteId || isSaving;
          const showSaveAction =
            canEdit && shouldShowPredictionSaveAction(match.id, player.id);

          const pointValue = Number(pred.points || 0);
          const showPointBadge = hasPrediction;
          const badgeText = locked && !match.played ? "🔒" : `${pointValue}P`;
          const badgeBg =
            locked && !match.played
              ? "linear-gradient(135deg,#64748b,#475569)"
              : pointValue >= 3
                ? "linear-gradient(135deg,#10b981,#059669)"
                : pointValue >= 1
                  ? "linear-gradient(135deg,#2563eb,#1d4ed8)"
                  : "linear-gradient(135deg,#475569,#334155)";

          return `
        <div class="prediction-cell ${pointLabel(pred.points)} ${outcomeClass} ${locked || !canEdit ? "locked-cell" : ""}${ownClass}${showPointBadge ? " has-point-badge" : ""}" style="position:relative; padding-top:${showPointBadge ? "16px" : "8px"};">
        ${showPointBadge ? `<div class="points-badge-inline" style="position:absolute; top:6px; left:6px; z-index:3; min-width:34px; height:20px; padding:0 7px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; line-height:1; color:#fff; background:${badgeBg}; box-shadow:0 4px 14px rgba(0,0,0,.18);">${badgeText}</div>` : ""}
        <div class="score-inputs compact-inputs center-mode pred-score-row">
            <input
              type="number"
              min="0"
              value="${pred.homePred}"
              id="pred_home_${match.id}_${player.id}"
              data-pred-role="input"
              data-match-id="${match.id}"
              data-player-id="${player.id}"
              ${locked || !canEdit ? "disabled" : ""}
              oninput="window.queuePredictionSave && window.queuePredictionSave('${match.id}','${player.id}')"
            />
            <span>-</span>
            <input
              type="number"
              min="0"
              value="${pred.awayPred}"
              id="pred_away_${match.id}_${player.id}"
              data-pred-role="input"
              data-match-id="${match.id}"
              data-player-id="${player.id}"
              ${locked || !canEdit ? "disabled" : ""}
              oninput="window.queuePredictionSave && window.queuePredictionSave('${match.id}','${player.id}')"
            />
          </div>

          <div class="pred-action-area">
          
            ${
              locked || !canEdit
                ? `<div class="prediction-save-wrap pred-btn-slot"></div>`
                : `<div class="prediction-save-wrap pred-btn-slot prediction-button-row">
                    <button
                      class="secondary small prediction-action-btn ${showSaveAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_btn_${match.id}_${player.id}"
                      data-pred-role="save-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      onclick="if(!this.disabled && window.queuePredictionSave){ event.preventDefault(); event.stopPropagation(); window.queuePredictionSave('${match.id}','${player.id}', true); } return false;"
                    >
                      ${getPredictionSaveLabel(match.id, player.id)}
                    </button>
                    <button
                      class="secondary small danger prediction-delete-btn ${showDeleteAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_delete_${match.id}_${player.id}"
                      data-pred-role="delete-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      onclick="if(!this.disabled && window.deletePredictionEntry){ event.preventDefault(); event.stopPropagation(); window.deletePredictionEntry('${match.id}','${player.id}'); } return false;"
                    >
                      Sil
                    </button>
                  </div>`
            }

            <div class="pred-status-slot">
              <div class="prediction-status-chip ${outcomeClass}" id="pred_status_${match.id}_${player.id}">${statusText}</div>
            </div>
          </div>

    
        </div>`;
        })
        .join("");

      return `
      <div class="prediction-grid-row ${match.played ? "played-row" : ""} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}">
        <div class="match-sticky-cell">
          ${matchCell(match, { showMeta: true, metaClass: "desktop-match-meta" })}
        </div>
        ${playerCols}
      </div>`;
    })
    .join("");

  container.innerHTML = `<div class="predictions-scroll-shell"><div class="excel-predictions" style="--player-count:${players.length};"><div class="prediction-grid-head"><div>Maç</div>${headerPlayers}</div><div class="prediction-grid-body">${rows}</div></div></div>`;

  updatePredictionShareModeButton();
  bindPredictionActionElements(container);
  bindPredictionTableDesktopScroll();
  saveState(true);
  schedulePredictionViewportRestore(viewportSnapshot);
}

const predictionTimers = {};
const predictionUiState = {};
const predictionUiResetTimers = {};

function getPredictionUiKey(matchId, playerId) {
  return `${matchId}_${playerId}`;
}

function getPredictionBaseStatus(matchId, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  const pred = ensurePrediction(matchId, playerId);
  const canEdit = canEditPrediction(playerId);

  const hasPrediction = pred.homePred !== "" && pred.awayPred !== "";
  const hasAnyValue = pred.homePred !== "" || pred.awayPred !== "";

  if (!match) return "";
  if (!match.played && isMatchLocked(match)) return "🔒 Kilitli";
  if (match.played) {
    if ((pred.points || 0) === 3) return "Tam skor";
    if ((pred.points || 0) === 1) return "Yakın";
    if (hasPrediction) return "Yanlış";
    return "Boş";
  }
  if (!canEdit) return "Sadece görüntüle";
  if (hasAnyValue && !hasPrediction) return "İki skor da girilmeli";
  return "Düzenlenebilir";
}

function bindPredictionTableDesktopScroll() {
  const shell = document.querySelector(
    "#predictionsTable .predictions-scroll-shell",
  );
  if (!shell) return;

  if (shell._dragScrollBound) return;
  shell._dragScrollBound = true;

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let startScrollTop = 0;
  let dragging = false;

  const stopDrag = () => {
    if (pointerId !== null) {
      try {
        shell.releasePointerCapture(pointerId);
      } catch (error) {}
    }
    pointerId = null;
    dragging = false;
    shell.classList.remove("is-dragging");
  };

  shell.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest("button, input, select, textarea, label, a"))
      return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startScrollLeft = shell.scrollLeft;
    startScrollTop = shell.scrollTop;
    dragging = false;
    shell.classList.add("can-drag");
    try {
      shell.setPointerCapture(pointerId);
    } catch (error) {}
  });

  shell.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (!dragging && (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6)) {
      dragging = true;
      shell.classList.add("is-dragging");
    }
    if (!dragging) return;
    shell.scrollLeft = startScrollLeft - deltaX;
    shell.scrollTop = startScrollTop - deltaY;
    event.preventDefault();
  });

  shell.addEventListener("pointerup", stopDrag);
  shell.addEventListener("pointercancel", stopDrag);
  shell.addEventListener("lostpointercapture", stopDrag);
}

function hasPredictionValue(matchId, playerId) {
  const pred = getPrediction(matchId, playerId);
  return !!(
    pred &&
    ((pred.homePred !== "" && pred.awayPred !== "") || pred.remoteId)
  );
}

function updatePredictionDeleteButton(matchId, playerId, forceVisible = null) {
  const button = document.getElementById(`pred_delete_${matchId}_${playerId}`);
  if (!button) return;
  const shouldShow =
    typeof forceVisible === "boolean"
      ? forceVisible
      : hasPredictionValue(matchId, playerId);
  button.classList.toggle("is-hidden", !shouldShow);
  button.disabled =
    predictionUiState[getPredictionUiKey(matchId, playerId)] === "deleting";
  button.setAttribute("aria-hidden", shouldShow ? "false" : "true");
}

function getPredictionSaveLabel(matchId, playerId) {
  const key = getPredictionUiKey(matchId, playerId);
  const uiState = predictionUiState[key] || "idle";
  const pred = getPrediction(matchId, playerId);
  const hasSavedValue = !!(pred && pred.remoteId);

  if (uiState === "saving") return "Kaydediliyor...";
  if (uiState === "deleting") return "Siliniyor...";
  if (uiState === "saved") return hasSavedValue ? "Güncellendi" : "Kaydedildi";
  if (uiState === "deleted") return "Kaydet";
  if (uiState === "queued") return "Sıraya alındı";
  if (uiState === "deleteQueued") return "Silinecek";
  if (uiState === "dirty") return hasSavedValue ? "Güncelle" : "Kaydet";
  if (uiState === "deleteError") return "Tekrar sil";
  if (uiState === "error")
    return hasSavedValue ? "Tekrar güncelle" : "Tekrar kaydet";
  if (hasSavedValue) return "Güncelle";
  return "Kaydet";
}

function getPredictionInputElements(matchId, playerId) {
  return {
    homeInput: document.getElementById(`pred_home_${matchId}_${playerId}`),
    awayInput: document.getElementById(`pred_away_${matchId}_${playerId}`),
  };
}

function getPredictionInputSnapshot(matchId, playerId) {
  const pred = ensurePrediction(matchId, playerId);
  const { homeInput, awayInput } = getPredictionInputElements(
    matchId,
    playerId,
  );
  const homePred = parseNumberOrEmpty(homeInput?.value ?? pred.homePred ?? "");
  const awayPred = parseNumberOrEmpty(awayInput?.value ?? pred.awayPred ?? "");
  return {
    pred,
    homeInput,
    awayInput,
    homePred,
    awayPred,
  };
}

function hasStoredPredictionRecord(matchId, playerId) {
  const pred = getPrediction(matchId, playerId);
  return !!(
    pred &&
    ((pred.homePred !== "" && pred.awayPred !== "") || pred.remoteId)
  );
}

function hasPredictionInputChanged(matchId, playerId) {
  const { pred, homePred, awayPred } = getPredictionInputSnapshot(
    matchId,
    playerId,
  );
  return (
    homePred !== parseNumberOrEmpty(pred.homePred) ||
    awayPred !== parseNumberOrEmpty(pred.awayPred)
  );
}

function shouldShowPredictionSaveAction(matchId, playerId) {
  const key = getPredictionUiKey(matchId, playerId);
  const uiState = predictionUiState[key] || "idle";
  if (["saving", "queued", "error", "deleteError"].includes(uiState))
    return true;

  if (!hasStoredPredictionRecord(matchId, playerId)) return false;

  const { homePred, awayPred } = getPredictionInputSnapshot(matchId, playerId);
  if (homePred === "" || awayPred === "") return false;

  return uiState === "dirty" || hasPredictionInputChanged(matchId, playerId);
}

function shouldAutoSavePrediction(matchId, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return false;
  if (
    (isMatchLocked(match) && getCurrentRole() !== "admin") ||
    !canEditPrediction(playerId)
  ) {
    return false;
  }

  const key = getPredictionUiKey(matchId, playerId);
  const uiState = predictionUiState[key] || "idle";
  if (["saving", "deleting"].includes(uiState)) return false;

  const { homePred, awayPred } = getPredictionInputSnapshot(matchId, playerId);
  if (homePred === "" || awayPred === "") return false;

  return !hasStoredPredictionRecord(matchId, playerId);
}

function focusPredictionSiblingInput(target) {
  if (!target) return;
  const { matchId, playerId } = target.dataset || {};
  if (!matchId || !playerId) return;

  const isHomeInput = target.id === `pred_home_${matchId}_${playerId}`;
  const siblingId = isHomeInput
    ? `pred_away_${matchId}_${playerId}`
    : `pred_home_${matchId}_${playerId}`;
  const sibling = document.getElementById(siblingId);
  if (!sibling || sibling.disabled) return;

  requestAnimationFrame(() => {
    sibling.focus();
    if (typeof sibling.select === "function") sibling.select();
  });
}
function blurPredictionInputAndCloseKeyboard(input) {
  if (!input) return;

  let sink = document.getElementById("mobile-keyboard-dismiss-sink");
  if (!sink) {
    sink = document.createElement("button");
    sink.id = "mobile-keyboard-dismiss-sink";
    sink.type = "button";
    sink.setAttribute("aria-hidden", "true");
    sink.tabIndex = -1;
    sink.style.position = "fixed";
    sink.style.opacity = "0";
    sink.style.pointerEvents = "none";
    sink.style.width = "1px";
    sink.style.height = "1px";
    sink.style.left = "0";
    sink.style.top = "0";
    sink.style.padding = "0";
    sink.style.border = "0";
    document.body.appendChild(sink);
  }

  input.blur();

  requestAnimationFrame(() => {
    try {
      sink.focus({ preventScroll: true });
    } catch (_) {
      sink.focus();
    }

    input.blur();

    requestAnimationFrame(() => {
      if (document.activeElement === sink || document.activeElement === input) {
        document.body.focus?.();
        input.blur();
      }
    });
  });
}
function setPredictionUiState(matchId, playerId, uiState) {
  const key = getPredictionUiKey(matchId, playerId);
  predictionUiState[key] = uiState;

  if (predictionUiResetTimers[key]) {
    clearTimeout(predictionUiResetTimers[key]);
    delete predictionUiResetTimers[key];
  }

  const button = document.getElementById(`pred_btn_${matchId}_${playerId}`);
  if (button) {
    button.textContent = getPredictionSaveLabel(matchId, playerId);
    button.disabled = uiState === "saving" || uiState === "deleting";
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    button.style.pointerEvents = "auto";
    button.dataset.saveState = uiState;
    button.classList.toggle(
      "is-saving",
      uiState === "saving" || uiState === "deleting",
    );
    button.classList.toggle(
      "is-saved",
      uiState === "saved" || uiState === "deleted",
    );
    button.classList.toggle(
      "is-error",
      uiState === "error" || uiState === "deleteError",
    );
    button.classList.toggle("is-dirty", uiState === "dirty");
    button.classList.toggle(
      "is-queued",
      uiState === "queued" || uiState === "deleteQueued",
    );
  }

  const deleteButton = document.getElementById(
    `pred_delete_${matchId}_${playerId}`,
  );
  if (deleteButton) {
    deleteButton.disabled = uiState === "saving" || uiState === "deleting";
    deleteButton.classList.toggle("is-working", uiState === "deleting");
  }
  updatePredictionDeleteButton(
    matchId,
    playerId,
    uiState === "deleting" ? true : null,
  );
  const status = document.getElementById(`pred_status_${matchId}_${playerId}`);
  if (status) {
    if (uiState === "saving") {
      status.textContent = "Firebase'e gönderiliyor...";
      status.dataset.saveState = "saving";
    } else if (uiState === "deleting") {
      status.textContent = "Tahmin Firebase'ten siliniyor...";
      status.dataset.saveState = "saving";
    } else if (uiState === "saved") {
      status.textContent = "Firebase ile eşitlendi";
      status.dataset.saveState = "saved";
    } else if (uiState === "deleted") {
      status.textContent = "Tahmin silindi";
      status.dataset.saveState = "saved";
    } else if (uiState === "dirty") {
      status.textContent = "Değişiklik var, Kaydet'e bas";
      status.dataset.saveState = "dirty";
    } else if (uiState === "queued") {
      status.textContent = "Sıraya alındı • Bağlantı gelince gönderilecek";
      status.dataset.saveState = "queued";
    } else if (uiState === "deleteQueued") {
      status.textContent = "Silme sıraya alındı • Bağlantı gelince uygulanacak";
      status.dataset.saveState = "queued";
    } else if (uiState === "deleteError") {
      status.textContent = "Tahmin silinemedi";
      status.dataset.saveState = "error";
    } else if (uiState === "error") {
      status.textContent = "Firebase kaydı başarısız";
      status.dataset.saveState = "error";
    } else {
      status.textContent = getPredictionBaseStatus(matchId, playerId);
      status.dataset.saveState = "idle";
    }
  }

  if (uiState === "saved" || uiState === "deleted") {
    predictionUiResetTimers[key] = setTimeout(() => {
      setPredictionUiState(matchId, playerId, "idle");
    }, 2200);
  } else if (uiState === "error") {
    predictionUiResetTimers[key] = setTimeout(() => {
      setPredictionUiState(matchId, playerId, "dirty");
    }, 4200);
  } else if (uiState === "deleteError") {
    predictionUiResetTimers[key] = setTimeout(() => {
      setPredictionUiState(
        matchId,
        playerId,
        hasPredictionValue(matchId, playerId) ? "idle" : "dirty",
      );
    }, 4200);
  }
}
window.queuePredictionSave = function (
  matchId,
  playerId,
  immediate = false,
  viewportSnapshot = null,
) {
  const key = getPredictionUiKey(matchId, playerId);
  clearTimeout(predictionTimers[key]);

  const snapshot =
    viewportSnapshot || capturePredictionViewport({ matchId, playerId });

  if (immediate) {
    window.savePrediction(matchId, playerId, { viewportSnapshot: snapshot });
    schedulePredictionViewportRestore(snapshot);
    return;
  }

  setPredictionUiState(matchId, playerId, "dirty");
  updatePredictionDeleteButton(matchId, playerId, true);
  schedulePredictionViewportRestore(snapshot);
};

window.deletePredictionEntry = async function (matchId, playerId) {
  const viewportSnapshot = capturePredictionViewport({ matchId, playerId });
  const btn = document.getElementById(`pred_delete_${matchId}_${playerId}`);
  if (!btn) return;

  const pred = getPrediction(matchId, playerId);

  if (!pred) return;

  btn.innerText = "Siliniyor...";
  btn.disabled = true;

  try {
    const payload = {
      matchId: matchId,
      playerId: playerId,
      kullaniciAdi: getCurrentUsername(),

      // 🔥 EN KRİTİK
      predictionId: pred.remoteId || pred.id || "",
      recordKey: `${matchId}_${playerId}`,

      sezon: getActiveSeasonLabel(),
      haftaNo: getWeekNumberById(state.settings.activeWeekId),
    };

    const result = await deleteOnlinePrediction(payload);

    console.log("DELETE RESULT:", result);

    // 🔥 HER DURUMDA UI RESET
    btn.innerText = "Sil";
    btn.disabled = false;

    if (result?.success) {
      // local temizle
      clearLocalPredictionRecord(matchId, playerId);

      // UI yenile
      renderAll();
    } else {
      console.warn("Sheet silme başarısız:", result?.message);
      renderAll();
    }
  } catch (err) {
    console.error("Silme hatası:", err);

    btn.innerText = "Sil";
    btn.disabled = false;
  } finally {
    schedulePredictionViewportRestore(viewportSnapshot);
  }
};

window.savePrediction = async function (matchId, playerId, options = {}) {
  const viewportSnapshot =
    options.viewportSnapshot ||
    capturePredictionViewport({ matchId, playerId });
  const match = state.matches.find((m) => m.id === matchId);

  if (
    !match ||
    (isMatchLocked(match) && getCurrentRole() !== "admin") ||
    !canEditPrediction(playerId)
  ) {
    return;
  }

  const key = getPredictionUiKey(matchId, playerId);

  if (predictionUiState[key] === "saving") {
    return;
  }

  clearTimeout(predictionTimers[key]);

  const pred = ensurePrediction(matchId, playerId);

  const homeInput = document.getElementById(
    `pred_home_${match.id}_${playerId}`,
  );
  const awayInput = document.getElementById(
    `pred_away_${match.id}_${playerId}`,
  );

  const homeValue = homeInput?.value ?? "";
  const awayValue = awayInput?.value ?? "";

  const homePred = parseNumberOrEmpty(homeValue);
  const awayPred = parseNumberOrEmpty(awayValue);

  pred.homePred = homePred;
  pred.awayPred = awayPred;
  pred.points = match.played
    ? calcPoints(homePred, awayPred, match.homeScore, match.awayScore)
    : 0;
  pred.username = getCurrentUsername();

  saveState(true);
  renderStandings();
  renderMissingPredictions();
  renderStats();
  renderAdvancedStats();
  schedulePredictionViewportRestore(viewportSnapshot);

  if (homePred === "" || awayPred === "") {
    setPredictionUiState(matchId, playerId, "dirty");
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

  if (!useOnlineMode || !isAuthenticated()) {
    setPredictionUiState(matchId, playerId, "saved");
    updatePredictionDeleteButton(matchId, playerId, true);
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

  setPredictionUiState(matchId, playerId, "saving");

  predictionTimers[key] = setTimeout(() => {
    if (predictionUiState[key] === "saving") {
      setPredictionUiState(matchId, playerId, "error");
    }
  }, 20000);

  playerId = normalizeEntityId(playerId);
  const player = getPlayerById(playerId);
  const seasonLabel = getActiveSeasonLabel();
  const weekNumber = getWeekNumberById(match.weekId);
  const recordKey = `${seasonLabel}_${weekNumber}_${playerId}_${match.id}`;

  const payload = {
    season: seasonLabel,
    sezon: seasonLabel,
    seasonId: match.seasonId,
    weekNo: weekNumber,
    haftaNo: weekNumber,
    weekId: match.weekId,
    matchId: match.id,
    localMatchId: match.id,
    sheetMatchId:
      match.sheetMatchId || match.remoteMatchId || match.macId || "",
    matchKey: recordKey,
    recordKey,
    playerId,
    kullaniciId: playerId,
    kullaniciAdi: getPlayerById(playerId)?.username || getCurrentUsername(),
    adSoyad: player?.name || getAuthUser()?.adSoyad || "",
    playerName: player?.name || "",
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homePred,
    awayPred,
    tahminEv: homePred,
    tahminDep: awayPred,
  };

  try {
    const result = await saveOnlinePrediction(payload);

    clearTimeout(predictionTimers[key]);

    if (!result?.success) {
      console.error("Online tahmin kaydedilemedi:", result);
      setPredictionUiState(matchId, playerId, "error");
      showAlert(result?.message || "Tahmin veritabanına kaydedilemedi.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
      schedulePredictionViewportRestore(viewportSnapshot);
      return;
    }

    if (result.sheetMatchId) {
      match.sheetMatchId = String(result.sheetMatchId);
    }

    upsertLocalPredictionRecord({
      matchId,
      playerId,
      homePred,
      awayPred,
      points: pred.points,
      remoteId: result.id || result.predictionId || pred.id,
      username: getPlayerById(playerId)?.username || getCurrentUsername(),
    });

    pred.remoteId =
      result.id || result.predictionId || pred.remoteId || pred.id;

    dequeuePredictionRetry(payload);
    saveState(true);
    setPredictionUiState(matchId, playerId, "saved");
    schedulePredictionViewportRestore(viewportSnapshot);
  } catch (error) {
    clearTimeout(predictionTimers[key]);
    console.error("Online tahmin kaydı hatası:", error);

    const timeoutError = String(error?.message || "").includes(
      "zaman aşımına uğradı",
    );

    if (timeoutError) {
      setPredictionUiState(matchId, playerId, "saving");

      setTimeout(() => {
        if (predictionUiState[key] === "saving") {
          setPredictionUiState(matchId, playerId, "saved");
        }
      }, 1500);

      enqueuePredictionRetry(payload);
      setPredictionUiState(matchId, playerId, "queued");
      recordAdminSyncActivity({
        lastAction: `${getPlayerById(playerId)?.name || "Kullanıcı"} tahmini sıraya alındı.`,
      });
      showAlert(
        "Veritabanı yanıtı geç geldi. Tahmin yerelde korundu ve sıraya alındı. Bağlantı uygun olduğunda otomatik tekrar gönderilecek.",
        {
          title: "Geciken Yanıt",
          type: "info",
        },
      );
      schedulePredictionViewportRestore(viewportSnapshot);
      return;
    }

    enqueuePredictionRetry(payload);
    setPredictionUiState(matchId, playerId, "queued");
    recordAdminSyncActivity({
      lastAction: `${getPlayerById(playerId)?.name || "Kullanıcı"} tahmini çevrimdışı sıraya alındı.`,
      lastError: error?.message || "Bağlantı gecikmesi",
    });
    showAlert(
      "Veri bağlantısında hata oluştu. Tahmin kaybolmadı; sıraya alındı ve bağlantı geldiğinde otomatik tekrar gönderilecek.",
      {
        title: "Bağlantı Hatası",
        type: "warning",
      },
    );
    schedulePredictionViewportRestore(viewportSnapshot);
  }
};

function standingsRows(rows, showPredictionCount = true, options = {}) {
  const topThree = new Set([0, 1, 2]);
  const leaderId = options.leaderId || null;
  return `<div class="standings-table excel-table compact-table premium-standings"><div class="excel-thead standings-head"><div>#</div><div>Kişi</div><div>Toplam</div><div>Tam Skor</div><div>Yakın</div><div>${showPredictionCount ? "Tahmin" : "Hafta"}</div></div><div class="excel-tbody">${rows
    .map((row, i) => {
      const rankClass = topThree.has(i) ? ` podium-${i + 1}` : "";
      const leaderClass = row.id === leaderId ? " weekly-leader-row" : "";
      const badge =
        i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
      return `<div class="excel-tr standings-tr ${i === 0 ? "leader-row" : ""}${rankClass}${leaderClass}"><div class="rank-pill">${badge}</div><div class="standing-name-cell">${escapeHtml(row.name)}${row.id === leaderId ? `<span class="weekly-leader-pill">${options.weeklyMode ? "Haftanın Lideri" : "Lider"}</span>` : ""}</div><div><strong>${row.total}</strong></div><div>${row.exact}</div><div>${row.resultOnly}</div><div>${showPredictionCount ? row.predictionCount : row.total}</div></div>`;
    })
    .join("")}</div></div>`;
}

function renderStandings() {
  const seasonId = getActiveSeasonId();
  const general = getGeneralStandings(seasonId);
  const weekId = state.settings.activeWeekId;
  const weekly = weekId ? getWeeklyStandings(weekId) : [];

  const generalLeaderId = general[0]?.id || null;
  const weeklyLeaderId = weekly[0]?.id || null;

  document.getElementById("standingsTable").innerHTML = general.length
    ? isMobileView()
      ? standingsRowsMobile(general, true, { leaderId: generalLeaderId })
      : standingsRows(general, true, { leaderId: generalLeaderId })
    : createEmptyState("Henüz puan tablosu oluşmadı.");

  document.getElementById("weeklyStandings").innerHTML = weekly.length
    ? isMobileView()
      ? standingsRowsMobile(weekly, false, {
          leaderId: weeklyLeaderId,
          weeklyMode: true,
        })
      : standingsRows(weekly, false, {
          leaderId: weeklyLeaderId,
          weeklyMode: true,
        })
    : createEmptyState("Seçili hafta için puan oluşmadı.");
}

function renderMissingPredictions() {
  const container = document.getElementById("missingPredictions");
  const weekId = state.settings.activeWeekId;
  if (!weekId)
    return (container.innerHTML = createEmptyState("Önce aktif hafta seç."));
  const rows = [];
  getMatchesByWeekId(weekId).forEach((match) => {
    state.players
      .filter((player) => getPlayerRole(player) !== "admin")
      .forEach((player) => {
        const pred = getPrediction(match.id, player.id);
        if (!pred || pred.homePred === "" || pred.awayPred === "")
          rows.push({
            player: player.name,
            match: `${match.homeTeam} - ${match.awayTeam}`,
          });
      });
  });
  if (!rows.length)
    return (container.innerHTML = createEmptyState(
      "Harika. Bu hafta eksik tahmin yok.",
    ));
  container.innerHTML = `<div class="excel-table compact-table"><div class="excel-thead missing-head"><div>Kişi</div><div>Maç</div></div><div class="excel-tbody">${rows.map((row) => `<div class="excel-tr missing-tr"><div>${escapeHtml(row.player)}</div><div>${escapeHtml(row.match)}</div></div>`).join("")}</div></div>`;
}

function getSortedSeasonMatches(seasonId = getActiveSeasonId()) {
  return [...getMatchesBySeasonId(seasonId)].sort((a, b) => {
    const aTs = a.date ? new Date(a.date).getTime() : 0;
    const bTs = b.date ? new Date(b.date).getTime() : 0;
    if (aTs !== bTs) return aTs - bTs;
    return String(a.id).localeCompare(String(b.id), "tr");
  });
}

function getPlayerSeasonStats(seasonId = getActiveSeasonId()) {
  const seasonMatches = getSortedSeasonMatches(seasonId);
  const matchIdSet = new Set(seasonMatches.map((match) => String(match.id)));
  const players = state.players.filter(
    (player) => getPlayerRole(player) !== "admin",
  );

  return players
    .map((player) => {
      const preds = state.predictions.filter(
        (pred) =>
          String(pred.playerId) === String(player.id) &&
          matchIdSet.has(String(pred.matchId)),
      );
      const filledPreds = preds.filter(
        (pred) => pred.homePred !== "" && pred.awayPred !== "",
      );
      const total = preds.reduce((sum, pred) => sum + (pred.points || 0), 0);
      const exact = preds.filter((pred) => pred.points === 3).length;
      const resultOnly = preds.filter((pred) => pred.points === 1).length;
      const average = filledPreds.length
        ? (total / filledPreds.length).toFixed(2)
        : "0.00";
      const recentForm = seasonMatches
        .map((match) =>
          preds.find((pred) => String(pred.matchId) === String(match.id)),
        )
        .filter(Boolean)
        .filter((pred) => pred.homePred !== "" && pred.awayPred !== "")
        .slice(-5)
        .map((pred) => Number(pred.points || 0));

      return {
        id: player.id,
        name: player.name,
        total,
        exact,
        resultOnly,
        predictionCount: filledPreds.length,
        average,
        recentForm,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.exact - a.exact ||
        b.resultOnly - a.resultOnly ||
        a.name.localeCompare(b.name, "tr"),
    )
    .map((item, index, arr) => ({
      ...item,
      rank: index + 1,
      gapToLeader: arr[0] ? arr[0].total - item.total : 0,
    }));
}

function renderAdvancedStats() {
  const seasonId = getActiveSeasonId();
  const info = getSeasonInsights(seasonId);
  const champion = getChampion(seasonId);
  const playerStats = getPlayerSeasonStats(seasonId);
  const liveLeader = playerStats[0] || null;
  const risingStar =
    [...playerStats].sort(
      (a, b) =>
        b.recentForm.reduce((sum, point) => sum + point, 0) -
          a.recentForm.reduce((sum, point) => sum + point, 0) ||
        b.average - a.average,
    )[0] || null;
  const sharpShooter =
    [...playerStats].sort(
      (a, b) => b.exact - a.exact || b.total - a.total,
    )[0] || null;
  const safePredictor =
    [...playerStats].sort(
      (a, b) => b.resultOnly - a.resultOnly || b.total - a.total,
    )[0] || null;

  document.getElementById("advancedStatsGrid").innerHTML = [
    ["Sezon Maçı", info.totalMatches],
    ["Oynanan", info.playedMatches],
    ["Maç Başına Ortalama Puan", info.averagePoints],
    [
      "En Çok Tam Skor",
      info.bestExact ? `${info.bestExact.name} (${info.bestExact.exact})` : "-",
    ],
    [
      "En Çok Doğru Sonuç",
      info.bestResult
        ? `${info.bestResult.name} (${info.bestResult.resultOnly})`
        : "-",
    ],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`,
    )
    .join("");

  document.getElementById("insightsList").innerHTML = playerStats.length
    ? `<div class="player-stats-grid">${playerStats
        .map((player) => {
          const formMarkup = player.recentForm.length
            ? player.recentForm
                .map((point) => `<span class="form-pill">${point}p</span>`)
                .join("")
            : '<span class="small-meta">Henüz tahmin yok</span>';
          return `
            <article class="player-stat-card ${player.rank === 1 ? "is-leader" : ""}">
              <div class="player-stat-head">
                <div>
                  <div class="player-stat-name">${escapeHtml(player.name)}</div>
                  <div class="small-meta">Genel sıra: #${player.rank}</div>
                </div>
                <div class="player-rank-badge">#${player.rank}</div>
              </div>
              <div class="player-stat-metrics">
                <div class="player-mini-stat"><span>Puan</span><strong>${player.total}</strong></div>
                <div class="player-mini-stat"><span>Tam skor</span><strong>${player.exact}</strong></div>
                <div class="player-mini-stat"><span>Doğru sonuç</span><strong>${player.resultOnly}</strong></div>
                <div class="player-mini-stat"><span>Tahmin</span><strong>${player.predictionCount}</strong></div>
                <div class="player-mini-stat"><span>Ortalama</span><strong>${player.average}</strong></div>
                <div class="player-mini-stat"><span>Lidere fark</span><strong>${player.rank === 1 ? "Lider" : `-${player.gapToLeader}`}</strong></div>
              </div>
              <div class="player-form-row">
                <span class="small-meta">Son 5 maç</span>
                <div class="player-form-pills">${formMarkup}</div>
              </div>
            </article>`;
        })
        .join("")}</div>`
    : createEmptyState("Henüz oyuncu istatistiği oluşmadı.");

  const championLabel = champion
    ? `${champion.name}, sezonu ${champion.total} puanla şampiyon kapattı.`
    : liveLeader
      ? `${liveLeader.name}, sezon bugün bitse ${liveLeader.total} puanla şampiyon olur.`
      : "Henüz canlı lider oluşmadı.";

  document.getElementById("championCard").innerHTML = liveLeader
    ? `
    <div class="champion-inner live-champion-card">
      <div class="champion-kicker">Haftalık canlı şampiyon görünümü</div>
      <div class="champion-name">👑 ${escapeHtml(liveLeader.name)}</div>
      <div class="champion-score">${liveLeader.total} puan</div>
      <div class="champion-summary">Sezon bugün bitse lider bu oyuncu olur.</div>
      <div class="champion-highlights">
        <div class="champion-highlight"><span>Sıra</span><strong>#${liveLeader.rank}</strong></div>
        <div class="champion-highlight"><span>Tam skor</span><strong>${liveLeader.exact}</strong></div>
        <div class="champion-highlight"><span>Doğru sonuç</span><strong>${liveLeader.resultOnly}</strong></div>
        <div class="champion-highlight"><span>Ortalama</span><strong>${liveLeader.average}</strong></div>
      </div>
      <div class="champion-side-notes">
        <div class="champion-note-card">
          <span>Yükselen oyuncu</span>
          <strong>${risingStar ? escapeHtml(risingStar.name) : "-"}</strong>
          <small>${risingStar ? `${risingStar.recentForm.reduce((sum, point) => sum + point, 0)} puan / son 5 maç` : "Veri yok"}</small>
        </div>
        <div class="champion-note-card">
          <span>Keskin nişancı</span>
          <strong>${sharpShooter ? escapeHtml(sharpShooter.name) : "-"}</strong>
          <small>${sharpShooter ? `${sharpShooter.exact} tam skor` : "Veri yok"}</small>
        </div>
        <div class="champion-note-card">
          <span>En güvenli tahminci</span>
          <strong>${safePredictor ? escapeHtml(safePredictor.name) : "-"}</strong>
          <small>${safePredictor ? `${safePredictor.resultOnly} doğru sonuç` : "Veri yok"}</small>
        </div>
      </div>
      <div class="small-meta champion-footer-note">${escapeHtml(championLabel)}</div>
      ${champion ? `<button onclick="celebrateChampion('${seasonId}', true)">Şampiyonu Kutla</button>` : ""}
    </div>`
    : createEmptyState("Şampiyon kartı için henüz yeterli veri yok.");

  if (champion && !state.settings.celebratedChampions[seasonId])
    celebrateChampion(seasonId, false);
}

function showLeaderToast(message) {
  const toast = document.getElementById("leaderToast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showLeaderToast.timer);
  showLeaderToast.timer = setTimeout(
    () => toast.classList.remove("show"),
    2200,
  );
}

let statsCelebrationTimer = null;
let lastStatsCelebrationAt = 0;

function createConfettiBurst(options = {}) {
  const layer = document.getElementById("confettiLayer");
  if (!layer) return;

  const count = Number(options.count || 120);
  const clearAfter = Number(options.clearAfter || 4500);
  const minDuration = Number(options.minDuration || 2);
  const maxDuration = Number(options.maxDuration || 4);
  const maxDelay = Number(options.maxDelay || 0.5);

  layer.innerHTML = "";
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * maxDelay}s`;
    piece.style.animationDuration = `${minDuration + Math.random() * Math.max(0.2, maxDuration - minDuration)}s`;
    piece.style.transform = `translateY(-20px) rotate(${Math.random() * 360}deg)`;
    layer.appendChild(piece);
  }

  clearTimeout(createConfettiBurst.timer);
  createConfettiBurst.timer = setTimeout(() => {
    if (layer) layer.innerHTML = "";
  }, clearAfter);
}

function triggerStatsCelebration(force = false) {
  if ((state.settings.currentTab || "dashboard") !== "stats") return;

  const now = Date.now();
  if (!force && now - lastStatsCelebrationAt < 1200) return;
  lastStatsCelebrationAt = now;

  clearTimeout(statsCelebrationTimer);
  statsCelebrationTimer = setTimeout(() => {
    createConfettiBurst({
      count: window.innerWidth <= 720 ? 72 : 110,
      clearAfter: 3400,
      minDuration: 1.8,
      maxDuration: 3.1,
      maxDelay: 0.35,
    });
  }, 180);
}

window.celebrateChampion = function (seasonId, manual = false) {
  const champion = getChampion(seasonId);
  if (!champion) return;
  state.settings.celebratedChampions[seasonId] = true;
  saveState(true);
  document.getElementById("championModalTitle").textContent =
    `${champion.name} şampiyon!`;
  document.getElementById("championModalText").textContent =
    `${getSeasonById(seasonId)?.name || "Sezon"} ${champion.total} puanla tamamlandı.`;
  document.getElementById("championModal").classList.remove("hidden");
  createConfettiBurst();
  if (manual) showLeaderToast("Şampiyon kutlaması açıldı!");
};

function renderAll() {
  const viewportSnapshot = capturePredictionViewport();
  ensureActiveSelections();
  recalculateAllPoints();
  saveState(true);
  renderSelects();
  renderStats();
  renderDashboardSyncCard();
  renderFirebaseAdminPanel();
  bindAdminPanelTableScroll();
  updateAdminSyncPanel();
  renderSeasons();
  renderPlayers();
  renderWeeks();
  renderMatches(
    "matchesList",
    document.getElementById("matchesFilterWeek").value ||
      state.settings.activeWeekId,
  );
  renderPredictions();
  renderStandings();
  renderMissingPredictions();
  renderMatches("dashboardMatches", state.settings.activeWeekId);
  renderAdvancedStats();
  renderBackupPanel();
  updateLoginOverlay();
  updateAdminSyncToggleButton();
  applyRolePermissions();
  ensureHeaderSyncButtons();
  updateNavSelection(state.settings.currentTab || "dashboard");
  schedulePredictionViewportRestore(viewportSnapshot);
}

async function addSeason() {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde bu alan sadece görüntülenir.", {
      title: "Yetki yok",
      type: "warning",
    });
  const name = document.getElementById("seasonName").value.trim();
  const leagueName = document.getElementById("seasonLeague").value.trim();
  if (!name)
    return showAlert("Sezon adı boş olamaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  if (!leagueName)
    return showAlert("Lig adı boş olamaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });

  const seasonExists = state.seasons.some(
    (s) => normalizeText(s.name) === normalizeText(name),
  );
  if (seasonExists)
    return showAlert("Bu sezon zaten var.", {
      title: "Tekrarlayan kayıt",
      type: "warning",
    });

  const seasonId = uid("season");
  const newSeason = { id: seasonId, name, leagueName };

  state.seasons.push(newSeason);
  state.players = state.players.map((player) => {
    if (getPlayerRole(player) === "admin") return player;
    const seasonStates = {
      ...createDefaultSeasonStateMap(true),
      ...getPlayerSeasonStateMap(player),
      [seasonId]: true,
    };
    return { ...player, seasonStates };
  });
  state.settings.activeSeasonId = seasonId;
  state.settings.activeWeekId = null;

  if (useOnlineMode && isFirebaseReady()) {
    try {
      await persistSeasonRegistryToFirebase();
      for (const player of state.players) {
        if (getPlayerRole(player) === "admin") continue;
        await updateOnlineUser({
          id: player.id,
          seasonStates: getPlayerSeasonStateMap(player),
        });
      }
      await hydrateFromFirebaseRealtime("season-add");
    } catch (error) {
      state.seasons = state.seasons.filter((item) => item.id !== seasonId);
      state.players = state.players.map((player) => {
        const nextStates = { ...getPlayerSeasonStateMap(player) };
        delete nextStates[seasonId];
        return { ...player, seasonStates: nextStates };
      });
      return showAlert(error?.message || "Sezon Firebase'e kaydedilemedi.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
    }
  }

  document.getElementById("seasonName").value = "";
  saveState(true);
  renderAll();
}

function addSeasonTeam() {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde bu alan sadece görüntülenir.", {
      title: "Yetki yok",
      type: "warning",
    });
  const seasonId = getActiveSeasonId();
  const name = document.getElementById("seasonTeamName").value.trim();
  const slug =
    document.getElementById("seasonTeamSlug").value.trim() || slugify(name);
  if (!seasonId)
    return showAlert("Önce sezon seç.", {
      title: "Eksik seçim",
      type: "warning",
    });
  if (!name)
    return showAlert("Takım adı gerekli.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  if (
    getTeamsBySeasonId(seasonId).some(
      (t) => t.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"),
    )
  )
    return showAlert("Bu takım zaten ekli.", {
      title: "Tekrarlayan kayıt",
      type: "warning",
    });
  state.teams.push({ id: uid("team"), seasonId, name, slug });
  document.getElementById("seasonTeamName").value = "";
  document.getElementById("seasonTeamSlug").value = "";
  saveState();
  renderAll();
}

function setAsyncButtonState(button, state = "idle", labels = {}) {
  if (!button) return;
  if (!button.dataset.originalText) {
    button.dataset.originalText = (button.textContent || "").trim();
  }

  const original =
    button.dataset.originalText || (button.textContent || "").trim();
  const loadingText = labels.loading || labels.pending || "Bekleniyor...";
  const successText = labels.success || "Tamam";
  const errorText = labels.error || "Tekrar dene";

  button.classList.remove("btn-loading", "btn-success", "btn-error");
  button.disabled = false;
  button.removeAttribute("aria-busy");

  if (state === "loading") {
    button.classList.add("btn-loading");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = loadingText;
    return;
  }

  if (state === "success") {
    button.classList.add("btn-success");
    button.textContent = successText;
    window.setTimeout(() => {
      button.classList.remove("btn-success");
      button.textContent = original;
    }, 1200);
    return;
  }

  if (state === "error") {
    button.classList.add("btn-error");
    button.textContent = errorText;
    window.setTimeout(() => {
      button.classList.remove("btn-error");
      button.textContent = original;
    }, 1600);
    return;
  }

  button.textContent = original;
}

function getActionButtonFromArg(buttonOrEvent) {
  if (!buttonOrEvent) return null;
  if (buttonOrEvent instanceof HTMLElement) return buttonOrEvent;
  if (buttonOrEvent.currentTarget instanceof HTMLElement)
    return buttonOrEvent.currentTarget;
  if (buttonOrEvent.target instanceof HTMLElement)
    return buttonOrEvent.target.closest("button");
  return null;
}

function addPlayer(buttonOrEvent) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde bu alan sadece görüntülenir.", {
      title: "Yetki yok",
      type: "warning",
    });
  const actionButton =
    getActionButtonFromArg(buttonOrEvent) ||
    document.getElementById("addPlayerBtn");
  const input = document.getElementById("playerName");
  const passwordInput = document.getElementById("playerPassword");
  const name = input?.value?.trim() || "";
  const password = passwordInput?.value?.trim() || "1234";
  if (!name)
    return showAlert("Kişi adı boş olamaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  if (state.players.some((p) => normalizeText(p.name) === normalizeText(name)))
    return showAlert("Bu kişi zaten var.", {
      title: "Tekrarlayan kayıt",
      type: "warning",
    });

  const newPlayer = {
    id: `player-${slugify(name) || "oyuncu"}`,
    name: name.toUpperCase(),
    password,
    seasonStates: createDefaultSeasonStateMap(true),
  };

  if (useOnlineMode) {
    addUserOnline(newPlayer, actionButton);
    return;
  }

  state.players.push(newPlayer);
  input.value = "";
  passwordInput.value = "";
  saveState();
  renderAll();
  setAsyncButtonState(actionButton, "success", { success: "Eklendi" });
}

async function addUserOnline(player, actionButton = null) {
  setAsyncButtonState(actionButton, "loading", {
    loading: "Ekleniyor...",
    success: "Eklendi",
  });
  try {
    const result = await addOnlineUser({
      kullaniciAdi: normalizeLoginName(player.name),
      sifre: player.password || "1234",
      adSoyad: player.name,
      seasonStates: player.seasonStates || createDefaultSeasonStateMap(true),
    });

    if (!result?.success) {
      showAlert(result?.message || "Kullanıcı eklenemedi.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
      setAsyncButtonState(actionButton, "error", { error: "Hata" });
      return;
    }

    await syncUsersFromSheet();
    document.getElementById("playerName").value = "";
    document.getElementById("playerPassword").value = "";
    renderAll();
    setAsyncButtonState(actionButton, "success", { success: "Eklendi" });
    showAlert("Kullanıcı veritabanına eklendi.", {
      title: "Başarılı",
      type: "success",
    });
  } catch (error) {
    setAsyncButtonState(actionButton, "error", { error: "Hata" });
    console.error("Kullanıcı ekleme hatası:", error);
    showAlert(error?.message || "Firebase kullanıcı kaydı yapılamadı.", {
      title: "Kayıt Hatası",
      type: "warning",
    });
  }
}

function addWeek() {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde bu alan sadece görüntülenir.", {
      title: "Yetki yok",
      type: "warning",
    });
  const seasonId = getActiveSeasonId();
  const number = Number(document.getElementById("weekNumber").value);
  const status = document.getElementById("weekStatus").value;
  if (!seasonId)
    return showAlert("Önce sezon seç.", {
      title: "Eksik seçim",
      type: "warning",
    });
  if (!number)
    return showAlert("Hafta numarası gerekli.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  if (getWeeksBySeasonId(seasonId).some((w) => w.number === number))
    return showAlert("Bu hafta zaten var.", {
      title: "Tekrarlayan kayıt",
      type: "warning",
    });
  const week = { id: uid("week"), seasonId, number, status };
  state.weeks.push(week);
  state.settings.activeWeekId = week.id;
  document.getElementById("weekNumber").value = "";
  saveState();
  renderAll();
}

function addMatch() {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde bu alan sadece görüntülenir.", {
      title: "Yetki yok",
      type: "warning",
    });
  const seasonId = getActiveSeasonId();
  const weekId = document.getElementById("matchWeekSelect").value;
  const homeTeam = document.getElementById("homeTeam").value;
  const awayTeam = document.getElementById("awayTeam").value;
  const date = document.getElementById("matchDate").value;
  if (!seasonId)
    return showAlert("Önce sezon seç.", {
      title: "Eksik seçim",
      type: "warning",
    });
  if (!weekId)
    return showAlert("Önce hafta seç.", {
      title: "Eksik seçim",
      type: "warning",
    });
  if (!homeTeam || !awayTeam)
    return showAlert("İki takım da seçilmeli.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  if (homeTeam === awayTeam)
    return showAlert("Aynı takım iki kez seçilemez.", {
      title: "Geçersiz seçim",
      type: "warning",
    });
  const newMatch = {
    id: uid("match"),
    seasonId,
    weekId,
    homeTeam,
    awayTeam,
    date,
    played: false,
    homeScore: null,
    awayScore: null,
  };
  state.matches.push(newMatch);
  if (useOnlineMode) {
    window.__ALLOW_MATCH_WRITE__ = true;
    sendMatchesToSheet([newMatch], { force: true })
      .catch((error) => console.error("Tek maç Sheets senkron hatası:", error))
      .finally(() => {
        window.__ALLOW_MATCH_WRITE__ = false;
      });
  }
  document.getElementById("homeTeam").value = "";
  document.getElementById("awayTeam").value = "";
  document.getElementById("matchDate").value = "";
  saveState();
  renderAll();
}

function switchTab(tabName) {
  if (
    getCurrentRole() !== "admin" &&
    ["players", "backup", "seasons", "weeks", "matches"].includes(tabName)
  )
    tabName = "dashboard";
  const shouldScrollTop = tabName !== "predictions";
  state.settings.currentTab = tabName;
  closeMobileAdminMenu();
  updateNavSelection(tabName);
  ensureHeaderSyncButtons();
  document
    .querySelectorAll(".tab-panel")
    .forEach((panel) =>
      panel.classList.toggle("active", panel.id === `tab-${tabName}`),
    );
  if (tabName === "stats") {
    triggerStatsCelebration();
  }
  closeLandscapeSidebar();
  saveState(true);
  if (shouldScrollTop) {
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      const content = document.querySelector(`#tab-${tabName}`);
      content?.scrollTo?.(0, 0);
    });
  }
}

function getBackupSelectedWeekId() {
  const select = document.getElementById("backupWeekSelect");
  return select?.value || state.settings.activeWeekId || "";
}

function getBackupSelectedWeek() {
  const weekId = getBackupSelectedWeekId();
  return weekId ? getWeekById(weekId) : null;
}

function formatBackupDateStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
}

function downloadTextFile(
  content,
  fileName,
  mimeType = "text/plain;charset=utf-8",
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[";,\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
function forceExcelText(value) {
  const text = String(value ?? "");
  if (!text) return "";
  return `="${text.replace(/"/g, '""')}"`;
}
function serializeStateForBackup(stateObj = state) {
  return JSON.parse(JSON.stringify(stateObj));
}

function buildFullBackupPayload() {
  return {
    type: "full-backup",
    app: "super-lig-tahmin-paneli",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: serializeStateForBackup(state),
  };
}

function buildWeekExportPayload(weekId) {
  const week = getWeekById(weekId);
  if (!week) return null;

  const season = getSeasonById(week.seasonId);
  const matches = getMatchesByWeekId(weekId);
  const matchIds = new Set(matches.map((match) => String(match.id)));
  const predictions = state.predictions.filter((pred) =>
    matchIds.has(String(pred.matchId)),
  );
  const playerIds = new Set(predictions.map((pred) => String(pred.playerId)));
  const players = state.players.filter((player) =>
    playerIds.has(String(player.id)),
  );
  const teams = state.teams.filter(
    (team) => String(team.seasonId) === String(week.seasonId),
  );

  return {
    type: "week-backup",
    app: "super-lig-tahmin-paneli",
    version: 1,
    exportedAt: new Date().toISOString(),
    season: season ? { ...season } : null,
    week: { ...week },
    teams,
    players,
    matches,
    predictions,
  };
}

function buildWeekCsv(weekId) {
  const week = getWeekById(weekId);
  if (!week) return "";

  const season = getSeasonById(week.seasonId);
  const matches = getMatchesByWeekId(weekId);

  const orderedPlayers = [...state.players]
    .filter((player) => getPlayerRole(player) !== "admin")
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "tr"),
    );

  const header = [
    "Sezon",
    "Hafta",
    "Tarih",
    "Ev Sahibi",
    "Deplasman",
    "Gerçek Skor",
    "Durum",
  ];

  orderedPlayers.forEach((player) => {
    header.push(`${player.name} Tahmin`);
    header.push(`${player.name} Puan`);
  });

  const rows = matches.map((match) => {
    const dateLabel = match.date ? formatDate(match.date) : "";

    const actualScoreRaw =
      match.homeScore !== null &&
      match.homeScore !== undefined &&
      match.homeScore !== "" &&
      match.awayScore !== null &&
      match.awayScore !== undefined &&
      match.awayScore !== ""
        ? `${match.homeScore}-${match.awayScore}`
        : "";

    const actualScore = forceExcelText(actualScoreRaw);

    const row = [
      season?.name || "",
      week.number || "",
      dateLabel,
      match.homeTeam || "",
      match.awayTeam || "",
      actualScore,
      match.played ? "Oynandı" : isMatchLocked(match) ? "Kilitli" : "Açık",
    ];

    orderedPlayers.forEach((player) => {
      const pred = state.predictions.find(
        (item) =>
          String(item.matchId) === String(match.id) &&
          String(item.playerId) === String(player.id),
      );

      const predictionRaw =
        pred && (pred.homePred !== "" || pred.awayPred !== "")
          ? `${pred.homePred !== "" ? pred.homePred : "-"}-${pred.awayPred !== "" ? pred.awayPred : "-"}`
          : "";

      const predictionText = forceExcelText(predictionRaw);

      row.push(predictionText);
      row.push(pred ? Number(pred.points || 0) : "");
    });

    return row;
  });

  return [header, ...rows]
    .map((row) => row.map(csvEscape).join(";"))
    .join("\n");
}

async function syncBackupStateToFirebase(stateObj) {
  if (!isFirebaseReady()) return true;

  const safeState = migrateLegacyState(serializeStateForBackup(stateObj));
  ensureAuthState(safeState);
  const stamp = new Date().toISOString();

  const usersMap = {};
  (safeState.players || []).forEach((player) => {
    const id = sanitizeFirebaseKey(
      player.id || buildPlayerKeyFromName(player.name || "oyuncu", usersMap),
    );
    usersMap[id] = {
      id,
      kullaniciAdi: normalizeLoginName(player.username || player.name || id),
      sifre: String(player.password || "1234"),
      adSoyad: String(player.name || player.username || id)
        .trim()
        .toUpperCase(),
      rol: getPlayerRole(player) === "admin" ? "admin" : "user",
      aktif: true,
      importedAt: stamp,
    };
  });

  if (!Object.values(usersMap).some((item) => item.rol === "admin")) {
    FIREBASE_DEFAULT_USERS.filter(
      (item) => String(item.rol || "user").toLowerCase() === "admin",
    ).forEach((item) => {
      usersMap[sanitizeFirebaseKey(item.id)] = { ...item, importedAt: stamp };
    });
  }

  const matchesMap = {};
  (safeState.matches || []).forEach((match) => {
    const season = safeState.seasons?.find(
      (item) => String(item.id) === String(match.seasonId),
    );
    const week = safeState.weeks?.find(
      (item) => String(item.id) === String(match.weekId),
    );
    const id = sanitizeFirebaseKey(match.id || uid("match"));
    matchesMap[id] = {
      ...match,
      id,
      season: season?.name || "",
      sezon: season?.name || "",
      weekNo: Number(week?.number || 0),
      haftaNo: Number(week?.number || 0),
      importedAt: stamp,
    };
  });

  const predictionsMap = {};
  (safeState.predictions || []).forEach((pred) => {
    const match = (safeState.matches || []).find(
      (item) => String(item.id) === String(pred.matchId),
    );
    const season = safeState.seasons?.find(
      (item) => String(item.id) === String(match?.seasonId),
    );
    const week = safeState.weeks?.find(
      (item) => String(item.id) === String(match?.weekId),
    );
    const player = (safeState.players || []).find(
      (item) => String(item.id) === String(pred.playerId),
    );
    const id = sanitizeFirebaseKey(
      pred.id || makePredictionRecordId(pred.matchId, pred.playerId),
    );
    predictionsMap[id] = {
      ...pred,
      id,
      season: season?.name || "",
      sezon: season?.name || "",
      weekNo: Number(week?.number || 0),
      haftaNo: Number(week?.number || 0),
      playerName: player?.name || "",
      adSoyad: player?.name || "",
      kullaniciAdi: player?.username || "",
      importedAt: stamp,
    };
  });

  await Promise.all([
    firebaseWrite("users", usersMap),
    firebaseWrite("matches", matchesMap),
    firebaseWrite("predictions", predictionsMap),
    firebaseUpdate("settings", {
      init: false,
      source: "firebase",
      lastImportAt: stamp,
      backupVersion: 1,
      seasonsMeta: (safeState.seasons || [])
        .map((season) => ({
          id: String(season.id || "").trim(),
          name: String(season.name || "").trim(),
          leagueName: String(season.leagueName || "").trim(),
        }))
        .filter((season) => season.id && season.name),
    }),
  ]);

  return true;
}

async function applyImportedState(nextState, options = {}) {
  const currentAuth = state.settings?.auth ? { ...state.settings.auth } : null;
  let safeState = migrateLegacyState(serializeStateForBackup(nextState));
  ensureAuthState(safeState);

  if (currentAuth) {
    safeState.settings.auth = {
      ...safeState.settings.auth,
      ...currentAuth,
    };
  }

  ensureDefaultSeason(safeState);
  state = safeState;
  recalculateAllPoints();
  saveState(true);

  if (options.syncFirebase !== false) {
    await syncBackupStateToFirebase(state);
  }

  renderAll();
  return true;
}

async function exportFullBackup() {
  const payload = buildFullBackupPayload();
  downloadTextFile(
    JSON.stringify(payload, null, 2),
    `fikstur-full-backup-${formatBackupDateStamp()}.json`,
    "application/json",
  );
  setBackupImportStatus("Tam yedek indirildi.");
}

async function exportSelectedWeekJson() {
  const week = getBackupSelectedWeek();
  if (!week) {
    showAlert("Önce dışa aktarmak istediğin haftayı seçmelisin.", {
      title: "Hafta seçilmedi",
      type: "warning",
    });
    return;
  }

  const payload = buildWeekExportPayload(week.id);
  const season = getSeasonById(week.seasonId);
  downloadTextFile(
    JSON.stringify(payload, null, 2),
    `fikstur-${slugify(season?.name || "sezon")}-hafta-${week.number || "x"}.json`,
    "application/json",
  );
  setBackupImportStatus(`Hafta ${week.number} JSON olarak indirildi.`);
}

async function exportSelectedWeekCsv() {
  const week = getBackupSelectedWeek();
  if (!week) {
    showAlert("Önce dışa aktarmak istediğin haftayı seçmelisin.", {
      title: "Hafta seçilmedi",
      type: "warning",
    });
    return;
  }

  const season = getSeasonById(week.seasonId);
  const csv = buildWeekCsv(week.id);
  downloadTextFile(
    "﻿" + csv,
    `fikstur-${slugify(season?.name || "sezon")}-hafta-${week.number || "x"}.csv`,
    "text/csv;charset=utf-8",
  );
  setBackupImportStatus(`Hafta ${week.number} CSV olarak indirildi.`);
}

function mergeWeekBackupIntoState(payload) {
  const next = serializeStateForBackup(state);
  const season = payload.season || null;
  const week = payload.week || null;
  if (!week) throw new Error("Hafta bilgisi bulunamadı.");

  let targetSeasonId = season?.id || null;
  if (season) {
    const existingSeason = next.seasons.find(
      (item) => normalizeText(item.name) === normalizeText(season.name || ""),
    );
    if (existingSeason) {
      targetSeasonId = existingSeason.id;
    } else {
      targetSeasonId = season.id || uid("season");
      next.seasons.push({ ...season, id: targetSeasonId });
    }
  }

  let targetWeekId = week.id || uid("week");
  const existingWeek = next.weeks.find(
    (item) =>
      String(item.seasonId) === String(targetSeasonId) &&
      Number(item.number) === Number(week.number),
  );
  if (existingWeek) {
    targetWeekId = existingWeek.id;
  } else {
    next.weeks.push({ ...week, id: targetWeekId, seasonId: targetSeasonId });
  }

  (payload.teams || []).forEach((team) => {
    if (
      !next.teams.some(
        (item) =>
          String(item.seasonId) === String(targetSeasonId) &&
          normalizeText(item.name) === normalizeText(team.name || ""),
      )
    ) {
      next.teams.push({
        ...team,
        id: team.id || uid("team"),
        seasonId: targetSeasonId,
      });
    }
  });

  (payload.players || []).forEach((player) => {
    if (!next.players.some((item) => String(item.id) === String(player.id))) {
      next.players.push({ ...player });
    }
  });

  const incomingMatches = (payload.matches || []).map((match) => ({
    ...match,
  }));
  const incomingPredictions = (payload.predictions || []).map((pred) => ({
    ...pred,
  }));
  const matchIdMap = new Map();

  const removedMatchIds = new Set(
    next.matches
      .filter((match) => String(match.weekId) === String(targetWeekId))
      .map((match) => String(match.id)),
  );

  next.matches = next.matches.filter(
    (match) => String(match.weekId) !== String(targetWeekId),
  );
  next.predictions = next.predictions.filter(
    (pred) => !removedMatchIds.has(String(pred.matchId)),
  );

  incomingMatches.forEach((match) => {
    const newId = uid("match");
    matchIdMap.set(String(match.id), newId);
    next.matches.push({
      ...match,
      id: newId,
      seasonId: targetSeasonId,
      weekId: targetWeekId,
    });
  });

  incomingPredictions.forEach((pred) => {
    const mappedMatchId = matchIdMap.get(String(pred.matchId));
    if (!mappedMatchId) return;
    next.predictions.push({
      ...pred,
      id: pred.id || uid("pred"),
      matchId: mappedMatchId,
    });
  });

  next.settings.activeSeasonId =
    targetSeasonId || next.settings.activeSeasonId || null;
  next.settings.activeWeekId = targetWeekId;
  return next;
}

async function importData(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      let nextState = null;

      if (parsed?.type === "full-backup" && parsed?.data) {
        nextState = parsed.data;
      } else if (parsed?.type === "week-backup" && parsed?.week) {
        nextState = mergeWeekBackupIntoState(parsed);
      } else if (
        parsed?.seasons ||
        parsed?.matches ||
        parsed?.players ||
        parsed?.predictions
      ) {
        nextState = parsed;
      } else {
        throw new Error("Geçersiz yedek formatı.");
      }

      await applyImportedState(nextState, { syncFirebase: true });
      setBackupImportStatus("Yedek başarıyla yüklendi.");
      showAlert("Yedek başarıyla yüklendi ve Firebase ile eşitlendi.", {
        title: "İşlem tamam",
        type: "success",
      });
    } catch (error) {
      console.error("Yedek yükleme hatası:", error);
      setBackupImportStatus("Yükleme başarısız oldu.");
      showAlert("Geçerli bir yedek / JSON dosyası seçmelisin.", {
        title: "Dosya hatası",
        type: "danger",
      });
    } finally {
      const input = document.getElementById("importFile");
      if (input) input.value = "";
    }
  };
  reader.readAsText(file);
}

function setBackupImportStatus(message) {
  const el = document.getElementById("backupImportStatus");
  if (el) el.textContent = message || "Hazır.";
}

function renderBackupPanel() {
  const select = document.getElementById("backupWeekSelect");
  const summary = document.getElementById("backupWeekSummary");
  if (!select || !summary) return;

  const seasonId = getActiveSeasonId();
  const season = getSeasonById(seasonId);
  const weeks = getWeeksBySeasonId(seasonId);
  const selectedWeekId =
    select.value || state.settings.activeWeekId || weeks[0]?.id || "";

  select.innerHTML = weeks.length
    ? weeks
        .map(
          (week) =>
            `<option value="${week.id}" ${String(week.id) === String(selectedWeekId) ? "selected" : ""}>Hafta ${week.number}</option>`,
        )
        .join("")
    : '<option value="">Hafta bulunamadı</option>';

  const activeWeek = selectedWeekId ? getWeekById(selectedWeekId) : null;
  const matches = activeWeek ? getMatchesByWeekId(activeWeek.id) : [];
  const matchIds = new Set(matches.map((match) => String(match.id)));
  const predictionCount = state.predictions.filter((pred) =>
    matchIds.has(String(pred.matchId)),
  ).length;

  summary.textContent = activeWeek
    ? `${season?.name || "Sezon seçilmedi"} • Hafta ${activeWeek.number} • ${matches.length} maç • ${predictionCount} tahmin`
    : "Önce aktif sezonda bir hafta oluşturmalısın.";

  setBackupImportStatus(
    document.getElementById("backupImportStatus")?.textContent || "Hazır.",
  );
}

async function handleDangerousReset() {
  const approved = await showConfirm(
    "Bu işlem tüm sezonları, haftaları, maçları ve tahminleri silecek. Admin hesabı korunur. Devam etmek istiyor musun?",
    {
      title: "Tüm veriler silinsin mi?",
      type: "danger",
      confirmText: "Devam et",
      cancelText: "Vazgeç",
    },
  );
  if (!approved) return;

  const typed = await showPrompt("Onay için kutuya SIL yaz.", "", {
    title: "Son güvenlik adımı",
    placeholder: "SIL",
    confirmText: "Verileri sil",
    cancelText: "Vazgeç",
  });

  if (
    String(typed || "")
      .trim()
      .toUpperCase() !== "SIL"
  ) {
    showAlert("İşlem iptal edildi. Onay metni doğru girilmedi.", {
      title: "Silme durduruldu",
      type: "warning",
    });
    return;
  }

  const adminPlayers = (state.players || []).filter(
    (player) => getPlayerRole(player) === "admin",
  );
  const preservedAuth = state.settings?.auth
    ? { ...state.settings.auth }
    : null;

  state = createInitialState();
  state.players = adminPlayers;
  ensureAuthState(state);
  if (preservedAuth)
    state.settings.auth = { ...state.settings.auth, ...preservedAuth };
  saveState(true);
  await syncBackupStateToFirebase(state);
  renderAll();
  setBackupImportStatus("Tüm veriler temizlendi.");
  showAlert("Tüm veriler silindi. Admin erişimi korundu.", {
    title: "Temizleme tamamlandı",
    type: "success",
  });
}

function parseApiEvent(item) {
  const homeTeam = item.strHomeTeam?.trim();
  const awayTeam = item.strAwayTeam?.trim();
  if (!homeTeam || !awayTeam) return null;

  const roundMatch = String(item.intRound || item.strRound || "").match(/\d+/);
  const weekNumber = roundMatch ? Number(roundMatch[0]) : 0;

  const rawDate = item.dateEvent || "";
  const rawTime = item.strTime ? item.strTime.slice(0, 8) : "20:00:00";

  let date = "";
  if (rawDate) {
    const utcDate = new Date(`${rawDate}T${rawTime}Z`);
    if (!Number.isNaN(utcDate.getTime())) {
      const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(utcDate);
      const pick = (type) =>
        parts.find((part) => part.type === type)?.value || "00";
      date = `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
    } else {
      date = rawDate ? `${rawDate}T20:00` : "";
    }
  }

  const statusText = item.strStatus
    ? String(item.strStatus).trim().toLowerCase()
    : "";

  return {
    apiId: item.idEvent,
    weekNumber,
    homeTeam,
    awayTeam,
    date,
    statusText,
    postponed: isPostponedStatus(statusText),
    homeScore:
      item.intHomeScore === null ||
      item.intHomeScore === undefined ||
      item.intHomeScore === ""
        ? null
        : Number(item.intHomeScore),
    awayScore:
      item.intAwayScore === null ||
      item.intAwayScore === undefined ||
      item.intAwayScore === ""
        ? null
        : Number(item.intAwayScore),
  };
}

async function fetchSeasonEvents(seasonLabel) {
  const url = `https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=${LEAGUE_ID}&s=${encodeURIComponent(seasonLabel)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API cevabı alınamadı.");
  const data = await res.json();
  return (data.events || []).map(parseApiEvent).filter(Boolean);
}

async function fetchRoundEvents(seasonLabel, weekNumber) {
  const url = `https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id=${LEAGUE_ID}&r=${encodeURIComponent(weekNumber)}&s=${encodeURIComponent(seasonLabel)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Hafta API cevabı alınamadı.");
  const data = await res.json();
  return (data.events || []).map(parseApiEvent).filter(Boolean);
}

function inferWeekStatusFromMatches(weekId) {
  const matches = getMatchesByWeekId(weekId);
  if (!matches.length) return "hazirlaniyor";
  if (matches.every((match) => match.played)) return "tamamlandi";
  return "aktif";
}

function syncWeekStatus(weekId) {
  const week = getWeekById(weekId);
  if (!week) return;
  week.status = inferWeekStatusFromMatches(weekId);
}

function findExistingMatchForApiEvent(seasonId, weekId, event) {
  return state.matches.find(
    (match) =>
      match.seasonId === seasonId &&
      match.weekId === weekId &&
      (match.apiId
        ? match.apiId === event.apiId
        : match.homeTeam === event.homeTeam &&
          match.awayTeam === event.awayTeam),
  );
}

function applyApiEventToMatch(match, event, allowCreateIfMissing = false) {
  if (!match && !allowCreateIfMissing) return null;
  const target = match || {
    id: uid("match"),
    seasonId: getActiveSeasonId(),
    weekId: null,
    played: false,
    homeScore: null,
    awayScore: null,
    postponed: false,
    wasPostponed: false,
  };
  target.apiId = event.apiId;
  target.homeTeam = event.homeTeam;
  target.awayTeam = event.awayTeam;
  target.statusText = event.statusText || "";
  if (event.date) target.date = event.date;
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  if (event.postponed) {
    target.postponed = true;
    target.wasPostponed = true;
  } else if (target.postponed) {
    target.postponed = false;
  }
  if (hasScore) {
    target.homeScore = event.homeScore;
    target.awayScore = event.awayScore;
    target.played = true;
    if (target.wasPostponed || event.postponed) target.wasPostponed = true;
    target.postponed = false;
  } else if (!target.played) {
    target.homeScore = null;
    target.awayScore = null;
  }
  return target;
}

function relocateMatchToApiWeek(match, seasonId, apiWeekNumber) {
  if (!apiWeekNumber || !match) return null;
  const currentWeekNumber = getWeekNumberById(match.weekId);
  if (Number(currentWeekNumber) === Number(apiWeekNumber))
    return getWeekById(match.weekId);
  const nextWeek = ensureWeekForSeason(seasonId, apiWeekNumber);
  if (nextWeek) {
    match.originalWeekNumber =
      match.originalWeekNumber || currentWeekNumber || apiWeekNumber;
    match.weekId = nextWeek.id;
    match.wasPostponed = true;
    if (!match.played) match.postponed = true;
  }
  return nextWeek;
}

async function syncSelectedWeekFromApi() {
  const seasonId = getActiveSeasonId();
  const weekId = state.settings.activeWeekId;
  const week = getWeekById(weekId);
  const seasonLabel = getApiSeasonLabel();
  const status = document.getElementById("weekApiStatus");
  if (!seasonId || !weekId || !week)
    return showAlert("Önce sezon ve hafta seç.", {
      title: "Eksik seçim",
      type: "warning",
    });
  if (!seasonLabel)
    return showAlert("API sezon etiketi boş olamaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  status.textContent = `${week.number}. hafta API'den kontrol ediliyor...`;
  try {
    let roundEvents = [];
    try {
      roundEvents = await fetchRoundEvents(seasonLabel, week.number);
    } catch {}
    const seasonEvents = await fetchSeasonEvents(seasonLabel);
    const fallbackWeekEvents = seasonEvents.filter(
      (event) => Number(event.weekNumber) === Number(week.number),
    );
    const weekEvents = roundEvents.length ? roundEvents : fallbackWeekEvents;

    const selectedWeekMatches = getMatchesByWeekId(weekId);
    let movedCount = 0;
    selectedWeekMatches.forEach((match) => {
      if (!match.apiId) return;
      const seasonEvent = seasonEvents.find(
        (event) => event.apiId === match.apiId,
      );
      if (
        seasonEvent?.weekNumber &&
        Number(seasonEvent.weekNumber) !== Number(week.number)
      ) {
        relocateMatchToApiWeek(match, seasonId, seasonEvent.weekNumber);
        applyApiEventToMatch(match, seasonEvent);
        movedCount += 1;
      }
    });

    if (!weekEvents.length && !movedCount)
      throw new Error(`${week.number}. hafta için API verisi bulunamadı.`);

    let updatedCount = 0;
    let scoreCount = 0;
    let createdCount = 0;

    weekEvents.forEach((event) => {
      let existing = state.matches.find(
        (match) =>
          match.seasonId === seasonId &&
          (match.apiId
            ? match.apiId === event.apiId
            : match.homeTeam === event.homeTeam &&
              match.awayTeam === event.awayTeam),
      );
      if (!existing) {
        existing = {
          id: uid("match"),
          seasonId,
          weekId,
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          date: event.date || "",
          played: false,
          homeScore: null,
          awayScore: null,
          apiId: event.apiId,
          postponed: false,
          wasPostponed: false,
        };
        state.matches.push(existing);
        createdCount += 1;
      }
      if (event.weekNumber)
        relocateMatchToApiWeek(existing, seasonId, event.weekNumber);
      const beforeDate = existing.date || "";
      const beforePlayed = !!existing.played;
      const beforeScore = `${existing.homeScore ?? ""}-${existing.awayScore ?? ""}`;
      const beforeWeek = existing.weekId;
      const beforePostponed = !!existing.postponed;
      applyApiEventToMatch(existing, event);
      if (
        beforeDate !== (existing.date || "") ||
        beforePlayed !== existing.played ||
        beforeScore !==
          `${existing.homeScore ?? ""}-${existing.awayScore ?? ""}` ||
        beforeWeek !== existing.weekId ||
        beforePostponed !== existing.postponed
      ) {
        updatedCount += 1;
      }
      if (existing.played) scoreCount += 1;
    });

    getWeeksBySeasonId(seasonId).forEach((item) => syncWeekStatus(item.id));
    recalculateAllPoints();
    saveState();
    renderAll();
    let sheetSyncResult = null;
    try {
      sheetSyncResult = await syncWeekMatchesToSheet(week.id);
    } catch (sheetError) {
      console.warn("Hafta Sheets senkron uyarısı:", sheetError);
    }
    status.textContent = `${week.number}. hafta güncellendi. ${updatedCount} maç işlendi, ${scoreCount} maçta skor var${createdCount ? `, ${createdCount} eksik maç eklendi` : ""}${movedCount ? `, ${movedCount} maç başka haftaya taşındı` : ""}${sheetSyncResult?.success ? `, Sheets senkronu tamamlandı` : ", Sheets yanıtı gecikti ama yerel güncelleme tamamlandı"}.`;
    recordAdminSyncActivity({
      lastAction: `${week.number}. hafta API ile güncellendi.`,
      success: true,
      updatedMatchCount: updatedCount + createdCount,
    });
  } catch (error) {
    status.textContent = `Hafta API hatası: ${error.message}`;
    recordAdminSyncActivity({
      lastAction: `${week?.number || "Seçili"}. hafta API güncellemesi başarısız oldu.`,
      lastError: error.message,
    });
    showAlert(`Seçili hafta API ile güncellenemedi: ${error.message}`, {
      title: "API hatası",
      type: "danger",
    });
    throw error;
  }
}

async function importFixturesFromApi(updateResultsOnly = false) {
  const seasonId = getActiveSeasonId();
  const seasonLabel = getApiSeasonLabel();
  if (!seasonId || !seasonLabel)
    return showAlert("Önce sezon seç ve API sezon etiketini yaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  const status = document.getElementById("apiStatus");
  status.textContent = "API verisi çekiliyor...";
  try {
    const events = await fetchSeasonEvents(seasonLabel);
    if (!events.length) throw new Error("Bu sezon için etkinlik bulunamadı.");
    const teamNames = [
      ...new Set(events.flatMap((e) => [e.homeTeam, e.awayTeam])),
    ].filter(Boolean);
    teamNames.forEach((name) => {
      if (
        !getTeamsBySeasonId(seasonId).some(
          (t) => normalizeText(t.name) === normalizeText(name),
        )
      ) {
        state.teams.push({
          id: uid("team"),
          seasonId,
          name,
          slug: DEFAULT_TEAM_SLUGS[name] || slugify(name),
        });
      }
    });

    if (!updateResultsOnly) {
      saveState(true);
      renderAll();
      status.textContent = `API'den ${teamNames.length} takım kontrol edildi. Yeni sezona yalnızca takım listesi işlendi; otomatik sezon/hafta eklenmedi.`;
      recordAdminSyncActivity({
        lastAction:
          "Sezon ekranından yalnızca takım listesi API üzerinden güncellendi.",
        success: true,
      });
      return true;
    }

    const touchedWeekIds = new Set();
    let movedCount = 0;

    events.forEach((event) => {
      let week = ensureWeekForSeason(
        seasonId,
        event.weekNumber || getWeeksBySeasonId(seasonId).length + 1,
      );
      touchedWeekIds.add(week.id);

      let existing = state.matches.find(
        (match) =>
          match.seasonId === seasonId &&
          (match.apiId
            ? match.apiId === event.apiId
            : match.homeTeam === event.homeTeam &&
              match.awayTeam === event.awayTeam),
      );
      if (existing) {
        const beforeWeek = existing.weekId;
        if (event.weekNumber)
          relocateMatchToApiWeek(existing, seasonId, event.weekNumber);
        if (beforeWeek !== existing.weekId) movedCount += 1;
        if (event.date) existing.date = event.date;
        applyApiEventToMatch(existing, event);
        touchedWeekIds.add(existing.weekId);
      } else if (!updateResultsOnly) {
        const newMatch = applyApiEventToMatch(
          {
            id: uid("match"),
            seasonId,
            weekId: week.id,
            homeTeam: event.homeTeam,
            awayTeam: event.awayTeam,
            date: event.date || "",
            played: false,
            homeScore: null,
            awayScore: null,
            apiId: event.apiId,
            postponed: false,
            wasPostponed: false,
          },
          event,
          true,
        );
        if (event.weekNumber)
          relocateMatchToApiWeek(newMatch, seasonId, event.weekNumber);
        state.matches.push(newMatch);
        touchedWeekIds.add(newMatch.weekId);
      }
    });

    touchedWeekIds.forEach((weekId) => syncWeekStatus(weekId));
    recalculateAllPoints();
    saveState();
    renderAll();
    let sheetSyncResult = null;
    try {
      sheetSyncResult = await syncSeasonMatchesToSheet(seasonId);
    } catch (sheetError) {
      console.warn("Sezon Sheets senkron uyarısı:", sheetError);
    }
    status.textContent = updateResultsOnly
      ? `Sezondaki tarih/saat ve skor verileri güncellendi${movedCount ? `, ${movedCount} ertelenen maç taşındı` : ""}${sheetSyncResult?.success ? `, Sheets senkronu tamamlandı` : ", Sheets yanıtı gecikti ama yerel güncelleme tamamlandı"}.`
      : `API'den yalnızca takım listesi işlendi.`;
    recordAdminSyncActivity({
      lastAction: updateResultsOnly
        ? "Sezon skor ve saat verileri güncellendi."
        : "Sezon fikstürü API üzerinden yenilendi.",
      success: true,
      updatedMatchCount: touchedWeekIds.size
        ? Array.from(touchedWeekIds).reduce(
            (sum, weekId) => sum + getMatchesByWeekId(weekId).length,
            0,
          )
        : 0,
    });
  } catch (error) {
    status.textContent = `API hatası: ${error.message}`;
    recordAdminSyncActivity({
      lastAction: "Sezon API işlemi başarısız oldu.",
      lastError: error.message,
    });
    showAlert(`API ile işlem yapılamadı: ${error.message}`, {
      title: "API hatası",
      type: "danger",
    });
    throw error;
  }
}

const DASHBOARD_CARD_STATE_STORAGE_PREFIX = "dashboardCardState:";

function getStoredDashboardCardOpen(key, defaultOpen = true) {
  try {
    const saved = localStorage.getItem(
      `${DASHBOARD_CARD_STATE_STORAGE_PREFIX}${key}`,
    );
    if (saved === null) return defaultOpen;
    return saved !== "closed";
  } catch {
    return defaultOpen;
  }
}

function setStoredDashboardCardOpen(key, isOpen) {
  try {
    localStorage.setItem(
      `${DASHBOARD_CARD_STATE_STORAGE_PREFIX}${key}`,
      isOpen ? "open" : "closed",
    );
  } catch {}
}

function applyCollapsibleCardState({
  cardId,
  buttonId,
  storageKey,
  defaultOpen = true,
}) {
  const card = document.getElementById(cardId);
  const button = document.getElementById(buttonId);
  if (!card || !button) return;
  const isOpen = getStoredDashboardCardOpen(storageKey, defaultOpen);
  card.classList.toggle("is-open", isOpen);
  button.setAttribute("aria-expanded", isOpen ? "true" : "false");
  button.setAttribute("title", isOpen ? "Daralt" : "Genişlet");
}

function toggleCollapsibleCard(
  cardId,
  buttonId,
  storageKey,
  defaultOpen = true,
) {
  const card = document.getElementById(cardId);
  const button = document.getElementById(buttonId);
  if (!card || !button) return;
  const nextOpen = !card.classList.contains("is-open");
  card.classList.toggle("is-open", nextOpen);
  button.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  button.setAttribute("title", nextOpen ? "Daralt" : "Genişlet");
  setStoredDashboardCardOpen(storageKey, nextOpen);
}

function applyDashboardCollapseStates() {
  applyCollapsibleCardState({
    cardId: "dashboardSyncCard",
    buttonId: "dashboardSyncToggleBtn",
    storageKey: "dashboardSyncCard",
    defaultOpen: true,
  });
  applyCollapsibleCardState({
    cardId: "adminSyncOverviewCard",
    buttonId: "adminSyncToggleBtn",
    storageKey: "adminSyncOverviewCard",
    defaultOpen: true,
  });
  applyCollapsibleCardState({
    cardId: "firebaseAdminCard",
    buttonId: "firebaseAdminToggleBtn",
    storageKey: "firebaseAdminCard",
    defaultOpen: true,
  });
}

function toggleDashboardSyncCard() {
  toggleCollapsibleCard(
    "dashboardSyncCard",
    "dashboardSyncToggleBtn",
    "dashboardSyncCard",
    true,
  );
}

function toggleAdminSyncOverview() {
  toggleCollapsibleCard(
    "adminSyncOverviewCard",
    "adminSyncToggleBtn",
    "adminSyncOverviewCard",
    true,
  );
}

function toggleFirebaseAdminCard() {
  toggleCollapsibleCard(
    "firebaseAdminCard",
    "firebaseAdminToggleBtn",
    "firebaseAdminCard",
    true,
  );
}

function updateAdminSyncToggleButton() {
  applyDashboardCollapseStates();
}

function bindEvents() {
  on("appModal", "click", (e) => {
    if (e.target.id === "appModal") resolveAppModal(false);
  });
  on("appModalCancelBtn", "click", () => resolveAppModal(false));
  on("appModalConfirmBtn", "click", () => {
    const mode = document.getElementById("appModal")?.dataset.mode;
    if (mode === "prompt") {
      resolveAppModal(document.getElementById("appModalInput")?.value || "");
      return;
    }
    resolveAppModal(true);
  });
  on("appModalInput", "keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      resolveAppModal(document.getElementById("appModalInput")?.value || "");
    }
  });
  document.addEventListener(
    "input",
    (e) => {
      const target = e.target.closest?.('input[data-pred-role="input"]');
      if (!target) return;

      const { matchId, playerId } = target.dataset;
      if (!matchId || !playerId) return;

      const value = String(target.value ?? "").trim();
      if (!value) return;

      const isHomeInput = target.id === `pred_home_${matchId}_${playerId}`;
      if (isHomeInput) {
        if (typeof e.stopImmediatePropagation === "function") {
          e.stopImmediatePropagation();
        }
        e.stopPropagation();
        focusPredictionSiblingInput(target);
        return;
      }

      blurPredictionInputAndCloseKeyboard(target);
      simulateOutsideTapAfterPredictionSave();

      if (shouldAutoSavePrediction(matchId, playerId)) {
        setTimeout(() => {
          const viewportSnapshot = capturePredictionViewport({
            matchId,
            playerId,
            focusId: null,
          });

          window.queuePredictionSave?.(
            matchId,
            playerId,
            true,
            viewportSnapshot,
          );

          simulateOutsideTapAfterPredictionSave();
        }, 40);
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (e) => {
      const target = e.target.closest?.('input[data-pred-role="input"]');
      if (!target) return;

      const { matchId, playerId } = target.dataset;
      if (!matchId || !playerId) return;

      if (e.key === "Enter") {
        e.preventDefault();
        const isHomeInput = target.id === `pred_home_${matchId}_${playerId}`;
        if (isHomeInput) {
          focusPredictionSiblingInput(target);
          return;
        }

        blurPredictionInputAndCloseKeyboard(target);
        if (shouldAutoSavePrediction(matchId, playerId)) {
          const saveViewportSnapshot = capturePredictionViewport({
            matchId,
            playerId,
            focusId: null,
          });
          window.queuePredictionSave?.(
            matchId,
            playerId,
            true,
            saveViewportSnapshot,
          );
        }
      }
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target.closest?.('button[data-pred-role="save-btn"]');
      if (!target) return;
      target.dataset.pointerPressed = "1";
    },
    true,
  );

  document.addEventListener(
    "pointerup",
    (e) => {
      const target = e.target.closest?.('button[data-pred-role="save-btn"]');
      if (!target || target.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const { matchId, playerId } = target.dataset;
      if (!matchId || !playerId) return;
      delete target.dataset.pointerPressed;
      window.queuePredictionSave(matchId, playerId, true);
    },
    true,
  );

  document.addEventListener(
    "touchend",
    (e) => {
      const target = e.target.closest?.('button[data-pred-role="save-btn"]');
      if (!target || target.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const { matchId, playerId } = target.dataset;
      if (!matchId || !playerId) return;
      window.queuePredictionSave(matchId, playerId, true);
    },
    true,
  );

  document.addEventListener(
    "mouseup",
    (e) => {
      const target = e.target.closest?.('button[data-pred-role="save-btn"]');
      if (!target || target.disabled) return;
      const { matchId, playerId } = target.dataset;
      if (!matchId || !playerId) return;
      if (target.dataset.pointerPressed === "1") {
        e.preventDefault();
        e.stopPropagation();
        delete target.dataset.pointerPressed;
        window.queuePredictionSave(matchId, playerId, true);
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target.closest?.('button[data-pred-role="save-btn"]');
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      if (target.disabled) return;

      const { matchId, playerId } = target.dataset;
      if (!matchId || !playerId) return;

      window.queuePredictionSave(matchId, playerId, true);
    },
    true,
  );

  on("addSeasonBtn", "click", addSeason);
  on("addSeasonTeamBtn", "click", addSeasonTeam);
  on("addPlayerBtn", "click", (event) => addPlayer(event.currentTarget));
  on("addWeekBtn", "click", addWeek);
  on("addMatchBtn", "click", addMatch);
  on("exportWeekCsvBtn", "click", exportSelectedWeekCsv);
  on("exportWeekJsonBtn", "click", exportSelectedWeekJson);
  on("exportFullBackupBtn", "click", exportFullBackup);
  on("apiImportFixturesBtn", "click", () => importFixturesFromApi(false));
  on("apiUpdateResultsBtn", "click", () => importFixturesFromApi(true));
  on("apiSyncWeekBtn", "click", syncSelectedWeekFromApi);
  on("dashboardSyncWeekBtn", "click", syncDashboardWeek);
  on("dashboardSyncSeasonBtn", "click", syncDashboardSeason);
  on("dashboardSyncToggleBtn", "click", toggleDashboardSyncCard);
  on("adminSyncToggleBtn", "click", toggleAdminSyncOverview);
  on("firebaseAdminRefreshBtn", "click", refreshFirebaseAdminPanel);
  on("firebaseAdminTestBtn", "click", testFirebaseAdminConnection);
  on("toggleShareModeBtn", "click", togglePredictionShareMode);
  document.addEventListener("click", (event) => {
    const syncBtn = event.target.closest('[data-role="global-sync-btn"]');
    if (!syncBtn) return;
    refreshSessionData(syncBtn);
  });
  on("shareViewPreBtn", "click", () => setPredictionShareView("pre"));
  on("shareViewPostBtn", "click", () => setPredictionShareView("post"));
  on("shareCompactToggle", "change", (event) =>
    setPredictionShareCompact(event.target.checked),
  );
  on("shareHideEmptyToggle", "change", (event) =>
    setPredictionShareFadeEmpty(event.target.checked),
  );
  on("downloadShareImageBtn", "click", exportPredictionShareImage);
  on("closeChampionModalBtn", "click", () =>
    document.getElementById("championModal")?.classList.add("hidden"),
  );
  on("resetBtn", "click", handleDangerousReset);
  on(
    "importFile",
    "change",
    (e) => e.target.files?.[0] && importData(e.target.files[0]),
  );

  document
    .querySelectorAll(".nav-tab")
    .forEach((btn) =>
      btn.addEventListener("click", () => switchTab(btn.dataset.tab)),
    );
  document
    .querySelectorAll(".mobile-nav-btn[data-tab]")
    .forEach((btn) =>
      btn.addEventListener("click", () => switchTab(btn.dataset.tab)),
    );
  on("logoutBtn", "click", logoutUser);
  on("mobileLogoutBtn", "click", logoutUser);
  on("desktopAccountBtn", "click", () => toggleAccountMenu("desktop"));
  on("mobileAccountBtn", "click", () => toggleAccountMenu("mobile"));
  on("mobileAdminMenuBtn", "click", () => toggleMobileAdminMenu());
  on("mobileAdminMenuCloseBtn", "click", closeMobileAdminMenu);
  on("mobileAdminMenuBackdrop", "click", closeMobileAdminMenu);
  document
    .querySelectorAll(".mobile-admin-menu-item[data-tab]")
    .forEach((btn) =>
      btn.addEventListener("click", () => switchTab(btn.dataset.tab)),
    );
  on("desktopChangePasswordBtn", "click", changeOwnPassword);
  on("mobileChangePasswordBtn", "click", changeOwnPassword);
  on("loginBtn", "click", loginUser);
  on("loginPassword", "keydown", (e) => {
    if (e.key === "Enter") loginUser();
  });
  on("loginUsername", "input", clearLoginErrorState);
  on("loginPassword", "input", clearLoginErrorState);

  let lastWindowWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (
      !window.matchMedia("(max-width: 950px) and (orientation: landscape)")
        .matches
    ) {
    }
    const currentWidth = window.innerWidth;
    if (currentWidth !== lastWindowWidth) {
      lastWindowWidth = currentWidth;
      renderAll();
      updateAdminSyncToggleButton();
    }
  });

  [
    "dashboardSeasonSelect",
    "seasonManagerSelect",
    "weekSeasonSelect",
    "matchSeasonSelect",
    "predictionSeasonSelect",
    "standingsSeasonSelect",
    "statsSeasonSelect",
  ].forEach((id) => {
    on(id, "change", (e) => setActiveSeason(e.target.value));
  });

  [
    "dashboardWeekSelect",
    "weekActiveSelect",
    "matchWeekSelect",
    "matchesFilterWeek",
    "predictionWeekSelect",
    "standingsWeekSelect",
  ].forEach((id) => {
    on(id, "change", (e) => setActiveWeek(e.target.value));
  });
  on("backupWeekSelect", "change", (e) => {
    const weekId = e.target.value;
    if (weekId) state.settings.activeWeekId = weekId;
    saveState();
    renderBackupPanel();
  });
}
window.addEventListener("online", () => {
  flushPendingPredictionQueue({ renderAfterFlush: true }).then((result) => {
    if (result.flushed) {
      updateLastSyncLabel();
      recordAdminSyncActivity({
        lastAction: `${result.flushed} bekleyen tahmin otomatik gönderildi.`,
        success: true,
      });
      updateSessionCard();
      showAlert(
        `${result.flushed} bekleyen tahmin yeniden çevrimiçi olunca gönderildi.`,
        {
          title: "Bağlantı Geri Geldi",
          type: "success",
        },
      );
    }
  });
});

bindEvents();
ensureHeaderSyncButtons();
switchTab(state.settings.currentTab || "dashboard");
updateLoginOverlay();
updateAdminSyncToggleButton();

if (isFirebaseReady()) {
  ensureFirebaseDefaults().catch((error) =>
    console.warn("Firebase varsayılanları hazırlanamadı:", error),
  );
  ensureFirebaseRealtimeBridge();
}

if (isAuthenticated()) {
  startPresenceTracking();
  renderAll();
  runSessionHydrationWithFastOverlay({
    loadingMessage:
      "Kayıtlı veriler açılıyor, güncel bilgiler arka planda senkronlanıyor...",
    sessionRestore: true,
    suppressOverlay: true,
  }).catch((error) =>
    console.warn("Başlangıç maç/tahmin senkron uyarısı:", error),
  );
} else {
  renderAll();
}

window.refreshFirebaseAdminPanel = refreshFirebaseAdminPanel;
window.testFirebaseAdminConnection = testFirebaseAdminConnection;
window.toggleFirebaseAdminCard = toggleFirebaseAdminCard;
window.toggleDashboardSyncCard = toggleDashboardSyncCard;
window.toggleAdminSyncOverview = toggleAdminSyncOverview;
window.handleTeamLogoError = handleTeamLogoError;
