/* 01-bootstrap-firebase.js */

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
        panelAdmin: payload.panelAdmin === true,
        supportedTeam: String(
          payload.supportedTeam || payload.teamName || payload.favoriteTeam || "",
        ).trim(),
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
        ...(Object.prototype.hasOwnProperty.call(payload, "panelAdmin")
          ? { panelAdmin: payload.panelAdmin === true }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, "aktif")
          ? { aktif: payload.aktif !== false }
          : {}),
        ...(payload.seasonStates ? { seasonStates: payload.seasonStates } : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, "supportedTeam")
          ? {
              supportedTeam: String(
                payload.supportedTeam || payload.teamName || payload.favoriteTeam || "",
              ).trim(),
            }
          : {}),
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
    role: hasPanelAdminAccess(player || authUser) ? "admin" : "user",
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

function hasPanelAdminAccess(userOrPlayer) {
  if (!userOrPlayer) return false;

  const rawRole = String(
    userOrPlayer?.rol ||
      userOrPlayer?.role ||
      userOrPlayer?.kullaniciRol ||
      "user",
  ).toLowerCase();
  if (rawRole === "admin") return true;

  const rawUsername = String(
    userOrPlayer?.kullaniciAdi || userOrPlayer?.username || "",
  )
    .trim()
    .toLowerCase();
  if (rawUsername === "admin") return true;

  return userOrPlayer?.panelAdmin === true;
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
    panelAdmin: user.panelAdmin === true,
    aktif: user.aktif !== false,
    seasonStates:
      user.seasonStates || user.seasonMemberships || user.activeSeasons || {},
    supportedTeam:
      user.supportedTeam || user.teamName || user.favoriteTeam || "",
  }));
  state.players = users;
  const authUser = getAuthUser();
  if (authUser) {
    const matched = findPlayerForSessionUser(authUser);
    state.settings.auth.playerId = matched ? matched.id : null;
    if (matched && currentSessionUser) {
      currentSessionUser.panelAdmin = matched.panelAdmin === true;
      state.settings.auth.user = {
        ...(state.settings.auth.user || {}),
        panelAdmin: matched.panelAdmin === true,
      };
    }
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
    panelAdmin: player.panelAdmin === true,
  }));
}

function getCurrentRole() {
  if (hasPanelAdminAccess(getAuthUser())) return "admin";
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



let welcomeOverlayTimer = null;

function getWelcomeDisplayName(user = getAuthUser()) {
  return String(
    getCurrentPlayer?.()?.name ||
      user?.adSoyad ||
      user?.name ||
      user?.kullaniciAdi ||
      user?.username ||
      ""
  )
    .trim()
    .toUpperCase();
}

function hideWelcomeOverlay(immediate = false) {
  const overlay = document.getElementById("welcomeOverlay");
  if (!overlay) return;
  if (welcomeOverlayTimer) {
    window.clearTimeout(welcomeOverlayTimer);
    welcomeOverlayTimer = null;
  }
  overlay.classList.remove("is-visible");
  overlay.setAttribute("aria-hidden", "true");
  const finish = () => overlay.classList.add("hidden");
  if (immediate) {
    finish();
  } else {
    window.setTimeout(finish, 280);
  }
}

function showWelcomeOverlay(user = getAuthUser(), options = {}) {
  const overlay = document.getElementById("welcomeOverlay");
  const avatar = document.getElementById("welcomeAvatar");
  const title = document.getElementById("welcomeTitle");
  const message = document.getElementById("welcomeMessage");
  if (!overlay || !avatar || !title || !message) return;

  const displayName = getWelcomeDisplayName(user) || "Hoş geldin";
  const shortName = displayName.split(/\s+/).filter(Boolean)[0] || displayName;
  const welcomeLines = [
    "İyi haftalar, bol şans! ✨",
    "Yeni haftada güzel tahminler seni bekliyor. ⚽",
    "Hazırsan başlayalım, şans seninle olsun. 🌟",
    "Harika bir hafta olsun, bol puanlar! 🙌",
  ];
  const selectedMessage =
    options.message || welcomeLines[Math.floor(Math.random() * welcomeLines.length)];

  const avatarSource =
    typeof createGenericAvatarMarkup === "function"
      ? createGenericAvatarMarkup(
          getCurrentPlayer?.() || user || { name: shortName },
          "welcome-hero-avatar",
        )
      : `<span class="app-avatar welcome-hero-avatar"><span class="app-avatar-fallback">${escapeHtml(shortName.charAt(0) || "?")}</span></span>`;

  avatar.innerHTML = avatarSource;
  title.textContent = `Hoş geldin, ${shortName}!`;
  message.textContent = selectedMessage;

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => {
    overlay.classList.add("is-visible");
  });

  if (typeof refreshAvatarImages === "function") {
    refreshAvatarImages(overlay);
  }

  if (welcomeOverlayTimer) window.clearTimeout(welcomeOverlayTimer);
  welcomeOverlayTimer = window.setTimeout(() => hideWelcomeOverlay(), options.duration || 2300);
}

function updateSessionCard() {
  const isAuth = isAuthenticated();
  const isAdmin = getCurrentRole() === "admin";
  const isPanelAdminUser =
    currentSessionUser?.rol === "user" &&
    currentSessionUser?.panelAdmin === true;
  const currentName = isAuth
    ? isPanelAdminUser
      ? getCurrentPlayer()?.name ||
        currentSessionUser?.adSoyad ||
        currentSessionUser?.name ||
        "Kullanıcı"
      : isAdmin
        ? currentSessionUser?.adSoyad || currentSessionUser?.name || "Admin"
        : getCurrentPlayer()?.name ||
          currentSessionUser?.adSoyad ||
          currentSessionUser?.name ||
          "Kullanıcı"
    : "Giriş yapılmadı";
  const online = isAuth ? navigator.onLine : false;
  const statusText = online ? "Online" : "Offline";
  const roleText = !isAuth
    ? "Misafir"
    : currentSessionUser?.rol === "user" &&
        currentSessionUser?.panelAdmin === true
      ? "Panel Admin"
      : isAdmin
        ? "Admin"
        : "Kullanıcı";

  const mappings = [
    ["desktopAccountName", currentName],
    ["mobileAccountName", currentName],
    ["desktopAccountBtnName", currentName],
    ["desktopAccountBtnRole", roleText],
    ["desktopAccountStatus", statusText],
    ["mobileAccountStatus", statusText],
    ["desktopAccountRole", roleText],
    ["mobileAccountRole", roleText],
  ];
  mappings.forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });


  const sessionAvatarRow = isPanelAdminUser
    ? getCurrentPlayer() || currentSessionUser || { name: currentName }
    : isAdmin
      ? currentSessionUser || { name: currentName }
      : getCurrentPlayer() || currentSessionUser || { name: currentName };
  const avatarMarkup = typeof createGenericAvatarMarkup === "function"
    ? createGenericAvatarMarkup(sessionAvatarRow, "topbar-account-avatar")
    : `<span class="app-avatar topbar-account-avatar"><span class="app-avatar-fallback">${escapeHtml(String(currentName || "?").trim().charAt(0) || "?")}</span></span>`;

  ["desktopAccountAvatar", "mobileTopProfileAvatar"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = avatarMarkup;
  });
  if (typeof refreshAvatarImages === "function") {
    refreshAvatarImages(document);
  }

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
  const mobileBtn = document.getElementById("mobileTopProfileBtn") || document.getElementById("mobileAccountBtn");
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
    isMobileMenu ? (document.getElementById("mobileTopProfileBtn") ? "mobileTopProfileBtn" : "mobileAccountBtn") : "desktopAccountBtn",
  );
  const otherMenu = document.getElementById(
    isMobileMenu ? "desktopAccountMenu" : "mobileAccountMenu",
  );
  const otherBtn = document.getElementById(
    isMobileMenu ? "desktopAccountBtn" : (document.getElementById("mobileTopProfileBtn") ? "mobileTopProfileBtn" : "mobileAccountBtn"),
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
      panelAdmin: result.user.panelAdmin === true,
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

    window.setTimeout(() => {
      showWelcomeOverlay(nextUser, { duration: 4000 });
    }, 860);
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


function getDashboardPredictionTone(pred, match) {
  if (!pred || pred.homePred === "" || pred.awayPred === "") return "is-missing";
  const points = Number(pred.points || 0);
  if (!match.played) return "is-filled";
  if (points >= 3) return "is-exact";
  if (points >= 1) return "is-close";
  return "is-miss";
}

function getDashboardPredictionLabel(pred, match) {
  if (!pred || pred.homePred === "" || pred.awayPred === "") return "Tahmin yok";
  if (!match.played) return "Tahmin girildi";
  const points = Number(pred.points || 0);
  if (points >= 3) return "Tam skor";
  if (points >= 1) return "Sonucu bildi";
  return "Tutmadı";
}

function getDashboardMatchInsight(match) {
  const players = getVisiblePlayersOrdered();
  const preds = players.map((player) => ({ player, pred: getPrediction(match.id, player.id) }));
  const filled = preds.filter(({ pred }) => pred && pred.homePred !== "" && pred.awayPred !== "");
  const missing = preds.length - filled.length;
  if (!filled.length) {
    return { title: "Tahmin bekleniyor", text: "Henüz bu maç için tahmin girilmedi." };
  }
  if (!match.played) {
    return {
      title: missing ? `${missing} kişi eksik` : "Tüm tahminler girildi",
      text: missing ? "Kartı açıp kimlerin tahmin girdiğini görebilirsin." : "Tüm oyuncular bu maç için tahminini girdi.",
    };
  }
  const exact = filled.filter(({ pred }) => Number(pred.points || 0) >= 3).length;
  const resultOnly = filled.filter(({ pred }) => Number(pred.points || 0) === 1).length;
  if (exact) return { title: `${exact} tam skor`, text: "Maç detayında tam skoru bilenleri öne çıkarıyorum." };
  if (resultOnly) return { title: `${resultOnly} doğru sonuç`, text: "Tam skor yok ama sonucu bilenler var." };
  return { title: "Sürpriz maç", text: "Bu maçta henüz kimse puan alamadı." };
}


function renderDashboardOverview() {
  const titleNode = document.getElementById("dashboardHeroTitle");
  const textNode = document.getElementById("dashboardHeroText");
  const chipsNode = document.getElementById("dashboardHeroChips");
  const sideNode = document.getElementById("dashboardHeroSide");
  const pulseNode = document.getElementById("dashboardPulseList");
  const leaderboardNode = document.getElementById("dashboardLeaderboardPreview");
  const liveNode = document.getElementById("dashboardHeroLiveBadge");

  if (!titleNode || !textNode || !chipsNode || !sideNode || !pulseNode || !leaderboardNode || !liveNode) return;

  const activeSeasonId = getActiveSeasonId();
  const activeWeekId = state.settings.activeWeekId;
  const season = getSeasonById(activeSeasonId);
  const week = getWeekById(activeWeekId);
  const matches = activeWeekId ? getMatchesByWeekId(activeWeekId) : [];
  const players = getVisiblePlayersOrdered();
  const standings = getGeneralStandings(activeSeasonId).slice(0, 5);
  const played = matches.filter((match) => match.played);
  const totalPredSlots = matches.length * players.length;
  const filledPredictions = matches.reduce((sum, match) => {
    return sum + players.filter((player) => {
      const pred = getPrediction(match.id, player.id);
      return pred && pred.homePred !== "" && pred.awayPred !== "";
    }).length;
  }, 0);
  const coverage = totalPredSlots ? Math.round((filledPredictions / totalPredSlots) * 100) : 0;
  const missing = Math.max(totalPredSlots - filledPredictions, 0);
  const exact = matches.reduce((sum, match) => {
    return sum + players.filter((player) => Number(getPrediction(match.id, player.id)?.points || 0) >= 3).length;
  }, 0);
  const resultOnly = matches.reduce((sum, match) => {
    return sum + players.filter((player) => Number(getPrediction(match.id, player.id)?.points || 0) === 1).length;
  }, 0);

  let nextMatch = null;
  const now = Date.now();
  matches.forEach((match) => {
    const ts = new Date(match.date).getTime();
    if (!match.played && !Number.isNaN(ts) && ts >= now && (!nextMatch || ts < new Date(nextMatch.date).getTime())) {
      nextMatch = match;
    }
  });

  const titleParts = [];
  if (season?.name) titleParts.push(season.name);
  if (week?.name) titleParts.push(week.name);
  titleNode.textContent = titleParts.join(" • ") || "Genel Bakış";

  if (!matches.length) {
    textNode.textContent = "Bu hafta için henüz maç bulunmuyor. Önce hafta veya maç eklediğinde burası otomatik dolacak.";
    liveNode.textContent = "Boş hafta";
    liveNode.className = "dashboard-hero-live is-idle";
  } else if (played.length === matches.length) {
    textNode.textContent = `Haftanın tüm maçları tamamlandı. ${exact} tam skor ve ${resultOnly} doğru sonuç üretildi.`;
    liveNode.textContent = "Hafta tamamlandı";
    liveNode.className = "dashboard-hero-live is-complete";
  } else if (played.length > 0) {
    textNode.textContent = `${played.length}/${matches.length} maç oynandı. Kalan maçlar için tahmin akışı hâlâ açık.`;
    liveNode.textContent = "Hafta canlı";
    liveNode.className = "dashboard-hero-live is-live";
  } else {
    textNode.textContent = `Hafta henüz başlamadı. ${filledPredictions} tahmin girildi, ${missing} tahmin alanı hâlâ boş.`;
    liveNode.textContent = "Başlamadı";
    liveNode.className = "dashboard-hero-live is-idle";
  }

  const chips = [
    `${matches.length} maç`,
    `${played.length} oynandı`,
    `${coverage}% doluluk`,
    `${players.length} kişi`,
  ];
  chipsNode.innerHTML = chips.map((chip) => `<span class="dashboard-hero-chip">${escapeHtml(chip)}</span>`).join("");

  sideNode.innerHTML = `
    <div class="dashboard-hero-side__stat">
      <span>Eksik Tahmin</span>
      <strong>${missing}</strong>
      <small>Bu haftadaki toplam boş giriş</small>
    </div>
    <div class="dashboard-hero-side__stat">
      <span>Toplam Tahmin</span>
      <strong>${filledPredictions}</strong>
      <small>Dolu skor tahmini hücresi</small>
    </div>
  `;

  const pulseItems = [];
  if (nextMatch) {
    pulseItems.push({
      title: "Sıradaki maç",
      text: `${nextMatch.homeTeam} - ${nextMatch.awayTeam}`,
      meta: formatDate(nextMatch.date),
      tone: "info",
    });
  }
  pulseItems.push({
    title: "Tahmin doluluğu",
    text: `%${coverage} dolu`,
    meta: `${filledPredictions} girildi / ${missing} boş`,
    tone: coverage >= 85 ? "good" : coverage >= 50 ? "warn" : "soft",
  });
  pulseItems.push({
    title: "Hafta sonucu",
    text: `${exact} tam skor`,
    meta: `${resultOnly} doğru sonuç`,
    tone: exact > 0 ? "good" : "soft",
  });
  pulseNode.innerHTML = pulseItems.map((item) => `
    <article class="dashboard-pulse-item is-${item.tone}">
      <div class="dashboard-pulse-item__dot"></div>
      <div class="dashboard-pulse-item__content">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.text)}</span>
        <small>${escapeHtml(item.meta)}</small>
      </div>
    </article>
  `).join("") || createEmptyState("Bu alan hafta verisi geldikçe dolacak.");

  leaderboardNode.innerHTML = standings.slice(0, 4).map((row, index) => `
    <div class="dashboard-leader-row ${index === 0 ? "is-leader" : ""}">
      <div class="dashboard-leader-row__rank">${index + 1}</div>
      <div class="dashboard-leader-row__name">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${index === 0 ? "Lider" : "Takipte"}</span>
      </div>
      <div class="dashboard-leader-row__points">${Number(row.total || 0)}p</div>
    </div>
  `).join("") || createEmptyState("Sıralama oluşması için puan verisi bekleniyor.");
}

function renderDashboardMatchCards(container, matches) {
  if (!container) return;
  if (!matches.length) {
    container.innerHTML = createEmptyState("Bu haftada henüz maç yok.");
    return;
  }
  const players = getVisiblePlayersOrdered();
  container.innerHTML = `<div class="dashboard-match-hub">${matches
    .map((match) => {
      const badge = getMatchBadge(match);
      const visual = getMatchVisualState(match);
      const predictions = players.map((player) => ({ player, pred: getPrediction(match.id, player.id) }));
      const filled = predictions.filter(({ pred }) => pred && pred.homePred !== "" && pred.awayPred !== "");
      const exact = predictions.filter(({ pred }) => pred && Number(pred.points || 0) >= 3).length;
      const resultOnly = predictions.filter(({ pred }) => pred && Number(pred.points || 0) === 1).length;
      const insight = getDashboardMatchInsight(match);
      const missing = Math.max(players.length - filled.length, 0);
      const fillRatio = players.length ? filled.length / players.length : 1;
      const coverageClass = fillRatio >= 0.85 ? "coverage-full" : fillRatio >= 0.5 ? "coverage-mid" : "coverage-low";
      const ts = new Date(match.date).getTime();
      const timeText = Number.isNaN(ts)
        ? "Saat yok"
        : new Date(match.date).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

      const avatars = predictions.slice(0, 5).map(({ player, pred }) => {
        const tone = getDashboardPredictionTone(pred, match);
        return `<span class="dashboard-avatar-chip ${tone}" title="${escapeHtml(player.name)}">${createGenericAvatarMarkup(player, "dashboard-inline-avatar")}</span>`;
      }).join("");

      return `
        <article class="dashboard-match-card is-${visual} ${coverageClass} ${match.played ? "is-played" : ""} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}" onclick="openDashboardMatchModal('${match.id}')">
          <div class="dashboard-match-card__glow"></div>

          <div class="dashboard-match-card__top">
            <div class="dashboard-card-topline">
              <span class="badge ${badge.cls}">${badge.text}</span>
              <span class="dashboard-card-kickoff">${timeText}</span>
            </div>
            <span class="dashboard-match-card__date">${formatDate(match.date)}</span>
          </div>

          <div class="dashboard-match-card__body">
            <div class="dashboard-team dashboard-team--home">
              ${teamLogoHtml(match.homeTeam, match.seasonId)}
              <strong>${escapeHtml(match.homeTeam)}</strong>
            </div>

            <div class="dashboard-score-core">
              <div class="dashboard-score-core__label">${match.played ? "Skor" : "Maç"}</div>
              <div class="dashboard-score-core__value">${match.played ? `${match.homeScore} <span>-</span> ${match.awayScore}` : '<span class="dashboard-score-core__pending">VS</span>'}</div>
              <div class="dashboard-score-core__sub">${match.played ? 'Sonuç işlendi' : 'Detay için dokun'}</div>
            </div>

            <div class="dashboard-team dashboard-team--away">
              ${teamLogoHtml(match.awayTeam, match.seasonId)}
              <strong>${escapeHtml(match.awayTeam)}</strong>
            </div>
          </div>

          <div class="dashboard-match-card__footer">
            <div class="dashboard-match-insight">
              <strong>${escapeHtml(insight.title)}</strong>
              <span>${escapeHtml(insight.text)}</span>
            </div>

            <div class="dashboard-match-meta-pills">
              <span class="dashboard-meta-pill">${filled.length}/${players.length} tahmin</span>
              <span class="dashboard-meta-pill">${missing} eksik</span>
              <span class="dashboard-meta-pill">${exact} tam</span>
              <span class="dashboard-meta-pill">${resultOnly} sonuç</span>
            </div>

            <div class="dashboard-avatar-row">
              <div class="dashboard-avatar-row__chips">${avatars}</div>
              <span class="dashboard-avatar-row__more">${players.length ? `${Math.max(players.length - Math.min(players.length, 5), 0)} daha` : ""}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("")}</div>`;
}

function buildDashboardMatchModalBody(match) {
  const players = getVisiblePlayersOrdered();
  const rows = players.map((player) => {
    const pred = getPrediction(match.id, player.id);
    const tone = getDashboardPredictionTone(pred, match);
    const label = getDashboardPredictionLabel(pred, match);
    const value = pred && (pred.homePred !== "" || pred.awayPred !== "") ? `${pred.homePred !== "" ? pred.homePred : "-"} - ${pred.awayPred !== "" ? pred.awayPred : "-"}` : "--";
    return { player, pred, tone, label, value, points: Number(pred?.points || 0) };
  }).sort((a,b) => b.points - a.points || a.player.name.localeCompare(b.player.name, 'tr'));

  const exact = rows.filter((row) => row.tone === 'is-exact').length;
  const close = rows.filter((row) => row.tone === 'is-close').length;
  const miss = rows.filter((row) => row.tone === 'is-miss').length;
  const missing = rows.filter((row) => row.tone === 'is-missing').length;

  return `
    <div class="dashboard-detail-summary">
      <div class="dashboard-detail-stat"><span>Tahmin</span><strong>${rows.length - missing}/${rows.length}</strong></div>
      <div class="dashboard-detail-stat"><span>Tam skor</span><strong>${exact}</strong></div>
      <div class="dashboard-detail-stat"><span>Doğru sonuç</span><strong>${close}</strong></div>
      <div class="dashboard-detail-stat"><span>Kaçıran</span><strong>${miss}</strong></div>
    </div>
    <div class="dashboard-detail-list">
      ${rows.map((row) => `
        <div class="dashboard-detail-row ${row.tone}">
          <div class="dashboard-detail-row__user">
            <span class="dashboard-avatar-chip ${row.tone}">${createGenericAvatarMarkup(row.player, "dashboard-inline-avatar")}</span>
            <div>
              <strong>${escapeHtml(row.player.name)}</strong>
              <span>${escapeHtml(row.label)}</span>
            </div>
          </div>
          <div class="dashboard-detail-row__score">${escapeHtml(row.value)}</div>
          <div class="dashboard-detail-row__points">${row.pred && row.pred.homePred !== "" && row.pred.awayPred !== "" ? `${row.points}p` : '--'}</div>
        </div>
      `).join('')}
    </div>
  `;
}

window.openDashboardMatchModal = function (matchId) {
  const modal = document.getElementById('dashboardMatchModal');
  const title = document.getElementById('dashboardMatchModalTitle');
  const meta = document.getElementById('dashboardMatchModalMeta');
  const body = document.getElementById('dashboardMatchModalBody');
  const match = state.matches.find((item) => String(item.id) === String(matchId));
  if (!modal || !title || !meta || !body || !match) return;
  title.textContent = `${match.homeTeam} - ${match.awayTeam}`;
  meta.textContent = match.played ? `Gerçek skor: ${match.homeScore}-${match.awayScore} • ${formatDate(match.date)}` : `${formatDate(match.date)} • Maç henüz oynanmadı`;
  body.innerHTML = buildDashboardMatchModalBody(match);
  modal.classList.remove('hidden');
  document.body.classList.add('dashboard-modal-open');
};

window.closeDashboardMatchModal = function () {
  const modal = document.getElementById('dashboardMatchModal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.classList.remove('dashboard-modal-open');
};

function renderMobilePredictions(container, matches) {
  if (!container) return;
  const currentPlayerId = getCurrentPlayerId();
  const players = getVisiblePlayersOrdered();
  const currentRole = getCurrentRole();
  const isAdmin = currentRole === "admin";

  container.innerHTML = `<div class="mobile-prediction-list mobile-prediction-list--compact">${matches
    .map((match) => {
      const locked = isMatchLocked(match);
      const lockedForUi = locked && !isAdmin;
      const badge = getMatchBadge(match);
      const visual = getMatchVisualState(match);

      return `
      <article class="mobile-prediction-card premium-card compact-premium-card ${match.played ? "played-row" : ""} ${locked ? "locked-match" : "open-match"} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}">
        <div class="mobile-prediction-header premium-header compact-premium-header">
          <div class="mobile-prediction-match">${matchCell(match)}</div>
          <div class="mobile-prediction-subline premium-subline compact-subline">
            <span class="badge ${badge.cls}">${badge.text}</span>
            ${match.played ? `<span class="result-chip premium-result-chip">Skor ${match.homeScore}-${match.awayScore}</span>` : locked ? `<span class="result-chip warning-chip premium-result-chip">Kapandı</span>` : `<span class="result-chip premium-result-chip soft-chip">Açık</span>`}
          </div>
        </div>
        <div class="mobile-user-predictions compact-mobile-user-predictions">${players
          .map((player) => {
            const pred = getPrediction(match.id, player.id) || createEmptyPredictionRecord(match.id, player.id);
            const hasPrediction = pred.homePred !== "" || pred.awayPred !== "";
            const canEdit = canEditPrediction(player.id, match.seasonId);
            const statusClass = hasPrediction ? "filled-prediction" : "empty-prediction";
            const lockedClass = lockedForUi || !canEdit ? "locked-cell locked-mobile-card" : "editable-cell";
            const ownClass = player.id === currentPlayerId ? "own-player-card" : "";
            const outcomeClass = getPredictionOutcomeClass(pred, match);
            const uiKey = getPredictionUiKey(match.id, player.id);
            const uiState = predictionUiState[uiKey] || "idle";
            const isSaving = uiState === "saving";
            const isOwnPlayer = player.id === currentPlayerId;
            const statusText = getPredictionBaseStatus(match.id, player.id);
            const showDeleteAction = hasPrediction || pred.remoteId || isSaving;
            const scoreDisplay = pred.homePred !== "" || pred.awayPred !== ""
              ? `${pred.homePred !== "" ? pred.homePred : "-"} - ${pred.awayPred !== "" ? pred.awayPred : "-"}`
              : "--";
            const showSaveAction = canEdit && shouldShowPredictionSaveAction(match.id, player.id);

            if (!isOwnPlayer && !isAdmin) {
              return `
              <div class="mobile-other-prediction premium-user-card compact-user-row compact-user-row--lean ${pointLabel(pred.points)} ${outcomeClass} ${statusClass}">
                <div class="compact-user-main">
                  <strong>${escapeHtml(player.name)}</strong>
                  <span class="compact-score-pill">${scoreDisplay}</span>
                </div>
                <div class="compact-user-meta compact-user-meta--lean">
                  <span class="mini-points premium-points compact-points">${pred.points || 0}p</span>
                  <div class="prediction-status-chip ${outcomeClass} compact-status compact-status--lean" id="pred_status_${match.id}_${player.id}">${statusText}</div>
                </div>
              </div>`;
            }

            return `
            <div class="mobile-user-prediction premium-user-card premium-user-card--compact ${pointLabel(pred.points)} ${outcomeClass} ${statusClass} ${lockedClass} ${ownClass}">
              <div class="mobile-user-head premium-user-head compact-user-head">
                <strong>${escapeHtml(player.name)}${isOwnPlayer ? '<span class="own-pill">Sen</span>' : isAdmin ? '<span class="own-pill">Yönet</span>' : ''}</strong>
                <span class="mini-points premium-points premium-points--compact">${locked ? "🔒" : `${pred.points || 0} puan`}</span>
              </div>

              <div class="score-inputs compact-inputs center-mode premium-score-inputs premium-score-inputs--compact pred-score-row own-pred-score-row">
                <input
                  type="number"
                  min="0"
                  inputmode="numeric"
                  value="${pred.homePred}"
                  id="pred_home_${match.id}_${player.id}"
                  data-pred-role="input"
                  data-match-id="${match.id}"
                  data-player-id="${player.id}"
                  ${lockedForUi || !canEdit ? "disabled" : ""}
                  oninput="window.queuePredictionSave && window.queuePredictionSave('${match.id}','${player.id}')"
                />
                <span class="premium-dash">-</span>
                <input
                  type="number"
                  min="0"
                  inputmode="numeric"
                  value="${pred.awayPred}"
                  id="pred_away_${match.id}_${player.id}"
                  data-pred-role="input"
                  data-match-id="${match.id}"
                  data-player-id="${player.id}"
                  ${lockedForUi || !canEdit ? "disabled" : ""}
                  oninput="window.queuePredictionSave && window.queuePredictionSave('${match.id}','${player.id}')"
                />
              </div>

              ${lockedForUi ? `<div class="mobile-lock-warning">🔒 Tahmin kapandı</div>` : ""}
              <div class="pred-action-area own-pred-action-area own-pred-action-area--compact">
                ${canEdit
                  ? `
                  <div class="mobile-save-row pred-btn-slot prediction-button-row mobile-save-row--compact ${showSaveAction || showDeleteAction ? "" : "is-collapsed"}">
                    <button
                      class="prediction-mobile-save-btn prediction-mobile-save-btn--compact ${showSaveAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_btn_${match.id}_${player.id}"
                      data-pred-role="save-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      ${lockedForUi ? "disabled" : ""}
                      onclick="if(!this.disabled && window.queuePredictionSave){ event.preventDefault(); event.stopPropagation(); window.queuePredictionSave('${match.id}','${player.id}', true); } return false;"
                    >${lockedForUi ? "🔒 Kilitli" : getPredictionSaveLabel(match.id, player.id)}</button>
                    <button
                      class="prediction-mobile-save-btn prediction-mobile-save-btn--compact danger prediction-delete-btn ${showDeleteAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_delete_${match.id}_${player.id}"
                      data-pred-role="delete-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      ${lockedForUi ? "disabled" : ""}
                      onclick="if(!this.disabled && window.deletePredictionEntry){ event.preventDefault(); event.stopPropagation(); window.deletePredictionEntry('${match.id}','${player.id}'); } return false;"
                    >Sil</button>
                  </div>`
                  : `<div class="pred-btn-slot"></div>`}

                <div class="pred-status-slot pred-status-slot--compact">
                  <div class="prediction-status-chip ${outcomeClass}" id="pred_status_${match.id}_${player.id}">${statusText}</div>
                </div>
              </div>
            </div>`;
          })
          .join("")}</div>
      </article>`;
    })
    .join("")}</div>`;

  bindPredictionActionElements(container);
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



document.addEventListener("click", (event) => {
  const overlay = document.getElementById("welcomeOverlay");
  if (!overlay || overlay.classList.contains("hidden")) return;
  if (event.target === overlay || event.target?.closest?.(".welcome-overlay__backdrop")) {
    hideWelcomeOverlay();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideWelcomeOverlay();
});
