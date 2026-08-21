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

let firebaseBootstrapPromise = null;

function waitForFirebaseSdk(timeoutMs = 15000) {
  if (window.firebase && typeof window.firebase.initializeApp === "function") {
    return Promise.resolve(window.firebase);
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (
        window.firebase &&
        typeof window.firebase.initializeApp === "function"
      ) {
        window.clearInterval(timer);
        resolve(window.firebase);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        reject(new Error("Firebase SDK zamanında yüklenemedi."));
      }
    }, 50);
  });
}

async function initializeFirebaseOnce() {
  if (window.__fiksturFirebaseApp) return window.__fiksturFirebaseApp;
  if (firebaseBootstrapPromise) return firebaseBootstrapPromise;

  firebaseBootstrapPromise = (async () => {
    if (!isFirebaseConfigured()) {
      throw new Error("Firebase yapılandırması bulunamadı veya eksik.");
    }

    const firebaseSdk = await waitForFirebaseSdk();
    const app =
      firebaseSdk.apps && firebaseSdk.apps.length
        ? firebaseSdk.app()
        : firebaseSdk.initializeApp(getFirebaseConfig());

    window.__fiksturFirebaseApp = app;
    window.__fiksturFirebaseDb = firebaseSdk.database(app);
    window.__fiksturFirebaseReady = true;
    return app;
  })().catch((error) => {
    firebaseBootstrapPromise = null;
    window.__fiksturFirebaseReady = false;
    console.error("Firebase bootstrap başarısız:", error);
    throw error;
  });

  return firebaseBootstrapPromise;
}

function getFirebaseDb() {
  if (window.__fiksturFirebaseDb) return window.__fiksturFirebaseDb;
  if (!isFirebaseConfigured()) return null;
  if (!window.firebase || typeof window.firebase.initializeApp !== "function")
    return null;

  try {
    const app =
      window.__fiksturFirebaseApp ||
      (window.firebase.apps && window.firebase.apps.length
        ? window.firebase.app()
        : window.firebase.initializeApp(getFirebaseConfig()));
    window.__fiksturFirebaseApp = app;
    window.__fiksturFirebaseDb = window.firebase.database(app);
    window.__fiksturFirebaseReady = true;
    return window.__fiksturFirebaseDb;
  } catch (error) {
    console.error("Firebase başlatılamadı:", error);
    return null;
  }
}

function isFirebaseReady() {
  return !!window.__fiksturFirebaseReady && !!getFirebaseDb();
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

function getFirebasePredictionTimestampValue(record = {}) {
  const raw =
    record.updatedAt ||
    record.guncellemeTarihi ||
    record.createdAt ||
    record.tarih ||
    record.timestamp ||
    0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number(raw || 0) || 0;
}

function getFirebasePredictionCanonicalKey(record = {}) {
  const matchId = String(record.matchId || record.localMatchId || "").trim();
  const playerId = String(
    record.playerId || record.kullaniciId || record.userId || "",
  ).trim();
  if (!matchId || !playerId) return "";
  return makePredictionRecordId(matchId, playerId);
}

function dedupeFirebasePredictionRows(rows = []) {
  const map = new Map();
  rows.forEach((row, index) => {
    const key = getFirebasePredictionCanonicalKey(row);
    if (!key) return;
    const current = map.get(key);
    const nextTime = getFirebasePredictionTimestampValue(row);
    const currentTime = current
      ? getFirebasePredictionTimestampValue(current.row)
      : -1;
    if (
      !current ||
      nextTime > currentTime ||
      (nextTime === currentTime && index > current.index)
    ) {
      map.set(key, { row, index });
    }
  });
  return Array.from(map.values()).map((item) => item.row);
}

async function firebaseRead(path) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase henüz yapılandırılmadı.");
  const safePath = String(path ?? "").trim();
  const snapshot = await (safePath ? db.ref(safePath) : db.ref()).get();
  return snapshot.exists() ? snapshot.val() : null;
}

async function firebaseWrite(path, value) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase henüz yapılandırılmadı.");
  const safePath = String(path ?? "").trim();
  if (!safePath) throw new Error("Firebase yazma yolu boş olamaz.");
  await db.ref(safePath).set(value);
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

  // Realtime Database boş nesne/dizileri kalıcı düğüm olarak saklamaz.
  // Bu koleksiyonlara her HYDRATE sırasında {} veya [] yazmak, value
  // listener'larını yeniden tetikleyerek sonsuz HYDRATE döngüsü oluşturur.
  // matches ve predictions boşken oluşturulmaları gerekmez; ilk gerçek kayıt
  // ilgili düğümü zaten oluşturacaktır.

  if (!settings || settings.init === true || !Object.keys(settings).length) {
    const now = new Date().toISOString();
    await firebaseWrite("settings", {
      init: false,
      source: "firebase",
      createdAt: now,
      defaultUsersSeeded: true,
      welcomeCard: {
        enabled: true,
        title: "Hoş geldin!",
        message: "İyi haftalar, bol şans! ✨",
        imageFile: "",
        imageFit: "cover",
        showOnce: false,
        updatedAt: now,
      },
    });
  } else if (!settings.welcomeCard) {
    const now = new Date().toISOString();
    await firebaseUpdate("settings", {
      welcomeCard: {
        enabled: true,
        title: "Hoş geldin!",
        message: "İyi haftalar, bol şans! ✨",
        imageFile: "",
        imageFit: "cover",
        showOnce: false,
        updatedAt: now,
      },
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
      predictions = dedupeFirebasePredictionRows(predictions);
      return { success: true, predictions };
    }
    case "getStandings":
      return { success: true, rows: [] };
    default:
      throw new Error(`Firebase GET aksiyonu tanımlı değil: ${action}`);
  }
}

function normalizePredictionLogValue(value) {
  if (value === undefined || value === null || value === "") return "";
  const num = Number(value);
  return Number.isNaN(num) ? String(value) : num;
}

function buildPredictionLogValue(record) {
  if (!record) return null;
  return {
    homePred: normalizePredictionLogValue(record.homePred ?? record.tahminEv),
    awayPred: normalizePredictionLogValue(record.awayPred ?? record.tahminDep),
  };
}

function predictionLogValuesEqual(oldValue, newValue) {
  if (!oldValue && !newValue) return true;
  if (!oldValue || !newValue) return false;
  return (
    String(oldValue.homePred ?? "") === String(newValue.homePred ?? "") &&
    String(oldValue.awayPred ?? "") === String(newValue.awayPred ?? "")
  );
}

function resolvePredictionLogActor(payload = {}) {
  const actorId = String(
    payload.actorId ||
      payload.changedById ||
      state.settings?.auth?.playerId ||
      getAuthUser()?.playerId ||
      getAuthUser()?.id ||
      "",
  );
  const actorUser = actorId ? getPlayerById(actorId) : null;
  const authUser = getAuthUser?.() || null;
  const role = String(
    payload.actorRole ||
      actorUser?.rol ||
      authUser?.rol ||
      getCurrentRole?.() ||
      "user",
  ).toLowerCase();
  return {
    id: actorId,
    name: String(
      payload.actorName ||
        actorUser?.name ||
        authUser?.adSoyad ||
        authUser?.name ||
        payload.changedBy ||
        payload.kullaniciAdi ||
        "Bilinmeyen kullanıcı",
    ),
    username: String(
      payload.actorUsername ||
        authUser?.kullaniciAdi ||
        getCurrentUsername?.() ||
        "",
    ),
    role: role === "admin" ? "admin" : "user",
  };
}

async function writePredictionLogEntry({
  actionType,
  predictionId,
  oldRecord,
  newRecord,
  payload = {},
}) {
  try {
    if (!isFirebaseReady()) return false;
    const oldValue = buildPredictionLogValue(oldRecord);
    const newValue = buildPredictionLogValue(newRecord);
    if (
      actionType !== "delete" &&
      predictionLogValuesEqual(oldValue, newValue)
    ) {
      return false;
    }

    const actor = resolvePredictionLogActor(payload);
    const targetPlayerId = String(
      newRecord?.playerId || oldRecord?.playerId || payload.playerId || "",
    );
    const targetPlayer = targetPlayerId ? getPlayerById(targetPlayerId) : null;
    const matchId = String(
      newRecord?.matchId || oldRecord?.matchId || payload.matchId || "",
    );
    const match = (state.matches || []).find(
      (item) => String(item.id) === matchId,
    );
    const createdAt = new Date().toISOString();
    const logId = sanitizeFirebaseKey(
      `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    );

    const logRecord = {
      id: logId,
      actionType,
      actionLabel:
        actionType === "create"
          ? "Tahmin eklendi"
          : actionType === "update"
            ? "Tahmin değiştirildi"
            : "Tahmin silindi",
      predictionId,
      matchId,
      matchLabel: String(
        payload.matchLabel ||
          (match
            ? `${match.homeTeam || "Ev sahibi"} - ${match.awayTeam || "Deplasman"}`
            : "Maç bilgisi yok"),
      ),
      homeTeam: String(
        newRecord?.homeTeam || oldRecord?.homeTeam || match?.homeTeam || "",
      ),
      awayTeam: String(
        newRecord?.awayTeam || oldRecord?.awayTeam || match?.awayTeam || "",
      ),
      weekId: String(
        newRecord?.weekId ||
          oldRecord?.weekId ||
          payload.weekId ||
          match?.weekId ||
          "",
      ),
      weekNo: String(
        newRecord?.weekNo ||
          newRecord?.haftaNo ||
          oldRecord?.weekNo ||
          oldRecord?.haftaNo ||
          payload.weekNo ||
          payload.haftaNo ||
          "",
      ),
      seasonId: String(
        newRecord?.seasonId ||
          oldRecord?.seasonId ||
          payload.seasonId ||
          match?.seasonId ||
          "",
      ),
      season: String(
        newRecord?.season ||
          newRecord?.sezon ||
          oldRecord?.season ||
          oldRecord?.sezon ||
          payload.season ||
          payload.sezon ||
          "",
      ),
      targetPlayerId,
      targetPlayerName: String(
        newRecord?.playerName ||
          oldRecord?.playerName ||
          targetPlayer?.name ||
          payload.adSoyad ||
          payload.kullaniciAdi ||
          "Bilinmeyen kişi",
      ),
      actorId: actor.id,
      actorName: actor.name,
      actorUsername: actor.username,
      actorRole: actor.role,
      isAdminAction: actor.role === "admin",
      oldValue,
      newValue,
      createdAt,
      source: "firebase-client",
    };
    try {
      await firebaseWrite(`predictionLogs/${logId}`, logRecord);
    } catch (primaryError) {
      console.warn(
        "predictionLogs yolu yazılamadı, settings/auditLogs deneniyor:",
        primaryError,
      );
      await firebaseWrite(`settings/auditLogs/${logId}`, logRecord);
    }
    return true;
  } catch (error) {
    console.warn("Tahmin log kaydı yazılamadı:", error);
    return false;
  }
}

async function writeAppAuditLogEntry({
  actionType,
  actionLabel,
  detail = "",
  oldValue = null,
  newValue = null,
  entityType = "system",
  entityId = "",
} = {}) {
  try {
    if (!isFirebaseReady()) return false;
    const actor = resolvePredictionLogActor({});
    const createdAt = new Date().toISOString();
    const logId = sanitizeFirebaseKey(
      `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    );
    const logRecord = {
      id: logId,
      actionType: String(actionType || "system"),
      actionLabel: String(actionLabel || "Sistem işlemi"),
      predictionId: "",
      matchId: "",
      matchLabel: String(detail || "Genel işlem"),
      homeTeam: "",
      awayTeam: "",
      weekId: "",
      weekNo: "",
      seasonId: "",
      season: "",
      targetPlayerId: "",
      targetPlayerName: entityType === "prediction" ? "Tahmin" : "Sistem",
      actorId: actor.id,
      actorName: actor.name,
      actorUsername: actor.username,
      actorRole: actor.role,
      isAdminAction: actor.role === "admin",
      oldValue,
      newValue,
      entityType: String(entityType || "system"),
      entityId: String(entityId || ""),
      createdAt,
      source: "firebase-client",
    };
    try {
      await firebaseWrite(`predictionLogs/${logId}`, logRecord);
    } catch (primaryError) {
      console.warn(
        "predictionLogs yolu yazılamadı, settings/auditLogs deneniyor:",
        primaryError,
      );
      await firebaseWrite(`settings/auditLogs/${logId}`, logRecord);
    }
    return true;
  } catch (error) {
    console.warn("Genel log kaydı yazılamadı:", error);
    return false;
  }
}
window.writeAppAuditLogEntry = writeAppAuditLogEntry;

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
          payload.supportedTeam ||
            payload.teamName ||
            payload.favoriteTeam ||
            "",
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
                payload.supportedTeam ||
                  payload.teamName ||
                  payload.favoriteTeam ||
                  "",
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
      const allowManualScoreUnlock =
        payload.allowManualScoreUnlock === true &&
        typeof getCurrentRole === "function" &&
        getCurrentRole() === "admin";
      const allowScoreClear =
        payload.allowScoreClear === true &&
        typeof getCurrentRole === "function" &&
        getCurrentRole() === "admin";

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

        const db = getFirebaseDb();
        if (!db) throw new Error("Firebase henüz yapılandırılmadı.");

        // Maç kaydını transaction ile birleştiriyoruz. Böylece API skoru
        // Firebase'e yazıldıktan hemen sonra başka bir cihazdaki eski/boş
        // state tüm kaydı set() ile ezip tekrar "Skor bekleniyor" yapamaz.
        await db.ref(`matches/${id}`).transaction((current) => {
          const currentRecord = current || {};
          const currentManualLocked = parseBooleanish(
            currentRecord.manualScoreLocked ??
              currentRecord.manualScoreLock ??
              currentRecord.manuelSkorKilitli ??
              false,
          );
          const incomingManualLocked = parseBooleanish(
            match.manualScoreLocked ??
              match.manualScoreLock ??
              match.manuelSkorKilitli ??
              false,
          );

          const incomingHome = parseNumberOrEmpty(
            match.homeScore ?? match.evGol ?? match.home_score,
          );
          const incomingAway = parseNumberOrEmpty(
            match.awayScore ?? match.depGol ?? match.away_score,
          );
          const incomingHasScore = incomingHome !== "" && incomingAway !== "";
          const incomingPlayed =
            parseBooleanish(match.played ?? match.oynandiMi ?? false) ||
            incomingHasScore;

          const currentHome = parseNumberOrEmpty(
            currentRecord.homeScore ?? currentRecord.evGol ?? currentRecord.home_score,
          );
          const currentAway = parseNumberOrEmpty(
            currentRecord.awayScore ?? currentRecord.depGol ?? currentRecord.away_score,
          );
          const currentHasScore = currentHome !== "" && currentAway !== "";
          const currentPlayed =
            parseBooleanish(currentRecord.played ?? currentRecord.oynandiMi ?? false) ||
            currentHasScore;

          const protectedManualScore =
            currentManualLocked &&
            !incomingManualLocked &&
            !allowManualScoreUnlock;

          // Firebase'de geçerli bir skor varken normal kullanıcı/API senkronundan
          // gelen boş kayıt bu skoru silemez. Skor yalnızca adminin açıkça
          // "Skoru Temizle" işlemiyle kaldırılabilir.
          const protectStoredScore =
            currentPlayed &&
            currentHasScore &&
            !incomingHasScore &&
            !allowScoreClear;

          const nextMatch = {
            ...currentRecord,
            ...match,
            id,
            season: seasonLabel,
            sezon: seasonLabel,
            weekNo,
            haftaNo: weekNo,
            updatedAt: new Date().toISOString(),
          };

          if (protectedManualScore || protectStoredScore) {
            nextMatch.homeScore = currentHome;
            nextMatch.awayScore = currentAway;
            nextMatch.evGol = currentHome;
            nextMatch.depGol = currentAway;
            nextMatch.played = true;
            nextMatch.oynandiMi = 1;
          }

          if (protectedManualScore) {
            nextMatch.manualScoreLocked = true;
            nextMatch.manualScoreLock = true;
            nextMatch.manuelSkorKilitli = 1;
            nextMatch.manualScoreUpdatedAt =
              currentRecord.manualScoreUpdatedAt || nextMatch.manualScoreUpdatedAt || null;
            nextMatch.manualScoreUpdatedBy =
              currentRecord.manualScoreUpdatedBy || nextMatch.manualScoreUpdatedBy || null;
          }

          return nextMatch;
        });
      }
      return { success: true };
    }
    case "savePrediction": {
      const normalizedMatchId = String(payload.matchId || "");
      const normalizedPlayerId = String(
        payload.playerId || payload.kullaniciId || "",
      );
      const canonicalId = sanitizeFirebaseKey(
        makePredictionRecordId(normalizedMatchId, normalizedPlayerId),
      );
      const requestedId = sanitizeFirebaseKey(
        payload.predictionId || payload.id || canonicalId,
      );
      const id = canonicalId || requestedId;
      let currentRecord = null;
      let duplicatePredictionIds = [];

      try {
        const allPredictions = (await firebaseRead("predictions")) || {};
        duplicatePredictionIds = Object.entries(allPredictions)
          .filter(([existingId, item]) => {
            const sameMatch =
              String(item?.matchId || item?.localMatchId || "") ===
              normalizedMatchId;
            const samePlayer =
              String(
                item?.playerId || item?.kullaniciId || item?.userId || "",
              ) === normalizedPlayerId;
            return (
              sameMatch && samePlayer && sanitizeFirebaseKey(existingId) !== id
            );
          })
          .map(([existingId]) => sanitizeFirebaseKey(existingId));

        currentRecord =
          allPredictions[id] ||
          allPredictions[requestedId] ||
          Object.entries(allPredictions).find(([existingId, item]) => {
            const sameMatch =
              String(item?.matchId || item?.localMatchId || "") ===
              normalizedMatchId;
            const samePlayer =
              String(
                item?.playerId || item?.kullaniciId || item?.userId || "",
              ) === normalizedPlayerId;
            return sameMatch && samePlayer;
          })?.[1] ||
          null;
      } catch (error) {
        console.warn("Eski tahmin okunamadı, kayıt yine de yapılacak:", error);
      }

      const record = {
        ...payload,
        id,
        predictionId: id,
        season: payload.season || payload.sezon || "",
        sezon: payload.sezon || payload.season || "",
        weekNo: payload.weekNo || payload.haftaNo || "",
        haftaNo: payload.haftaNo || payload.weekNo || "",
        playerId: normalizedPlayerId,
        kullaniciId: normalizedPlayerId,
        matchId: normalizedMatchId,
        localMatchId: normalizedMatchId,
        homePred: payload.homePred,
        awayPred: payload.awayPred,
        tahminEv: payload.tahminEv ?? payload.homePred,
        tahminDep: payload.tahminDep ?? payload.awayPred,
        updatedAt: new Date().toISOString(),
      };

      await firebaseWrite(`predictions/${id}`, record);

      for (const duplicateId of duplicatePredictionIds) {
        if (duplicateId && duplicateId !== id) {
          await firebaseRemove(`predictions/${duplicateId}`);
        }
      }

      await writePredictionLogEntry({
        actionType: currentRecord ? "update" : "create",
        predictionId: id,
        oldRecord: currentRecord,
        newRecord: record,
        payload,
      });
      return { success: true, id, predictionId: id };
    }
    case "deletePrediction": {
      const normalizedMatchId = String(payload.matchId || "");
      const normalizedPlayerId = String(
        payload.playerId || payload.kullaniciId || "",
      );
      const id = sanitizeFirebaseKey(
        payload.predictionId ||
          payload.id ||
          makePredictionRecordId(normalizedMatchId, normalizedPlayerId),
      );
      let currentRecord = null;
      let idsToDelete = [id];
      try {
        const allPredictions = (await firebaseRead("predictions")) || {};
        const duplicateIds = Object.entries(allPredictions)
          .filter(([existingId, item]) => {
            const sameMatch =
              String(item?.matchId || item?.localMatchId || "") ===
              normalizedMatchId;
            const samePlayer =
              String(
                item?.playerId || item?.kullaniciId || item?.userId || "",
              ) === normalizedPlayerId;
            return sameMatch && samePlayer;
          })
          .map(([existingId]) => sanitizeFirebaseKey(existingId));
        idsToDelete = Array.from(
          new Set([...idsToDelete, ...duplicateIds]),
        ).filter(Boolean);
        currentRecord =
          allPredictions[id] ||
          duplicateIds
            .map((duplicateId) => allPredictions[duplicateId])
            .find(Boolean) ||
          null;
      } catch (error) {
        console.warn(
          "Silinecek tahmin okunamadı, silme yine de yapılacak:",
          error,
        );
      }
      for (const deleteId of idsToDelete) {
        await firebaseRemove(`predictions/${deleteId}`);
      }
      if (currentRecord) {
        await writePredictionLogEntry({
          actionType: "delete",
          predictionId: id,
          oldRecord: currentRecord,
          newRecord: null,
          payload,
        });
      }
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
    if (isAuthenticated()) {
      localStorage.setItem(
        BACKGROUND_ENTERED_AT_STORAGE_KEY,
        String(Date.now()),
      );
    }
    stopPresenceTracking({ removeSession: true });
  });

  window.addEventListener("beforeunload", () => {
    if (isAuthenticated()) {
      localStorage.setItem(
        BACKGROUND_ENTERED_AT_STORAGE_KEY,
        String(Date.now()),
      );
    }
    stopPresenceTracking({ removeSession: true });
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
  if (!isFirebaseReady()) {
    console.warn("[HYDRATE] atlandı: Firebase hazır değil.", source);
    return false;
  }
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
      validateFreshActiveSelection({
        forceNewestPublished: /login|startup|session-restore/.test(
          String(source),
        ),
      });
      saveState(true);
      if (isAuthenticated()) startPresenceTracking();
      recordAdminSyncActivity({
        lastAction: `Canlı ${getOnlineSourceLabel()} verisi alındı (${source}).`,
        success: true,
      });
      debounceFirebaseRealtimeRender();
      return true;
    } catch (error) {
      console.warn("Firebase canlı veri eşitleme uyarısı:", error);
      console.error("[HYDRATE ERROR]", error);
      return false;
    } finally {
      firebaseRealtimeHydrationPromise = null;
    }
  })();

  return firebaseRealtimeHydrationPromise;
}

let firebaseRealtimeHydrationTimer = null;
let appBootstrapInProgress = false;

function scheduleFirebaseRealtimeHydration(source = "realtime") {
  clearTimeout(firebaseRealtimeHydrationTimer);
  firebaseRealtimeHydrationTimer = setTimeout(() => {
    if (!isAuthenticated()) {
      console.log(
        "[REALTIME] Oturum açılmadığı için eşitleme beklendi:",
        source,
      );
      return;
    }
    hydrateFromFirebaseRealtime(source);
  }, 250);
}

function ensureFirebaseRealtimeBridge() {
  if (!isFirebaseReady() || firebaseRealtimeBindingsInitialized) return;
  const db = getFirebaseDb();
  if (!db) return;

  ["users", "matches", "predictions", "settings"].forEach((path) => {
    db.ref(path).on("value", () => {
      scheduleFirebaseRealtimeHydration(path);
    });
  });

  db.ref("presence").on("value", (snapshot) => {
    firebasePresenceCache = snapshot.exists() ? snapshot.val() || {} : {};

    // Presence heartbeat 25 saniyede bir değişiyor.
    // Bunu renderAll() ile yeniden çizmek, tahminler dışındaki sayfalarda scroll'u üste atıyordu.
    // Online/offline bilgisi bir sonraki normal çizimde güncellenir; sayfa artık zıplamaz.
    if ((state.settings.currentTab || "dashboard") === "predictions") {
      debounceFirebaseRealtimeRender();
    }
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
    success: { success: "" },
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
        '<span class="sync-btn-icon" aria-hidden="true">↻</span><span> </span>';
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

function getPredictionQueueKey(item = {}) {
  const season = item.season ?? item.sezon ?? item.seasonLabel ?? "";
  const weekNo = item.weekNo ?? item.haftaNo ?? item.weekNumber ?? "";
  const playerId = normalizeEntityId(item.playerId ?? item.kullaniciId ?? "");
  const matchId = normalizeEntityId(
    item.matchId ?? item.localMatchId ?? item.sheetMatchId ?? "",
  );
  return [season, weekNo, playerId, matchId]
    .map((value) => String(value ?? ""))
    .join("__");
}

function isSamePredictionQueueTarget(a = {}, b = {}) {
  const aMatch = normalizeEntityId(
    a.matchId ?? a.localMatchId ?? a.sheetMatchId ?? "",
  );
  const bMatch = normalizeEntityId(
    b.matchId ?? b.localMatchId ?? b.sheetMatchId ?? "",
  );
  const aPlayer = normalizeEntityId(a.playerId ?? a.kullaniciId ?? "");
  const bPlayer = normalizeEntityId(b.playerId ?? b.kullaniciId ?? "");
  return (
    !!aMatch &&
    !!bMatch &&
    !!aPlayer &&
    !!bPlayer &&
    aMatch === bMatch &&
    aPlayer === bPlayer
  );
}

function getPredictionQueueAction(item) {
  return String(item?.action || "save").toLowerCase();
}

function enqueuePredictionRetry(payload) {
  const queue = getPendingPredictionQueue().filter(
    (item) =>
      getPredictionQueueKey(item) !== getPredictionQueueKey(payload) &&
      !isSamePredictionQueueTarget(item, payload),
  );
  queue.push({ ...payload, queuedAt: new Date().toISOString() });
  persistPendingPredictionQueue(queue);
}

function dequeuePredictionRetry(payload) {
  const queue = getPendingPredictionQueue().filter(
    (item) =>
      getPredictionQueueKey(item) !== getPredictionQueueKey(payload) &&
      !isSamePredictionQueueTarget(item, payload),
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

function ensureAppToastStack() {
  let stack = document.getElementById("appToastStack");
  if (stack) return stack;
  stack = document.createElement("div");
  stack.id = "appToastStack";
  stack.className = "app-toast-stack";
  stack.setAttribute("aria-live", "polite");
  stack.setAttribute("aria-atomic", "false");
  document.body.appendChild(stack);
  return stack;
}

function showAppToast(message, options = {}) {
  const stack = ensureAppToastStack();
  if (!stack) return Promise.resolve(true);

  const type = options.type || "info";
  const title =
    options.title ||
    (type === "success"
      ? "Başarılı"
      : type === "danger"
        ? "Hata"
        : type === "warning"
          ? "Uyarı"
          : "Bilgi");
  const duration = Number(
    options.duration || (type === "danger" || type === "warning" ? 6500 : 4200),
  );
  const icons = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    danger: "⛔",
    error: "⛔",
  };

  const toast = document.createElement("div");
  toast.className = `app-toast app-toast--${type}`;
  toast.setAttribute(
    "role",
    type === "danger" || type === "error" ? "alert" : "status",
  );
  toast.innerHTML = `
    <div class="app-toast__icon">${icons[type] || icons.info}</div>
    <div class="app-toast__body">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
    <button type="button" class="app-toast__close" aria-label="Bildirimi kapat">×</button>
    <div class="app-toast__bar"></div>
  `;

  const removeToast = () => {
    toast.classList.remove("show");
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 220);
  };

  toast
    .querySelector(".app-toast__close")
    ?.addEventListener("click", removeToast);
  stack.prepend(toast);

  requestAnimationFrame(() => toast.classList.add("show"));
  const bar = toast.querySelector(".app-toast__bar");
  if (bar) bar.style.animationDuration = `${duration}ms`;
  setTimeout(removeToast, duration);

  return Promise.resolve(true);
}

function showAlert(message, options = {}) {
  return showAppToast(message, {
    type: options.type || "info",
    title: options.title || "Bilgi",
    duration: options.duration,
  });
}

window.showAppToast = showAppToast;
window.showAlert = showAlert;
if (!window.__nativeAppAlert) {
  window.__nativeAppAlert = window.alert.bind(window);
  window.alert = function appToastAlert(message) {
    if (document?.body) {
      showAppToast(String(message || ""), { title: "Bilgi", type: "info" });
      return;
    }
    window.__nativeAppAlert(message);
  };
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

const MATCH_SCENE_BASE_PATH = "images/match-scenes/";
const MATCH_SCENE_DEFAULT = `${MATCH_SCENE_BASE_PATH}default.png`;
const MATCH_SCENE_BY_TEAM = {
  amedspor: "amedspor.png",
  "amed spor": "amedspor.png",
  basaksehir: "başakşehir.png",
  "istanbul basaksehir": "başakşehir.png",
  besiktas: "beşiktaş.png",
  corumspor: "corumspor.png",
  "corum spor": "corumspor.png",
  erzurumspor: "erzurumspor.png",
  "erzurum spor": "erzurumspor.png",
  eyupspor: "eyüpspor.png",
  fenerbahce: "fenerbahce.png",
  galatasaray: "galatasaray.png",
  gaziantep: "gaziantep.png",
  "gaziantep fk": "gaziantep.png",
  genclerbirligi: "gençlerbirliği.png",
  goztepe: "göztepe.png",
  kasimpasa: "kasımpaşa.png",
  kocaelispor: "kocaelispor.png",
  "kocaeli spor": "kocaelispor.png",
  konyaspor: "konyaspor.png",
  "konya spor": "konyaspor.png",
  samsunspor: "samsunspor.png",
  "samsun spor": "samsunspor.png",
  trabzonspor: "trabzonspor.png",
  "trabzon spor": "trabzonspor.png",
  caykurrize: "çaykurrize.png",
  "caykur rizespor": "çaykurrize.png",
  "caykur rize": "çaykurrize.png",
};

function normalizeMatchSceneFileName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.toLowerCase().endsWith(".png") ? raw : `${raw}.png`;
}

function getDefaultMatchSceneSlugForTeam(teamName, teamMeta = null) {
  const normalized = normalizeText(teamName);
  const slug = slugify(teamName);
  const mappedFileName =
    MATCH_SCENE_BY_TEAM[normalized] || MATCH_SCENE_BY_TEAM[slug] || "";
  const mappedSlug = mappedFileName.replace(/\.png$/i, "");
  return mappedSlug || String(teamMeta?.slug || "").trim() || slug || "default";
}

function getEffectiveMatchSceneSlug(team) {
  if (!team) return "";
  return String(
    team.sceneSlug ||
      team.stadiumSlug ||
      team.matchSceneSlug ||
      getDefaultMatchSceneSlugForTeam(team.name, team) ||
      "",
  )
    .trim()
    .replace(/\.png$/i, "");
}

function findTeamMetaForMatchScene(teamName, seasonId = getActiveSeasonId?.()) {
  const normalizedName = normalizeText(teamName);
  if (!normalizedName) return null;
  const teams = Array.isArray(state?.teams) ? state.teams : [];
  return (
    teams.find(
      (team) =>
        String(team.seasonId || "") === String(seasonId || "") &&
        normalizeText(team.name) === normalizedName,
    ) ||
    teams.find((team) => normalizeText(team.name) === normalizedName) ||
    null
  );
}

function getMatchSceneUrl(teamName, seasonId = getActiveSeasonId?.()) {
  const savedOverride = getStoredMatchSceneOverride(teamName, seasonId);
  const teamMeta = findTeamMetaForMatchScene(teamName, seasonId);
  const sceneSlug =
    savedOverride ||
    (teamMeta
      ? getEffectiveMatchSceneSlug(teamMeta)
      : getDefaultMatchSceneSlugForTeam(teamName));
  const fileName = normalizeMatchSceneFileName(sceneSlug);
  return fileName && fileName !== "default.png"
    ? `${MATCH_SCENE_BASE_PATH}${fileName}`
    : MATCH_SCENE_DEFAULT;
}

function getMatchSceneOverrideKey(teamName) {
  const normalized = normalizeText(teamName);
  return (
    slugify(normalized || teamName) ||
    sanitizeFirebaseKey(String(teamName || "team"))
  );
}

function getStoredMatchSceneOverrides() {
  if (!state.settings || typeof state.settings !== "object")
    state.settings = {};
  if (
    !state.settings.teamSceneSlugs ||
    typeof state.settings.teamSceneSlugs !== "object"
  ) {
    state.settings.teamSceneSlugs = {};
  }
  return state.settings.teamSceneSlugs;
}

function getStoredMatchSceneOverride(
  teamName,
  seasonId = getActiveSeasonId?.(),
) {
  const overrides = getStoredMatchSceneOverrides();
  const seasonMap = overrides[String(seasonId || "")] || {};
  const key = getMatchSceneOverrideKey(teamName);
  const raw = seasonMap[key];
  const sceneSlug =
    typeof raw === "string" ? raw : raw?.sceneSlug || raw?.stadiumSlug || "";
  return String(sceneSlug || "")
    .trim()
    .replace(/\.png$/i, "");
}

function applyMatchSceneOverridesToTeams(overrides = null) {
  const allOverrides = overrides || getStoredMatchSceneOverrides();
  if (
    !allOverrides ||
    typeof allOverrides !== "object" ||
    !Array.isArray(state?.teams)
  )
    return;

  state.teams.forEach((team) => {
    const seasonId = String(team.seasonId || "");
    const seasonMap = allOverrides[seasonId] || {};
    const key = getMatchSceneOverrideKey(team.name);
    const raw = seasonMap[key] || seasonMap[String(team.id || "")];
    const sceneSlug =
      typeof raw === "string" ? raw : raw?.sceneSlug || raw?.stadiumSlug || "";
    const cleaned = String(sceneSlug || "")
      .trim()
      .replace(/\.png$/i, "");
    if (!cleaned) return;
    team.sceneSlug = cleaned;
    team.stadiumSlug = cleaned;
  });
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
      // Hazırlanmakta olan haftaların maçları admin taslağıdır.
      // Kullanıcı Firebase alanında henüz bulunmadıkları için uzak listeye göre silinmez.
      if (isWeekPreparing(match.weekId)) return false;

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
      const manualScoreLocked = parseBooleanish(
        row.manualScoreLocked ?? row.manualScoreLock ?? row.manuelSkorKilitli ?? false,
      );
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
          manualScoreLocked,
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
        // Firebase kanonik kaynaktır. Admin kilidi Firebase yazma katmanında
        // korunur; böylece burada gerçek uzak durum güvenle uygulanabilir.
        existing.played = played;
        existing.homeScore = homeScore === "" ? null : homeScore;
        existing.awayScore = awayScore === "" ? null : awayScore;
        existing.manualScoreLocked = manualScoreLocked;
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
          sceneSlug: getDefaultMatchSceneSlugForTeam(homeTeam),
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
          sceneSlug: getDefaultMatchSceneSlugForTeam(awayTeam),
        });
      }
    });

    applyMatchSceneOverridesToTeams();

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

async function addOnlineMatches(matches, options = {}) {
  const serializedMatches = JSON.stringify(matches || []);
  return await apiPost("addMatches", {
    matches: serializedMatches,
    allowManualScoreUnlock: options.allowManualScoreUnlock === true,
    allowScoreClear: options.allowScoreClear === true,
  });
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

function normalizeWeekRegistryItem(item) {
  if (!item) return null;
  const id = String(item.id || "").trim();
  const seasonId = String(item.seasonId || "").trim();
  const number = Number(item.number || item.weekNo || 0);
  const rawStatus = String(item.status || "hazirlaniyor").toLowerCase();
  const status = ["hazirlaniyor", "aktif", "tamamlandi"].includes(rawStatus)
    ? rawStatus
    : "hazirlaniyor";
  if (!id || !seasonId || !number) return null;
  return {
    id,
    seasonId,
    number,
    status,
    publishedAt: item.publishedAt || "",
    publishedBy: item.publishedBy || "",
    completedAt: item.completedAt || "",
    predictionManualLocked: item.predictionManualLocked === true,
    predictionManualOpen: item.predictionManualOpen === true,
    predictionManualUpdatedAt: item.predictionManualUpdatedAt || "",
    predictionManualUpdatedBy: item.predictionManualUpdatedBy || "",
  };
}

async function syncSeasonRegistryFromFirebase() {
  if (!isFirebaseReady()) return [];
  const settings = (await firebaseRead("settings")) || {};
  const rawList = Array.isArray(settings.seasonsMeta)
    ? settings.seasonsMeta
    : [];
  const rawWeekList = Array.isArray(settings.weeksMeta)
    ? settings.weeksMeta
    : [];
  state.settings.resultsLastAutoSyncAt = Number(
    settings.resultsLastAutoSyncAt || 0,
  );
  state.settings.resultsAutoSyncInProgressAt = Number(
    settings.resultsAutoSyncInProgressAt || 0,
  );
  state.settings.leagueStandingsCache =
    settings.leagueStandingsCache || state.settings.leagueStandingsCache || {};
  state.settings.teamSceneSlugs =
    settings.teamSceneSlugs || state.settings.teamSceneSlugs || {};
  state.settings.teamLogoCache =
    settings.teamLogoCache || state.settings.teamLogoCache || {};
  state.settings.welcomeCard = normalizeWelcomeCardSettings(
    settings.welcomeCard || state.settings.welcomeCard,
  );
  applyMatchSceneOverridesToTeams(state.settings.teamSceneSlugs);
  const seasonList = rawList.map(normalizeSeasonRegistryItem).filter(Boolean);
  const weekList = rawWeekList.map(normalizeWeekRegistryItem).filter(Boolean);
  const remoteIds = new Set(seasonList.map((item) => String(item.id)));

  state.seasons = seasonList.map((item) => ({ ...item }));

  const localWeekMap = new Map(
    state.weeks.map((week) => [
      `${week.seasonId}__${Number(week.number)}`,
      week,
    ]),
  );
  weekList.forEach((remoteWeek) => {
    const key = `${remoteWeek.seasonId}__${Number(remoteWeek.number)}`;
    const localWeek = localWeekMap.get(key);
    if (localWeek) Object.assign(localWeek, remoteWeek);
    else state.weeks.push({ ...remoteWeek });
  });
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

async function persistWeekRegistryToFirebase() {
  if (!isFirebaseReady()) return false;
  const weeksMeta = state.weeks
    .map((week) => ({
      id: String(week.id || "").trim(),
      seasonId: String(week.seasonId || "").trim(),
      number: Number(week.number || 0),
      status: String(week.status || "hazirlaniyor"),
      publishedAt: week.publishedAt || "",
      publishedBy: week.publishedBy || "",
      completedAt: week.completedAt || "",
      predictionManualLocked: week.predictionManualLocked === true,
      predictionManualOpen: week.predictionManualOpen === true,
      predictionManualUpdatedAt: week.predictionManualUpdatedAt || "",
      predictionManualUpdatedBy: week.predictionManualUpdatedBy || "",
    }))
    .filter((week) => week.id && week.seasonId && week.number);

  await firebaseUpdate("settings", {
    weeksMeta,
    weeksMetaUpdatedAt: new Date().toISOString(),
  });
  return true;
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
      manualScoreLocked: !!match.manualScoreLocked,
      manualScoreLock: !!match.manualScoreLocked,
      manuelSkorKilitli: match.manualScoreLocked ? 1 : 0,
    }))
    .filter(
      (item) => item.sezon && item.haftaNo && item.evSahibi && item.deplasman,
    );

  if (!payloadMatches.length) return null;
  return await addOnlineMatches(payloadMatches, {
    allowManualScoreUnlock: options.allowManualScoreUnlock === true,
    allowScoreClear: options.allowScoreClear === true,
  });
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
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/\s+/g, " ");
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
  updatedAt = "",
}) {
  const normalizedMatchId = normalizeEntityId(matchId);
  const normalizedPlayerId = normalizeEntityId(playerId);
  if (!normalizedMatchId || !normalizedPlayerId) return null;

  const duplicates = state.predictions.filter(
    (item) =>
      normalizeEntityId(item.matchId || item.localMatchId) ===
        normalizedMatchId &&
      normalizeEntityId(item.playerId || item.kullaniciId || item.userId) ===
        normalizedPlayerId,
  );

  let pred = duplicates[0] || null;
  duplicates.slice(1).forEach((item) => {
    if (isPredictionRecordNewer(item, pred)) pred = item;
  });

  if (!pred) {
    pred = {
      id:
        remoteId ||
        makePredictionRecordId(normalizedMatchId, normalizedPlayerId),
      remoteId: remoteId || null,
      matchId: normalizedMatchId,
      playerId: normalizedPlayerId,
      homePred: "",
      awayPred: "",
      points: 0,
    };
    state.predictions.push(pred);
  }

  pred.id =
    remoteId ||
    pred.id ||
    makePredictionRecordId(normalizedMatchId, normalizedPlayerId);
  pred.remoteId = remoteId || pred.remoteId || null;
  pred.matchId = normalizedMatchId;
  pred.playerId = normalizedPlayerId;
  pred.localMatchId = normalizedMatchId;
  pred.homePred = parseNumberOrEmpty(homePred);
  pred.awayPred = parseNumberOrEmpty(awayPred);
  pred.points = Number(points || 0);
  pred.updatedAt = updatedAt || new Date().toISOString();
  if (username) pred.username = username;

  state.predictions = state.predictions.filter(
    (item) =>
      item === pred ||
      !(
        normalizeEntityId(item.matchId || item.localMatchId) ===
          normalizedMatchId &&
        normalizeEntityId(item.playerId || item.kullaniciId || item.userId) ===
          normalizedPlayerId
      ),
  );
  invalidatePredictionIndexCache();
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

function getPredictionRowTimestampValue(row = {}) {
  const raw =
    row.updatedAt ||
    row.guncellemeTarihi ||
    row.createdAt ||
    row.tarih ||
    row.timestamp ||
    "";
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function getCanonicalPredictionRowId(row = {}) {
  const matchId = resolveMatchIdFromOnlineRow(row);
  const playerId = resolvePlayerIdFromOnlineRow(row);
  if (!matchId || !playerId) return null;
  return `${matchId}__${playerId}`;
}

function dedupeOnlinePredictionRows(rows = []) {
  const map = new Map();
  rows.forEach((row, index) => {
    const key = getCanonicalPredictionRowId(row);
    if (!key) return;
    const current = map.get(key);
    const nextScore = getPredictionRowTimestampValue(row);
    const currentScore = current
      ? getPredictionRowTimestampValue(current.row)
      : -1;
    if (!current || nextScore >= currentScore || index > current.index) {
      map.set(key, { row, index });
    }
  });
  return Array.from(map.values()).map((item) => item.row);
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
    const rows = dedupeOnlinePredictionRows(
      normalizeOnlinePredictionRows(response),
    );
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
        updatedAt:
          row.updatedAt ||
          row.guncellemeTarihi ||
          row.createdAt ||
          row.tarih ||
          "",
      });
    });

    localDrafts.forEach((draft) => {
      upsertLocalPredictionRecord(draft);
    });

    if (typeof compactLocalPredictionRecords === "function") {
      compactLocalPredictionRecords();
    }

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

function normalizeWelcomeCardSettings(raw = {}) {
  const fallback = {
    enabled: true,
    title: "Hoş geldin!",
    message: "İyi haftalar, bol şans! ✨",
    imageFile: "",
    imageFit: "cover",
    showOnce: false,
    updatedAt: "",
  };
  const next = { ...fallback, ...(raw || {}) };
  next.enabled = next.enabled !== false;
  next.showOnce = next.showOnce === true;
  next.imageFit = ["contain", "cover"].includes(
    String(next.imageFit || "").trim(),
  )
    ? String(next.imageFit).trim()
    : "cover";
  next.title = String(next.title || fallback.title).trim();
  next.message = String(next.message || fallback.message).trim();
  next.imageFile = String(next.imageFile || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^images\/welcome\//i, "");
  next.updatedAt = String(next.updatedAt || "");
  return next;
}

function getWelcomeCardSettings() {
  state.settings.welcomeCard = normalizeWelcomeCardSettings(
    state.settings?.welcomeCard || {},
  );
  return state.settings.welcomeCard;
}

function getWelcomeImageSrc(imageFile = "") {
  const clean = String(imageFile || "")
    .trim()
    .replace(/^\/+/, "");
  if (!clean) return "";
  if (/^(https?:|data:|blob:)/i.test(clean)) return clean;
  if (/^images\/welcome\//i.test(clean)) return clean;
  return `images/welcome/${clean}`;
}

function getWelcomeSeenKey(config = getWelcomeCardSettings()) {
  const stamp =
    config.updatedAt || `${config.title}|${config.message}|${config.imageFile}`;
  return `fikstur_welcome_seen_${btoa(unescape(encodeURIComponent(stamp))).replace(/=+$/g, "")}`;
}

function getWelcomeDisplayName(user = getAuthUser()) {
  return String(
    getCurrentPlayer?.()?.name ||
      user?.adSoyad ||
      user?.name ||
      user?.kullaniciAdi ||
      user?.username ||
      "",
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
  
  let config = normalizeWelcomeCardSettings(
    options.config || getWelcomeCardSettings(),
  );
  const customWelcomeEnabled = config.enabled || options.force;
  if (!customWelcomeEnabled) {
    config = {
      ...config,
      title: "",
      message: "",
      imageFile: "",
      showOnce: false,
      imageFit: "cover",
    };
  }
  if (config.showOnce && !options.force) {
    const seenKey = getWelcomeSeenKey(config);
    if (localStorage.getItem(seenKey) === "1") return;
    localStorage.setItem(seenKey, "1");
  }

  const overlay = document.getElementById("welcomeOverlay");
  const avatar = document.getElementById("welcomeAvatar");
  const title = document.getElementById("welcomeTitle");
  const message = document.getElementById("welcomeMessage");
  const mediaWrap = document.getElementById("welcomeMediaWrap");
  const image = document.getElementById("welcomeImage");
  const eyebrow = document.querySelector(".welcome-card__eyebrow");
  const stats = document.querySelector(".welcome-card__stats");
  if (!overlay || !avatar || !title || !message) return;

  const displayName = getWelcomeDisplayName(user) || "Hoş geldin";
  const shortName = displayName.split(/\s+/).filter(Boolean)[0] || displayName;
  // Eski motivasyon sistemi (karşılama kartı kapalıysa çalışır)
  const welcomeLines = [
    "Sezon hazır. Tahminlerini oluşturmaya başlayalım.",
    "Arena hazır. İlk tahmin için sahaya çıkalım.",
    "Yeni sezon başladı. Puanları toplamaya başlayalım.",
    "Premium arena açıldı. Şimdi tahmin zamanı.",
  ];
  const selectedMessage =
    options.message ||
    config.message ||
    welcomeLines[Math.floor(Math.random() * welcomeLines.length)];

  const welcomePlayer = getCurrentPlayer?.() || user || { name: shortName };

  const welcomeImageName = `${String(shortName || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, "-")}.png`;

  const welcomeCleanImageName = String(welcomeImageName || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^avatars\//i, "")
    .replace(/^images\/welcome\//i, "")
    .replace(/^images\//i, "");

    if (config.enabled && config.imageFile) {
      if (eyebrow) eyebrow.classList.add("hidden");
      if (stats) stats.classList.add("hidden");
      avatar.classList.add("hidden");

      title.textContent = config.title || "";

      message.textContent = config.message || "";
    } else {
      if (eyebrow) eyebrow.classList.remove("hidden");
      if (stats) stats.classList.remove("hidden");
      
      avatar.classList.remove("hidden");

      const welcomeAvatarSrc = getWelcomeImageSrc(welcomeCleanImageName);

      avatar.innerHTML = `
          <span class="app-avatar welcome-hero-avatar">
              <img
                  class="welcome-profile-image"
                  src="${escapeHtml(welcomeAvatarSrc)}"
                  alt="${escapeHtml(String(welcomePlayer.name || shortName || "Profil"))}"
                  loading="lazy"
                  decoding="async"
                  onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';"
              >
              <span class="app-avatar-fallback" style="display:none">
                  ${escapeHtml(shortName.charAt(0) || "?")}
              </span>
          </span>
      `;

      title.textContent = String(
        shortName || displayName || "Oyuncu",
      ).toLocaleUpperCase("tr-TR");

      message.textContent =
        selectedMessage || "Sezon hazır. Tahminlerini oluşturmaya başlayalım.";
    }
  const imageSrc = getWelcomeImageSrc(config.imageFile);
  if (image && mediaWrap && imageSrc) {
    image.src = imageSrc;
    image.classList.toggle("is-contain", config.imageFit === "contain");
    image.classList.toggle("is-cover", config.imageFit !== "contain");
    image.onerror = () => mediaWrap.classList.add("hidden");
    mediaWrap.classList.remove("hidden");
  } else if (mediaWrap) {
    mediaWrap.classList.add("hidden");
  }

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => {
    overlay.classList.add("is-visible");
  });

  /*hoşgeldin kartı kaybolsun diye
  if (welcomeOverlayTimer) window.clearTimeout(welcomeOverlayTimer);
  welcomeOverlayTimer = window.setTimeout(
    () => hideWelcomeOverlay(),
    options.duration || 4300,
  );*/
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
  const avatarMarkup =
    typeof createGenericAvatarMarkup === "function"
      ? createGenericAvatarMarkup(sessionAvatarRow, "topbar-account-avatar")
      : `<span class="app-avatar topbar-account-avatar"><span class="app-avatar-fallback">${escapeHtml(
          String(currentName || "?")
            .trim()
            .charAt(0) || "?",
        )}</span></span>`;

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
  const desktopPlayersBtn = document.getElementById("desktopPlayersPageBtn");
  const mobilePlayersBtn = document.getElementById("mobilePlayersPageBtn");
  const showUserAccountTools = isAuth && !isAdmin;
  if (desktopChangeBtn) desktopChangeBtn.hidden = !showUserAccountTools;
  if (mobileChangeBtn) mobileChangeBtn.hidden = !showUserAccountTools;
  if (desktopPlayersBtn) desktopPlayersBtn.hidden = !showUserAccountTools;
  if (mobilePlayersBtn) mobilePlayersBtn.hidden = !showUserAccountTools;
}

function closeAccountMenus() {
  const desktopMenu = document.getElementById("desktopAccountMenu");
  const mobileMenu = document.getElementById("mobileAccountMenu");
  const desktopBtn = document.getElementById("desktopAccountBtn");
  const mobileBtn =
    document.getElementById("mobileTopProfileBtn") ||
    document.getElementById("mobileAccountBtn");
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
    isMobileMenu
      ? document.getElementById("mobileTopProfileBtn")
        ? "mobileTopProfileBtn"
        : "mobileAccountBtn"
      : "desktopAccountBtn",
  );
  const otherMenu = document.getElementById(
    isMobileMenu ? "desktopAccountMenu" : "mobileAccountMenu",
  );
  const otherBtn = document.getElementById(
    isMobileMenu
      ? "desktopAccountBtn"
      : document.getElementById("mobileTopProfileBtn")
        ? "mobileTopProfileBtn"
        : "mobileAccountBtn",
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
  if (typeof stopIdleLogoutTimer === "function") stopIdleLogoutTimer();
  clearSessionRuntimeCaches();
  stopPresenceTracking({ removeSession: true });

  try {
    const firebaseAuth = window.firebase?.auth?.();
    if (firebaseAuth?.currentUser) firebaseAuth.signOut().catch(() => {});
  } catch (error) {
    console.warn("Firebase Auth oturumu kapatılamadı:", error);
  }

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
    forceDefaultLandingAfterLogin("login-before-hydration");

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
    if (typeof resetIdleLogoutTimer === "function") resetIdleLogoutTimer();
    console.log("[START] Session Hydration başladı");
    const sessionHydrationOk = await runSessionHydrationWithFastOverlay({
      loadingMessage: "Kayıtlı veriler açılıyor, güncel bilgiler yükleniyor...",
    });
    console.log(
      "[LOGIN AUTO SYNC] Oturum eşitlemesi tamamlandı:",
      sessionHydrationOk,
    );

    // Manuel Firebase Güncelle butonunun yaptığı tam eşitlemeyi girişten sonra
    // otomatik olarak bir kez daha çalıştır. Böylece adminin eklediği yeni hafta,
    // kullanıcı ilk girişinde butona basmadan kesin olarak alınır.
    const fullHydrationOk = await hydrateFromFirebaseRealtime("login-auto");
    validateFreshActiveSelection({ forceNewestPublished: true });
    saveState(true);
    console.log(
      "[LOGIN AUTO SYNC] Tam Firebase eşitlemesi tamamlandı:",
      fullHydrationOk,
      {
        seasons: state.seasons?.length || 0,
        weeks: state.weeks?.length || 0,
        matches: state.matches?.length || 0,
        predictions: state.predictions?.length || 0,
      },
    );
    renderAll();

    if (typeof window.refreshFiksturFcmTokenOwner === "function") {
      window.refreshFiksturFcmTokenOwner().catch((error) => {
        console.warn(
          "[FCM] Giriş sonrası token kullanıcıya bağlanamadı:",
          error,
        );
      });
    }

    validateFreshActiveSelection({ forceNewestPublished: true });
    ensureActiveSelections();
    saveState(true);
    switchTab("dashboard", {
      skipPersistPrevious: true,
      skipViewportRestore: true,
    });
    renderAll();

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
let tabViewportRestoreToken = 0;
let pageViewportRestoreToken = 0;
let viewportPersistenceSuspendedUntil = 0;
let isProgrammaticViewportScroll = false;
let lastManualViewportScrollAt = 0;

function suspendViewportPersistence(durationMs = 420) {
  viewportPersistenceSuspendedUntil = Math.max(
    viewportPersistenceSuspendedUntil,
    Date.now() + Math.max(0, Number(durationMs) || 0),
  );
}

function isViewportPersistenceSuspended() {
  return Date.now() < viewportPersistenceSuspendedUntil;
}

function runProgrammaticViewportScroll(fn) {
  if (typeof fn !== "function") return;
  isProgrammaticViewportScroll = true;
  try {
    fn();
  } finally {
    requestAnimationFrame(() => {
      isProgrammaticViewportScroll = false;
    });
  }
}

window.addEventListener(
  "scroll",
  () => {
    if (isProgrammaticViewportScroll) return;
    lastManualViewportScrollAt = Date.now();
  },
  { passive: true },
);

try {
  if (
    typeof window !== "undefined" &&
    window.history &&
    "scrollRestoration" in window.history
  ) {
    window.history.scrollRestoration = "manual";
  }
} catch (error) {}

const TAB_VIEWPORT_STORAGE_KEY = "fikstur_tab_viewports_v1";
let tabViewportPersistTimer = null;

function getActiveTabNameForViewport() {
  return state?.settings?.currentTab || "dashboard";
}

function readStoredTabViewports() {
  try {
    const raw = sessionStorage.getItem(TAB_VIEWPORT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeStoredTabViewports(viewports) {
  try {
    sessionStorage.setItem(
      TAB_VIEWPORT_STORAGE_KEY,
      JSON.stringify(viewports || {}),
    );
  } catch (error) {}
}

function persistViewportForTab(tabName, snapshot) {
  if (isViewportPersistenceSuspended()) return;

  const key = String(tabName || "dashboard");
  const nextSnapshot = snapshot || {
    windowX: window.pageXOffset || window.scrollX || 0,
    windowY: window.pageYOffset || window.scrollY || 0,
  };

  const viewports = readStoredTabViewports();
  viewports[key] = {
    windowX: Number(nextSnapshot.windowX || 0),
    windowY: Number(nextSnapshot.windowY || 0),
    savedAt: Date.now(),
  };
  writeStoredTabViewports(viewports);
}

function persistCurrentViewportForActiveTab() {
  persistViewportForTab(getActiveTabNameForViewport());
}

function getStoredViewportForTab(tabName) {
  const key = String(tabName || "dashboard");
  return readStoredTabViewports()[key] || null;
}

function restoreViewportForTab(tabName, options = {}) {
  const snapshot = getStoredViewportForTab(tabName);
  if (!snapshot) {
    if (options.fallbackToTop) {
      runProgrammaticViewportScroll(() => window.scrollTo(0, 0));
    }
    return;
  }

  const x = Number(snapshot.windowX || 0);
  const y = Number(snapshot.windowY || 0);
  runProgrammaticViewportScroll(() => window.scrollTo(x, y));
}

function scheduleTabViewportRestore(tabName, options = {}) {
  suspendViewportPersistence(520);
  tabViewportRestoreToken += 1;
  const token = tabViewportRestoreToken;
  let frameCount = 0;

  const restoreStep = () => {
    if (token !== tabViewportRestoreToken) return;
    restoreViewportForTab(tabName, options);
    frameCount += 1;
    if (frameCount < 3) {
      requestAnimationFrame(restoreStep);
    }
  };

  requestAnimationFrame(restoreStep);
  setTimeout(() => {
    if (token !== tabViewportRestoreToken) return;
    restoreViewportForTab(tabName, options);
  }, 80);
}

function scheduleActiveTabViewportPersist() {
  if (isViewportPersistenceSuspended()) return;
  if (tabViewportPersistTimer) clearTimeout(tabViewportPersistTimer);
  tabViewportPersistTimer = setTimeout(() => {
    persistCurrentViewportForActiveTab();
  }, 120);
}

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
  runProgrammaticViewportScroll(() =>
    window.scrollTo(snapshot.windowX || 0, snapshot.windowY || 0),
  );

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

  suspendViewportPersistence(420);
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

function shouldCancelPageViewportRestore(snapshot) {
  if (!snapshot) return true;

  // Render sırasında DOM yeniden kurulunca tarayıcı bazen scroll'u otomatik 0'a çekiyor.
  // Eski kontrol bunu kullanıcı kaydırması sanıp geri yüklemeyi iptal ediyordu.
  if (Date.now() - lastManualViewportScrollAt > 140) return false;

  const targetY = Number(snapshot.windowY || 0);
  const currentY = window.pageYOffset || window.scrollY || 0;

  if (currentY <= 4 && targetY > 24) return false;

  return Math.abs(currentY - targetY) <= 16;
}

function restoreWindowViewport(snapshot) {
  if (!snapshot) return;
  const x = Number(snapshot.windowX || 0);
  const y = Number(snapshot.windowY || 0);
  runProgrammaticViewportScroll(() => window.scrollTo(x, y));
}

function schedulePageViewportRestore(snapshot) {
  if (!snapshot) return;

  suspendViewportPersistence(320);
  pageViewportRestoreToken += 1;
  const token = pageViewportRestoreToken;
  let frameCount = 0;

  const restoreStep = () => {
    if (token !== pageViewportRestoreToken) return;
    if (shouldCancelPageViewportRestore(snapshot)) return;
    restoreWindowViewport(snapshot);
    frameCount += 1;
    if (frameCount < 2) {
      requestAnimationFrame(restoreStep);
    }
  };

  requestAnimationFrame(restoreStep);
  setTimeout(() => {
    if (token !== pageViewportRestoreToken) return;
    if (shouldCancelPageViewportRestore(snapshot)) return;
    restoreWindowViewport(snapshot);
  }, 70);
}
window.addEventListener("scroll", scheduleActiveTabViewportPersist, {
  passive: true,
});
window.addEventListener("pagehide", persistCurrentViewportForActiveTab, {
  capture: true,
});
window.addEventListener("beforeunload", persistCurrentViewportForActiveTab, {
  capture: true,
});

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
    [
      "backup",
      "notifications",
      "seasons",
      "weeks",
      "matches",
      "settings",
    ].includes(currentTab)
  ) {
    switchTab("dashboard");
    return;
  }

  document
    .querySelectorAll(
      "#tab-seasons button, #tab-seasons input, #tab-seasons select, #tab-weeks button, #tab-weeks input, #tab-weeks select, #tab-matches button, #tab-matches input, #tab-matches select, #tab-players button, #tab-players input, #tab-players select, #tab-notifications button, #tab-notifications input, #tab-notifications select, #tab-notifications textarea, #tab-backup button, #tab-backup input, #tab-backup select, #tab-settings button, #tab-settings input, #tab-settings select, #tab-settings textarea",
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

  if (role !== "admin" && authReady) {
    document
      .querySelectorAll("#tab-players .user-self-control")
      .forEach((el) => {
        el.disabled = false;
        el.classList.remove("readonly-control");
      });
  }

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
      const insideDashboardModal = !!el.closest("#dashboardMatchModal");
      const allow =
        insideDashboardModal ||
        [
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
  if (!pred || pred.homePred === "" || pred.awayPred === "")
    return "is-missing";
  const points = Number(pred.points || 0);
  if (!match.played) return "is-filled";
  if (points >= 3) return "is-exact";
  if (points >= 1) return "is-close";
  return "is-miss";
}

function getDashboardPredictionLabel(pred, match) {
  if (!pred || pred.homePred === "" || pred.awayPred === "")
    return "Tahmin yok";
  if (!match.played) return "Tahmin girildi";
  const points = Number(pred.points || 0);
  if (points >= 3) return "Tam skor";
  if (points >= 1) return "Sonucu bildi";
  return "Tutmadı";
}

function getDashboardMatchInsight(match) {
  const players = getVisiblePlayersOrdered();
  const preds = players.map((player) => ({
    player,
    pred: getPrediction(match.id, player.id),
  }));
  const filled = preds.filter(
    ({ pred }) => pred && pred.homePred !== "" && pred.awayPred !== "",
  );
  const missing = preds.length - filled.length;
  if (!filled.length) {
    return {
      title: "Tahmin bekleniyor",
      text: "Henüz bu maç için tahmin girilmedi.",
    };
  }
  if (!match.played) {
    return {
      title: missing ? `${missing} kişi eksik` : "Tüm tahminler girildi",
      text: missing
        ? "Kartı açıp kimlerin tahmin girdiğini görebilirsin."
        : "Tüm oyuncular bu maç için tahminini girdi.",
    };
  }
  const exact = filled.filter(
    ({ pred }) => Number(pred.points || 0) >= 3,
  ).length;
  const resultOnly = filled.filter(
    ({ pred }) => Number(pred.points || 0) === 1,
  ).length;
  if (exact)
    return {
      title: `${exact} tam skor`,
      text: "Maç detayında tam skoru bilenleri öne çıkarıyorum.",
    };
  if (resultOnly)
    return {
      title: `${resultOnly} doğru sonuç`,
      text: "Tam skor yok ama sonucu bilenler var.",
    };
  return { title: "Sürpriz maç", text: "Bu maçta henüz kimse puan alamadı." };
}

function renderDashboardOverview() {
  const titleNode = document.getElementById("dashboardHeroTitle");
  const textNode = document.getElementById("dashboardHeroText");
  const chipsNode = document.getElementById("dashboardHeroChips");
  const sideNode = document.getElementById("dashboardHeroSide");
  const pulseNode = document.getElementById("dashboardPulseList");
  const leaderboardNode = document.getElementById(
    "dashboardLeaderboardPreview",
  );
  const liveNode = document.getElementById("dashboardHeroLiveBadge");

  if (
    !titleNode ||
    !textNode ||
    !chipsNode ||
    !sideNode ||
    !pulseNode ||
    !leaderboardNode ||
    !liveNode
  )
    return;

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
    return (
      sum +
      players.filter((player) => {
        const pred = getPrediction(match.id, player.id);
        return pred && pred.homePred !== "" && pred.awayPred !== "";
      }).length
    );
  }, 0);
  const coverage = totalPredSlots
    ? Math.round((filledPredictions / totalPredSlots) * 100)
    : 0;
  const missing = Math.max(totalPredSlots - filledPredictions, 0);
  const exact = matches.reduce((sum, match) => {
    return (
      sum +
      players.filter(
        (player) =>
          Number(getPrediction(match.id, player.id)?.points || 0) >= 3,
      ).length
    );
  }, 0);
  const resultOnly = matches.reduce((sum, match) => {
    return (
      sum +
      players.filter(
        (player) =>
          Number(getPrediction(match.id, player.id)?.points || 0) === 1,
      ).length
    );
  }, 0);

  let nextMatch = null;
  const now = Date.now();
  matches.forEach((match) => {
    const ts = new Date(match.date).getTime();
    if (
      !match.played &&
      !Number.isNaN(ts) &&
      ts >= now &&
      (!nextMatch || ts < new Date(nextMatch.date).getTime())
    ) {
      nextMatch = match;
    }
  });

  const titleParts = [];
  if (season?.name) titleParts.push(season.name);
  if (week?.name) titleParts.push(week.name);
  titleNode.textContent = titleParts.join(" • ") || "Genel Bakış";

  if (!matches.length) {
    textNode.textContent =
      "Bu hafta için henüz maç bulunmuyor. Önce hafta veya maç eklediğinde burası otomatik dolacak.";
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
  chipsNode.innerHTML = chips
    .map(
      (chip) => `<span class="dashboard-hero-chip">${escapeHtml(chip)}</span>`,
    )
    .join("");

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
  pulseNode.innerHTML =
    pulseItems
      .map(
        (item) => `
    <article class="dashboard-pulse-item is-${item.tone}">
      <div class="dashboard-pulse-item__dot"></div>
      <div class="dashboard-pulse-item__content">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.text)}</span>
        <small>${escapeHtml(item.meta)}</small>
      </div>
    </article>
  `,
      )
      .join("") || createEmptyState("Bu alan hafta verisi geldikçe dolacak.");

  leaderboardNode.innerHTML =
    standings
      .slice(0, 4)
      .map(
        (row, index) => `
    <div class="dashboard-leader-row ${index === 0 ? "is-leader" : ""}">
      <div class="dashboard-leader-row__rank">${index + 1}</div>
      <div class="dashboard-leader-row__name">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${index === 0 ? "Lider" : "Takipte"}</span>
      </div>
      <div class="dashboard-leader-row__points">${Number(row.total || 0)}p</div>
    </div>
  `,
      )
      .join("") ||
    createEmptyState("Sıralama oluşması için puan verisi bekleniyor.");
  if (typeof renderDashboardAutoSyncStatus === "function") {
    renderDashboardAutoSyncStatus();
  }
  if (typeof renderDashboardSyncCard === "function") {
    renderDashboardSyncCard();
  }
}

function renderDashboardMatchCards(container, matches) {
  if (!container) return;
  if (!matches.length) {
    container.innerHTML = createEmptyState("Bu haftada henüz maç yok.");
    return;
  }

  const players = getVisiblePlayersOrdered();
  const now = Date.now();

  const getPremiumStateMeta = (match, visual, badge, timeText) => {
    const runtime =
      typeof getMatchRuntimeInfo === "function"
        ? getMatchRuntimeInfo(match, now)
        : { diffMs: null, elapsedMs: null, minute: null, phase: "unknown" };
    const diff = runtime.diffMs;
    const countdown =
      diff !== null && diff > 0
        ? formatPredictionLockCountdown(diff)
        : "00sa 00dk 00sn";
    const progress =
      diff === null
        ? 12
        : diff > 0
          ? Math.max(
              8,
              Math.min(94, 100 - Math.floor(diff / (1000 * 60 * 60 * 24)) * 8),
            )
          : visual === "live"
            ? Math.max(
                12,
                Math.min(
                  96,
                  Math.floor(
                    ((runtime.elapsedMs || 0) /
                      (MATCH_TOTAL_RUNTIME_MINUTES * 60 * 1000)) *
                      100,
                  ),
                ),
              )
            : 100;

    if (match.played || visual === "played" || visual === "played-postponed") {
      return {
        icon: "✓",
        label: "BİTTİ",
        sub: "Sonuç işlendi",
        kicker: "FULL TIME",
        progress: 100,
        timeText,
      };
    }

    if (visual === "finished-time") {
      return {
        icon: "⏱",
        label: "BİTTİ",
        sub: "Skor girilmesi bekleniyor",
        kicker: "SONUÇ BEKLİYOR",
        progress: 100,
        timeText,
      };
    }

    if (visual === "live") {
      const liveMinute = runtime.halftime
        ? "DEVRE ARASI"
        : runtime.minute
          ? `${runtime.minute}'`
          : String(match.statusText || "Canlı")
              .replace(/live|in play/gi, "")
              .trim() || "Canlı";
      return {
        icon: "●",
        label: "CANLI",
        sub: "Maç şu anda devam ediyor",
        kicker: liveMinute,
        progress,
        timeText,
      };
    }

    if (visual === "locked") {
      return {
        icon: "🔒",
        label: "KİLİTLİ",
        sub: "Maç başlamak üzere",
        kicker: countdown,
        progress: Math.max(progress, 88),
        timeText,
      };
    }

    return {
      icon: "⚡",
      label: badge.text || "BEKLİYOR",
      sub: "Maça kalan süre",
      kicker: countdown,
      progress,
      timeText,
    };
  };

  container.innerHTML = `<div class="dashboard-match-hub premium-match-hub">${matches
    .map((match) => {
      const badge = getMatchBadge(match);
      const visual = getMatchVisualState(match);
      const predictions = players.map((player) => ({
        player,
        pred: getPrediction(match.id, player.id),
      }));
      const filled = predictions.filter(
        ({ pred }) => pred && pred.homePred !== "" && pred.awayPred !== "",
      );
      const exact = predictions.filter(
        ({ pred }) => pred && Number(pred.points || 0) >= 3,
      ).length;
      const resultOnly = predictions.filter(
        ({ pred }) => pred && Number(pred.points || 0) === 1,
      ).length;
      const missing = Math.max(players.length - filled.length, 0);
      const fillRatio = players.length ? filled.length / players.length : 1;
      const coverageClass =
        fillRatio >= 0.85
          ? "coverage-full"
          : fillRatio >= 0.5
            ? "coverage-mid"
            : "coverage-low";
      const ts = new Date(match.date).getTime();
      const timeText = Number.isNaN(ts)
        ? "Saat yok"
        : new Date(match.date).toLocaleTimeString("tr-TR", {
            hour: "2-digit",
            minute: "2-digit",
          });
      const premium = getPremiumStateMeta(match, visual, badge, timeText);

      const avatars = predictions
        .map(({ player, pred }) => {
          const tone = getDashboardPredictionTone(pred, match);
          return `
            <button
              type="button"
              class="dashboard-avatar-chip ${tone}"
              title="${escapeHtml(player.name)}"
              onclick="event.stopPropagation(); handleDashboardAvatarTap(event, '${match.id}', '${player.id}');">
              ${createGenericAvatarMarkup(player, "dashboard-inline-avatar")}
            </button>
          `;
        })
        .join("");

      return `
      <article
      class="dashboard-match-card premium-match-card master-match-card is-${visual} ${coverageClass} ${match.played ? "is-played" : ""} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}"
      data-match-id="${match.id}"
      style="--match-stadium-bg:url('${getMatchSceneUrl(match.homeTeam, match.seasonId)}'), url('${MATCH_SCENE_DEFAULT}')">
          <div class="premium-stadium-bg" aria-hidden="true"></div>
          <div class="premium-stadium-lights" aria-hidden="true"></div>
          <div class="dashboard-match-card__glow"></div>

          <div class="premium-card-head dashboard-match-open-zone" onclick="openDashboardMatchModal('${match.id}')">
            <span class="premium-status-chip">
              <span class="premium-status-icon">${premium.icon}</span>
              <strong>${escapeHtml(premium.label)}</strong>
              <span>•</span>
              <b>${premium.timeText}</b>
            </span>
            <span class="premium-countdown" data-countdown-role="match-clock">
              <strong data-countdown-text>${escapeHtml(premium.kicker)}</strong>
            </span>
          </div>

          <div class="dashboard-match-card__body premium-match-body dashboard-match-open-zone" onclick="openDashboardMatchModal('${match.id}')">
            <div class="dashboard-team premium-team dashboard-team--home">
              <div class="premium-logo-aura premium-logo-aura--home">${teamLogoHtml(match.homeTeam, match.seasonId)}</div>
              <strong>${escapeHtml(match.homeTeam)}</strong>
            </div>

            <div class="dashboard-score-core premium-score-core">
              <div class="dashboard-score-core__label">${match.played ? "SKOR" : visual === "finished-time" ? "BİTTİ" : visual === "live" ? "CANLI" : "MAÇ"}</div>
              <div class="dashboard-score-core__value premium-score-value">${match.played ? `${match.homeScore} <span>-</span> ${match.awayScore}` : '<span class="dashboard-score-core__pending premium-vs-capsule">VS</span>'}</div>
              <div class="dashboard-score-core__sub">${match.played ? "Sonuç işlendi" : visual === "finished-time" ? "Skor bekleniyor" : "Detay için dokun"}</div>
            </div>

            <div class="dashboard-team premium-team dashboard-team--away">
              <div class="premium-logo-aura premium-logo-aura--away">${teamLogoHtml(match.awayTeam, match.seasonId)}</div>
              <strong>${escapeHtml(match.awayTeam)}</strong>
            </div>
          </div>

          <div class="premium-progress-line" aria-hidden="true">
            <span style="width:${premium.progress}%"></span>
          </div>

          <div class="dashboard-avatar-row premium-avatar-row">
            <div class="dashboard-avatar-row__chips">${avatars}</div>
          </div>

          <div class="dashboard-match-card__footer premium-card-footer">
            <div class="dashboard-match-meta-pills premium-meta-pills">
              <span class="dashboard-meta-pill"><i>🎯</i><b>${filled.length}/${players.length}</b><em>tahmin</em></span>
              <span class="dashboard-meta-pill"><i>👥</i><b>${missing}</b><em>eksik</em></span>
              <span class="dashboard-meta-pill"><i>✅</i><b>${exact}</b><em>tam</em></span>
              <span class="dashboard-meta-pill"><i>📍</i><b>${resultOnly}</b><em>yakın</em></span>
            </div>
          </div>
        </article>
      `;
    })
    .join("")}</div>`;
}

function buildDashboardMatchModalBody(match) {
  const players = getVisiblePlayersOrdered();
  const rows = players
    .map((player) => {
      const pred = getPrediction(match.id, player.id);
      const tone = getDashboardPredictionTone(pred, match);
      const label = getDashboardPredictionLabel(pred, match);
      const value =
        pred && (pred.homePred !== "" || pred.awayPred !== "")
          ? `${pred.homePred !== "" ? pred.homePred : "-"} - ${pred.awayPred !== "" ? pred.awayPred : "-"}`
          : "--";
      const revealPrediction = canRevealPredictionForViewer(match, player.id);
      const hasPrediction = !!(
        pred &&
        (pred.homePred !== "" || pred.awayPred !== "")
      );
      return {
        player,
        pred,
        tone,
        label: !revealPrediction && hasPrediction ? "Tahmin girildi" : label,
        value: revealPrediction ? value : hasPrediction ? "🔒 Gizli" : "--",
        points: revealPrediction ? Number(pred?.points || 0) : 0,
        revealPrediction,
        hasPrediction,
      };
    })
    .sort(
      (a, b) =>
        b.points - a.points || a.player.name.localeCompare(b.player.name, "tr"),
    );

  const exact = rows.filter((row) => row.tone === "is-exact").length;
  const close = rows.filter((row) => row.tone === "is-close").length;
  const miss = rows.filter((row) => row.tone === "is-miss").length;
  const missing = rows.filter((row) => row.tone === "is-missing").length;

  return `
    <div class="dashboard-detail-summary">
      <div class="dashboard-detail-stat"><span>Tahmin</span><strong>${rows.length - missing}/${rows.length}</strong></div>
      <div class="dashboard-detail-stat"><span>Tam skor</span><strong>${exact}</strong></div>
      <div class="dashboard-detail-stat"><span>Doğru sonuç</span><strong>${close}</strong></div>
      <div class="dashboard-detail-stat"><span>Kaçıran</span><strong>${miss}</strong></div>
    </div>
    <div class="dashboard-detail-list">
      ${rows
        .map(
          (row) => `
        <div class="dashboard-detail-row ${row.tone} ${!row.revealPrediction && row.hasPrediction ? "dashboard-secret-row" : ""}">
          <div class="dashboard-detail-row__user">
            <span class="dashboard-avatar-chip ${row.tone}">${createGenericAvatarMarkup(row.player, "dashboard-inline-avatar")}</span>
            <div>
              <strong>${escapeHtml(row.player.name)}</strong>
              <span>${escapeHtml(row.label)}</span>
            </div>
          </div>
          <div class="dashboard-detail-row__score">${escapeHtml(row.value)}</div>
          <div class="dashboard-detail-row__points">${row.revealPrediction && row.pred && row.pred.homePred !== "" && row.pred.awayPred !== "" ? `${row.points}p` : row.hasPrediction ? "🔒" : "--"}</div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}
function buildDashboardPlayerWeekModalBody(match, player) {
  const weekMatches = getMatchesByWeekId(match.weekId);
  const supportedTeam = getPlayerSupportedTeamName(player) || "Takım seçilmedi";

  const weekRows = weekMatches.map((weekMatch) => {
    const pred = getPrediction(weekMatch.id, player.id);
    const hasPrediction = !!(
      pred &&
      pred.homePred !== "" &&
      pred.awayPred !== ""
    );
    const revealPrediction = canRevealPredictionForViewer(weekMatch, player.id);
    const tone = getDashboardPredictionTone(pred, weekMatch);
    const label = getDashboardPredictionLabel(pred, weekMatch);

    return {
      match: weekMatch,
      pred,
      hasPrediction,
      revealPrediction,
      tone,
      label,
    };
  });

  const predictedCount = weekRows.filter((row) => row.hasPrediction).length;
  const missingCount = Math.max(weekRows.length - predictedCount, 0);
  const exactCount = weekRows.filter(
    (row) => row.match.played && Number(row.pred?.points || 0) >= 3,
  ).length;
  const closeCount = weekRows.filter(
    (row) => row.match.played && Number(row.pred?.points || 0) === 1,
  ).length;
  const missCount = weekRows.filter(
    (row) =>
      row.match.played &&
      row.hasPrediction &&
      Number(row.pred?.points || 0) === 0,
  ).length;
  const weeklyPoint = weekRows.reduce(
    (sum, row) => sum + Number(row.match.played ? row.pred?.points || 0 : 0),
    0,
  );

  return `
    <div class="dashboard-player-profile-modal">
      <div class="dashboard-player-profile-head">
        <div class="dashboard-player-profile-avatar">
          ${createGenericAvatarMarkup(player, "dashboard-player-profile-avatar-img")}
        </div>

        <div class="dashboard-player-profile-info">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${teamLogoHtml(supportedTeam, getActiveSeasonId())} ${escapeHtml(supportedTeam)}</span>
        </div>

        <div class="dashboard-player-profile-score">
          <strong>${weeklyPoint}p</strong>
          <span>Haftalık</span>
        </div>
      </div>

      <div class="dashboard-player-profile-stats">
        <div><span>Tahmin</span><strong>${predictedCount}/${weekRows.length}</strong></div>
        <div><span>Eksik</span><strong>${missingCount}</strong></div>
        <div><span>Tam</span><strong>${exactCount}</strong></div>
        <div><span>Yakın</span><strong>${closeCount}</strong></div>
        <div><span>Kaçtı</span><strong>${missCount}</strong></div>
      </div>

      <div class="dashboard-player-profile-list">
        ${weekRows
          .map((row) => {
            const scoreText =
              row.hasPrediction && row.revealPrediction
                ? `${row.pred.homePred} - ${row.pred.awayPred}`
                : row.hasPrediction
                  ? "🔒 Maç başlayınca görünür"
                  : "Tahmin yok";

            const pointText =
              row.hasPrediction && row.revealPrediction && row.match.played
                ? `${Number(row.pred.points || 0)}p`
                : row.hasPrediction && !row.revealPrediction
                  ? "🔒"
                  : "--";

            return `
              <div class="dashboard-player-profile-match ${row.tone}">
                <div class="dashboard-player-profile-teams">
                  <strong>${escapeHtml(row.match.homeTeam)} - ${escapeHtml(row.match.awayTeam)}</strong>
                  <span>${formatDate(row.match.date)}</span>
                </div>

                <div class="dashboard-player-profile-prediction">
                  <strong>${escapeHtml(scoreText)}</strong>
                  <span>${escapeHtml(row.revealPrediction ? row.label : row.hasPrediction ? "Gizli tahmin" : "Eksik")}</span>
                </div>

                <div class="dashboard-player-profile-points">${pointText}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}
let dashboardSelectedAvatarKey = "";

window.handleDashboardAvatarTap = function (event, matchId, playerId) {
  const chip = event.currentTarget;
  const key = `${matchId}-${playerId}`;
  const isMobile = window.matchMedia("(max-width: 640px)").matches;

  if (!isMobile) {
    openDashboardPlayerWeekModal(matchId, playerId);
    return;
  }

  if (
    dashboardSelectedAvatarKey === key &&
    chip.classList.contains("is-selected")
  ) {
    dashboardSelectedAvatarKey = "";
    chip.classList.remove("is-selected");
    openDashboardPlayerWeekModal(matchId, playerId);
    return;
  }

  document
    .querySelectorAll(".dashboard-avatar-chip.is-selected")
    .forEach((item) => item.classList.remove("is-selected"));

  dashboardSelectedAvatarKey = key;
  chip.classList.add("is-selected");
};
window.openDashboardPlayerWeekModal = function (matchId, playerId) {
  const modal = document.getElementById("dashboardMatchModal");
  const title = document.getElementById("dashboardMatchModalTitle");
  const meta = document.getElementById("dashboardMatchModalMeta");
  const body = document.getElementById("dashboardMatchModalBody");

  const match = state.matches.find(
    (item) => String(item.id) === String(matchId),
  );
  const player = state.players.find(
    (item) => String(item.id) === String(playerId),
  );

  if (!modal || !title || !meta || !body || !match || !player) return;

  title.textContent = `${player.name} profili`;
  meta.textContent = `${formatDate(match.date)} haftası tahmin özeti`;
  body.innerHTML = buildDashboardPlayerWeekModalBody(match, player);

  modal.classList.remove("hidden");
  document.body.classList.add("dashboard-modal-open");
};
window.openDashboardMatchModal = function (matchId) {
  const modal = document.getElementById("dashboardMatchModal");
  const title = document.getElementById("dashboardMatchModalTitle");
  const meta = document.getElementById("dashboardMatchModalMeta");
  const body = document.getElementById("dashboardMatchModalBody");
  const match = state.matches.find(
    (item) => String(item.id) === String(matchId),
  );
  if (!modal || !title || !meta || !body || !match) return;

  // Modal normalde dashboard sekmesinin içinde duruyor. Kullanıcı Tahminler
  // sayfasındayken o sekme gizli olduğu için pencere arkada/hiç görünmüyordu.
  // Body'ye taşıyınca admin tarafındaki tablo ve ekran resmi alanına dokunmadan
  // aynı pencere her sekmede en önde açılır.
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  const userCompactMode = getCurrentRole() !== "admin";
  modal.classList.toggle("is-user-compact-prediction-modal", userCompactMode);

  title.textContent = userCompactMode
    ? `Tahminler • ${match.homeTeam} - ${match.awayTeam}`
    : `${match.homeTeam} - ${match.awayTeam}`;
  meta.textContent = match.played
    ? `Gerçek skor: ${match.homeScore}-${match.awayScore} • ${formatDate(match.date)}`
    : `${formatDate(match.date)} • Maç başladı, tahminler kilitli`;
  body.innerHTML = buildDashboardMatchModalBody(match);
  modal.classList.remove("hidden");
  document.body.classList.add("dashboard-modal-open");
};

window.closeDashboardMatchModal = function () {
  const modal = document.getElementById("dashboardMatchModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("is-user-compact-prediction-modal");
  document.body.classList.remove("dashboard-modal-open");
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
      const predictionRevealOpen = isWeekStartedForPredictionReveal(
        match.weekId,
      );
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
        ${!isAdmin && !predictionRevealOpen ? `<div class="mobile-fairplay-notice">🔒 Diğer kullanıcıların tahminleri tahmin süresi kilitlenince açılır.</div>` : ""}
        <div class="mobile-user-predictions compact-mobile-user-predictions">${players
          .map((player) => {
            const pred =
              getPrediction(match.id, player.id) ||
              createEmptyPredictionRecord(match.id, player.id);
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
            const statusText = getPredictionBaseStatus(match.id, player.id);
            const showDeleteAction =
              !lockedForUi && (hasPrediction || pred.remoteId || isSaving);
            const scoreDisplay =
              pred.homePred !== "" || pred.awayPred !== ""
                ? `${pred.homePred !== "" ? pred.homePred : "-"} - ${pred.awayPred !== "" ? pred.awayPred : "-"}`
                : "--";
            const showSaveAction =
              !lockedForUi &&
              canEdit &&
              shouldShowPredictionSaveAction(match.id, player.id);

            if (!isOwnPlayer && !isAdmin) {
              if (!canRevealPredictionForViewer(match, player.id)) {
                return "";
              }
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
                <strong>${escapeHtml(player.name)}${isOwnPlayer ? '<span class="own-pill">Sen</span>' : isAdmin ? '<span class="own-pill">Yönet</span>' : ""}</strong>
                <span class="mini-points premium-points premium-points--compact">${locked ? "🔒" : `${pred.points || 0} puan`}</span>
              </div>

              <div class="score-inputs compact-inputs center-mode premium-score-inputs premium-score-inputs--compact pred-score-row own-pred-score-row">
                <input
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  value="${getPredictionRenderValue(match.id, player.id, "home", pred.homePred)}"
                  id="pred_home_${match.id}_${player.id}"
                  data-pred-role="input"
                  data-match-id="${match.id}"
                  data-player-id="${player.id}"
                  ${lockedForUi || !canEdit ? 'disabled readonly aria-disabled="true" data-pred-locked="true"' : ""}
                />
                <span class="premium-dash">-</span>
                <input
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  value="${getPredictionRenderValue(match.id, player.id, "away", pred.awayPred)}"
                  id="pred_away_${match.id}_${player.id}"
                  data-pred-role="input"
                  data-match-id="${match.id}"
                  data-player-id="${player.id}"
                  ${lockedForUi || !canEdit ? 'disabled readonly aria-disabled="true" data-pred-locked="true"' : ""}
                />
              </div>

              ${lockedForUi ? `<div class="mobile-lock-warning">🔒 Tahmin kapandı</div>` : ""}
              <div class="pred-action-area own-pred-action-area own-pred-action-area--compact">
                ${
                  canEdit
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
                    >${lockedForUi ? "🔒 Kilitli" : getPredictionSaveLabel(match.id, player.id)}</button>
                    <button
                      class="prediction-mobile-save-btn prediction-mobile-save-btn--compact danger prediction-delete-btn ${showDeleteAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_delete_${match.id}_${player.id}"
                      data-pred-role="delete-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      ${lockedForUi ? "disabled" : ""}
                    >Sil</button>
                  </div>`
                    : `<div class="pred-btn-slot"></div>`
                }

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
  if (
    event.target === overlay ||
    event.target?.closest?.(".welcome-overlay__backdrop") ||
    event.target?.closest?.("#welcomeCloseBtn")
  ) {
    hideWelcomeOverlay();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideWelcomeOverlay();
});
/* 02-state-core.js */

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
      resultsLastAutoSyncAt: 0,
      resultsAutoSyncInProgressAt: 0,
      leagueStandingsCache: {},
      welcomeCard: {
        enabled: true,
        title: "Hoş geldin!",
        message: "İyi haftalar, bol şans! ✨",
        imageFile: "",
        imageFit: "cover",
        showOnce: false,
        updatedAt: "",
      },
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

let predictionIndexCache = null;
let predictionIndexCacheSource = null;
let predictionIndexCacheLength = -1;

function getPredictionTimestampValue(pred = {}) {
  const raw =
    pred.updatedAt ||
    pred.guncellemeTarihi ||
    pred.createdAt ||
    pred.tarih ||
    pred.timestamp ||
    0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number(raw || 0) || 0;
}

function isPredictionRecordNewer(next = {}, current = {}) {
  const nextTime = getPredictionTimestampValue(next);
  const currentTime = getPredictionTimestampValue(current);
  if (nextTime !== currentTime) return nextTime > currentTime;
  if (next.remoteId && !current.remoteId) return true;
  if (next.id && !current.id) return true;
  return true;
}

function getPredictionIndexMap() {
  if (
    predictionIndexCache &&
    predictionIndexCacheSource === state.predictions &&
    predictionIndexCacheLength === state.predictions.length
  ) {
    return predictionIndexCache;
  }

  const map = new Map();
  state.predictions.forEach((pred) => {
    const key = `${normalizeEntityId(pred.matchId)}__${normalizeEntityId(pred.playerId)}`;
    const current = map.get(key);
    if (!current || isPredictionRecordNewer(pred, current)) {
      map.set(key, pred);
    }
  });

  predictionIndexCache = map;
  predictionIndexCacheSource = state.predictions;
  predictionIndexCacheLength = state.predictions.length;
  return map;
}

function getPredictionCacheKey(matchId, playerId) {
  return `${normalizeEntityId(matchId)}__${normalizeEntityId(playerId)}`;
}

function invalidatePredictionIndexCache() {
  predictionIndexCache = null;
  predictionIndexCacheSource = null;
  predictionIndexCacheLength = -1;
}

function createEmptyPredictionRecord(matchId, playerId) {
  return {
    id: null,
    remoteId: null,
    matchId: normalizeEntityId(matchId),
    playerId: normalizeEntityId(playerId),
    homePred: "",
    awayPred: "",
    points: 0,
  };
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
function getPlayerAvatarUrl(player) {
  return String(
    player?.avatar ||
      player?.avatarUrl ||
      player?.photo ||
      player?.profilePhoto ||
      "",
  ).trim();
}

function getPlayerInitials(player) {
  const raw = String(player?.name || player?.username || "?").trim();
  if (!raw) return "?";
  return raw
    .split(/\s+/)
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getPlayerAvatarHtml(player, sizeClass = "") {
  const avatarUrl = getPlayerAvatarUrl(player);
  const initials = getPlayerInitials(player);

  if (avatarUrl) {
    return `
      <div class="player-avatar ${sizeClass}">
        <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(player?.name || "Avatar")}" class="player-avatar-img" />
      </div>
    `;
  }

  return `
    <div class="player-avatar player-avatar-fallback ${sizeClass}">
      <span>${escapeHtml(initials)}</span>
    </div>
  `;
}
function getTeamById(id) {
  return state.teams.find((t) => t.id === id);
}
function getActiveSeasonId() {
  return state.settings.activeSeasonId || state.seasons[0]?.id || null;
}
function getAllWeeksBySeasonId(seasonId) {
  return state.weeks
    .filter((w) => w.seasonId === seasonId)
    .sort((a, b) => a.number - b.number);
}

function getWeeksBySeasonId(seasonId) {
  const weeks = getAllWeeksBySeasonId(seasonId);
  if (!isReadOnlyMode()) return weeks;
  return weeks.filter(
    (week) => String(week.status || "hazirlaniyor") !== "hazirlaniyor",
  );
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

function isWeekPreparing(weekId) {
  const week = getWeekById(weekId);
  return String(week?.status || "hazirlaniyor") === "hazirlaniyor";
}

function shouldPublishMatchChanges(weekId) {
  return !isWeekPreparing(weekId);
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
  invalidatePredictionIndexCache();
}

function compactLocalPredictionRecords() {
  if (!Array.isArray(state.predictions) || !state.predictions.length) return;

  const map = new Map();
  state.predictions.forEach((pred) => {
    const matchId = normalizeEntityId(pred.matchId || pred.localMatchId);
    const playerId = normalizeEntityId(
      pred.playerId || pred.kullaniciId || pred.userId,
    );
    if (!matchId || !playerId) return;

    pred.matchId = matchId;
    pred.playerId = playerId;
    pred.localMatchId = pred.localMatchId || matchId;

    const key = `${matchId}__${playerId}`;
    const current = map.get(key);
    if (!current || isPredictionRecordNewer(pred, current)) {
      map.set(key, pred);
    }
  });

  if (map.size !== state.predictions.length) {
    state.predictions = Array.from(map.values());
    invalidatePredictionIndexCache();
    saveState(true);
  }
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
  return getPredictionIndexMap().get(getPredictionCacheKey(matchId, playerId));
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

function resetActiveWeekToPreferredForSeason(seasonId = getActiveSeasonId()) {
  const resolvedSeasonId = seasonId || getActiveSeasonId() || null;
  state.settings.activeSeasonId = resolvedSeasonId;
  state.settings.activeWeekId = resolvedSeasonId
    ? getPreferredWeekIdForSeason(resolvedSeasonId)
    : null;
  return state.settings.activeWeekId;
}

async function setActiveSeason(seasonId) {
  const requestedSeasonId = seasonId || null;
  appBootstrapInProgress = true;
  state.settings.activeSeasonId = requestedSeasonId;
  state.settings.activeWeekId = null;
  renderAll();

  try {
    if (isAuthenticated() && isFirebaseReady()) {
      await hydrateFromFirebaseRealtime("season-change");
    }

    state.settings.activeSeasonId = requestedSeasonId;
    state.settings.activeWeekId = requestedSeasonId
      ? getPreferredWeekIdForSeason(requestedSeasonId)
      : null;
    saveState(true);

    await syncOnlinePredictions({
      seasonId: requestedSeasonId,
      weekId: state.settings.activeWeekId,
    });
  } finally {
    appBootstrapInProgress = false;
    renderAll();
    refreshPlayerDetailModal();
  }
}

async function setActiveWeek(weekId) {
  state.settings.activeWeekId = weekId || null;
  const week = getWeekById(weekId);
  if (week?.seasonId) state.settings.activeSeasonId = week.seasonId;
  saveState();
  renderAll();
  refreshPlayerDetailModal();
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
  const normalizedName = normalizeText(name);
  return (
    getTeamsBySeasonId(seasonId).find(
      (t) => normalizeText(t.name) === normalizedName,
    ) ||
    state.teams.find((t) => normalizeText(t.name) === normalizedName) || {
      name,
      slug: DEFAULT_TEAM_SLUGS[name] || slugify(name),
      sceneSlug:
        typeof getDefaultMatchSceneSlugForTeam === "function"
          ? getDefaultMatchSceneSlugForTeam(name)
          : slugify(name),
    }
  );
}

function getStoredTeamLogoCache() {
  if (!state.settings || typeof state.settings !== "object")
    state.settings = {};
  if (
    !state.settings.teamLogoCache ||
    typeof state.settings.teamLogoCache !== "object"
  ) {
    state.settings.teamLogoCache = {};
  }
  return state.settings.teamLogoCache;
}

function getTeamLogoCacheKey(teamName) {
  return slugify(normalizeText(teamName)) || sanitizeFirebaseKey(teamName);
}

function getTeamLogoUrl(teamName, seasonId = getActiveSeasonId()) {
  const team = getTeamMetaByName(teamName, seasonId);
  const directUrl = String(team?.badgeUrl || team?.logoUrl || "").trim();
  if (directUrl) return directUrl;

  const cache = getStoredTeamLogoCache();
  const seasonMap = cache[String(seasonId || "")] || {};
  const key = getTeamLogoCacheKey(teamName);
  const cached = seasonMap[key];
  const cachedUrl = typeof cached === "string" ? cached : cached?.badgeUrl;
  if (cachedUrl) return String(cachedUrl).trim();

  for (const map of Object.values(cache)) {
    if (!map || typeof map !== "object") continue;
    const value = map[key];
    const url = typeof value === "string" ? value : value?.badgeUrl;
    if (url) return String(url).trim();
  }
  return "";
}

function handleTeamLogoError(img) {
  if (!img) return;
  img.style.display = "none";
  img.dataset.logoFailed = "1";
  const fallback = img.nextElementSibling;
  if (fallback) fallback.style.display = "grid";
}

function hydrateTeamLogosIn(container = document) {
  container.querySelectorAll?.(".team-logo-img").forEach((img) => {
    if (img.complete && img.naturalWidth > 0) return;
    if (img.dataset.logoFailed === "1") {
      img.style.display = "none";
      const fallback = img.nextElementSibling;
      if (fallback) fallback.style.display = "grid";
    }
  });
}

function teamLogoHtml(teamName, seasonId, extraClass = "") {
  const logoUrl = getTeamLogoUrl(teamName, seasonId);
  const imageHtml = logoUrl
    ? `<img class="team-logo-img" src="${escapeHtml(logoUrl)}" data-team-name="${escapeHtml(teamName)}" alt="${escapeHtml(teamName)} logosu" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="window.handleTeamLogoError && window.handleTeamLogoError(this);" />`
    : "";
  return `
    <span class="team-logo-wrap ${extraClass}">
      ${imageHtml}
      <span class="team-logo fallback-logo" style="${logoUrl ? "display:none;" : "display:grid;"} ${teamStyle(teamName)}">${teamInitials(teamName)}</span>
    </span>
  `;
}

function parseMatchDateTimestamp(value) {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();

  const raw = String(value).trim();
  if (!raw) return NaN;

  const isoLocal = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (isoLocal) {
    const [, y, m, d, h, min] = isoLocal;
    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(h),
      Number(min),
      0,
      0,
    ).getTime();
  }

  const trLocal = raw.match(
    /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/,
  );
  if (trLocal) {
    const [, d, m, y, h = "0", min = "0"] = trLocal;
    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(h),
      Number(min),
      0,
      0,
    ).getTime();
  }

  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? NaN : parsed;
}

function formatDate(date) {
  if (!date) return "Tarih yok";
  const ts = parseMatchDateTimestamp(date);
  if (Number.isNaN(ts)) return "Tarih yok";
  return new Date(ts).toLocaleString("tr-TR", {
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
    .map((item) => parseMatchDateTimestamp(item.date))
    .filter((ts) => !Number.isNaN(ts))
    .sort((a, b) => a - b);

  if (!datedMatches.length) return null;
  return datedMatches[0] - 6 * 60 * 60 * 1000;
}

function getWeekPredictionManualState(weekId) {
  const week = getWeekById(weekId);
  if (!week) return "auto";
  if (week.predictionManualLocked === true) return "locked";
  if (week.predictionManualOpen === true) return "open";
  return "auto";
}

function isWeekPredictionLockedForUsers(weekId, nowMs = Date.now()) {
  const manualState = getWeekPredictionManualState(weekId);
  if (manualState === "locked") return true;
  if (manualState === "open") return false;

  const lockTs = getWeekPredictionLockTimestamp(weekId);
  if (lockTs === null) return false;
  return nowMs >= lockTs;
}

function getWeekPredictionAdminControlHtml(weekId) {
  if (getCurrentRole() !== "admin" || !weekId) return "";
  const manualState = getWeekPredictionManualState(weekId);
  const isLocked = manualState === "locked";
  const label = isLocked ? "🔓 Haftayı Aç" : "🔒 Haftayı Kilitle";
  const cls = isLocked ? "secondary" : "danger";
  return `<button type="button" class="${cls} small prediction-week-lock-btn" onclick="toggleWeekPredictionLock('${weekId}', this)">${label}</button>`;
}

window.toggleWeekPredictionLock = async function (weekId, actionButton = null) {
  if (getCurrentRole() !== "admin" || !weekId) return;
  const week = getWeekById(weekId);
  if (!week) return;

  const manualState = getWeekPredictionManualState(weekId);
  const willLock = manualState !== "locked";
  const autoLockTs = getWeekPredictionLockTimestamp(weekId);
  const now = Date.now();

  const confirmed = await showConfirm(
    willLock
      ? `${week.number}. haftayı şimdi kilitlemek istiyor musun?\n\nKullanıcılar tahmin giremeyecek ve tahminler görünür olacak. Bu işlem için kimseye 2 saat / 1 saat hatırlatma bildirimi gönderilmeyecek.`
      : `${week.number}. haftayı yeniden tahminlere açmak istiyor musun?\n\nNormal 6 saatlik kilit zamanı henüz gelmediyse otomatik sistem tekrar devralır. Kilit zamanı geçtiyse admin açma kararı geçerli olur.`,
    {
      title: willLock ? "Haftayı Kilitle" : "Haftayı Aç",
      type: "confirm",
      confirmText: willLock ? "Kilitle" : "Aç",
    },
  );
  if (!confirmed) return;

  try {
    if (actionButton) {
      setAsyncButtonState(actionButton, "loading", {
        loading: willLock ? "Kilitleniyor..." : "Açılıyor...",
      });
    }

    week.predictionManualLocked = willLock;
    week.predictionManualOpen =
      !willLock && typeof autoLockTs === "number" && now >= autoLockTs;
    week.predictionManualUpdatedAt = new Date().toISOString();
    week.predictionManualUpdatedBy =
      (typeof getCurrentUsername === "function" && getCurrentUsername()) ||
      "admin";

    await persistWeekRegistryToFirebase();
    saveState(true);

    if (typeof renderPredictions === "function") renderPredictions();
    if (typeof renderDashboard === "function") renderDashboard();

    showToast(
      willLock
        ? `${week.number}. hafta manuel olarak kilitlendi. Hatırlatma bildirimleri susturuldu.`
        : `${week.number}. hafta yeniden tahminlere açıldı.`,
      "success",
    );
  } catch (error) {
    console.error("Hafta tahmin kilidi güncellenemedi:", error);
    showAlert(`Hafta kilidi güncellenemedi: ${error.message || error}`, {
      title: "İşlem başarısız",
      type: "error",
    });
  } finally {
    if (actionButton) setAsyncButtonState(actionButton, "idle");
  }
};

let predictionLockTimerInterval = null;
let predictionRevealRefreshTimer = null;
let predictionLockRerenderPending = false;
const predictionRevealSignatureCache = {};

function getPredictionRevealSignature(weekId) {
  if (!weekId) return "";
  return isWeekStartedForPredictionReveal(weekId)
    ? "week-started"
    : "week-hidden";
}

function refreshPredictionViewsAfterRevealChange(weekId) {
  if (!weekId || predictionLockRerenderPending) return;

  const nextSignature = getPredictionRevealSignature(weekId);
  if (predictionRevealSignatureCache[weekId] === nextSignature) return;

  predictionRevealSignatureCache[weekId] = nextSignature;
  predictionLockRerenderPending = true;

  setTimeout(() => {
    predictionLockRerenderPending = false;
    if (
      (state.settings.currentTab || "dashboard") === "predictions" &&
      typeof renderPredictions === "function"
    ) {
      renderPredictions();
    }
    if (typeof renderDashboard === "function") renderDashboard();
  }, 0);
}

function clearPredictionRevealRefreshTimer() {
  if (predictionRevealRefreshTimer) {
    clearTimeout(predictionRevealRefreshTimer);
    predictionRevealRefreshTimer = null;
  }
}

function schedulePredictionRevealRefresh(weekId) {
  clearPredictionRevealRefreshTimer();
  if (!weekId) return;

  const now = Date.now();
  const nextRevealTs = getMatchesByWeekId(weekId)
    .map((match) => parseMatchDateTimestamp(match.date))
    .filter((ts) => !Number.isNaN(ts) && ts > now)
    .sort((a, b) => a - b)[0];

  if (!nextRevealTs) return;

  const delay = Math.min(Math.max(nextRevealTs - now + 750, 1000), 2147483647);
  predictionRevealRefreshTimer = setTimeout(() => {
    predictionRevealRefreshTimer = null;
    if (typeof renderPredictions === "function") renderPredictions();
    if (typeof renderDashboard === "function") renderDashboard();
  }, delay);
}

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
    clearPredictionRevealRefreshTimer();
    banner.className = "prediction-lock-banner is-hidden";
    banner.innerHTML = "";
    return;
  }

  schedulePredictionRevealRefresh(weekId);
  predictionRevealSignatureCache[weekId] = getPredictionRevealSignature(weekId);

  const lockTs = getWeekPredictionLockTimestamp(weekId);
  const isAdmin = getCurrentRole() === "admin";

  const updateBanner = () => {
    const manualState = getWeekPredictionManualState(weekId);
    const adminControl = isAdmin ? getWeekPredictionAdminControlHtml(weekId) : "";
    const notificationButton =
      typeof getPredictionNotificationButtonHtml === "function" &&
      manualState !== "locked"
        ? getPredictionNotificationButtonHtml()
        : "";

    if (manualState === "locked") {
      banner.className = `prediction-lock-banner ${isAdmin ? "admin" : "closed"}`;
      banner.innerHTML = isAdmin
        ? `<strong>🔒 Hafta admin tarafından kilitlendi</strong><span>Kullanıcılar tahmin giremez. 2 saat / 1 saat otomatik hatırlatma bildirimleri bu hafta için gönderilmez.</span>${adminControl}`
        : `<strong>🔒 Tahminler kilitlendi</strong><span>Admin bu haftayı manuel olarak kilitledi. Tahminler artık görünür.</span>`;
      refreshPredictionViewsAfterRevealChange(weekId);
      return;
    }

    if (manualState === "open") {
      banner.className = `prediction-lock-banner ${isAdmin ? "admin" : "open"}`;
      banner.innerHTML = isAdmin
        ? `<strong>🔓 Hafta admin tarafından açık tutuluyor</strong><span>Normal 6 saatlik kilit zamanı geçmiş olsa bile kullanıcılar tahmin girmeye devam edebilir.</span>${adminControl}${notificationButton}`
        : `<strong>🔓 Tahminler admin tarafından yeniden açıldı</strong><span>Bu hafta için tahmin girişi şu anda açık.</span>${notificationButton}`;
      refreshPredictionViewsAfterRevealChange(weekId);
      return;
    }

    if (lockTs === null) {
      banner.className = "prediction-lock-banner is-hidden";
      banner.innerHTML = "";
      return;
    }

    const diff = lockTs - Date.now();

    if (diff <= 0) {
      if (isAdmin) {
        banner.className = "prediction-lock-banner admin";
        banner.innerHTML =
          `<strong>🔓 Admin modu açık</strong><span>Tahmin süresi kullanıcılar için doldu. İstersen haftayı manuel olarak yeniden açabilirsin.</span>${adminControl}`;
      } else {
        banner.className = "prediction-lock-banner closed";
        banner.innerHTML =
          "<strong>🔒 Tahminler kilitlendi</strong><span>Bu hafta için yeni tahmin ve silme işlemleri kapalı.</span>";
      }
      refreshPredictionViewsAfterRevealChange(weekId);
      return;
    }

    const countdown = formatPredictionLockCountdown(diff);
    const toneClass = diff <= 60 * 60 * 1000 ? "warning" : "open";
    banner.className = `prediction-lock-banner ${isAdmin ? "admin" : toneClass}`;

    if (isAdmin) {
      banner.innerHTML = `<strong>🔓 Admin görünümü · ${countdown}</strong><span>Kullanıcılar için otomatik kilit bu sürenin sonunda devreye girer. İstersen daha erken manuel kilitleyebilirsin.</span>${adminControl}${notificationButton}`;
      return;
    }

    banner.innerHTML = `<strong>⏳ Tahmin vermek için kalan süre: ${countdown}</strong><span>Haftanın ilk maçından 6 saat önce tüm tahminler otomatik kilitlenir.</span>${notificationButton}`;
    refreshPredictionViewsAfterRevealChange(weekId);
  };

  updateBanner();
  predictionLockTimerInterval = setInterval(updateBanner, 1000);
}

function isMatchLocked(match) {
  if (getCurrentRole() === "admin") return false;
  if (match.played) return true;

  const manualState = getWeekPredictionManualState(match.weekId);
  if (manualState === "locked") return true;
  if (manualState === "open") return false;

  const weekLockTs = getWeekPredictionLockTimestamp(match.weekId);
  if (weekLockTs !== null) return Date.now() >= weekLockTs;

  if (!match.date) return false;
  const ts = parseMatchDateTimestamp(match.date);
  if (Number.isNaN(ts)) return false;
  return Date.now() >= ts;
}

function isMatchStartedForPredictionReveal(match) {
  if (!match) return false;
  if (match.played) return true;

  const visual =
    typeof getMatchVisualState === "function" ? getMatchVisualState(match) : "";
  if (visual === "live" || visual === "played" || visual === "played-postponed")
    return true;

  const statusText = String(match.statusText || "").toLowerCase();
  if (
    statusText.includes("live") ||
    statusText.includes("in play") ||
    statusText.includes("1st") ||
    statusText.includes("2nd") ||
    statusText.includes("half") ||
    statusText.includes("devre") ||
    statusText.includes("başladı") ||
    statusText.includes("basladi") ||
    statusText.includes("oynanıyor") ||
    statusText.includes("oynaniyor")
  ) {
    return true;
  }

  if (!match.date) return false;
  const ts = parseMatchDateTimestamp(match.date);
  if (Number.isNaN(ts)) return false;
  return Date.now() >= ts;
}

function isWeekStartedForPredictionReveal(weekId) {
  if (!weekId) return false;

  const manualState = getWeekPredictionManualState(weekId);
  if (manualState === "locked") return true;

  // Admin haftayı, normal otomatik kilit saati geçtikten sonra yeniden açmışsa
  // kullanıcılar tekrar tahmin girebilsin diye otomatik kilit/reveal kuralını
  // geçici olarak bastırırız. Maç gerçekten başladıysa tahminler yine görünür.
  if (manualState !== "open") {
    const weekLockTs = getWeekPredictionLockTimestamp(weekId);
    if (weekLockTs !== null && Date.now() >= weekLockTs) return true;
  }

  return getMatchesByWeekId(weekId).some((match) =>
    isMatchStartedForPredictionReveal(match),
  );
}

function canRevealPredictionForViewer(match, playerId) {
  if (getCurrentRole() === "admin") return true;
  if (String(playerId || "") === String(getCurrentPlayerId() || ""))
    return true;
  if (!match) return false;
  return isWeekStartedForPredictionReveal(match.weekId);
}

function getHiddenPredictionNotice(match) {
  return isMatchLocked(match)
    ? "Kilitli · Tahmin süresi kapanınca açılır"
    : "Adil oyun · Tahmin süresi kapanınca açılır";
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
    invalidatePredictionIndexCache();
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

function getWeekPublishTime(week) {
  const timestamp = Date.parse(week?.publishedAt || week?.completedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getPreferredWeekIdForSeason(seasonId) {
  const weeks = getWeeksBySeasonId(seasonId).slice();
  if (!weeks.length) return null;

  const byNewestPublication = (a, b) =>
    getWeekPublishTime(b) - getWeekPublishTime(a) ||
    Number(b.number) - Number(a.number);

  const activeWeeks = weeks
    .filter((week) => String(week.status || "") === "aktif")
    .sort(byNewestPublication);
  if (activeWeeks.length) return activeWeeks[0].id;

  const publishedWeeks = weeks
    .filter((week) => String(week.status || "hazirlaniyor") !== "hazirlaniyor")
    .sort(byNewestPublication);
  if (publishedWeeks.length) return publishedWeeks[0].id;

  // Admin hazırlık ekranlarında çalışmaya devam edebilsin; normal kullanıcıda
  // getWeeksBySeasonId zaten hazırlanıyor haftalarını filtreler.
  return (
    weeks.sort((a, b) => Number(b.number) - Number(a.number))[0]?.id || null
  );
}

function validateFreshActiveSelection({ forceNewestPublished = false } = {}) {
  const seasons = Array.isArray(state.seasons) ? state.seasons : [];
  const allEligibleWeeks = seasons.flatMap((season) =>
    getWeeksBySeasonId(season.id).map((week) => ({ season, week })),
  );

  const sortCandidates = (a, b) =>
    (String(b.week.status || "") === "aktif" ? 1 : 0) -
      (String(a.week.status || "") === "aktif" ? 1 : 0) ||
    getWeekPublishTime(b.week) - getWeekPublishTime(a.week) ||
    Number(b.week.number) - Number(a.week.number);

  const currentWeek = getWeekById(state.settings.activeWeekId);
  const currentIsEligible =
    currentWeek &&
    allEligibleWeeks.some(
      ({ week }) => String(week.id) === String(currentWeek.id),
    );

  if (!forceNewestPublished && currentIsEligible) {
    state.settings.activeSeasonId = currentWeek.seasonId;
    return currentWeek.id;
  }

  const preferred = allEligibleWeeks.sort(sortCandidates)[0] || null;
  state.settings.activeSeasonId =
    preferred?.season?.id || seasons[0]?.id || null;
  state.settings.activeWeekId = preferred?.week?.id || null;
  return state.settings.activeWeekId;
}

function forceDefaultLandingAfterLogin(reason = "login") {
  if (!state.settings) state.settings = {};

  state.settings.currentTab = "dashboard";

  const seasonId = getActiveSeasonId();
  if (seasonId) {
    state.settings.activeSeasonId = seasonId;
    state.settings.activeWeekId = getPreferredWeekIdForSeason(seasonId);
  }
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

const MATCH_FIRST_HALF_MINUTES = 45;
const MATCH_HALFTIME_MINUTES = 20;
const MATCH_SECOND_HALF_MINUTES = 45;
const MATCH_TOTAL_RUNTIME_MINUTES =
  MATCH_FIRST_HALF_MINUTES + MATCH_HALFTIME_MINUTES + MATCH_SECOND_HALF_MINUTES;

function getMatchRuntimeInfo(match, nowMs = Date.now()) {
  const startTs = parseMatchDateTimestamp(match?.date);
  if (Number.isNaN(startTs)) {
    return {
      startTs: NaN,
      diffMs: null,
      elapsedMs: null,
      minute: null,
      phase: "unknown",
      halftime: false,
    };
  }

  const diffMs = startTs - nowMs;
  const elapsedMs = nowMs - startTs;
  const elapsedMinutes = Math.floor(Math.max(0, elapsedMs) / 60000);

  if (diffMs > 0) {
    return {
      startTs,
      diffMs,
      elapsedMs,
      minute: null,
      phase: "waiting",
      halftime: false,
    };
  }

  if (elapsedMinutes < MATCH_FIRST_HALF_MINUTES) {
    const minute = Math.max(1, Math.min(45, elapsedMinutes + 1));
    return {
      startTs,
      diffMs,
      elapsedMs,
      minute,
      phase: "live",
      halftime: false,
    };
  }

  const halftimeEndsAt = MATCH_FIRST_HALF_MINUTES + MATCH_HALFTIME_MINUTES;
  if (elapsedMinutes < halftimeEndsAt) {
    return {
      startTs,
      diffMs,
      elapsedMs,
      minute: 45,
      phase: "halftime",
      halftime: true,
    };
  }

  if (elapsedMinutes < MATCH_TOTAL_RUNTIME_MINUTES) {
    const secondHalfElapsed = elapsedMinutes - halftimeEndsAt;
    const minute = Math.max(46, Math.min(90, 46 + secondHalfElapsed));
    return {
      startTs,
      diffMs,
      elapsedMs,
      minute,
      phase: "live",
      halftime: false,
    };
  }

  return {
    startTs,
    diffMs,
    elapsedMs,
    minute: null,
    phase: "finished-time",
    halftime: false,
  };
}

function getMatchVisualState(match) {
  if (match.played && match.wasPostponed) return "played-postponed";
  if (match.played) return "played";
  if (match.postponed) return "postponed";

  const statusText = String(match.statusText || "").toLowerCase();
  if (
    statusText.includes("finished") ||
    statusText.includes("full time") ||
    statusText.includes("bitti")
  ) {
    return "finished-time";
  }
  if (
    statusText.includes("live") ||
    statusText.includes("in play") ||
    statusText.includes("canlı")
  ) {
    return "live";
  }

  const runtime = getMatchRuntimeInfo(match);
  if (runtime.phase === "live" || runtime.phase === "halftime") return "live";
  if (runtime.phase === "finished-time") return "finished-time";
  if (isMatchLocked(match)) return "locked";
  return "waiting";
}

function getMatchBadge(match) {
  const visual = getMatchVisualState(match);
  if (visual === "played-postponed")
    return { text: "Ertelendi / Oynandı", cls: "info" };
  if (visual === "played") return { text: "Bitti", cls: "" };
  if (visual === "finished-time")
    return { text: "Sonuç Bekliyor", cls: "warn" };
  if (visual === "postponed") return { text: "Ertelendi", cls: "warn" };
  if (visual === "live") return { text: "Canlı", cls: "red" };
  if (visual === "locked") return { text: "🔒 Kilitli", cls: "red" };
  return { text: "Bekliyor", cls: "warn" };
}

function recalculateAllPoints() {
  const matchMap = new Map(state.matches.map((match) => [match.id, match]));
  state.predictions.forEach((pred) => {
    const match = matchMap.get(pred.matchId);
    const nextPoints =
      match && match.played
        ? calcPoints(
            pred.homePred,
            pred.awayPred,
            match.homeScore,
            match.awayScore,
          )
        : 0;
    if (pred.points !== nextPoints) pred.points = nextPoints;
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

function isMatchResolvedForScoring(match) {
  if (!match) return false;
  if (match.played) return true;

  const hasHomeScore =
    match.homeScore !== "" &&
    match.homeScore !== null &&
    match.homeScore !== undefined;
  const hasAwayScore =
    match.awayScore !== "" &&
    match.awayScore !== null &&
    match.awayScore !== undefined;
  return hasHomeScore && hasAwayScore;
}

function getResolvedWeekMatches(weekId) {
  return getMatchesByWeekId(weekId).filter((match) =>
    isMatchResolvedForScoring(match),
  );
}

function getWeeklyStandings(weekId) {
  const resolvedMatches = getResolvedWeekMatches(weekId);
  if (!resolvedMatches.length) return [];

  const matchIds = new Set(resolvedMatches.map((match) => match.id));

  return state.players
    .filter((player) => getPlayerRole(player) !== "admin")
    .map((player) => {
      const preds = state.predictions.filter(
        (p) => p.playerId === player.id && matchIds.has(p.matchId),
      );

      const predictionCount = preds.filter(
        (p) => p.homePred !== "" && p.awayPred !== "",
      ).length;

      return {
        id: player.id,
        name: player.name,
        total: preds.reduce((sum, p) => sum + Number(p.points || 0), 0),
        exact: preds.filter((p) => Number(p.points || 0) === 3).length,
        resultOnly: preds.filter((p) => Number(p.points || 0) === 1).length,
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
  if (!select) return;
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
  if (!select) return;
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
  if (!select) return;
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
  renderTeamOptions(
    document.getElementById("playerSupportedTeam"),
    activeSeasonId,
    true,
  );
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

const dashboardApiProgressState = {
  value: 0,
  label: "Beklemede",
  mode: "idle",
  timer: null,
};

function setDashboardApiProgress(
  value = 0,
  label = "Beklemede",
  mode = "idle",
) {
  dashboardApiProgressState.value = Math.max(
    0,
    Math.min(100, Number(value) || 0),
  );
  dashboardApiProgressState.label = label;
  dashboardApiProgressState.mode = mode;

  const fill = document.getElementById("dashboardApiProgressFill");
  const valueNode = document.getElementById("dashboardApiProgressValue");
  const labelNode = document.getElementById("dashboardApiProgressLabel");

  if (fill) {
    fill.style.width = `${dashboardApiProgressState.value}%`;
    fill.classList.remove("is-success", "is-error", "is-loading");

    const progressClass =
      mode === "success"
        ? "is-success"
        : mode === "error"
          ? "is-error"
          : mode === "loading"
            ? "is-loading"
            : null;

    if (progressClass) {
      fill.classList.add(progressClass);
    }
  }

  if (valueNode) {
    valueNode.textContent = `${Math.round(dashboardApiProgressState.value)}%`;
  }

  if (labelNode) {
    labelNode.textContent = label;
  }
}

function startDashboardApiProgress() {
  clearInterval(dashboardApiProgressState.timer);
  setDashboardApiProgress(12, "API bağlantısı kuruluyor...", "loading");
  dashboardApiProgressState.timer = setInterval(() => {
    const current = dashboardApiProgressState.value || 0;
    if (current >= 88) return;
    let nextValue = current + (current < 40 ? 14 : current < 65 ? 9 : 4);
    let nextLabel = "Seçili hafta kontrol ediliyor...";
    if (nextValue >= 35) nextLabel = "Maç skorları karşılaştırılıyor...";
    if (nextValue >= 65) nextLabel = "Yerel veriler güncelleniyor...";
    setDashboardApiProgress(nextValue, nextLabel, "loading");
  }, 420);
}

function finishDashboardApiProgress(success = true, message = "Hazır.") {
  clearInterval(dashboardApiProgressState.timer);
  dashboardApiProgressState.timer = null;
  if (success) {
    setDashboardApiProgress(100, "Tamamlandı", "success");
    setTimeout(() => {
      if (dashboardApiProgressState.mode === "success") {
        setDashboardApiProgress(0, "Beklemede", "idle");
      }
    }, 2200);
  } else {
    setDashboardApiProgress(100, "Hata", "error");
  }
  const status = document.getElementById("dashboardSyncStatus");
  if (status && message) status.textContent = message;
}

function formatDashboardAutoSyncTime(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return "Henüz yapılmadı";
  try {
    return new Date(value).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "Henüz yapılmadı";
  }
}

function ensureAutoSyncDebugStore() {
  if (!Array.isArray(window.__autoSyncDebugLog)) {
    window.__autoSyncDebugLog = [];
  }
  return window.__autoSyncDebugLog;
}

function logAutoSyncDebug() {}

function ensureAutoSyncDebugPanel() {
  return null;
}

function renderAutoSyncDebugPanel() {}

function ensureAutoSyncStatusObserver() {}

function renderDashboardAutoSyncStatus(message = "", forcedTimestamp = null) {
  const el = document.getElementById("dashboardAutoSyncStatus");
  if (!el) return;

  const lastSyncAt =
    forcedTimestamp != null
      ? Number(forcedTimestamp || 0)
      : Number(state.settings?.resultsLastAutoSyncAt || 0);

  const lockAt = Number(state.settings?.resultsAutoSyncInProgressAt || 0);
  const now = Date.now();
  const isRunning = lockAt && now - lockAt < 90 * 1000;

  let text = `🔄 Son API sonuç güncellemesi: ${formatDashboardAutoSyncTime(lastSyncAt)}`;
  let className = "dashboard-inline-status is-idle";

  if (isRunning) {
    text = "⏳ Sonuçlar arka planda kontrol ediliyor...";
    className = "dashboard-inline-status is-running";
  } else if (message) {
    text = `${message} • Son başarılı güncelleme: ${formatDashboardAutoSyncTime(lastSyncAt)}`;
    className = "dashboard-inline-status is-success";
  }

  el.className = className;
  el.textContent = text;
}

function renderDashboardSyncCard() {
  const season = getSeasonById(getActiveSeasonId());
  const week = getWeekById(state.settings.activeWeekId);
  const compactSeasonBadge = document.getElementById(
    "dashboardActiveSeasonBadge",
  );
  const compactWeekBadge = document.getElementById("dashboardActiveWeekBadge");
  const adminSeasonBadge = document.getElementById("dashboardAdminSeasonBadge");
  const adminWeekBadge = document.getElementById("dashboardAdminWeekBadge");
  const compactStatus = document.getElementById("dashboardSyncStatus");
  const adminStatus = document.getElementById("dashboardSyncAdminStatus");

  const statusText = isFirebaseReady()
    ? `Veri kaynağı: ${getOnlineSourceLabel()} • ${getSyncSummaryText()}`
    : "Veri kaynağı hazırlanıyor...";

  [compactSeasonBadge, adminSeasonBadge].forEach((node) => {
    if (node) node.textContent = `Aktif sezon: ${season?.name || "-"}`;
  });
  [compactWeekBadge, adminWeekBadge].forEach((node) => {
    if (node)
      node.textContent = `Aktif hafta: ${week ? `${week.number}. Hafta` : "-"}`;
  });
  if (compactStatus) compactStatus.textContent = statusText;
  if (adminStatus) adminStatus.textContent = statusText;

  renderDashboardAutoSyncStatus();
  setDashboardApiProgress(
    dashboardApiProgressState.value,
    dashboardApiProgressState.label,
    dashboardApiProgressState.mode,
  );
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

async function runDashboardWeekScoreUpdate(buttonOrEvent) {
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const season = getSeasonById(getActiveSeasonId());
  const week = getWeekById(state.settings.activeWeekId);
  if (!season || !week) {
    return showAlert("Önce aktif sezon ve aktif hafta seçmelisin.", {
      title: "Eksik seçim",
      type: "warning",
    });
  }

  setAsyncButtonState(actionButton, "loading", { loading: "Çekiliyor..." });
  startDashboardApiProgress();
  const status = document.getElementById("dashboardSyncStatus");
  if (status) {
    status.textContent = `${season.name} / ${week.number}. hafta skorları API'den çekiliyor...`;
  }

  try {
    await syncSelectedWeekFromApi();
    const adminWeekStatus =
      document.getElementById("weekApiStatus")?.textContent ||
      `${week.number}. hafta skorları güncellendi.`;
    finishDashboardApiProgress(true, adminWeekStatus);
    setAsyncButtonState(actionButton, "success", { success: "Tamamlandı" });
  } catch (error) {
    finishDashboardApiProgress(
      false,
      error?.message || "API işlemi başarısız oldu.",
    );
    setAsyncButtonState(actionButton, "error", { error: "Hata" });
  }
}

async function syncDashboardWeek() {
  const season = getSeasonById(getActiveSeasonId());
  const week = getWeekById(state.settings.activeWeekId);
  const status = document.getElementById("dashboardSyncAdminStatus");
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
  const status = document.getElementById("dashboardSyncAdminStatus");
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

function getPlayerSupportedTeamName(player) {
  if (!player) return "";
  const directName = String(
    player.supportedTeam || player.teamName || player.favoriteTeam || "",
  ).trim();
  if (directName) return directName;

  const teamId = String(player.teamId || "").trim();
  if (!teamId) return "";

  return state.teams.find((team) => String(team.id) === teamId)?.name || "";
}
function getPlayerSupportedTeamPalette(player) {
  const supportedTeam = getPlayerSupportedTeamName(player);
  if (!supportedTeam) {
    return {
      colorA: "rgba(88, 144, 255, 0.22)",
      colorB: "rgba(56, 189, 248, 0.12)",
      border: "rgba(98, 133, 197, 0.22)",
    };
  }

  const teamIndex = Math.max(0, DEFAULT_TEAM_NAMES.indexOf(supportedTeam));
  const palette = TEAM_COLORS[
    teamIndex >= 0
      ? teamIndex % TEAM_COLORS.length
      : Math.abs(String(supportedTeam || "").length) % TEAM_COLORS.length
  ] || ["#3b82f6", "#38bdf8"];

  const [colorA, colorB] = palette;

  return {
    colorA,
    colorB,
    border: colorA,
  };
}
function buildPlayerSupportedTeamOptions(player) {
  const selectedTeam = getPlayerSupportedTeamName(player);
  const teamNames = [
    ...new Set(
      state.teams.map((team) => String(team.name || "").trim()).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, "tr"));

  return [
    '<option value="">Takım seç</option>',
    ...teamNames.map(
      (teamName) =>
        `<option value="${escapeHtml(teamName)}" ${selectedTeam === teamName ? "selected" : ""}>${escapeHtml(teamName)}</option>`,
    ),
  ].join("");
}
function createPlayerCardAvatar(player, extraClass = "player-card-avatar") {
  if (typeof createGenericAvatarMarkup === "function") {
    return createGenericAvatarMarkup(player, extraClass);
  }

  const fallbackLetter = escapeHtml(
    String(player?.name || player?.username || "?")
      .trim()
      .charAt(0) || "?",
  );

  return `
    <span class="app-avatar ${extraClass}">
      <span class="app-avatar-fallback" style="display:flex;">${fallbackLetter}</span>
    </span>
  `;
}
function renderPlayers() {
  const container = document.getElementById("playersList");
  if (!state.players.length) {
    container.innerHTML = createEmptyState("Henüz kişi eklenmedi.");
    return;
  }

  container.innerHTML = `
    <div class="players-premium-grid players-summary-grid">
      ${state.players
        .map((player) => {
          if (getPlayerRole(player) === "admin") return "";
          const isAdminUser = getPlayerRole(player) === "admin";
          const presence = getPresenceStatusForUser(player.id);
          const statusClass = presence.isOnline ? "is-online" : "is-offline";
          const statusText = presence.isOnline ? "Online" : "Offline";
          const lastSeenText = presence.lastSeen
            ? formatAdminPanelDateTime(presence.lastSeen)
            : "Henüz giriş yok";
          const supportedTeam = getPlayerSupportedTeamName(player);
          const supportedPalette = getPlayerSupportedTeamPalette(player);

          const supportedTeamBackground = supportedTeam
            ? `
    <div class="player-card-supported-team-bg" aria-hidden="true">
      ${teamLogoHtml(supportedTeam, getActiveSeasonId(), "player-card-supported-team-bg__wrap")}
    </div>
  `
            : "";

          const teamGlowStyle = `
  --team-glow-a: ${supportedPalette.colorA};
  --team-glow-b: ${supportedPalette.colorB};
  --team-border-color: ${supportedPalette.border};
`;
          return `
          <div
  class="player-premium-card player-summary-card ${isAdminUser ? "is-admin" : ""} ${statusClass}"
  onclick="openPlayerDetailModal('${player.id}')"
  style="${teamGlowStyle}"
>
  <div class="player-card-glow"></div>
  ${supportedTeamBackground}
          ${supportedTeamBackground}

              <div class="player-card-top">
              <div class="player-card-title-row">
             
                <div class="player-card-title-row">
                <div class="player-card-title-main">
                  ${createPlayerCardAvatar(player, "player-card-avatar")}
                  <div class="player-card-title-copy">
                    <div class="player-card-name">${escapeHtml(player.name)}</div>
                    <div class="player-card-username">@${escapeHtml(player.username || player.name)}</div>
                  </div>
                </div>

              </div>

                  <div class="player-card-top-right">
                    ${isAdminUser ? '<span class="player-role-badge">Admin</span>' : player.panelAdmin ? '<span class="player-role-badge panel-admin">Panel Admin</span>' : ""}
                    <div class="player-presence-pill ${statusClass}">
                      <span class="player-presence-dot"></span>
                      <strong>${statusText}</strong>
                    </div>
                  </div>
                </div>

                <div class="player-card-stats">
                  <div class="player-stat-pill player-stat-pill-wide">
                    <span class="player-stat-label">Son giriş</span>
                    <strong>${lastSeenText}</strong>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}
window.__activePlayerDetailId = null;

function canManagePlayerProfile(player) {
  if (!player) return false;
  if (getCurrentRole() === "admin") return true;
  const currentPlayerId = normalizeEntityId(getCurrentPlayerId());
  return !!currentPlayerId && normalizeEntityId(player.id) === currentPlayerId;
}

function canEditOnlyOwnProfile(player) {
  if (!player || getCurrentRole() !== "user") return false;
  const currentPlayerId = normalizeEntityId(getCurrentPlayerId());
  return !!currentPlayerId && normalizeEntityId(player.id) === currentPlayerId;
}

function buildPlayerDetailModalContent(player) {
  if (!player) return "";

  const isAdminUser = getPlayerRole(player) === "admin";
  const isAdminMode = getCurrentRole() === "admin";
  const canManageThisProfile = canManagePlayerProfile(player);
  const isOwnUserProfile = canEditOnlyOwnProfile(player);
  const seasonStates = getPlayerSeasonStateMap(player);
  const predictionCount = state.predictions.filter(
    (p) => p.playerId === player.id && p.homePred !== "" && p.awayPred !== "",
  ).length;

  const seasonCards = [...state.seasons].sort((a, b) =>
    b.name.localeCompare(a.name, "tr"),
  );

  const seasonMembershipMarkup = !isAdminMode
    ? ""
    : isAdminUser
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
  const supportedTeam = getPlayerSupportedTeamName(player);
  const teamSelectorOptions = buildPlayerSupportedTeamOptions(player);

  const supportedTeamMarkup = supportedTeam
    ? `
      <div class="player-supported-team-hero has-team">
        <div class="player-supported-team-visual">
          ${teamLogoHtml(supportedTeam, getActiveSeasonId())}
        </div>
        <div class="player-supported-team-copy">
          <span class="player-supported-team-label">Tuttuğu takım</span>
          <strong>${escapeHtml(supportedTeam)}</strong>
        </div>
      </div>
    `
    : `
      <div class="player-supported-team-hero is-empty">
        <div class="player-supported-team-copy">
          <span class="player-supported-team-label">Tuttuğu takım</span>
          <strong>Henüz seçilmedi</strong>
        </div>
      </div>
    `;

  return `
    <div class="player-modal-sheet ${isAdminUser ? "is-admin" : ""} ${statusClass}">
      <div class="player-card-top">
      <div class="player-card-title-row">
      <div class="player-card-title-row">
      <div class="player-card-title-main player-card-title-main-lg">
        ${createPlayerCardAvatar(player, "player-card-avatar player-card-avatar-lg")}
        <div class="player-card-title-copy">
          <div class="player-card-name">${escapeHtml(player.name)}</div>
          <div class="player-card-username">@${escapeHtml(player.username || player.name)}</div>
        </div>
      </div>
      </div>
          <div class="player-card-top-right">
            ${isAdminUser ? '<span class="player-role-badge">Admin</span>' : player.panelAdmin ? '<span class="player-role-badge panel-admin">Panel Admin</span>' : ""}
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
          ${
            canManageThisProfile
              ? `
          <div class="player-stat-pill">
            <span class="player-stat-label">Şifre</span>
            <strong>${escapeHtml(player.password || "1234")}</strong>
          </div>
          `
              : ""
          }
          <div class="player-stat-pill">
            <span class="player-stat-label">Tahmin</span>
            <strong>${predictionCount}</strong>
          </div>
        </div>
      </div>

      <div class="player-card-team-block">
        <div class="player-card-section-title">Takım kartı</div>
        ${supportedTeamMarkup}
        ${
          canManageThisProfile
            ? `
        <div class="player-team-editor-row">
          <select id="player_team_${player.id}" class="player-team-select user-self-control">
            ${teamSelectorOptions}
          </select>
          <button class="small secondary user-self-control" onclick="savePlayerSupportedTeam('${player.id}', this)">Takımı Kaydet</button>
        </div>
        `
            : ""
        }
      </div>

      ${
        isAdminMode
          ? `
      <div class="player-card-seasons">
        <div class="player-card-section-title">Sezon katılımı</div>
        ${seasonMembershipMarkup}
      </div>
      `
          : ""
      }

      <div class="player-card-actions">
        ${
          isAdminMode
            ? `
          <button class="small secondary" onclick="renamePlayer('${player.id}', this)">Düzenle</button>
          <button class="small secondary" onclick="changePlayerPassword('${player.id}', this)">Ş. Değiştir</button>
          ${isAdminUser ? "" : `<button class="small secondary" onclick="togglePanelAdmin('${player.id}', this)">${player.panelAdmin ? "Admin Yetkisini Kaldır" : "Admin Yap"}</button>`}
          ${isAdminUser ? "" : `<button class="small secondary" onclick="forceLogoutUserSession('${player.id}', this)">Sistemden At</button>`}
          ${isAdminUser ? "" : `<button class="small danger" onclick="removePlayer('${player.id}', this)">Sil</button>`}
        `
            : isOwnUserProfile
              ? `
          <button class="small secondary user-self-control" onclick="changePlayerPassword('${player.id}', this)">Şifremi Değiştir</button>
        `
              : `
          <span class="player-readonly-note">Bu kart sadece görüntülenebilir.</span>
        `
        }
      </div>
    </div>
  `;
}

window.openPlayerDetailModal = function (playerId) {
  const modal = document.getElementById("playerDetailModal");
  const body = document.getElementById("playerDetailModalBody");
  const player = getPlayerById(playerId);
  if (!modal || !body || !player) return;

  window.__activePlayerDetailId = playerId;
  body.innerHTML = buildPlayerDetailModalContent(player);
  modal.classList.remove("hidden");
  document.body.classList.add("player-modal-open");
};

window.closePlayerDetailModal = function () {
  const modal = document.getElementById("playerDetailModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("player-modal-open");
  window.__activePlayerDetailId = null;
};
window.refreshPlayerDetailModal = function () {
  const modal = document.getElementById("playerDetailModal");
  const body = document.getElementById("playerDetailModalBody");
  const activePlayerId = window.__activePlayerDetailId;

  if (!modal || !body || !activePlayerId) return;
  if (modal.classList.contains("hidden")) return;

  const player = getPlayerById(activePlayerId);
  if (!player) {
    closePlayerDetailModal();
    return;
  }

  body.innerHTML = buildPlayerDetailModalContent(player);
};
window.savePlayerSupportedTeam = async function (playerId, buttonOrEvent) {
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const player = getPlayerById(playerId);
  const select = document.getElementById(`player_team_${playerId}`);
  if (!player || !select) return;

  if (!canManagePlayerProfile(player)) {
    return showAlert("Sadece kendi tuttuğun takımını değiştirebilirsin.", {
      title: "Yetki yok",
      type: "warning",
    });
  }

  const nextSupportedTeam = String(select.value || "").trim();

  if (useOnlineMode) {
    setAsyncButtonState(actionButton, "loading", {
      loading: "Kaydediliyor...",
      success: "Kaydedildi",
    });
    try {
      const result = await updateOnlineUser({
        id: player.id,
        supportedTeam: nextSupportedTeam,
      });
      if (!result?.success) {
        showAlert(result?.message || "Kullanıcının takımı kaydedilemedi.", {
          title: "Kayıt Hatası",
          type: "warning",
        });
        setAsyncButtonState(actionButton, "error", { error: "Hata" });
        return;
      }
      await syncUsersFromSheet();
      renderAll();
      refreshPlayerDetailModal();
      setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
      return;
    } catch (error) {
      console.error("Kullanıcı takım kaydetme hatası:", error);
      showAlert(error?.message || "Firebase güncellemesi başarısız.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
      setAsyncButtonState(actionButton, "error", { error: "Hata" });
      return;
    }
  }

  player.supportedTeam = nextSupportedTeam;
  saveState(true);
  renderAll();
  refreshPlayerDetailModal();
  setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
};

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
  refreshPlayerDetailModal();
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
      refreshPlayerDetailModal();
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
  refreshPlayerDetailModal();
  setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
};

window.togglePanelAdmin = async function (id, buttonOrEvent) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde admin yetkisi değiştirilemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const player = getPlayerById(id);
  if (!player) return;
  if (getPlayerRole(player) === "admin") {
    return showAlert("Ana admin hesabının yetkisi buradan değiştirilemez.", {
      title: "İşlem kapalı",
      type: "warning",
    });
  }

  const nextValue = player.panelAdmin !== true;
  const confirmText = nextValue ? "Admin yap" : "Yetkiyi kaldır";
  const message = nextValue
    ? `${player.name} kullanıcısına panel admin yetkisi verilsin mi? Bu kullanıcı tahmin oyuncusu olarak görünmeye devam eder ama yönetim ekranlarını da açabilir.`
    : `${player.name} kullanıcısının panel admin yetkisi kaldırılsın mı? Kullanıcı tahmin oyuncusu olarak kalır ama yönetim ekranlarına erişemez.`;

  if (
    !(await showConfirm(message, {
      title: nextValue
        ? "Panel admin verilsin mi?"
        : "Panel admin kaldırılsın mı?",
      type: "warning",
      confirmText,
    }))
  ) {
    return;
  }

  if (useOnlineMode) {
    setAsyncButtonState(actionButton, "loading", {
      loading: "Kaydediliyor...",
      success: "Kaydedildi",
    });
    try {
      const result = await updateOnlineUser({
        id: player.id,
        panelAdmin: nextValue,
      });
      if (!result?.success) {
        showAlert(result?.message || "Panel admin yetkisi güncellenemedi.", {
          title: "Kayıt Hatası",
          type: "warning",
        });
        setAsyncButtonState(actionButton, "error", { error: "Hata" });
        return;
      }
      if (
        currentSessionUser &&
        String(currentSessionUser.id) === String(player.id)
      ) {
        currentSessionUser.panelAdmin = nextValue;
        state.settings.auth.user = {
          ...(state.settings.auth.user || {}),
          panelAdmin: nextValue,
        };
      }
      await syncUsersFromSheet();
      renderAll();
      refreshPlayerDetailModal();
      setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
      showAlert(
        nextValue
          ? "Kullanıcı artık panel admin yetkisine sahip. Tahmin tablosunda görünmeye devam eder."
          : "Kullanıcının panel admin yetkisi kaldırıldı.",
        {
          title: "Başarılı",
          type: "success",
        },
      );
      return;
    } catch (error) {
      console.error("Panel admin güncelleme hatası:", error);
      showAlert(error?.message || "Firebase güncellemesi başarısız.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
      setAsyncButtonState(actionButton, "error", { error: "Hata" });
      return;
    }
  }

  player.panelAdmin = nextValue;
  if (
    currentSessionUser &&
    String(currentSessionUser.id) === String(player.id)
  ) {
    currentSessionUser.panelAdmin = nextValue;
    state.settings.auth.user = {
      ...(state.settings.auth.user || {}),
      panelAdmin: nextValue,
    };
  }
  saveState(true);
  renderAll();
  refreshPlayerDetailModal();
  setAsyncButtonState(actionButton, "success", { success: "Kaydedildi" });
};

window.changePlayerPassword = async function (id, buttonOrEvent) {
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const player = getPlayerById(id);
  if (!player) return;
  if (!canManagePlayerProfile(player))
    return showAlert("Sadece kendi şifreni değiştirebilirsin.", {
      title: "Yetki yok",
      type: "warning",
    });
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
      refreshPlayerDetailModal();
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
  refreshPlayerDetailModal();
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
      refreshPlayerDetailModal();
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
  refreshPlayerDetailModal();
  setAsyncButtonState(actionButton, "success", { success: "Silindi" });
};

/* 03-management-ui.js */

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
          <span>Stadyum dosya adı</span>
          <input type="text" value="${escapeHtml(getEffectiveMatchSceneSlug(team) || team.slug || slugify(team.name))}" oninput="markSeasonTeamSceneDraft('${team.id}', this.value)" placeholder="örn: galatasaray" />
        </label>
        <div class="inline-actions compact wrap-actions">
          <button class="small secondary" onclick="saveSeasonTeamSceneSlug('${team.id}', this)">Stadyum adını kaydet</button>
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

window.markSeasonTeamSceneDraft = function (teamId, value) {
  const team = getTeamById(teamId);
  if (!team) return;
  team._draftSceneSlug = String(value || "").trim();
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

window.saveSeasonTeamSceneSlug = async function (teamId, buttonOrEvent) {
  if (isReadOnlyMode()) {
    return showAlert("Kullanıcı görünümünde takım stadyumu düzenlenemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  }
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const team = getTeamById(teamId);
  if (!team) return;
  const nextSceneSlug = String(
    team._draftSceneSlug ||
      getEffectiveMatchSceneSlug(team) ||
      team.slug ||
      slugify(team.name) ||
      "",
  ).trim();
  if (!nextSceneSlug) {
    return showAlert("Stadyum dosya adı boş olamaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  }
  team.sceneSlug = nextSceneSlug.replace(/\.png$/i, "");
  team.stadiumSlug = team.sceneSlug;

  if (!state.settings || typeof state.settings !== "object")
    state.settings = {};
  if (
    !state.settings.teamSceneSlugs ||
    typeof state.settings.teamSceneSlugs !== "object"
  ) {
    state.settings.teamSceneSlugs = {};
  }
  const seasonId = String(team.seasonId || getActiveSeasonId() || "");
  const sceneKey = getMatchSceneOverrideKey(team.name);
  if (!state.settings.teamSceneSlugs[seasonId])
    state.settings.teamSceneSlugs[seasonId] = {};
  state.settings.teamSceneSlugs[seasonId][sceneKey] = {
    teamName: team.name,
    sceneSlug: team.sceneSlug,
    updatedAt: new Date().toISOString(),
  };

  delete team._draftSceneSlug;
  saveState(true);

  try {
    if (isFirebaseReady()) {
      await firebaseUpdate(`settings/teamSceneSlugs/${seasonId}`, {
        [sceneKey]: state.settings.teamSceneSlugs[seasonId][sceneKey],
      });
    }
    renderAll();
    setAsyncButtonState(actionButton, "success", {
      success: "Firebase'e kaydedildi",
    });
  } catch (error) {
    console.error("Stadyum dosya adı Firebase'e kaydedilemedi:", error);
    renderAll();
    showAlert(
      "Stadyum adı bu cihazda güncellendi ama Firebase'e yazılamadı. Rules tarafında settings yazma iznini kontrol et.",
      {
        title: "Firebase kayıt uyarısı",
        type: "warning",
      },
    );
    setAsyncButtonState(actionButton, "error", { error: "Firebase hatası" });
  }
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

      const seasonDeleteContext = {
        seasonId: String(id || ""),
        seasonName: String(season.name || ""),
        matchIds: remoteMatchIdsToDelete,
        weekIds: new Set(getWeeksBySeasonId(id).map((week) => String(week.id))),
      };

      const deleteSeasonRelatedRows = async (path) => {
        const map = (await firebaseRead(path).catch(() => null)) || {};
        const rows = firebaseSnapshotToArray(map);
        for (const row of rows) {
          const related =
            typeof isSeasonRelatedBackupRecord === "function"
              ? isSeasonRelatedBackupRecord(row, seasonDeleteContext)
              : normalizeText(
                  row.season || row.sezon || row.seasonName || "",
                ) === normalizeText(season.name || "") ||
                remoteMatchIdsToDelete.has(
                  String(row.matchId || row.localMatchId || "").trim(),
                );
          if (!related) continue;
          const rowKey = sanitizeFirebaseKey(row._firebaseKey || row.id || "");
          if (rowKey) await firebaseRemove(`${path}/${rowKey}`);
        }
      };

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

      await Promise.all([
        deleteSeasonRelatedRows("predictionLogs"),
        deleteSeasonRelatedRows("settings/auditLogs"),
        deleteSeasonRelatedRows("notificationLogs"),
        deleteSeasonRelatedRows("adminNotificationQueue"),
        deleteSeasonRelatedRows("sentNotifications"),
      ]);

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
  const sceneSlug = await showPrompt(
    "Stadyum dosya adı:",
    getEffectiveMatchSceneSlug(team) || slugify(name),
    {
      title: "Stadyum dosya adı",
      placeholder: "örn: galatasaray veya beşiktaş",
    },
  );
  team.name = name.trim();
  team.slug = (slug || slugify(name)).trim();
  team.sceneSlug = String(
    sceneSlug || getEffectiveMatchSceneSlug(team) || team.slug || slugify(name),
  )
    .trim()
    .replace(/\.png$/i, "");
  team.stadiumSlug = team.sceneSlug;
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

function getWeekStatusMeta(week) {
  const status = String(week?.status || "hazirlaniyor");
  if (status === "tamamlandi") {
    return {
      label: "Tamamlandı",
      className: "week-status-completed",
      icon: "⚫",
      detail: "Tüm maçlar oynandı",
    };
  }
  if (status === "aktif") {
    return {
      label: "Aktif",
      className: "week-status-active",
      icon: "🟢",
      detail: "Tahminler kullanıcılara açık",
    };
  }
  return {
    label: "Hazırlanıyor",
    className: "week-status-preparing",
    icon: "🟡",
    detail: "Henüz kullanıcılara yayınlanmadı",
  };
}

function renderWeeks() {
  const seasonId = getActiveSeasonId();
  const container = document.getElementById("weeksList");
  const weeks = getAllWeeksBySeasonId(seasonId);
  if (!weeks.length)
    return (container.innerHTML = createEmptyState("Henüz hafta eklenmedi."));

  container.innerHTML = `<div class="week-publish-list">${weeks
    .map((week) => {
      const matches = getMatchesByWeekId(week.id);
      const playedCount = matches.filter((match) => match.played).length;
      const meta = getWeekStatusMeta(week);
      const isPreparing =
        String(week.status || "hazirlaniyor") === "hazirlaniyor";
      const isActive = String(week.status || "") === "aktif";
      const publishedLabel = week.publishedAt
        ? `Yayınlandı: ${formatAdminPanelDateTime(week.publishedAt)}`
        : meta.detail;
      return `
        <article class="week-publish-card ${meta.className}">
          <div class="week-publish-main">
            <div class="week-publish-number"><span>${week.number}</span><small>HAFTA</small></div>
            <div class="week-publish-info">
              <div class="week-publish-title-row">
                <strong>${week.number}. Hafta</strong>
                <span class="week-status-chip"><b>${meta.icon}</b>${meta.label}</span>
              </div>
              <span class="week-publish-detail">${escapeHtml(publishedLabel)}</span>
              <div class="week-progress-line"><span style="width:${matches.length ? Math.round((playedCount / matches.length) * 100) : 0}%"></span></div>
              <small>${playedCount}/${matches.length} maç oynandı</small>
            </div>
          </div>
          <div class="week-publish-actions">
            ${isPreparing ? `<button class="small danger week-delete-btn" onclick="removeWeek('${week.id}')">🗑️ Sil</button>` : ""}
            ${isPreparing ? `<button class="week-publish-btn" onclick="publishWeek('${week.id}', this)">🚀 Haftayı Yayınla</button>` : ""}
            ${isActive ? `<button class="week-unpublish-btn" onclick="unpublishWeek('${week.id}', this)">📥 Yayından Kaldır</button>` : ""}
            ${String(week.status || "") === "tamamlandi" ? `<span class="week-locked-note">🔒 Kilitlendi</span>` : ""}
          </div>
        </article>`;
    })
    .join("")}</div>`;
}

async function queueWeekPublishedNotification(week) {
  if (!isFirebaseReady() || !week) return false;
  const season = getSeasonById(week.seasonId);
  const id = sanitizeFirebaseKey(`week_publish_${week.id}_${Date.now()}`);
  const now = new Date().toISOString();
  const iconMeta =
    typeof getAdminNotificationIconMeta === "function"
      ? getAdminNotificationIconMeta("announce")
      : { emoji: "📢" };
  const assetUrls =
    typeof getAdminNotificationAssetUrls === "function"
      ? getAdminNotificationAssetUrls("announce")
      : {};
  await firebaseWrite(`adminNotificationQueue/${id}`, {
    id,
    type: "week_published",
    status: "pending",
    title: `${week.number}. Hafta Yayınlandı!`,
    message: `${season?.name ? `${season.name} · ` : ""}${week.number}. hafta tahminlere açıldı. Tahminlerini yapmayı unutma, bol şans!`,
    target: "all",
    targetMode: "all",
    targetUserIds: [],
    icon: "announce",
    iconEmoji: iconMeta.emoji || "📢",
    iconUrl: assetUrls.iconUrl || "",
    badgeUrl: assetUrls.badgeUrl || "",
    seasonId: week.seasonId,
    season: season?.name || "",
    weekId: week.id,
    weekNo: Number(week.number || 0),
    createdAt: now,
    createdBy: getCurrentUsername?.() || "admin",
  });
  return true;
}

window.publishWeek = async function (id, actionButton = null) {
  if (isReadOnlyMode()) return;
  const week = getWeekById(id);
  if (!week || String(week.status || "hazirlaniyor") !== "hazirlaniyor") return;
  const matches = getMatchesByWeekId(id);
  if (!matches.length) {
    return showAlert(
      "Haftayı yayınlamadan önce maçları API'den getir veya manuel ekle.",
      {
        title: "Maç bulunamadı",
        type: "warning",
      },
    );
  }
  const confirmed = await showConfirm(
    `Bu hafta yayınlansın mı?\n\nKullanıcılara bildirim gönderilecektir.`,
    { title: "Haftayı Yayınla", type: "confirm", confirmText: "Yayınla" },
  );
  if (!confirmed) return;

  try {
    if (actionButton)
      setAsyncButtonState(actionButton, "loading", {
        loading: "Yayınlanıyor...",
      });

    // Maçları kullanıcıların okuduğu Firebase alanına yalnızca yayınlama anında aktar.
    // Hafta bu sırada hâlâ "hazirlaniyor" olduğundan kullanıcı ekranında görünmez.
    if (useOnlineMode) {
      window.__ALLOW_MATCH_WRITE__ = true;
      try {
        const syncResult = await syncWeekMatchesToSheet(week.id);
        if (!syncResult?.success) {
          throw new Error(
            syncResult?.message || "Hafta maçları Firebase'e aktarılamadı.",
          );
        }
      } finally {
        window.__ALLOW_MATCH_WRITE__ = false;
      }
    }

    week.status = "aktif";
    week.publishedAt = new Date().toISOString();
    week.publishedBy = getCurrentUsername?.() || "admin";
    state.settings.activeWeekId = week.id;
    state.settings.activeSeasonId = week.seasonId;
    saveState();
    if (isFirebaseReady()) {
      await persistWeekRegistryToFirebase();
      await queueWeekPublishedNotification(week);
    }
    if (typeof window.writeAppAuditLogEntry === "function") {
      const season = getSeasonById(week.seasonId);
      window.writeAppAuditLogEntry({
        actionType: "week_publish",
        actionLabel: "Hafta yayınlandı",
        detail: `${season?.name || "Sezon"} · ${week.number}. hafta yayınlandı`,
        entityType: "week",
        entityId: week.id,
        newValue: { status: "aktif", publishedAt: week.publishedAt },
      });
    }
    renderAll();
    showAlert(
      `${week.number}. hafta yayınlandı. Bildirim gönderim kuyruğuna alındı.`,
      {
        title: "Hafta yayında",
        type: "success",
      },
    );
  } catch (error) {
    week.status = "hazirlaniyor";
    week.publishedAt = "";
    saveState();
    renderAll();
    console.error("Hafta yayınlama hatası:", error);
    showAlert(error?.message || "Hafta yayınlanamadı.", {
      title: "Yayınlama hatası",
      type: "danger",
    });
  }
};

window.unpublishWeek = async function (id, actionButton = null) {
  if (isReadOnlyMode()) return;
  const week = getWeekById(id);
  if (!week || String(week.status || "") !== "aktif") return;

  const confirmed = await showConfirm(
    `Bu hafta yayından kaldırılacak.\n\nGirilen tahminler korunacaktır.`,
    {
      title: "Yayından Kaldır",
      type: "warning",
      confirmText: "Yayından Kaldır",
    },
  );
  if (!confirmed) return;

  const previousActiveWeekId = state.settings.activeWeekId;
  try {
    if (actionButton)
      setAsyncButtonState(actionButton, "loading", {
        loading: "Kaldırılıyor...",
      });
    week.status = "hazirlaniyor";
    week.publishedAt = "";
    week.publishedBy = "";

    if (state.settings.activeWeekId === week.id) {
      const replacementWeek = getAllWeeksBySeasonId(week.seasonId).find(
        (item) =>
          item.id !== week.id &&
          String(item.status || "hazirlaniyor") === "aktif",
      );
      state.settings.activeWeekId = replacementWeek?.id || null;
    }

    saveState();
    if (isFirebaseReady()) await persistWeekRegistryToFirebase();

    if (typeof window.writeAppAuditLogEntry === "function") {
      const season = getSeasonById(week.seasonId);
      window.writeAppAuditLogEntry({
        actionType: "week_unpublish",
        actionLabel: "Hafta yayından kaldırıldı",
        detail: `${season?.name || "Sezon"} · ${week.number}. hafta yayından kaldırıldı; tahminler korundu`,
        entityType: "week",
        entityId: week.id,
        oldValue: { status: "aktif" },
        newValue: { status: "hazirlaniyor" },
      });
    }

    renderAll();
    showAlert(
      `${week.number}. hafta yayından kaldırıldı. Girilen tahminler korunmuştur.`,
      {
        title: "Hafta yayından kaldırıldı",
        type: "success",
      },
    );
  } catch (error) {
    week.status = "aktif";
    state.settings.activeWeekId = previousActiveWeekId;
    saveState();
    renderAll();
    console.error("Haftayı yayından kaldırma hatası:", error);
    showAlert(error?.message || "Hafta yayından kaldırılamadı.", {
      title: "İşlem hatası",
      type: "danger",
    });
  }
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
  if (String(week.status || "hazirlaniyor") !== "hazirlaniyor") {
    return showAlert(
      "Yalnızca hazırlanıyor durumundaki haftalar silinebilir.",
      {
        title: "Hafta silinemez",
        type: "warning",
      },
    );
  }

  if (
    !(await showConfirm(
      `Bu hafta tamamen silinecek.\n\nDevam etmek istiyor musun?`,
      { title: "Sil", type: "danger", confirmText: "Sil" },
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
    if (isFirebaseReady()) {
      try {
        await persistWeekRegistryToFirebase();
      } catch (error) {
        console.warn("Hafta listesi Firebase'de güncellenemedi:", error);
      }
    }
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
  if (isDashboard) {
    renderDashboardMatchCards(container, matches);
    return;
  }
  container.innerHTML = `
    <div class="excel-table compact-table admin-matches-table ${isDashboard ? "dashboard-fixtures" : ""}">
      <div class="excel-thead ${isDashboard ? "dashboard-head" : ""}">
        <div>Maç</div><div>Skor</div><div>Durum</div><div>Tarih</div><div>Sonuç</div>${isDashboard ? "" : "<div>İşlem</div>"}
      </div>
      <div class="excel-tbody admin-matches-body">${matches
        .map((match) => {
          const badge = getMatchBadge(match);
          const visual = getMatchVisualState(match);
          const scoreText = match.played
            ? `${match.homeScore} - ${match.awayScore}`
            : "- -";
          const statusClass =
            match.played ||
            visual === "played" ||
            visual === "finished-time" ||
            visual === "played-postponed"
              ? "is-played"
              : visual === "live"
                ? "is-live"
                : "is-waiting";
          return `
        <div class="excel-tr match-tr admin-match-row ${statusClass} ${match.played ? "played-row" : ""} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}">
          <div class="admin-match-fixture">
            <div class="admin-match-teams">
              <div class="admin-match-team">
                ${teamLogoHtml(match.homeTeam, match.seasonId)}
                <strong>${escapeHtml(match.homeTeam)}</strong>
              </div>
              <div class="admin-match-score-mobile">${escapeHtml(scoreText)}</div>
              <div class="admin-match-team admin-match-team-away">
                ${teamLogoHtml(match.awayTeam, match.seasonId)}
                <strong>${escapeHtml(match.awayTeam)}</strong>
              </div>
            </div>
          </div>
          <div class="admin-match-score-cell"><span class="score-box slim">${escapeHtml(scoreText)}</span></div>
          <div class="admin-match-status-cell"><span class="badge ${badge.cls}">${badge.text}</span></div>
          <div class="admin-match-date small-meta">${formatDate(match.date)}</div>
          <div class="admin-match-result-cell">
            <div class="score-inputs compact-inputs admin-score-inputs">
              <input type="number" min="0" id="homeScore_${match.id}" value="${match.played ? match.homeScore : ""}" oninput="queueResultSave('${match.id}')" aria-label="${escapeHtml(match.homeTeam)} skoru" />
              <span>-</span>
              <input type="number" min="0" id="awayScore_${match.id}" value="${match.played ? match.awayScore : ""}" oninput="queueResultSave('${match.id}')" aria-label="${escapeHtml(match.awayTeam)} skoru" />
              <span class="auto-save-note">${match.manualScoreLocked ? "🔒 Manuel" : "Otomatik"}</span>
            </div>
          </div>
          ${
            isDashboard
              ? ""
              : `
            <div class="match-action-buttons admin-match-actions">
              <button class="small secondary" onclick="editMatch('${match.id}')">Düzenle</button>
              ${match.played ? `<button class="small secondary" onclick="clearMatchScore('${match.id}')">Skoru Temizle</button>` : ""}
              <button class="small danger" onclick="removeMatch('${match.id}')">Sil</button>
            </div>
          `
          }        </div>`;
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
  // Admin tarafından girilen skor API sonucundan daha yüksek önceliklidir.
  match.manualScoreLocked = true;
  match.manualScoreUpdatedAt = new Date().toISOString();
  match.manualScoreUpdatedBy = getCurrentUsername?.() || "admin";
  recalculateAllPoints();
  saveState();
  renderAll();

  if (!useOnlineMode || !shouldPublishMatchChanges(match.weekId)) return;

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
async function saveSingleMatchChange(match, successMessage, options = {}) {
  recalculateAllPoints();
  saveState();
  renderAll();

  if (!useOnlineMode || !shouldPublishMatchChanges(match.weekId)) {
    showAlert(successMessage, {
      title: "İşlem tamamlandı",
      type: "success",
    });
    return;
  }

  try {
    window.__ALLOW_MATCH_WRITE__ = true;

    await sendMatchesToSheet([match], {
      force: true,
      allowManualScoreUnlock: options.allowManualScoreUnlock === true,
      allowScoreClear: options.allowScoreClear === true,
    });

    await syncOnlineMatchesFromSheet({
      seasonId: match.seasonId,
      seasonLabel: getSeasonById(match.seasonId)?.name || "",
      silent: true,
    });

    recalculateAllPoints();
    saveState();
    renderAll();

    showAlert(successMessage, {
      title: "İşlem tamamlandı",
      type: "success",
    });
  } catch (error) {
    console.error("Maç güncelleme hatası:", error);
    showAlert(
      "Değişiklik yerelde kaydedildi ama Firebase'e yazılırken hata oluştu.",
      {
        title: "Senkron hatası",
        type: "warning",
      },
    );
  } finally {
    window.__ALLOW_MATCH_WRITE__ = false;
  }
}

function toMatchDatetimeLocalValue(dateValue) {
  if (!dateValue) return "";

  const text = String(dateValue).trim();

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    return text.slice(0, 16);
  }

  const d = new Date(text);
  if (isNaN(d.getTime())) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openMatchEditModal(match) {
  return new Promise((resolve) => {
    const oldModal = document.getElementById("matchEditModal");
    if (oldModal) oldModal.remove();

    const modal = document.createElement("div");
    modal.id = "matchEditModal";
    modal.className = "match-edit-modal";

    modal.innerHTML = `
      <div class="match-edit-card">
        <h3>Maçı Düzenle</h3>

        <label>Ev sahibi</label>
        <input id="editMatchHomeTeam" type="text" value="${escapeHtml(match.homeTeam || "")}" />

        <label>Deplasman</label>
        <input id="editMatchAwayTeam" type="text" value="${escapeHtml(match.awayTeam || "")}" />

        <label>Maç tarihi / saati</label>
        <input id="editMatchDate" type="datetime-local" value="${toMatchDatetimeLocalValue(match.date)}" />

        <label class="match-edit-check">
          <input id="editMatchClearScore" type="checkbox" />
          Test skorunu temizle ve maçı bekliyor yap
        </label>

        <div class="match-edit-actions">
          <button class="secondary" id="matchEditCancelBtn">Vazgeç</button>
          <button id="matchEditSaveBtn">Kaydet</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = (value) => {
      modal.remove();
      resolve(value);
    };

    modal.querySelector("#matchEditCancelBtn").onclick = () => close(null);

    modal.querySelector("#matchEditSaveBtn").onclick = () => {
      close({
        homeTeam: modal.querySelector("#editMatchHomeTeam").value.trim(),
        awayTeam: modal.querySelector("#editMatchAwayTeam").value.trim(),
        date: modal.querySelector("#editMatchDate").value.trim(),
        clearScore: modal.querySelector("#editMatchClearScore").checked,
      });
    };
  });
}

function toMatchDatetimeLocalValue(dateValue) {
  if (!dateValue) return "";

  const text = String(dateValue).trim();

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    return text.slice(0, 16);
  }

  const d = new Date(text);
  if (isNaN(d.getTime())) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openMatchEditModal(match) {
  return new Promise((resolve) => {
    const oldModal = document.getElementById("matchEditModal");
    if (oldModal) oldModal.remove();

    const modal = document.createElement("div");
    modal.id = "matchEditModal";
    modal.className = "match-edit-modal";

    modal.innerHTML = `
      <div class="match-edit-card">
        <h3>Maçı Düzenle</h3>

        <label>Ev sahibi</label>
        <input id="editMatchHomeTeam" type="text" value="${escapeHtml(match.homeTeam || "")}" />

        <label>Deplasman</label>
        <input id="editMatchAwayTeam" type="text" value="${escapeHtml(match.awayTeam || "")}" />

        <label>Maç tarihi / saati</label>
        <input id="editMatchDate" type="datetime-local" value="${toMatchDatetimeLocalValue(match.date)}" />

        <label class="match-edit-check">
          <input id="editMatchClearScore" type="checkbox" />
          Test skorunu temizle ve maçı bekliyor yap
        </label>

        <div class="match-edit-actions">
          <button class="secondary" id="matchEditCancelBtn">Vazgeç</button>
          <button id="matchEditSaveBtn">Kaydet</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = (value) => {
      modal.remove();
      resolve(value);
    };

    modal.querySelector("#matchEditCancelBtn").onclick = () => close(null);

    modal.querySelector("#matchEditSaveBtn").onclick = () => {
      close({
        homeTeam: modal.querySelector("#editMatchHomeTeam").value.trim(),
        awayTeam: modal.querySelector("#editMatchAwayTeam").value.trim(),
        date: modal.querySelector("#editMatchDate").value.trim(),
        clearScore: modal.querySelector("#editMatchClearScore").checked,
      });
    };
  });
}

window.editMatch = async function (matchId) {
  if (isReadOnlyMode()) {
    return showAlert("Kullanıcı görünümünde maç düzenlenemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  }

  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return;

  const form = await openMatchEditModal(match);
  if (!form) return;

  if (!form.homeTeam || !form.awayTeam || !form.date) {
    return showAlert("Takım ve tarih alanları boş olamaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  }

  if (form.homeTeam === form.awayTeam) {
    return showAlert("Ev sahibi ve deplasman aynı olamaz.", {
      title: "Geçersiz maç",
      type: "warning",
    });
  }

  match.homeTeam = form.homeTeam;
  match.awayTeam = form.awayTeam;
  match.date = form.date;

  if (form.clearScore) {
    match.homeScore = null;
    match.awayScore = null;
    match.played = false;
    match.manualScoreLocked = false;
  }

  await saveSingleMatchChange(match, "Maç bilgileri güncellendi.");
};

window.clearMatchScore = async function (matchId) {
  if (isReadOnlyMode()) {
    return showAlert("Kullanıcı görünümünde skor temizlenemez.", {
      title: "Yetki yok",
      type: "warning",
    });
  }

  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return;

  const ok = await showConfirm(
    `${match.homeTeam} - ${match.awayTeam} maçının skorunu temizlemek istiyor musun?`,
    {
      title: "Skor temizlensin mi?",
      type: "warning",
      confirmText: "Temizle",
    },
  );

  if (!ok) return;

  match.homeScore = null;
  match.awayScore = null;
  match.played = false;
  // Skor temizlenince manuel kilit de kalkar; kontrol tekrar TheSportsDB'ye geçer.
  match.manualScoreLocked = false;
  match.manualScoreUpdatedAt = null;
  match.manualScoreUpdatedBy = null;

  let apiScoreRestored = false;
  try {
    const season = getSeasonById(match.seasonId);
    const seasonLabel = String(season?.name || getApiSeasonLabel() || "").trim();
    if (seasonLabel) {
      const events = await fetchSeasonEvents(seasonLabel);
      const apiEvent = events.find(
        (event) =>
          (match.apiId && String(event.apiId) === String(match.apiId)) ||
          (normalizeText(event.homeTeam) === normalizeText(match.homeTeam) &&
            normalizeText(event.awayTeam) === normalizeText(match.awayTeam)),
      );
      if (apiEvent) {
        applyApiEventToMatch(match, apiEvent);
        apiScoreRestored = !!match.played;
      }
    }
  } catch (error) {
    console.warn("Skor temizlendikten sonra API skoru yeniden alınamadı:", error);
  }

  await saveSingleMatchChange(
    match,
    apiScoreRestored
      ? "Manuel skor temizlendi; güncel API skoru yeniden alındı."
      : "Manuel skor temizlendi. Maç yeniden API güncellemesine açıldı.",
    { allowManualScoreUnlock: true, allowScoreClear: true },
  );
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
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const r = Math.max(
    0,
    Math.min(Number(radius) || 0, safeWidth / 2, safeHeight / 2),
  );
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + safeWidth, y, x + safeWidth, y + safeHeight, r);
  ctx.arcTo(x + safeWidth, y + safeHeight, x, y + safeHeight, r);
  ctx.arcTo(x, y + safeHeight, x, y, r);
  ctx.arcTo(x, y, x + safeWidth, y, r);
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const shareLogoImageCache = new Map();

function getCanvasSafeTeamLogoUrl(src) {
  const cleanSrc = String(src || "").trim();
  if (!cleanSrc) return "";
  if (/^(data:|blob:)/i.test(cleanSrc)) return cleanSrc;

  const proxyUrl = new URL("https://wsrv.nl/");
  proxyUrl.searchParams.set("url", cleanSrc);
  proxyUrl.searchParams.set("w", "256");
  proxyUrl.searchParams.set("h", "256");
  proxyUrl.searchParams.set("fit", "contain");
  proxyUrl.searchParams.set("output", "png");
  return proxyUrl.toString();
}

function getTeamLogoCandidateSources(teamName, seasonId = getActiveSeasonId()) {
  const directUrl = getTeamLogoUrl(teamName, seasonId);
  if (!directUrl) return [];

  const canvasSafeUrl = getCanvasSafeTeamLogoUrl(directUrl);
  return [...new Set([canvasSafeUrl, directUrl].filter(Boolean))];
}

function loadCanvasImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);

    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };

    const timeoutId = window.setTimeout(() => finish(null), 12000);
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = src;
  });
}

async function getTeamLogoImage(teamName, seasonId = getActiveSeasonId()) {
  const cacheKey = `${seasonId || "global"}__${normalizeText(teamName || "")}`;
  if (shareLogoImageCache.has(cacheKey)) {
    return await shareLogoImageCache.get(cacheKey);
  }

  const logoPromise = (async () => {
    for (const src of getTeamLogoCandidateSources(teamName, seasonId)) {
      const img = await loadCanvasImage(src);
      if (img) return img;
    }
    return null;
  })();

  shareLogoImageCache.set(cacheKey, logoPromise);

  const result = await logoPromise;
  if (!result) shareLogoImageCache.delete(cacheKey);
  return result;
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
  const centerX = x + size / 2,
    centerY = y + size / 2;
  const [colorA, colorB] = getTeamPalette(teamName);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = Math.max(18, size * 0.28);
  ctx.shadowOffsetY = Math.max(6, size * 0.08);
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2 - 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = colorA;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  if (logoImg) {
    const nw = Math.max(1, logoImg.naturalWidth || logoImg.width || size);
    const nh = Math.max(1, logoImg.naturalHeight || logoImg.height || size);
    const inset = Math.max(4, Math.round(size * 0.05));
    const avail = size - inset * 2;
    const s = Math.min(avail / nw, avail / nh);
    const dw = nw * s,
      dh = nh * s;
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, centerX - dw / 2, centerY - dh / 2, dw, dh);
    const shine = ctx.createRadialGradient(
      centerX,
      centerY - size * 0.15,
      size * 0.05,
      centerX,
      centerY,
      size / 2,
    );
    shine.addColorStop(0, "rgba(255,255,255,0.18)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, size, size);
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, colorA);
    g.addColorStop(1, colorB);
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `900 ${Math.max(18, Math.round(size * 0.28))}px Inter, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const t =
      teamInitials(teamName) ||
      String(teamName || "?")
        .slice(0, 3)
        .toUpperCase();
    ctx.fillText(t, centerX, centerY + 1);
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2 - 1, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
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
  const headerH = 142;
  const gradient = ctx.createLinearGradient(x, y, x + width, y + headerH);
  gradient.addColorStop(0, "#0f2b55");
  gradient.addColorStop(0.52, "#0b1e3c");
  gradient.addColorStop(1, "#07162c");

  ctx.save();
  ctx.shadowColor = "rgba(2,6,23,0.42)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  fillRoundedRect(
    ctx,
    x,
    y,
    width,
    headerH,
    30,
    gradient,
    "rgba(125,211,252,0.18)",
  );
  ctx.restore();

  fillRoundedRect(
    ctx,
    x + 26,
    y + 24,
    176,
    34,
    17,
    "rgba(56,189,248,0.15)",
    "rgba(125,211,252,0.26)",
  );
  ctx.fillStyle = "#7dd3fc";
  ctx.font = "900 15px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TAHMİN ARENASI", x + 114, y + 47);

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 48px Inter, Arial, sans-serif";
  ctx.fillText(title, x + 26, y + 104);

  ctx.fillStyle = "#a9bdd8";
  ctx.font = "700 20px Inter, Arial, sans-serif";
  ctx.fillText(
    truncateCanvasText(ctx, subtitle, width - 420),
    x + 288,
    y + 103,
  );

  fillRoundedRect(
    ctx,
    x + width - 174,
    y + 37,
    142,
    54,
    27,
    "rgba(2,6,23,0.38)",
    "rgba(255,255,255,0.16)",
  );
  ctx.fillStyle = "#e0f2fe";
  ctx.font = "900 18px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(pageText, x + width - 103, y + 70);
  ctx.textAlign = "left";
}

function getShareCellPalette(pred, match, shareView) {
  const hasPrediction =
    pred &&
    pred.homePred !== "" &&
    pred.homePred !== null &&
    pred.homePred !== undefined &&
    pred.awayPred !== "" &&
    pred.awayPred !== null &&
    pred.awayPred !== undefined;

  if (!hasPrediction) {
    return {
      bg: "rgba(30,41,59,0.72)",
      border: "rgba(148,163,184,0.20)",
      accent: "#94a3b8",
      icon: "—",
      label: "-",
      pointsText: "",
    };
  }

  if (shareView === "pre" || !match.played) {
    return {
      bg: "rgba(14,38,69,0.92)",
      border: "rgba(56,189,248,0.30)",
      accent: "#e0f2fe",
      icon: "•",
      label: "Tahmin",
      pointsText: "",
    };
  }

  const points = Number(pred.points || 0);
  if (points >= 3) {
    return {
      bg: "rgba(20,83,45,0.86)",
      border: "rgba(74,222,128,0.52)",
      accent: "#dcfce7",
      icon: "🏆",
      label: "Tam tahmin",
      pointsText: `${points} Puan`,
    };
  }
  if (points >= 1) {
    return {
      bg: "rgba(133,77,14,0.86)",
      border: "rgba(250,204,21,0.52)",
      accent: "#fef3c7",
      icon: "🎯",
      label: "Sonucu bilen",
      pointsText: `${points} Puan`,
    };
  }

  // Maç sonu görselinde puan kazandırmayan tahminleri "yakın" diye
  // işaretlemek yanıltıcı oluyor. Sonuç türü yanlışsa skor farkına
  // bakılmaksızın kırmızı/yanlış gösterilir.
  return {
    bg: "rgba(127,29,29,0.82)",
    border: "rgba(248,113,113,0.44)",
    accent: "#fee2e2",
    icon: "✖",
    label: "Yanlış",
    pointsText: "0 Puan",
  };
}

function drawPredictionShareStandingsPanel(
  ctx,
  x,
  y,
  width,
  weeklyStandings,
  generalStandings,
  players,
) {
  const weeklyMap = new Map(
    weeklyStandings.map((row, index) => [
      String(row.id),
      { ...row, rank: index + 1 },
    ]),
  );
  const generalMap = new Map(
    generalStandings.map((row, index) => [
      String(row.id),
      { ...row, rank: index + 1 },
    ]),
  );

  const rows = players
    .map((player) => {
      const weekly = weeklyMap.get(String(player.id));
      const general = generalMap.get(String(player.id));
      return {
        id: player.id,
        name: player.name,
        weekly: Number(weekly?.total || 0),
        general: Number(general?.total || 0),
        weeklyRank: weekly?.rank || 9999,
        generalRank: general?.rank || 9999,
        exact: Number(weekly?.exact || 0),
        resultOnly: Number(weekly?.resultOnly || 0),
      };
    })
    .sort(
      (a, b) =>
        a.weeklyRank - b.weeklyRank ||
        b.weekly - a.weekly ||
        a.generalRank - b.generalRank ||
        b.general - a.general ||
        String(a.name || "").localeCompare(String(b.name || ""), "tr"),
    );

  const padding = 20;
  const titleH = 112;
  const columnsH = 38;
  const rowH = 64;
  const rowGap = 7;
  const bottomH = 102;
  const panelH =
    padding * 2 +
    titleH +
    columnsH +
    rows.length * rowH +
    Math.max(0, rows.length - 1) * rowGap +
    bottomH;

  const panelGradient = ctx.createLinearGradient(x, y, x, y + panelH);
  panelGradient.addColorStop(0, "rgba(14,39,72,0.99)");
  panelGradient.addColorStop(0.48, "rgba(8,25,49,0.99)");
  panelGradient.addColorStop(1, "rgba(5,17,34,0.99)");

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.48)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  fillRoundedRect(
    ctx,
    x,
    y,
    width,
    panelH,
    26,
    panelGradient,
    "rgba(125,211,252,0.20)",
  );
  ctx.restore();

  const titleGradient = ctx.createLinearGradient(x, y, x + width, y + titleH);
  titleGradient.addColorStop(0, "rgba(14,116,144,0.30)");
  titleGradient.addColorStop(1, "rgba(30,64,175,0.12)");
  fillRoundedRect(
    ctx,
    x + 12,
    y + 12,
    width - 24,
    titleH - 10,
    20,
    titleGradient,
    "rgba(125,211,252,0.18)",
  );

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#7dd3fc";
  ctx.font = "900 14px Inter, Arial, sans-serif";
  ctx.fillText("PUAN DURUMU", x + 30, y + 45);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 29px Inter, Arial, sans-serif";
  ctx.fillText("Haftalık Sıralama", x + 30, y + 80);
  ctx.fillStyle = "#9fb6d2";
  ctx.font = "700 13px Inter, Arial, sans-serif";
  ctx.fillText("Hafta ve sezon toplamı birlikte", x + 30, y + 101);

  let cursorY = y + padding + titleH;
  ctx.fillStyle = "#7892b2";
  ctx.font = "900 11px Inter, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("SIRA  KULLANICI", x + padding + 6, cursorY + 23);
  ctx.textAlign = "center";
  ctx.fillText("HAFTA", x + width - 112, cursorY + 23);
  ctx.fillText("GENEL", x + width - 45, cursorY + 23);
  cursorY += columnsH;

  rows.forEach((row, index) => {
    const rank = index + 1;
    const isLeader = rank === 1;
    const rowGradient = ctx.createLinearGradient(
      x + padding,
      cursorY,
      x + width - padding,
      cursorY + rowH,
    );
    if (rank === 1) {
      rowGradient.addColorStop(0, "rgba(146,91,12,0.96)");
      rowGradient.addColorStop(1, "rgba(91,54,7,0.90)");
    } else if (rank === 2) {
      rowGradient.addColorStop(0, "rgba(71,85,105,0.88)");
      rowGradient.addColorStop(1, "rgba(42,55,75,0.88)");
    } else if (rank === 3) {
      rowGradient.addColorStop(0, "rgba(120,65,34,0.88)");
      rowGradient.addColorStop(1, "rgba(72,43,30,0.88)");
    } else {
      rowGradient.addColorStop(0, "rgba(15,45,77,0.88)");
      rowGradient.addColorStop(1, "rgba(10,30,57,0.88)");
    }

    fillRoundedRect(
      ctx,
      x + padding,
      cursorY,
      width - padding * 2,
      rowH,
      14,
      rowGradient,
      isLeader
        ? "rgba(250,204,21,0.50)"
        : "rgba(125,211,252,0.12)",
    );

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = isLeader ? "#fde68a" : "#b9cbe0";
    ctx.font = `${isLeader ? "900" : "800"} 18px Inter, Arial, sans-serif`;
    const rankText = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : String(rank);
    ctx.fillText(rankText, x + padding + 26, cursorY + rowH / 2);

    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 14px Inter, Arial, sans-serif";
    ctx.fillText(
      truncateCanvasText(ctx, String(row.name || "").toUpperCase(), 112),
      x + padding + 52,
      cursorY + 24,
    );
    ctx.fillStyle = isLeader ? "#fde68a" : "#89a2bf";
    ctx.font = "700 10px Inter, Arial, sans-serif";
    ctx.fillText(
      `Tam ${row.exact}  •  Sonuç ${row.resultOnly}`,
      x + padding + 52,
      cursorY + 45,
    );

    ctx.textAlign = "center";
    ctx.fillStyle = isLeader ? "#fef3c7" : "#dbeafe";
    ctx.font = "900 19px Inter, Arial, sans-serif";
    ctx.fillText(`${row.weekly}P`, x + width - 112, cursorY + rowH / 2);
    ctx.fillStyle = "#93c5fd";
    ctx.font = "900 17px Inter, Arial, sans-serif";
    ctx.fillText(`${row.general}P`, x + width - 45, cursorY + rowH / 2);

    cursorY += rowH + rowGap;
  });

  cursorY += 16;
  fillRoundedRect(
    ctx,
    x + padding,
    cursorY,
    width - padding * 2,
    72,
    18,
    "rgba(2,6,23,0.42)",
    "rgba(255,255,255,0.10)",
  );
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#8fa8c5";
  ctx.font = "800 11px Inter, Arial, sans-serif";
  ctx.fillText("HAFTA LİDERİ", x + padding + 18, cursorY + 26);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 17px Inter, Arial, sans-serif";
  ctx.fillText(
    truncateCanvasText(ctx, String(rows[0]?.name || "Henüz yok").toUpperCase(), 160),
    x + padding + 18,
    cursorY + 51,
  );
  ctx.textAlign = "right";
  ctx.fillStyle = "#fde68a";
  ctx.font = "900 24px Inter, Arial, sans-serif";
  ctx.fillText(`${rows[0]?.weekly || 0} PUAN`, x + width - padding - 18, cursorY + 49);
  ctx.textAlign = "left";
}

async function createPredictionShareExportCanvas(
  matches,
  players,
  options = {},
) {
  const shareView = options.shareView === "post" ? "post" : "pre";
  const seasonId = getActiveSeasonId();
  const seasonName = getSeasonById(seasonId)?.name || "Sezon";
  const weekNumber = getWeekNumberById(state.settings.activeWeekId) || "?";
  const pageIndex = Number(options.pageIndex || 0);
  const totalPages = Number(options.totalPages || 1);
  const weeklyStandings =
    shareView === "post" ? getWeeklyStandings(state.settings.activeWeekId) : [];
  const generalStandings =
    shareView === "post" ? getGeneralStandings(seasonId) : [];
  const weekLeader = weeklyStandings[0] || null;
  const margin = 42;
  const gridContentW = 1600 - margin * 2;
  const standingsPanelGap = 24;
  const standingsPanelW = 400;
  const width =
    shareView === "post"
      ? margin * 2 + gridContentW + standingsPanelGap + standingsPanelW
      : 1600;
  const contentW = width - margin * 2;

  const headerH = 150;
  const topGap = 22;

  const columns = 3;

  /* Kartlar arası boşluğu artır */
  const cardGap = 28;

  const cardW = (gridContentW - cardGap * (columns - 1)) / columns;

  const playerRowH = shareView === "post" ? 48 : 46;
  const playerGap = 5;

  /* Kartın iç boşluğu artsın */
  const cardPadding = 20;

  /* Üst alan biraz küçülsün */
  const matchTopH = 210;

  const cardH =
    cardPadding * 2 +
    matchTopH +
    players.length * playerRowH +
    Math.max(0, players.length - 1) * playerGap;

  const gridRows = Math.max(1, Math.ceil(matches.length / columns));
  const gridBlockH =
    gridRows * cardH + Math.max(0, gridRows - 1) * cardGap;
  const standingsPanelH =
    shareView === "post" ? 285 + players.length * 71 : 0;
  const mainContentH = Math.max(gridBlockH, standingsPanelH);

  const leaderH = shareView === "post" && weekLeader ? 185 : 0;
  const leaderGap = leaderH ? 22 : 0;

  const footerH = 48;

  const height =
    margin +
    headerH +
    topGap +
    mainContentH +
    leaderGap +
    leaderH +
    footerH +
    margin;
  const uniqueTeams = [
    ...new Set(
      matches
        .flatMap((match) => [match.homeTeam, match.awayTeam])
        .filter(Boolean),
    ),
  ];
  await Promise.all(
    uniqueTeams.map((teamName) => getTeamLogoImage(teamName, seasonId)),
  );

  const canvas = document.createElement("canvas");
  const exportScale = Math.max(
    2,
    Math.min(3, Math.round(window.devicePixelRatio || 2)),
  );
  canvas.width = width * exportScale;
  canvas.height = height * exportScale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.scale(exportScale, exportScale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#020b18");
  bg.addColorStop(0.5, "#071a32");
  bg.addColorStop(1, "#020914");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const topGlow = ctx.createRadialGradient(
    width * 0.2,
    80,
    20,
    width * 0.2,
    80,
    650,
  );
  topGlow.addColorStop(0, "rgba(14,165,233,0.20)");
  topGlow.addColorStop(1, "rgba(14,165,233,0)");
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, width, Math.min(height, 900));

  drawPredictionShareHeader(
    ctx,
    margin,
    margin,
    contentW,
    `${weekNumber}. Hafta`,
    `${seasonName} • ${shareView === "post" ? "Maç Sonrası" : "Maç Öncesi"}`,
    `${pageIndex + 1} / ${totalPages}`,
  );

  const gridY = margin + headerH + topGap;

  for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    const match = matches[matchIndex];
    const column = matchIndex % columns;
    const row = Math.floor(matchIndex / columns);
    const cardX = margin + column * (cardW + cardGap);
    const cardY = gridY + row * (cardH + cardGap);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.48)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    const cardGradient = ctx.createLinearGradient(
      cardX,
      cardY,
      cardX,
      cardY + cardH,
    );
    cardGradient.addColorStop(0, "rgba(13,34,63,0.99)");
    cardGradient.addColorStop(1, "rgba(6,18,36,0.99)");
    fillRoundedRect(
      ctx,
      cardX,
      cardY,
      cardW,
      cardH,
      24,
      cardGradient,
      "rgba(125,211,252,0.14)",
    );
    ctx.restore();

    const centerX = cardX + cardW / 2;
    const logoSize = 72;
    const logoY = cardY + 18;
    const homeLogoX = cardX + 42;
    const awayLogoX = cardX + cardW - 42 - logoSize;

    await drawTeamBadgeOnCanvas(
      ctx,
      match.homeTeam,
      homeLogoX,
      logoY,
      logoSize,
      seasonId,
    );
    await drawTeamBadgeOnCanvas(
      ctx,
      match.awayTeam,
      awayLogoX,
      logoY,
      logoSize,
      seasonId,
    );

    if (shareView === "post" && match.played) {
      fillRoundedRect(
        ctx,
        centerX - 54,
        cardY + 27,
        108,
        56,
        18,
        "rgba(2,6,23,0.68)",
        "rgba(125,211,252,0.30)",
      );
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 36px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `${match.homeScore ?? 0} - ${match.awayScore ?? 0}`,
        centerX,
        cardY + 55,
      );
    } else {
      fillRoundedRect(
        ctx,
        centerX - 38,
        cardY + 31,
        76,
        44,
        18,
        "rgba(2,6,23,0.62)",
        "rgba(125,211,252,0.26)",
      );
      ctx.fillStyle = "#7dd3fc";
      ctx.font = "900 17px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("VS", centerX, cardY + 53);
    }

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 17px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      truncateCanvasText(
        ctx,
        String(match.homeTeam || "").toUpperCase(),
        cardW * 0.34,
      ),
      homeLogoX + logoSize / 2,
      cardY + 112,
    );
    ctx.fillText(
      truncateCanvasText(
        ctx,
        String(match.awayTeam || "").toUpperCase(),
        cardW * 0.34,
      ),
      awayLogoX + logoSize / 2,
      cardY + 112,
    );

    const formattedMatchDate = formatDate(match.date).replace(",", "");
    const dateParts = formattedMatchDate.split(" ");
    const timeText = dateParts.length > 1 ? dateParts.pop() : "";
    const dateText = dateParts.join(" ") || formattedMatchDate;
    fillRoundedRect(
      ctx,
      cardX + 38,
      cardY + 130,
      cardW - 56,
      34,
      14,
      "rgba(30,41,59,0.70)",
      "rgba(148,163,184,0.14)",
    );
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "800 17px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `${dateText}${timeText ? `  •  ${timeText}` : ""}`,
      centerX,
      cardY + 152,
    );

    let playerY = cardY + cardPadding + matchTopH;
    const rowX = cardX + cardPadding;
    const rowW = cardW - cardPadding * 2;

    for (const player of players) {
      const pred =
        getPrediction(match.id, player.id) ||
        createEmptyPredictionRecord(match.id, player.id);
      const palette = getShareCellPalette(pred, match, shareView);

      fillRoundedRect(
        ctx,
        rowX,
        playerY,
        rowW,
        playerRowH,
        12,
        palette.bg,
        palette.border,
      );

      ctx.fillStyle = palette.accent;
      ctx.font = "900 14px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(palette.icon, rowX + 16, playerY + playerRowH / 2);

      ctx.textAlign = "left";
      ctx.fillStyle = "#f8fafc";
      ctx.font = "900 14px Inter, Arial, sans-serif";
      ctx.fillText(
        truncateCanvasText(ctx, String(player.name || "").toUpperCase(), 88),
        rowX + 28,
        playerY + playerRowH / 2,
      );

      const predictionText = getPredictionDisplayValue(pred).replace("—", "-");
      ctx.textAlign = "right";
      ctx.fillStyle = palette.accent;
      ctx.font = "900 19px Inter, Arial, sans-serif";
      ctx.fillText(predictionText, rowX + rowW - 10, playerY + playerRowH / 2);

      if (shareView === "post" && palette.pointsText) {
        ctx.textAlign = "right";
        ctx.fillStyle = palette.accent;
        ctx.font = "800 11px Inter, Arial, sans-serif";
        ctx.fillText(
          palette.pointsText.replace(" Puan", "P"),
          rowX + rowW - 76,
          playerY + playerRowH / 2,
        );
      }

      ctx.textBaseline = "alphabetic";
      playerY += playerRowH + playerGap;
    }
  }

  if (shareView === "post") {
    drawPredictionShareStandingsPanel(
      ctx,
      margin + gridContentW + standingsPanelGap,
      gridY,
      standingsPanelW,
      weeklyStandings,
      generalStandings,
      players,
    );
  }

  let cursorY = gridY + mainContentH;

  if (leaderH && weekLeader) {
    cursorY += leaderGap;
    const leaderY = cursorY;
    const leaderGradient = ctx.createLinearGradient(
      margin,
      leaderY,
      margin + contentW,
      leaderY + leaderH,
    );
    leaderGradient.addColorStop(0, "rgba(120,74,8,0.98)");
    leaderGradient.addColorStop(0.5, "rgba(63,38,8,0.98)");
    leaderGradient.addColorStop(1, "rgba(15,29,49,0.98)");

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.48)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    fillRoundedRect(
      ctx,
      margin,
      leaderY,
      contentW,
      leaderH,
      28,
      leaderGradient,
      "rgba(250,204,21,0.42)",
    );
    ctx.restore();

    fillRoundedRect(
      ctx,
      margin + 24,
      leaderY + 24,
      116,
      116,
      28,
      "rgba(255,255,255,0.10)",
      "rgba(250,204,21,0.34)",
    );
    ctx.fillStyle = "#fde68a";
    ctx.font = "900 64px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🏆", margin + 82, leaderY + 82);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fde68a";
    ctx.font = "900 19px Inter, Arial, sans-serif";
    ctx.fillText("HAFTANIN LİDERİ", margin + 164, leaderY + 43);
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 36px Inter, Arial, sans-serif";
    ctx.fillText(
      truncateCanvasText(ctx, String(weekLeader.name || "").toUpperCase(), 420),
      margin + 164,
      leaderY + 84,
    );
    ctx.fillStyle = "#fef3c7";
    ctx.font = "900 24px Inter, Arial, sans-serif";
    ctx.fillText(`${weekLeader.total || 0} PUAN`, margin + 164, leaderY + 119);
    ctx.fillStyle = "#dbeafe";
    ctx.font = "800 17px Inter, Arial, sans-serif";
    ctx.fillText(
      `Tam ${weekLeader.exact || 0}  •  Sonuç ${weekLeader.resultOnly || 0}`,
      margin + 310,
      leaderY + 118,
    );

    fillRoundedRect(
      ctx,
      margin + contentW - 300,
      leaderY + 48,
      266,
      78,
      22,
      "rgba(2,6,23,0.40)",
      "rgba(255,255,255,0.13)",
    );
    ctx.fillStyle = "#e0f2fe";
    ctx.font = "900 18px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TÜM SIRALAMA", margin + contentW - 167, leaderY + 81);
    ctx.fillStyle = "#93c5fd";
    ctx.font = "800 17px Inter, Arial, sans-serif";
    ctx.fillText("UYGULAMADA", margin + contentW - 167, leaderY + 106);
  }

  ctx.fillStyle = "rgba(148,163,184,0.82)";
  ctx.font = "700 11px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    `Oluşturuldu: ${formatDate(new Date())}`,
    width / 2,
    height - 24,
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

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
    const playersPerPage = Math.max(1, players.length);
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
          const pred =
            getPrediction(match.id, player.id) ||
            createEmptyPredictionRecord(match.id, player.id);
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
/* 04-predictions-avatar.js */

function desktopPredictionMatchCell(match) {
  const visual = getMatchVisualState(match);
  const locked = isMatchLocked(match);
  const badge = getMatchBadge(match);
  const scoreText = match.played
    ? `${match.homeScore} <span>-</span> ${match.awayScore}`
    : "VS";
  const centerLabel = match.played
    ? "Skor"
    : locked
      ? "Kilitli"
      : "Tahmin açık";

  return `
    <div class="desktop-prediction-match-card prediction-fixture-card ${visual === "postponed" ? "fixture-postponed" : visual === "played-postponed" ? "fixture-rescheduled-played" : ""}">
      <div class="prediction-fixture-glow"></div>
      <div class="desktop-prediction-match-inner prediction-fixture-inner">
        <div class="desktop-prediction-team prediction-fixture-team home-team">
          ${teamLogoHtml(match.homeTeam, match.seasonId)}
          <span class="team-name" title="${escapeHtml(match.homeTeam)}">${escapeHtml(match.homeTeam)}</span>
        </div>
        <div class="desktop-prediction-center prediction-fixture-center">
          <div class="desktop-prediction-date-pill prediction-fixture-date">${formatDate(match.date)}</div>
          <div class="desktop-prediction-score prediction-fixture-score">${scoreText}</div>
          <div class="prediction-fixture-state"><span class="badge ${badge.cls}">${badge.text}</span><small>${centerLabel}</small></div>
        </div>
        <div class="desktop-prediction-team prediction-fixture-team away-team">
          ${teamLogoHtml(match.awayTeam, match.seasonId)}
          <span class="team-name" title="${escapeHtml(match.awayTeam)}">${escapeHtml(match.awayTeam)}</span>
        </div>
      </div>
    </div>
  `;
}

function isPredictionLockedForUserUi(matchIdOrMatch) {
  const match =
    typeof matchIdOrMatch === "object" && matchIdOrMatch
      ? matchIdOrMatch
      : state.matches.find(
          (item) => String(item.id) === String(matchIdOrMatch),
        );

  return !!(match && isMatchLocked(match) && getCurrentRole() !== "admin");
}

function getLockedPredictionBlockReason(matchIdOrMatch, playerId) {
  if (isPredictionLockedForUserUi(matchIdOrMatch)) {
    return "Maç başladı, tahmin kilitli.";
  }
  const match =
    typeof matchIdOrMatch === "object" && matchIdOrMatch
      ? matchIdOrMatch
      : state.matches.find(
          (item) => String(item.id) === String(matchIdOrMatch),
        );
  if (match && !canEditPrediction(playerId, match.seasonId)) {
    return "Bu tahmini düzenleme yetkin yok.";
  }
  return "";
}

function renderFocusedUserPredictions(container, matches) {
  if (!container) return;
  const currentPlayerId = getCurrentPlayerId();
  const currentPlayer = getPlayerById(currentPlayerId);
  const isAdmin = getCurrentRole() === "admin";

  if (!currentPlayerId || !currentPlayer) {
    container.innerHTML = createEmptyState(
      "Bu sayfada tahmin girmek için kullanıcı eşleşmesi bulunamadı.",
    );
    return;
  }

  const editableMatches = matches.filter(Boolean);
  const completedCount = editableMatches.filter((match) => {
    const pred = getPrediction(match.id, currentPlayerId);
    return !!(pred && pred.homePred !== "" && pred.awayPred !== "");
  }).length;
  const openCount = editableMatches.filter(
    (match) => !isMatchLocked(match) || isAdmin,
  ).length;
  const pendingCount = Math.max(editableMatches.length - completedCount, 0);

  const cards = editableMatches
    .map((match) => {
      const locked = isMatchLocked(match);
      const lockedForUi = locked && !isAdmin;
      const pred =
        getPrediction(match.id, currentPlayerId) ||
        createEmptyPredictionRecord(match.id, currentPlayerId);
      const hasPrediction = pred.homePred !== "" || pred.awayPred !== "";
      const hasFullPrediction = pred.homePred !== "" && pred.awayPred !== "";
      const canEdit = canEditPrediction(currentPlayerId, match.seasonId);
      const badge = getMatchBadge(match);
      const visual = getMatchVisualState(match);
      const outcomeClass = getPredictionOutcomeClass(pred, match);
      const statusText = getPredictionBaseStatus(match.id, currentPlayerId);
      const uiKey = getPredictionUiKey(match.id, currentPlayerId);
      const uiState = predictionUiState[uiKey] || "idle";
      const isSaving = uiState === "saving";
      const toastInfo = getPredictionToastInfo(match.id, currentPlayerId);
      const showDeleteAction =
        !lockedForUi && (hasPrediction || pred.remoteId || isSaving);
      const showSaveAction =
        !lockedForUi &&
        canEdit &&
        shouldShowPredictionSaveAction(match.id, currentPlayerId);
      const revealOthersOpen =
        typeof isWeekStartedForPredictionReveal === "function" &&
        isWeekStartedForPredictionReveal(match.weekId);
      const revealButtonText = "Tahminleri gör";

      const sceneUrl =
        typeof getMatchSceneUrl === "function"
          ? getMatchSceneUrl(match.homeTeam, match.seasonId)
          : `images/match-scenes/${slugify(match.homeTeam) || "default"}.png`;
      const sceneFallbackUrl = `images/match-scenes/default.png`;
      return `
      <article
        class="prediction-scene-card ${match.played ? "is-played" : ""} ${lockedForUi ? "is-locked" : "is-open"} ${hasFullPrediction ? "has-prediction" : "needs-prediction"} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}"
        style="--match-scene-bg: url('${sceneUrl}'), url('${sceneFallbackUrl}');"      >
        <div class="prediction-scene-overlay"></div>

        <span class="badge prediction-scene-badge ${badge.cls}">${badge.text}</span>

        <div class="prediction-scene-inner">
          <div class="prediction-scene-team prediction-scene-team--home">
            
          <div class="prediction-scene-logo">
              ${teamLogoHtml(match.homeTeam, match.seasonId)}
            </div>
            <strong title="${escapeHtml(match.homeTeam)}">${escapeHtml(match.homeTeam)}</strong>
          
            </div>
            <div class="prediction-match-time-bar">
            <span>${formatDate(match.date)}</span>
          </div>
          <div class="prediction-glass-panel">

            <div class="prediction-score-control ${outcomeClass}">
              <input
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                value="${getPredictionRenderValue(match.id, currentPlayerId, "home", pred.homePred)}"
                id="pred_home_${match.id}_${currentPlayerId}"
                data-pred-role="input"
                data-match-id="${match.id}"
                data-player-id="${currentPlayerId}"
                aria-label="${escapeHtml(match.homeTeam)} tahmini"
                ${lockedForUi || !canEdit ? 'disabled readonly aria-disabled="true" data-pred-locked="true"' : ""}
              />
              <span>:</span>
              <input
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                value="${getPredictionRenderValue(match.id, currentPlayerId, "away", pred.awayPred)}"
                id="pred_away_${match.id}_${currentPlayerId}"
                data-pred-role="input"
                data-match-id="${match.id}"
                data-player-id="${currentPlayerId}"
                aria-label="${escapeHtml(match.awayTeam)} tahmini"
                ${lockedForUi || !canEdit ? 'disabled readonly aria-disabled="true" data-pred-locked="true"' : ""}
              />
            </div>

            <div class="prediction-scene-actions">
              ${lockedForUi ? `<div class="focused-lock-warning">🔒 Kilitli</div>` : ""}
              ${
                canEdit && !lockedForUi
                  ? `
                <button
                class="prediction-mobile-save-btn focused-save-btn ${
                  hasPrediction ? "is-update" : "is-create"
                } ${showSaveAction ? "" : "is-hidden"}"                  type="button"
                  id="pred_btn_${match.id}_${currentPlayerId}"
                  data-pred-role="save-btn"
                  data-match-id="${match.id}"
                  data-player-id="${currentPlayerId}"
                  >${hasPrediction ? " " : " "}</button>
                <button
                  class="prediction-delete-btn focused-delete-btn ${showDeleteAction ? "" : "is-hidden"}"
                  type="button"
                  id="pred_delete_${match.id}_${currentPlayerId}"
                  data-pred-role="delete-btn"
                  data-match-id="${match.id}"
                  data-player-id="${currentPlayerId}"
                  title="Tahmini sil"
                >×</button>
              `
                  : ""
              }
            </div>

            <div class="prediction-status-chip ${outcomeClass}" id="pred_status_${match.id}_${currentPlayerId}">
              ${statusText}
            </div>
            ${
              revealOthersOpen
                ? `
              <button
                type="button"
                class="focused-reveal-predictions-btn"
                onclick="event.stopPropagation(); openDashboardMatchModal('${match.id}');"
                title="Bu maçtaki diğer kullanıcı tahminlerini aç"
              >${revealButtonText}</button>
            `
                : `
              <div class="focused-reveal-locked-note">🔒 Diğer tahminler tahmin süresi kilitlenince açılır</div>
            `
            }
            <div
              class="prediction-card-toast ${toastInfo ? "is-visible" : ""}"
              id="pred_toast_${match.id}_${currentPlayerId}"
              data-toast-type="${toastInfo?.type || "idle"}"
            >${toastInfo ? escapeHtml(toastInfo.message) : ""}</div>
          </div>

          <div class="prediction-scene-team prediction-scene-team--away">
            <div class="prediction-scene-logo">
              ${teamLogoHtml(match.awayTeam, match.seasonId)}
            </div>
            <strong title="${escapeHtml(match.awayTeam)}">${escapeHtml(match.awayTeam)}</strong>
          </div>
        </div>
      </article>`;
    })
    .join("");

  container.innerHTML = `
    <section class="focused-predictions-shell">
      <div class="focused-predictions-hero">
        <div>
          <span class="focused-eyebrow">Benim Tahminlerim</span>
          <h2>${escapeHtml(currentPlayer.name || "Kullanıcı")}</h2>
          <p>Kart görünümü sabit kalır. Maç başlayınca tahmin kilidi devam eder; diğer tahminleri görmek için karttaki butona basabilirsin.</p>
        </div>
        <div class="focused-summary">
          <span><strong>${completedCount}</strong> Girildi</span>
          <span><strong>${pendingCount}</strong> Bekliyor</span>
          <span><strong>${openCount}</strong> Açık maç</span>
        </div>
      </div>
      <div class="focused-prediction-list">${cards}</div>
    </section>`;

  hydrateTeamLogosIn(container);
  bindPredictionActionElements(container);
}

function renderPredictions() {
  const viewportSnapshot = capturePredictionViewport();
  const container = document.getElementById("predictionsTable");
  if (!container) return;

  /*
   * Seçim kutusu ilk haftayı görsel olarak gösterebilir; ancak aktif hafta
   * state içinde boş kalmışsa tahmin ekranı "Önce bir hafta seç" der.
   * Tahminleri çizmeden önce sezon/hafta seçimini gerçek verilerle eşitle.
   */
  ensureActiveSelections();
  if (typeof compactLocalPredictionRecords === "function") {
    compactLocalPredictionRecords();
  }
  const weekId = state.settings.activeWeekId;

  renderPredictionLockBanner(weekId);

  if (
    appBootstrapInProgress ||
    ((currentHydrationPromise || firebaseRealtimeHydrationPromise) && !weekId)
  ) {
    container.innerHTML = `<div class="empty-state prediction-loading-state"><span class="app-loading-spinner"></span><strong>Aktif hafta yükleniyor...</strong><small>Sezon ve hafta bilgileri Firebase üzerinden doğrulanıyor.</small></div>`;
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

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

  const isAdmin = getCurrentRole() === "admin";
  const predictionsLocked = matches.some((match) => isMatchLocked(match));

  if (!isAdmin) {
    renderFocusedUserPredictions(container, matches);
    updatePredictionShareModeButton();
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

  if (isMobileView()) {
    renderMobilePredictions(container, matches);
    hydrateTeamLogosIn(container);
    updatePredictionShareModeButton();
    bindPredictionActionElements(container);
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
          const pred =
            getPrediction(match.id, player.id) ||
            createEmptyPredictionRecord(match.id, player.id);
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
          const revealPrediction = canRevealPredictionForViewer(
            match,
            player.id,
          );
          const hiddenNotice = getHiddenPredictionNotice(match);

          const pointValue = Number(pred.points || 0);
          const showPointBadge = hasPrediction;
          const badgeText = locked && !match.played ? "🔒" : `${pointValue}P`;
          const badgeBg =
            locked && !match.played
              ? "linear-gradient(135deg,#64748b,#475569)"
              : pointValue >= 3
                ? "linear-gradient(135deg,#34d399,#059669)"
                : pointValue >= 1
                  ? "linear-gradient(135deg,#fb923c,#f97316)"
                  : match.played
                    ? "linear-gradient(135deg,#f87171,#ef4444)"
                    : "linear-gradient(135deg,#64748b,#475569)";

          return `
        <div class="prediction-cell prediction-pro-cell ${hasPrediction ? "filled-prediction" : "empty-prediction"} ${pointLabel(pred.points)} ${outcomeClass} ${locked || !canEdit ? "locked-cell" : ""}${ownClass}${showPointBadge ? " has-point-badge" : ""} ${!revealPrediction ? "prediction-secret-cell" : ""}">
          ${showPointBadge && revealPrediction ? `<div class="points-badge-inline" style="background:${badgeBg};">${badgeText}</div>` : ""}

          ${
            !revealPrediction
              ? `
            <div class="prediction-secret-box">
              <span class="prediction-secret-lock">🔒</span>
              <strong>${hasPrediction ? "Tahmin gizli" : "Tahmin bekleniyor"}</strong>
              <small>${hiddenNotice}</small>
            </div>
          `
              : `
          <div class="desktop-prediction-control">
            <div class="score-inputs compact-inputs center-mode pred-score-row">
              <input
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                value="${getPredictionRenderValue(match.id, player.id, "home", pred.homePred)}"
                id="pred_home_${match.id}_${player.id}"
                data-pred-role="input"
                data-match-id="${match.id}"
                data-player-id="${player.id}"
                ${locked || !canEdit ? "disabled" : ""}
              />
              <span>-</span>
              <input
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                value="${getPredictionRenderValue(match.id, player.id, "away", pred.awayPred)}"
                id="pred_away_${match.id}_${player.id}"
                data-pred-role="input"
                data-match-id="${match.id}"
                data-player-id="${player.id}"
                ${locked || !canEdit ? "disabled" : ""}
              />
            </div>

            ${
              locked || !canEdit
                ? `<div class="prediction-save-wrap pred-btn-slot prediction-button-row desktop-icon-actions is-disabled-actions"></div>`
                : `<div class="prediction-save-wrap pred-btn-slot prediction-button-row desktop-icon-actions">
                    <button
                      class="secondary small prediction-action-btn ${showSaveAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_btn_${match.id}_${player.id}"
                      data-pred-role="save-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      title="Kaydet / güncelle"
                    >${getPredictionSaveLabel(match.id, player.id)}</button>
                    <button
                      class="secondary small danger prediction-delete-btn ${showDeleteAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_delete_${match.id}_${player.id}"
                      data-pred-role="delete-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      title="Tahmini sil"
                    >Sil</button>
                  </div>`
            }
          </div>

          <div class="pred-status-slot">
            <div class="prediction-status-chip ${outcomeClass}" id="pred_status_${match.id}_${player.id}">${statusText}</div>
          </div>
          `
          }
        </div>`;
        })
        .join("");

      return `
      <div class="prediction-grid-row ${match.played ? "played-row" : ""} ${visual === "postponed" ? "postponed-row" : ""} ${visual === "played-postponed" ? "rescheduled-played-row" : ""}">
        <div class="match-sticky-cell">
          ${desktopPredictionMatchCell(match)}
        </div>
        ${playerCols}
      </div>`;
    })
    .join("");

  container.innerHTML = `<div class="predictions-scroll-shell"><div class="excel-predictions" style="--player-count:${players.length};"><div class="prediction-grid-head"><div>Maç</div>${headerPlayers}</div><div class="prediction-grid-body">${rows}</div></div></div>`;

  updatePredictionShareModeButton();
  bindPredictionActionElements(container);
  bindPredictionTableDesktopScroll();
  schedulePredictionViewportRestore(viewportSnapshot);
}

const predictionTimers = {};
const predictionUiState = {};
const predictionToastState = {};
const predictionUiResetTimers = {};
const predictionInputDrafts = {};
const predictionEditButtonTapLock = {};

function getPredictionUiKey(matchId, playerId) {
  return `${matchId}_${playerId}`;
}

function getPredictionToastInfo(matchId, playerId) {
  return predictionToastState[getPredictionUiKey(matchId, playerId)] || null;
}

function setPredictionCardToast(matchId, playerId, type, message) {
  const key = getPredictionUiKey(matchId, playerId);
  const safeType = type || "idle";
  const safeMessage = String(message || "").trim();

  if (!safeMessage) {
    clearPredictionCardToast(matchId, playerId);
    return;
  }

  predictionToastState[key] = {
    type: safeType,
    message: safeMessage,
  };

  const toast = document.getElementById(`pred_toast_${matchId}_${playerId}`);
  if (!toast) return;

  toast.textContent = safeMessage;
  toast.dataset.toastType = safeType;
  toast.classList.add("is-visible");
}

function clearPredictionCardToast(matchId, playerId) {
  const key = getPredictionUiKey(matchId, playerId);
  delete predictionToastState[key];

  const toast = document.getElementById(`pred_toast_${matchId}_${playerId}`);
  if (!toast) return;

  toast.textContent = "";
  toast.dataset.toastType = "idle";
  toast.classList.remove("is-visible");
}

function getPredictionDraft(matchId, playerId) {
  return predictionInputDrafts[getPredictionUiKey(matchId, playerId)] || null;
}

function setPredictionDraft(matchId, playerId, values = {}) {
  const key = getPredictionUiKey(matchId, playerId);
  const current = predictionInputDrafts[key] || {};
  predictionInputDrafts[key] = {
    homePred: Object.prototype.hasOwnProperty.call(values, "homePred")
      ? values.homePred
      : (current.homePred ?? ""),
    awayPred: Object.prototype.hasOwnProperty.call(values, "awayPred")
      ? values.awayPred
      : (current.awayPred ?? ""),
    updatedAt: Date.now(),
  };
}

function clearPredictionDraft(matchId, playerId) {
  delete predictionInputDrafts[getPredictionUiKey(matchId, playerId)];
}

function getPredictionRenderValue(matchId, playerId, side, fallback = "") {
  const draft = getPredictionDraft(matchId, playerId);
  if (draft) {
    const key = side === "away" ? "awayPred" : "homePred";
    if (Object.prototype.hasOwnProperty.call(draft, key)) {
      return draft[key];
    }
  }
  return fallback ?? "";
}

function getPredictionBaseStatus(matchId, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  const pred =
    getPrediction(matchId, playerId) ||
    createEmptyPredictionRecord(matchId, playerId);
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
  const hasSavedValue = !!(
    pred &&
    (pred.remoteId || (pred.homePred !== "" && pred.awayPred !== ""))
  );

  if (uiState === "saving") return "Güncelleniyor...";
  if (uiState === "deleting") return "Siliniyor...";
  if (uiState === "saved") return "Güncellendi ✓";
  if (uiState === "deleted") return "Tahmin gir";
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
  const draft = getPredictionDraft(matchId, playerId);
  const { homeInput, awayInput } = getPredictionInputElements(
    matchId,
    playerId,
  );
  const homeSource = homeInput?.value ?? draft?.homePred ?? pred.homePred ?? "";
  const awaySource = awayInput?.value ?? draft?.awayPred ?? pred.awayPred ?? "";
  const homePred = parseNumberOrEmpty(homeSource);
  const awayPred = parseNumberOrEmpty(awaySource);
  return {
    pred,
    draft,
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
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return false;
  if (
    (isMatchLocked(match) && getCurrentRole() !== "admin") ||
    !canEditPrediction(playerId)
  ) {
    return false;
  }
  return true;
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

  return (
    !hasStoredPredictionRecord(matchId, playerId) ||
    hasPredictionInputChanged(matchId, playerId) ||
    !!getPredictionDraft(matchId, playerId)
  );
}

function focusPredictionHomeInput(matchId, playerId) {
  const input = document.getElementById(`pred_home_${matchId}_${playerId}`);
  if (!input || input.disabled) return;
  requestAnimationFrame(() => {
    try {
      input.focus({ preventScroll: true });
    } catch (_) {
      input.focus();
    }
    if (typeof input.select === "function") input.select();
  });
}

window.handlePredictionSaveButtonClick = function (matchId, playerId) {
  const key = getPredictionUiKey(matchId, playerId);
  const now = Date.now();
  if (
    predictionEditButtonTapLock[key] &&
    now - predictionEditButtonTapLock[key] < 450
  ) {
    return;
  }
  predictionEditButtonTapLock[key] = now;

  const uiState = predictionUiState[key] || "idle";
  const snapshot = capturePredictionViewport({ matchId, playerId });

  if (uiState === "saving" || uiState === "deleting") return;

  if (
    shouldAutoSavePrediction(matchId, playerId) ||
    uiState === "dirty" ||
    uiState === "error"
  ) {
    window.queuePredictionSave(matchId, playerId, true, snapshot);
    return;
  }

  setPredictionUiState(matchId, playerId, "dirty");
  focusPredictionHomeInput(matchId, playerId);
  schedulePredictionViewportRestore(snapshot);
};

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
function setPredictionUiState(matchId, playerId, uiState, options = {}) {
  const key = getPredictionUiKey(matchId, playerId);
  predictionUiState[key] = uiState;

  if (predictionUiResetTimers[key]) {
    clearTimeout(predictionUiResetTimers[key]);
    delete predictionUiResetTimers[key];
  }

  const lockReason = getLockedPredictionBlockReason(matchId, playerId);
  const forceLocked = !!lockReason;

  const button = document.getElementById(`pred_btn_${matchId}_${playerId}`);
  if (button) {
    button.textContent = getPredictionSaveLabel(matchId, playerId);
    button.disabled =
      forceLocked || uiState === "saving" || uiState === "deleting";
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    button.style.pointerEvents = forceLocked ? "none" : "auto";
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
    button.classList.toggle(
      "is-hidden",
      !shouldShowPredictionSaveAction(matchId, playerId),
    );
  }

  const deleteButton = document.getElementById(
    `pred_delete_${matchId}_${playerId}`,
  );
  if (deleteButton) {
    deleteButton.disabled =
      forceLocked || uiState === "saving" || uiState === "deleting";
    deleteButton.setAttribute(
      "aria-disabled",
      deleteButton.disabled ? "true" : "false",
    );
    deleteButton.style.pointerEvents = forceLocked ? "none" : "auto";
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

  if (uiState === "saving") {
    setPredictionCardToast(
      matchId,
      playerId,
      "saving",
      options.message || "Kaydediliyor...",
    );
  } else if (uiState === "deleting") {
    setPredictionCardToast(
      matchId,
      playerId,
      "saving",
      options.message || "Siliniyor...",
    );
  } else if (uiState === "saved") {
    setPredictionCardToast(
      matchId,
      playerId,
      "success",
      options.message || "Kaydedildi",
    );
  } else if (uiState === "deleted") {
    setPredictionCardToast(
      matchId,
      playerId,
      "success",
      options.message || "Silindi",
    );
  } else if (uiState === "error") {
    setPredictionCardToast(
      matchId,
      playerId,
      "error",
      options.message || "Hata oluştu",
    );
  } else if (uiState === "deleteError") {
    setPredictionCardToast(
      matchId,
      playerId,
      "error",
      options.message || "Silme hatası",
    );
  } else if (uiState === "queued" || uiState === "deleteQueued") {
    setPredictionCardToast(
      matchId,
      playerId,
      "warning",
      options.message || "Bağlantı bekleniyor",
    );
  } else if (uiState === "dirty" || uiState === "idle") {
    if (!options.keepToast) {
      clearPredictionCardToast(matchId, playerId);
    }
  }

  if (uiState === "saved" || uiState === "deleted") {
    clearPredictionDraft(matchId, playerId);
    predictionUiResetTimers[key] = setTimeout(() => {
      clearPredictionCardToast(matchId, playerId);
      setPredictionUiState(matchId, playerId, "idle");
    }, 2600);
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
  const blockReason = getLockedPredictionBlockReason(matchId, playerId);
  if (blockReason) {
    clearPredictionDraft(matchId, playerId);
    setPredictionUiState(matchId, playerId, "idle", { keepToast: true });
    setPredictionCardToast(matchId, playerId, "warning", blockReason);
    renderAll();
    return;
  }

  const key = getPredictionUiKey(matchId, playerId);
  clearTimeout(predictionTimers[key]);

  const snapshot =
    viewportSnapshot || capturePredictionViewport({ matchId, playerId });

  if (immediate) {
    window.savePrediction(matchId, playerId, { viewportSnapshot: snapshot });
    schedulePredictionViewportRestore(snapshot);
    return;
  }

  const { homePred, awayPred } = getPredictionInputSnapshot(matchId, playerId);
  setPredictionDraft(matchId, playerId, { homePred, awayPred });
  setPredictionUiState(matchId, playerId, "dirty");
  updatePredictionDeleteButton(matchId, playerId, true);
  schedulePredictionViewportRestore(snapshot);
};

window.deletePredictionEntry = async function (matchId, playerId) {
  const viewportSnapshot = capturePredictionViewport({ matchId, playerId });
  const blockReason = getLockedPredictionBlockReason(matchId, playerId);
  if (blockReason) {
    setPredictionCardToast(matchId, playerId, "warning", blockReason);
    renderAll();
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

  const key = getPredictionUiKey(matchId, playerId);
  const btn = document.getElementById(`pred_delete_${matchId}_${playerId}`);
  if (!btn) return;

  const pred = getPrediction(matchId, playerId);
  if (!pred) return;

  const confirmed = await showConfirm(
    "Bu tahmini silmek istediğinizden emin misiniz?",
    {
      title: "Tahmin silinsin mi?",
      type: "danger",
      confirmText: "Sil",
      cancelText: "Vazgeç",
    },
  );

  if (!confirmed) {
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

  btn.innerText = "Siliniyor...";
  btn.disabled = true;
  clearTimeout(predictionTimers[key]);
  setPredictionUiState(matchId, playerId, "deleting", {
    message: "Siliniyor...",
  });

  try {
    const payload = {
      matchId: matchId,
      playerId: playerId,
      kullaniciAdi: getCurrentUsername(),
      predictionId: pred.remoteId || pred.id || "",
      recordKey: `${matchId}_${playerId}`,
      sezon: getActiveSeasonLabel(),
      haftaNo: getWeekNumberById(state.settings.activeWeekId),
    };

    const result = await deleteOnlinePrediction(payload);

    btn.innerText = "Sil";
    btn.disabled = false;

    if (result?.success) {
      clearPredictionDraft(matchId, playerId);
      clearLocalPredictionRecord(matchId, playerId);
      if (typeof dequeuePredictionRetry === "function") {
        dequeuePredictionRetry(payload);
      }
      setPredictionUiState(matchId, playerId, "deleted", {
        message: "Silindi",
      });
      renderAll();
    } else {
      console.warn("Sheet silme başarısız:", result?.message);
      setPredictionUiState(matchId, playerId, "deleteError", {
        message: "Silme hatası",
      });
      renderAll();
    }
  } catch (err) {
    console.error("Silme hatası:", err);
    btn.innerText = "Sil";
    btn.disabled = false;
    setPredictionUiState(matchId, playerId, "deleteError", {
      message: "Silme hatası",
    });
  } finally {
    schedulePredictionViewportRestore(viewportSnapshot);
  }
};
if (typeof window.renderMissingPredictions !== "function") {
  window.renderMissingPredictions = function () {};
}
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
  const wasUpdate = hasStoredPredictionRecord(matchId, playerId);

  if (predictionUiState[key] === "saving") {
    return;
  }

  clearTimeout(predictionTimers[key]);

  const pred = ensurePrediction(matchId, playerId);

  const { homePred, awayPred } = getPredictionInputSnapshot(matchId, playerId);
  setPredictionDraft(matchId, playerId, { homePred, awayPred });

  pred.homePred = homePred;
  pred.awayPred = awayPred;
  pred.points = match.played
    ? calcPoints(homePred, awayPred, match.homeScore, match.awayScore)
    : 0;
  pred.username = getCurrentUsername();
  pred.updatedAt = new Date().toISOString();

  if (typeof compactLocalPredictionRecords === "function") {
    compactLocalPredictionRecords();
  }

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
    setPredictionUiState(matchId, playerId, "saved", {
      message: wasUpdate ? "Güncellendi" : "Kaydedildi",
    });
    updatePredictionDeleteButton(matchId, playerId, true);
    schedulePredictionViewportRestore(viewportSnapshot);
    return;
  }

  setPredictionUiState(matchId, playerId, "saving", {
    message: "Firebase'e kaydediliyor...",
  });

  predictionTimers[key] = setTimeout(() => {
    if (predictionUiState[key] === "saving") {
      setPredictionUiState(matchId, playerId, "saving", {
        message: "Bağlantı bekleniyor...",
      });
    }
  }, 20000);

  playerId = normalizeEntityId(playerId);
  const player = getPlayerById(playerId);
  const actorUser = getAuthUser?.() || null;
  const actorPlayer =
    typeof findPlayerForSessionUser === "function"
      ? findPlayerForSessionUser(actorUser)
      : null;
  const actorId = String(
    state.settings?.auth?.playerId || actorPlayer?.id || actorUser?.id || "",
  );
  const actorName = String(
    actorPlayer?.name ||
      actorUser?.adSoyad ||
      actorUser?.name ||
      actorUser?.kullaniciAdi ||
      getCurrentUsername?.() ||
      "",
  );
  const actorRole =
    String(
      getCurrentRole?.() || actorPlayer?.role || actorUser?.rol || "user",
    ).toLowerCase() === "admin"
      ? "admin"
      : "user";
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
    actorId,
    actorName,
    actorUsername: actorUser?.kullaniciAdi || getCurrentUsername?.() || "",
    actorRole,
    changedById: actorId,
    changedBy: actorName,
  };

  let onlineSaveCompleted = false;

  try {
    // Aynı maç/kullanıcı için eskiden sırada kalmış tahmin varsa önce temizle.
    // Aksi halde eski kuyruk kaydı Firebase'e tekrar yazıp yeni tahmini geri alabiliyor.
    if (typeof dequeuePredictionRetry === "function") {
      dequeuePredictionRetry(payload);
    }

    const result = await saveOnlinePrediction(payload);

    clearTimeout(predictionTimers[key]);

    if (!result?.success) {
      console.error("Online tahmin kaydedilemedi:", result);
      setPredictionUiState(matchId, playerId, "error", {
        message: result?.message || "Hata oluştu",
      });
      showAlert(result?.message || "Tahmin veritabanına kaydedilemedi.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
      schedulePredictionViewportRestore(viewportSnapshot);
      return;
    }

    onlineSaveCompleted = true;

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
    if (typeof compactLocalPredictionRecords === "function") {
      compactLocalPredictionRecords();
    }
    saveState(true);
    setPredictionUiState(matchId, playerId, "saved", {
      message: wasUpdate ? "Güncellendi" : "Kaydedildi",
    });
    renderPredictions();
    schedulePredictionViewportRestore(viewportSnapshot);
  } catch (error) {
    clearTimeout(predictionTimers[key]);

    if (onlineSaveCompleted) {
      console.warn(
        "Firebase kaydı tamamlandı; ekran/yerel güncelleme sırasında hata yakalandı:",
        error,
      );
      saveState(true);
      setPredictionUiState(matchId, playerId, "saved", {
        message: wasUpdate ? "Güncellendi" : "Kaydedildi",
      });
      try {
        renderPredictions();
      } catch (renderError) {
        console.warn("Tahmin ekranı yenilenemedi:", renderError);
      }
      schedulePredictionViewportRestore(viewportSnapshot);
      return;
    }

    console.error("Online tahmin kaydı hatası:", error);

    const timeoutError = String(error?.message || "").includes(
      "zaman aşımına uğradı",
    );

    if (timeoutError) {
      setPredictionUiState(matchId, playerId, "saving", {
        message: "Bağlantı bekleniyor...",
      });

      enqueuePredictionRetry(payload);
      setPredictionUiState(matchId, playerId, "queued", {
        message: "Bağlantı bekleniyor",
      });
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
    setPredictionUiState(matchId, playerId, "queued", {
      message: "Bağlantı bekleniyor",
    });
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

function getStandingTone(index) {
  if (index === 0) return "gold";
  if (index === 1) return "silver";
  if (index === 2) return "bronze";
  return "default";
}

function renderLeaderboardTopThree(rows, options = {}) {
  const topRows = rows.slice(0, 3);
  if (!topRows.length) return createEmptyState("Henüz ilk 3 oluşmadı.");
  const order = [1, 0, 2].filter((index) => topRows[index]);
  const titleMap = {
    1: "Tahtın sahibi",
    2: "Takipte",
    3: "Yarışta",
  };
  return `
    <div class="leaderboard-podium ${options.compact ? "is-compact" : ""}">
    ${order
      .map((sourceIndex) => {
        const row = topRows[sourceIndex];
        const displayRank = sourceIndex + 1;
        const tone = getStandingTone(sourceIndex);
        const trophy =
          displayRank === 1 ? "👑" : displayRank === 2 ? "🥈" : "🥉";
        const metaLabel = options.weeklyMode ? "hafta puanı" : "puan";

        const player = getPlayerById(row.id);
        const supportedTeamName = getPlayerSupportedTeamName(player);
        const supportedTeamLogo = supportedTeamName
          ? `
            <div class="podium-supported-team-logo" aria-hidden="true">
              ${teamLogoHtml(supportedTeamName, getActiveSeasonId(), "podium-supported-team-logo-inner")}
            </div>
          `
          : "";

        return `
          <article class="podium-card podium-card-${tone} podium-rank-${displayRank}">
            <span class="podium-glow"></span>
            <span class="podium-orbit podium-orbit-a"></span>
            <span class="podium-orbit podium-orbit-b"></span>
            ${supportedTeamLogo}
            <div class="podium-rank-badge">${trophy}</div>
            <div class="podium-tier-label">${titleMap[displayRank]}</div>
            <div class="podium-avatar-wrap">
              ${createGenericAvatarMarkup(row, "podium-avatar")}
            </div>
            <strong class="podium-name">${escapeHtml(row.name)}</strong>
            <span class="podium-points">${row.total}</span>
            <span class="podium-points-label">${metaLabel}</span>
            <div class="podium-meta-row">
              <span>${row.exact} tam skor</span>
              <span>${row.resultOnly} yakın</span>
            </div>
          </article>`;
      })
      .join("")}
    </div>`;
}

function normalizeAvatarKey(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]/g, "");
}

let avatarDirectoryMap = null;
let avatarDirectoryPromise = null;
let avatarDirectoryLoadedOnce = false;
const avatarResolvedPathCache = new Map();
let avatarDirectoryInitStarted = false;

function isSystemGeneratedAvatarKey(value) {
  const key = normalizeAvatarKey(value);
  if (!key) return false;

  return /^(player|pred|match|team|week|season|session)[a-z0-9]*/i.test(key);
}
function getAvatarCandidateKeys(row) {
  const keys = [];
  const pushKey = (value) => {
    const key = normalizeAvatarKey(value);
    if (key && !keys.includes(key)) keys.push(key);
  };

  pushKey(row?.name);
  pushKey(row?.username);
  pushKey(row?.displayName);
  pushKey(row?.email ? String(row.email).split("@")[0] : "");
  pushKey(row?.id);

  const stateUsers = Object.values((state && state.users) || {});
  const rowId = normalizeEntityId(row?.id || "");
  const matchedUser = stateUsers.find((user) => {
    return rowId && normalizeEntityId(user?.id || user?.uid || "") === rowId;
  });

  if (matchedUser) {
    pushKey(matchedUser.name);
    pushKey(matchedUser.username);
    pushKey(matchedUser.displayName);
    pushKey(matchedUser.email ? String(matchedUser.email).split("@")[0] : "");
    pushKey(matchedUser.id);
    pushKey(matchedUser.uid);
    pushKey(matchedUser.originalName);
    pushKey(matchedUser.previousName);
  }

  return keys;
}

function getAvatarRegistry() {
  const registry = window.FIKSTUR_AVATAR_MAP;
  if (!registry || typeof registry !== "object") return {};
  return registry;
}

function buildAvatarDirectoryMapFromList(filePaths = []) {
  const map = {};
  filePaths.forEach((filePath) => {
    const cleanedPath = String(filePath || "").trim();
    if (!cleanedPath) return;
    const fileName = cleanedPath.split("/").pop() || "";
    const baseName = fileName.replace(/\.[^.]+$/, "");
    const key = normalizeAvatarKey(baseName);
    if (key && !map[key]) map[key] = cleanedPath;
  });
  return map;
}

function parseAvatarDirectoryListing(htmlText = "") {
  const filePaths = [];
  const html = String(htmlText || "");
  if (!html) return filePaths;

  const hrefRegex = /href=["']([^"']+\.(?:png|jpe?g|webp|gif|svg))["']/gi;
  let match;
  while ((match = hrefRegex.exec(html))) {
    const href = String(match[1] || "").trim();
    if (!href) continue;

    if (/^https?:/i.test(href)) {
      try {
        const url = new URL(href);
        const fileName = url.pathname.split("/").pop();
        if (fileName) filePaths.push(`avatars/${fileName}`);
      } catch {}
      continue;
    }

    const fileName = href.split("/").pop();
    if (fileName) filePaths.push(`avatars/${fileName}`);
  }

  return [...new Set(filePaths)];
}

async function loadAvatarDirectoryMap() {
  if (avatarDirectoryMap) return avatarDirectoryMap;
  if (avatarDirectoryPromise) return avatarDirectoryPromise;

  avatarDirectoryPromise = (async () => {
    let mergedMap = {};

    try {
      const manifestResponse = await fetch(
        `avatars/avatars.json?v=${Date.now()}`,
        {
          cache: "no-store",
        },
      );
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        if (manifest && typeof manifest === "object") {
          Object.entries(manifest).forEach(([key, value]) => {
            const normalizedKey = normalizeAvatarKey(key);
            const normalizedValue = String(value || "").trim();
            if (normalizedKey && normalizedValue) {
              mergedMap[normalizedKey] = normalizedValue;
            }
          });
        }
      }
    } catch {}

    try {
      const directoryResponse = await fetch(`avatars/?v=${Date.now()}`, {
        cache: "no-store",
      });
      const contentType = String(
        directoryResponse.headers.get("content-type") || "",
      ).toLowerCase();
      if (directoryResponse.ok && contentType.includes("text/html")) {
        const html = await directoryResponse.text();
        mergedMap = {
          ...buildAvatarDirectoryMapFromList(parseAvatarDirectoryListing(html)),
          ...mergedMap,
        };
      }
    } catch {}

    avatarDirectoryMap = mergedMap;
    avatarDirectoryLoadedOnce = true;
    avatarDirectoryPromise = null;
    return avatarDirectoryMap;
  })();

  return avatarDirectoryPromise;
}

function findAvatarFromDirectory(candidateKeys = []) {
  const directoryMap = avatarDirectoryMap || {};
  for (const key of candidateKeys) {
    if (directoryMap[key]) return directoryMap[key];
  }

  for (const key of candidateKeys) {
    const startsWithMatch = Object.entries(directoryMap).find(
      ([fileKey]) => fileKey.startsWith(key) || key.startsWith(fileKey),
    );
    if (startsWithMatch?.[1]) return startsWithMatch[1];
  }

  for (const key of candidateKeys) {
    const includesMatch = Object.entries(directoryMap).find(
      ([fileKey]) => fileKey.includes(key) || key.includes(fileKey),
    );
    if (includesMatch?.[1]) return includesMatch[1];
  }

  return "";
}
function buildAvatarPathCandidates(candidateKeys = []) {
  const extensions = ["png", "jpg", "jpeg", "webp", "gif"];
  const output = [];

  candidateKeys.forEach((key) => {
    const normalizedKey = normalizeAvatarKey(key);
    if (!normalizedKey) return;
    extensions.forEach((ext) => {
      output.push(`avatars/${normalizedKey}.${ext}`);
    });
  });

  return [...new Set(output)];
}

function resolveAvatarPathFromCandidates(candidateKeys = []) {
  const fileCandidates = buildAvatarPathCandidates(candidateKeys);
  if (!fileCandidates.length) return Promise.resolve("");

  return new Promise((resolve) => {
    const tryNext = (index) => {
      if (index >= fileCandidates.length) {
        resolve("");
        return;
      }

      const src = fileCandidates[index];
      const probe = new Image();
      probe.onload = () => resolve(src);
      probe.onerror = () => tryNext(index + 1);
      probe.src = `${src}?v=${Date.now()}`;
    };

    tryNext(0);
  });
}
function getExplicitAvatarSource(row) {
  const directCandidates = [
    row?.avatar,
    row?.avatarSrc,
    row?.avatarUrl,
    row?.photo,
    row?.photoUrl,
    row?.image,
    row?.imageUrl,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (directCandidates.length) {
    return directCandidates[0];
  }

  const candidateKeys = getAvatarCandidateKeys(row);
  const registry = getAvatarRegistry();
  for (const key of candidateKeys) {
    const mapped = String(registry[key] || "").trim();
    if (mapped) return mapped;
  }

  const autoMapped = findAvatarFromDirectory(candidateKeys);
  if (autoMapped) return autoMapped;

  return "";
}

function getAvatarDisplayLetter(row) {
  return escapeHtml(
    String(row?.name || row?.username || row?.displayName || "?")
      .trim()
      .charAt(0) || "?",
  );
}

function markAvatarFallback(img) {
  if (!img) return;
  img.removeAttribute("src");
  img.style.display = "none";
  const fallback = img.nextElementSibling;
  if (fallback) fallback.style.display = "flex";
}

function handleAvatarImageLoad(img) {
  if (!img) return;
  img.style.display = "block";
  const fallback = img.nextElementSibling;
  if (fallback) fallback.style.display = "none";
}

function refreshAvatarImages(root = document) {
  const scope = root || document;
  scope.querySelectorAll?.(".app-avatar").forEach((avatarEl) => {
    const img = avatarEl.querySelector(".app-avatar-image");
    const fallback = avatarEl.querySelector(".app-avatar-fallback");
    if (!img) return;

    const candidateKeys = String(avatarEl.dataset.avatarKeys || "")
      .split(",")
      .map((value) => normalizeAvatarKey(value))
      .filter(Boolean);

    const resolvedSrc =
      String(img.dataset.avatarSrc || "").trim() ||
      findAvatarFromDirectory(candidateKeys);

    if (resolvedSrc) {
      img.dataset.avatarSrc = resolvedSrc;
      if (img.getAttribute("src") !== resolvedSrc) {
        img.src = resolvedSrc;
      }
      img.style.display = "block";
      if (fallback) fallback.style.display = "none";
      return;
    }

    img.style.display = "none";
    if (fallback) fallback.style.display = "flex";
  });
}

function ensureAvatarDirectoryReady() {
  return loadAvatarDirectoryMap()
    .then(() => {
      refreshAvatarImages(document);
      if (avatarDirectoryLoadedOnce && typeof renderAll === "function") {
        renderAll();
      }
      return avatarDirectoryMap || {};
    })
    .catch(() => ({}));
}

function createGenericAvatarMarkup(row, extraClass = "") {
  const candidateKeys = getAvatarCandidateKeys(row);
  const avatarSrc = getExplicitAvatarSource(row);
  const fallbackLetter = getAvatarDisplayLetter(row);
  const srcAttr = avatarSrc ? ` src="${escapeHtml(avatarSrc)}"` : "";
  const dataSrcAttr = avatarSrc
    ? ` data-avatar-src="${escapeHtml(avatarSrc)}"`
    : "";
  const initialDisplay = avatarSrc ? "" : ' style="display:none"';
  const fallbackInitialDisplay = avatarSrc ? ' style="display:none"' : "";

  return `
    <div class="app-avatar ${extraClass}" data-avatar-keys="${escapeHtml(candidateKeys.join(","))}">
      <img class="app-avatar-image"
           ${srcAttr}${dataSrcAttr}${initialDisplay}
           alt="${escapeHtml(String(row?.name || row?.username || "Avatar"))}"
           loading="lazy"
           decoding="async"
           onload="handleAvatarImageLoad(this)"
           onerror="handleAvatarImageError(this)">
      <span class="app-avatar-fallback"${fallbackInitialDisplay}>${fallbackLetter}</span>
    </div>
  `;
}

function createAvatarMarkup(row) {
  return createGenericAvatarMarkup(row, "leaderboard-avatar");
}
function getLeaderboardSupportedTeamName(row) {
  const player = getPlayerById?.(row?.id) || {};

  return (
    row?.supportedTeam ||
    row?.supportedTeamName ||
    row?.teamName ||
    row?.team ||
    player?.supportedTeam ||
    player?.supportedTeamName ||
    player?.teamName ||
    player?.team ||
    ""
  );
}

function createLeaderboardSupportedTeamLogo(row) {
  const teamName = getLeaderboardSupportedTeamName(row);
  if (!teamName) return "";

  return `
    <div class="leaderboard-supported-team-logo" aria-hidden="true">
      ${teamLogoHtml(teamName, getActiveSeasonId(), "leaderboard-supported-team-logo__wrap")}
    </div>
  `;
}
function handleAvatarImageError(img) {
  markAvatarFallback(img);
}

function standingsRows(rows, showPredictionCount = true, options = {}) {
  const currentPlayerId = normalizeEntityId(getCurrentPlayerId?.() || "");
  const maxTotal = Math.max(...rows.map((row) => Number(row.total || 0)), 1);

  return `<div class="leaderboard-list ${options.weeklyMode ? "leaderboard-list-weekly" : "leaderboard-list-general"}">${rows
    .map((row, i) => {
      const tone = getStandingTone(i);
      const leaderChip =
        row.id === options.leaderId
          ? `<span class="leaderboard-chip ${options.weeklyMode ? "chip-week" : "chip-leader"}">${options.weeklyMode ? "Hafta lideri" : "Lider"}</span>`
          : "";

      const isCurrentUser =
        currentPlayerId && normalizeEntityId(row.id) === currentPlayerId;

      const currentUserChip = isCurrentUser
        ? `<span class="leaderboard-chip chip-self">Sen</span>`
        : "";

      const rightLabel = showPredictionCount
        ? `${row.predictionCount} tahmin`
        : `${row.total} hafta`;

      const progressWidth = Math.max(
        8,
        Math.round((Number(row.total || 0) / maxTotal) * 100),
      );

      const rankDelta = Number(
        (options.rankDeltaMap && options.rankDeltaMap[row.id]) || 0,
      );

      const movementChip =
        rankDelta > 0
          ? `<span class="leaderboard-move move-up">↑ +${rankDelta}</span>`
          : rankDelta < 0
            ? `<span class="leaderboard-move move-down">↓ ${Math.abs(rankDelta)}</span>`
            : `<span class="leaderboard-move move-flat">• 0</span>`;

      const player = getPlayerById(row.id);
      const supportedTeamName = getPlayerSupportedTeamName(player);
      const supportedTeamLogo = supportedTeamName
        ? `
          <div class="leaderboard-supported-team-logo" aria-hidden="true">
            ${teamLogoHtml(
              supportedTeamName,
              getActiveSeasonId(),
              "leaderboard-supported-team-logo-inner",
            )}
          </div>
        `
        : "";

      return `
        <article class="leaderboard-row tone-${tone} ${i < 3 ? "top-rank-row" : ""} ${isCurrentUser ? "is-current-user" : ""}">
          ${createLeaderboardSupportedTeamLogo(row)}
      
          <div class="leaderboard-row-left">
            <span class="leaderboard-rank">${i < 3 ? `<span class="rank-medal">${i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}</span>` : `#${i + 1}`}</span>
      
            <div class="leaderboard-main-content">
              ${createAvatarMarkup(row)}
      
              <div class="leaderboard-person">
                <div class="leaderboard-name-line">
                  <strong>${escapeHtml(row.name)}</strong>
                  ${leaderChip}
                  ${currentUserChip}
                  ${movementChip}
                </div>
      
                <div class="leaderboard-subline">
                  <span>${row.exact} tam skor</span>
                  <span>${row.resultOnly} yakın</span>
                  <span>${rightLabel}</span>
                </div>
      
                <div class="leaderboard-progress" aria-hidden="true">
                  <span style="width:${progressWidth}%"></span>
                </div>
              </div>
            </div>
          </div>
      
          <div class="leaderboard-score-block">
            <strong>${row.total}</strong>
            <span>${options.weeklyMode ? "hafta puanı" : "puan"}</span>
          </div>
        </article>`;
    })
    .join("")}</div>`;
}

function standingsRowsMobile(rows, showPredictionCount = true, options = {}) {
  return standingsRows(rows, showPredictionCount, options);
}

function getStandingsSummaryData(general, weekly) {
  const seasonId = getActiveSeasonId();
  const seasonMatches = getSortedSeasonMatches(seasonId);
  const playedMatches = seasonMatches.filter(
    (match) => match.homeScore !== "" && match.awayScore !== "",
  );
  const weekId = state.settings.activeWeekId;
  const weekMatches = weekId ? getMatchesByWeekId(weekId) : [];
  const filledWeeklyPredictions = state.predictions.filter((pred) => {
    if (!weekId) return false;
    const match = weekMatches.find(
      (item) => String(item.id) === String(pred.matchId),
    );
    return (
      match &&
      pred.homePred !== "" &&
      pred.awayPred !== "" &&
      getPlayerRole(getPlayerById(pred.playerId) || {}) !== "admin"
    );
  }).length;
  const leaderGap =
    general.length > 1 ? general[0].total - general[1].total : 0;

  return {
    totalPlayers: general.length,
    playedMatches: playedMatches.length,
    totalMatches: seasonMatches.length,
    weekMatches: weekMatches.length,
    filledWeeklyPredictions,
    leaderGap,
  };
}

function renderStandingsSummary(summary, generalLeader, weeklyLeader) {
  const strip = document.getElementById("standingsSummaryStrip");
  const hero = document.getElementById("standingsHero");
  if (strip) {
    strip.innerHTML = "";
    strip.hidden = true;
  }
  if (hero) {
    const general = getGeneralStandings(getActiveSeasonId());
    hero.innerHTML = renderLeaderboardTopThree(general);
  }
}

function renderStandingsInsights(summary, generalLeader, weeklyLeader) {
  const wrap = document.getElementById("standingsInsights");
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="standings-insights-grid standings-insights-grid--luxury">
      <div class="standings-insight-box tone-violet">
        <span>Aktif hafta</span>
        <strong>${summary.weekMatches || 0}</strong>
        <small>Bu haftadaki toplam maç sayısı</small>
      </div>
      <div class="standings-insight-box tone-green">
        <span>Girilen tahmin</span>
        <strong>${summary.filledWeeklyPredictions}</strong>
        <small>Tamamlanan tahmin adedi</small>
      </div>
      <div class="standings-insight-box tone-gold">
        <span>Oyuncu</span>
        <strong>${summary.totalPlayers}</strong>
        <small>Tabloya dahil aktif kişi</small>
      </div>
      <div class="standings-insight-box tone-neutral">
        <span>Zirve farkı</span>
        <strong>${summary.leaderGap ? `${summary.leaderGap}` : "0"}</strong>
        <small>${summary.leaderGap ? "puanlık fark var" : "liderlik yarışı başa baş"}</small>
      </div>
    </div>

    <div class="standings-highlight-panel standings-highlight-panel--luxury">
      <div class="standings-highlight-block standings-highlight-general">
        <span>Sezon lideri</span>
        <strong>${generalLeader ? escapeHtml(generalLeader.name) : "-"}</strong>
        <small>${generalLeader ? `${generalLeader.total} puan • ${generalLeader.exact} tam skor` : "Henüz puan oluşmadı"}</small>
      </div>

      <div class="standings-highlight-block standings-highlight-weekly">
        <span>Haftalık yarış lideri</span>
        <strong>${weeklyLeader ? escapeHtml(weeklyLeader.name) : "-"}</strong>
        <small>${weeklyLeader ? `${weeklyLeader.total} puan • ${weeklyLeader.exact} tam skor` : "Seçili hafta için veri yok"}</small>
      </div>
    </div>`;
}

function getWeeklyStandingsEmptyMessage(weekId) {
  if (!weekId) return "Hafta seçilmedi.";

  const weekMatches = getMatchesByWeekId(weekId);
  if (!weekMatches.length) return "Seçili haftada maç bulunmuyor.";

  const resolvedMatches =
    typeof getResolvedWeekMatches === "function"
      ? getResolvedWeekMatches(weekId)
      : weekMatches.filter((match) => match?.played);

  if (!resolvedMatches.length) {
    return "Haftalık yarış için henüz sonuçlanmış maç yok.";
  }

  return "Seçili hafta için puan oluşmadı.";
}

function renderStandings() {
  const seasonId = getActiveSeasonId();
  const general = getGeneralStandings(seasonId);
  const weekId = state.settings.activeWeekId;
  const weekly = weekId ? getWeeklyStandings(weekId) : [];

  const generalLeader = general[0] || null;
  const weeklyLeader = weekly[0] || null;
  const generalLeaderId = generalLeader?.id || null;
  const weeklyLeaderId = weeklyLeader?.id || null;
  const summary = getStandingsSummaryData(general, weekly);

  const generalLeaderBadge = document.getElementById("generalLeaderBadge");
  const weeklyLeaderBadge = document.getElementById("weeklyLeaderBadge");

  const generalRankMap = Object.fromEntries(
    general.map((row, index) => [row.id, index + 1]),
  );
  const weeklyRankMap = Object.fromEntries(
    weekly.map((row, index) => [row.id, index + 1]),
  );
  const generalDeltaMap = {};
  const weeklyDeltaMap = {};

  general.forEach((row, index) => {
    const generalRank = index + 1;
    const weeklyRank = weeklyRankMap[row.id];
    generalDeltaMap[row.id] = weeklyRank ? generalRank - weeklyRank : 0;
  });

  weekly.forEach((row, index) => {
    const weeklyRank = index + 1;
    const generalRank = generalRankMap[row.id];
    weeklyDeltaMap[row.id] = generalRank ? generalRank - weeklyRank : 0;
  });

  if (generalLeaderBadge) {
    generalLeaderBadge.textContent = generalLeader
      ? `Sezon lideri • ${generalLeader.name}`
      : "Sezon lideri bekleniyor";
  }
  if (weeklyLeaderBadge) {
    weeklyLeaderBadge.textContent = weeklyLeader
      ? `Hafta lideri • ${weeklyLeader.name}`
      : "Hafta lideri bekleniyor";
  }

  renderStandingsSummary(summary, generalLeader, weeklyLeader);
  renderStandingsInsights(summary, generalLeader, weeklyLeader);

  document.getElementById("standingsTable").innerHTML = general.length
    ? isMobileView()
      ? standingsRowsMobile(general, true, {
          leaderId: generalLeaderId,
          rankDeltaMap: generalDeltaMap,
        })
      : standingsRows(general, true, {
          leaderId: generalLeaderId,
          rankDeltaMap: generalDeltaMap,
        })
    : createEmptyState("Henüz puan tablosu oluşmadı.");

  document.getElementById("weeklyStandings").innerHTML = weekly.length
    ? isMobileView()
      ? standingsRowsMobile(weekly, false, {
          leaderId: weeklyLeaderId,
          weeklyMode: true,
          rankDeltaMap: weeklyDeltaMap,
        })
      : standingsRows(weekly, false, {
          leaderId: weeklyLeaderId,
          weeklyMode: true,
          rankDeltaMap: weeklyDeltaMap,
        })
    : createEmptyState(getWeeklyStandingsEmptyMessage(weekId));
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
  const totalMatches = seasonMatches.length;
  const playedMatches = seasonMatches.filter((match) => match.played).length;
  const seasonWeeks = state.weeks.filter(
    (week) => String(week.seasonId) === String(seasonId),
  );
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
      const averageValue = filledPreds.length ? total / filledPreds.length : 0;
      const accuracyValue = playedMatches
        ? ((exact + resultOnly) / playedMatches) * 100
        : 0;
      const exactRateValue = filledPreds.length
        ? (exact / filledPreds.length) * 100
        : 0;
      const participationRateValue = totalMatches
        ? (filledPreds.length / totalMatches) * 100
        : 0;
      const missed = Math.max(totalMatches - filledPreds.length, 0);

      const weeklyPlayedSummaries = seasonWeeks
        .map((week) => {
          const playedWeekMatches = getMatchesByWeekId(week.id).filter(
            (match) => {
              if (match?.played) return true;
              return (
                match?.homeScore !== "" &&
                match?.awayScore !== "" &&
                match?.homeScore != null &&
                match?.awayScore != null
              );
            },
          );
          const playedWeekMatchIds = new Set(
            playedWeekMatches.map((match) => String(match.id)),
          );
          if (!playedWeekMatchIds.size) return null;

          const filledWeekPreds = preds.filter(
            (pred) =>
              playedWeekMatchIds.has(String(pred.matchId)) &&
              pred.homePred !== "" &&
              pred.awayPred !== "",
          );
          if (!filledWeekPreds.length) {
            return {
              weekId: week.id,
              total: null,
            };
          }

          return {
            weekId: week.id,
            total: filledWeekPreds.reduce(
              (sum, pred) => sum + Number(pred.points || 0),
              0,
            ),
          };
        })
        .filter(Boolean);

      const weeklyTotals = weeklyPlayedSummaries
        .map((item) => item.total)
        .filter((value) => value !== null);

      const bestWeekScore = weeklyTotals.length ? Math.max(...weeklyTotals) : 0;
      const worstWeekScore = weeklyTotals.length
        ? Math.min(...weeklyTotals)
        : 0;
      const weekWins = seasonWeeks.reduce((count, week) => {
        const playedWeekMatches = getMatchesByWeekId(week.id).filter(
          (match) => {
            if (match?.played) return true;
            return (
              match?.homeScore !== "" &&
              match?.awayScore !== "" &&
              match?.homeScore != null &&
              match?.awayScore != null
            );
          },
        );
        const playedWeekMatchIds = new Set(
          playedWeekMatches.map((match) => String(match.id)),
        );
        if (!playedWeekMatchIds.size) return count;

        const weeklyStandings = state.players
          .filter((candidate) => getPlayerRole(candidate) !== "admin")
          .map((candidate) => {
            const weekPreds = state.predictions.filter(
              (pred) =>
                String(pred.playerId) === String(candidate.id) &&
                playedWeekMatchIds.has(String(pred.matchId)) &&
                pred.homePred !== "" &&
                pred.awayPred !== "",
            );
            return {
              playerId: candidate.id,
              total: weekPreds.reduce(
                (sum, pred) => sum + Number(pred.points || 0),
                0,
              ),
              exact: weekPreds.filter((pred) => Number(pred.points || 0) === 3)
                .length,
              resultOnly: weekPreds.filter(
                (pred) => Number(pred.points || 0) === 1,
              ).length,
              predictionCount: weekPreds.length,
            };
          })
          .filter((row) => row.predictionCount > 0)
          .sort(
            (a, b) =>
              b.total - a.total ||
              b.exact - a.exact ||
              b.resultOnly - a.resultOnly ||
              String(a.playerId).localeCompare(String(b.playerId), "tr"),
          );

        if (!weeklyStandings.length) return count;

        const top = weeklyStandings[0];
        const isLeader = weeklyStandings.some(
          (row) =>
            String(row.playerId) === String(player.id) &&
            row.total === top.total &&
            row.exact === top.exact &&
            row.resultOnly === top.resultOnly,
        );

        return isLeader ? count + 1 : count;
      }, 0);

      const recentPlayedWeeks = weeklyPlayedSummaries.slice(-5);

      const recentForm = recentPlayedWeeks.map((weekSummary) => {
        const week = getWeekById(weekSummary.weekId);
        if (weekSummary.total === null) {
          return {
            label: `${week?.number || "?"}.H -`,
            value: 0,
            type: "missing",
          };
        }

        const points = Number(weekSummary.total || 0);
        return {
          label: `${week?.number || "?"}.H ${points}p`,
          value: points,
          type: points >= 10 ? "exact" : points > 0 ? "result" : "zero",
        };
      });
      const recentFormPoints = recentForm.reduce(
        (sum, item) => sum + Number(item.value || 0),
        0,
      );

      return {
        id: player.id,
        name: player.name,
        total,
        exact,
        resultOnly,
        predictionCount: filledPreds.length,
        average: averageValue.toFixed(2),
        averageValue,
        accuracyValue,
        exactRateValue,
        participationRateValue,
        missed,
        recentForm,
        recentFormPoints,
        bestWeekScore,
        worstWeekScore,
        weekWins,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.accuracyValue - a.accuracyValue ||
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

function getStatMoodLabel(player) {
  if (!player) return "Henüz veri yok";
  if (player.rank === 1) return "Sezon lideri";
  if (player.recentFormPoints >= 7) return "Formda";
  if (player.exact >= 3) return "Keskin";
  if (player.accuracyValue >= 45) return "İsabetli";
  if (player.participationRateValue >= 95) return "Disiplinli";
  return "Takipte";
}

function safePercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function renderAdvancedStats() {
  const seasonId = getActiveSeasonId();
  const season = getSeasonById(seasonId);
  const info = getSeasonInsights(seasonId);
  const champion = getChampion(seasonId);
  const playerStats = getPlayerSeasonStats(seasonId);
  const liveLeader = playerStats[0] || null;
  const mostAccurate =
    [...playerStats].sort(
      (a, b) =>
        b.accuracyValue - a.accuracyValue ||
        b.total - a.total ||
        a.name.localeCompare(b.name, "tr"),
    )[0] || null;
  const sharpShooter =
    [...playerStats].sort(
      (a, b) => b.exact - a.exact || b.total - a.total,
    )[0] || null;
  const reliable =
    [...playerStats].sort(
      (a, b) =>
        b.participationRateValue - a.participationRateValue ||
        b.total - a.total,
    )[0] || null;
  const risingStar =
    [...playerStats].sort(
      (a, b) =>
        b.recentFormPoints - a.recentFormPoints ||
        b.averageValue - a.averageValue,
    )[0] || null;
  const bestAverage =
    [...playerStats].sort(
      (a, b) => b.averageValue - a.averageValue || b.total - a.total,
    )[0] || null;

  const totalPlayers = getVisiblePlayersOrdered().length;
  const allSeasonMatches = getMatchesBySeasonId(seasonId);
  const filledPredictions = playerStats.reduce(
    (sum, player) => sum + Number(player.predictionCount || 0),
    0,
  );
  const totalPossiblePredictions = allSeasonMatches.length * totalPlayers;
  const globalParticipation = totalPossiblePredictions
    ? (filledPredictions / totalPossiblePredictions) * 100
    : 0;
  const totalExact = playerStats.reduce((sum, player) => sum + player.exact, 0);
  const totalResult = playerStats.reduce(
    (sum, player) => sum + player.resultOnly,
    0,
  );
  const bestWeekPlayer =
    [...playerStats].sort(
      (a, b) => b.bestWeekScore - a.bestWeekScore || b.total - a.total,
    )[0] || null;
  const worstWeekPlayer =
    [...playerStats].sort(
      (a, b) => a.worstWeekScore - b.worstWeekScore || a.rank - b.rank,
    )[0] || null;

  const heroTarget = document.getElementById("statsHeroCard");
  const overviewTarget = document.getElementById("advancedStatsGrid");
  const leadersTarget = document.getElementById("statsLeadersGrid");
  const playerCardsTarget = document.getElementById("insightsList");
  const deepTarget = document.getElementById("statsDeepGrid");

  if (
    !heroTarget ||
    !overviewTarget ||
    !leadersTarget ||
    !playerCardsTarget ||
    !deepTarget
  ) {
    return;
  }

  const championLabel = champion
    ? `${champion.name}, ${season?.name || "sezonu"} ${champion.total} puanla şampiyon tamamladı.`
    : liveLeader
      ? `${liveLeader.name}, sezon bugün bitse ${liveLeader.total} puanla zirvede yer alıyor.`
      : "Henüz canlı lider oluşmadı.";

  heroTarget.innerHTML = liveLeader
    ? `
      <div class="stats-hero-layout">
        <div>
          <span class="stats-hero-kicker">İstatistik Merkezi</span>
          <h3 class="stats-hero-title">${escapeHtml(season?.name || "Aktif sezon")} için oyun resmi burada.</h3>
          <p class="stats-hero-summary">
            Bu ekran artık sadece puanı değil; isabet, katılım, form ve oyuncu karakterini de gösterir. ${escapeHtml(championLabel)}
          </p>
          <div class="stats-hero-meta">
            <span class="stats-hero-chip">🎯 ${safePercent(globalParticipation)} katılım</span>
            <span class="stats-hero-chip">⚽ ${info.playedMatches}/${info.totalMatches} maç oynandı</span>
            <span class="stats-hero-chip">🔥 ${totalExact} tam skor</span>
            <span class="stats-hero-chip">✅ ${totalResult} doğru sonuç</span>
          </div>
        </div>
        <div class="stats-hero-side">
          <div class="stats-hero-spotlight">
            <span class="stats-spotlight-kicker">Canlı Lider</span>
            <div class="stats-spotlight-name">${escapeHtml(liveLeader.name)}</div>
            <div class="stats-spotlight-score"><strong>${liveLeader.total}</strong>puan</div>
            <div class="stats-spotlight-grid">
              <div class="stats-spotlight-stat"><span>Başarı</span><strong>${safePercent(liveLeader.accuracyValue)}</strong></div>
              <div class="stats-spotlight-stat"><span>Ortalama</span><strong>${liveLeader.average}</strong></div>
              <div class="stats-spotlight-stat"><span>Tam skor</span><strong>${liveLeader.exact}</strong></div>
              <div class="stats-spotlight-stat"><span>Hafta liderliği</span><strong>${liveLeader.weekWins}</strong></div>
            </div>
            ${champion ? `<button onclick="celebrateChampion('${seasonId}', true)">Şampiyonu Kutla</button>` : ""}
          </div>
        </div>
      </div>`
    : createEmptyState("İstatistik merkezi için henüz yeterli veri yok.");

  overviewTarget.innerHTML = [
    {
      label: "Toplam maç",
      value: info.totalMatches,
      note: `${info.playedMatches} maç oynandı`,
    },
    {
      label: "Toplam oyuncu",
      value: totalPlayers,
      note: "Admin hariç aktif tahminciler",
    },
    {
      label: "Katılım oranı",
      value: safePercent(globalParticipation),
      note: `${filledPredictions}/${totalPossiblePredictions || 0} tahmin dolu`,
    },
    {
      label: "Maç başı puan",
      value: info.averagePoints,
      note: "Sezon genel ortalaması",
    },
    {
      label: "Tam skor toplamı",
      value: totalExact,
      note: "3 puan alınan tahminler",
    },
    {
      label: "Doğru sonuç toplamı",
      value: totalResult,
      note: "1 puan alınan tahminler",
    },
    {
      label: "En iyi ortalama",
      value: bestAverage ? bestAverage.average : "0.00",
      note: bestAverage ? escapeHtml(bestAverage.name) : "Henüz veri yok",
    },
    {
      label: "En yüksek başarı",
      value: mostAccurate ? safePercent(mostAccurate.accuracyValue) : "0.0%",
      note: mostAccurate ? escapeHtml(mostAccurate.name) : "Henüz veri yok",
    },
  ]
    .map(
      (card) => `
        <article class="stats-overview-card">
          <span>${card.label}</span>
          <strong>${card.value}</strong>
          <p>${card.note}</p>
        </article>`,
    )
    .join("");

  leadersTarget.innerHTML = [
    {
      tag: "👑 Puan lideri",
      name: liveLeader?.name || "-",
      value: liveLeader ? `${liveLeader.total} puan` : "Veri yok",
      note: liveLeader
        ? `Başarı ${safePercent(liveLeader.accuracyValue)} • Ortalama ${liveLeader.average}`
        : "Henüz veri yok",
    },
    {
      tag: "🎯 En isabetli",
      name: mostAccurate?.name || "-",
      value: mostAccurate
        ? safePercent(mostAccurate.accuracyValue)
        : "Veri yok",
      note: mostAccurate
        ? `${mostAccurate.exact + mostAccurate.resultOnly} doğru tahmin`
        : "Henüz veri yok",
    },
    {
      tag: "🔥 Tam skor kralı",
      name: sharpShooter?.name || "-",
      value: sharpShooter ? `${sharpShooter.exact} tam skor` : "Veri yok",
      note: sharpShooter
        ? `Tam skor oranı ${safePercent(sharpShooter.exactRateValue)}`
        : "Henüz veri yok",
    },
    {
      tag: "🛡️ En disiplinli",
      name: reliable?.name || "-",
      value: reliable
        ? safePercent(reliable.participationRateValue)
        : "Veri yok",
      note: reliable
        ? `${reliable.predictionCount} dolu tahmin`
        : "Henüz veri yok",
    },
  ]
    .map(
      (item) => `
        <article class="stats-leader-card">
          <span class="stats-leader-tag">${item.tag}</span>
          <div class="stats-leader-name">${escapeHtml(item.name)}</div>
          <div class="stats-leader-value">${item.value}</div>
          <p>${item.note}</p>
        </article>`,
    )
    .join("");

  playerCardsTarget.innerHTML = playerStats.length
    ? `<div class="player-stats-grid">${playerStats
        .map((player) => {
          const formMarkup = player.recentForm.length
            ? player.recentForm
                .map(
                  (item) =>
                    `<span class="form-pill ${item.type ? `is-${item.type}` : ""}">${item.label}</span>`,
                )
                .join("")
            : '<span class="small-meta">Henüz tahmin yok</span>';
          return `
            <article class="player-stat-card ${player.rank === 1 ? "is-leader" : ""} ${risingStar && String(risingStar.id) === String(player.id) ? "is-rising" : ""}">
              <div class="player-stat-head">
                <div class="player-stat-main">
                  <div class="player-topline">
                    <div class="player-rank-badge">#${player.rank}</div>
                    <span class="player-card-chip">${getStatMoodLabel(player)}</span>
                  </div>
                  <div class="player-stat-name">${escapeHtml(player.name)}</div>
                  <div class="player-card-caption">${player.rank === 1 ? "Lider koltuğunda" : `Lidere fark ${player.gapToLeader}`}</div>
                </div>
              </div>

              <div class="player-stat-metrics">
                <div class="player-mini-stat"><span>Puan</span><strong>${player.total}</strong></div>
                <div class="player-mini-stat"><span>Başarı</span><strong>${safePercent(player.accuracyValue)}</strong></div>
                <div class="player-mini-stat"><span>Ortalama</span><strong>${player.average}</strong></div>
                <div class="player-mini-stat"><span>Tam skor</span><strong>${player.exact}</strong></div>
                <div class="player-mini-stat"><span>Doğru sonuç</span><strong>${player.resultOnly}</strong></div>
                <div class="player-mini-stat"><span>Katılım</span><strong>${safePercent(player.participationRateValue)}</strong></div>
              </div>

              <div class="player-form-row">
                <span class="player-card-caption">Son 5 hafta puanı</span>
                <div class="player-form-pills">${formMarkup}</div>
              </div>

              <div class="player-footer-row">
                <span class="player-card-caption">Kısa özet</span>
                <div class="player-footer-pills">
                <span class="player-footer-pill">🏆 ${player.weekWins} kez lider</span>
                <span class="player-footer-pill">🔥 En iyi hafta: ${player.bestWeekScore} puan</span>
                <span class="player-footer-pill">❌ Boş tahmin: ${player.missed}</span>
              </div>
              </div>
            </article>`;
        })
        .join("")}</div>`
    : createEmptyState("Henüz oyuncu istatistiği oluşmadı.");

  deepTarget.innerHTML = [
    {
      label: "Yükselen oyuncu",
      value: risingStar ? escapeHtml(risingStar.name) : "-",
      note: risingStar
        ? `Son 5 haftada ${risingStar.recentFormPoints} puan topladı.`
        : "Henüz veri yok.",
    },
    {
      label: "En iyi tek hafta",
      value: bestWeekPlayer ? `${bestWeekPlayer.bestWeekScore} puan` : "-",
      note: bestWeekPlayer
        ? escapeHtml(bestWeekPlayer.name)
        : "Henüz veri yok.",
    },
    {
      label: "En düşük hafta",
      value: worstWeekPlayer ? `${worstWeekPlayer.worstWeekScore} puan` : "-",
      note: worstWeekPlayer
        ? `${escapeHtml(worstWeekPlayer.name)} için sezonun en düşük dolu haftası.`
        : "Henüz veri yok.",
    },
    {
      label: "En güvenli tahmin profili",
      value: reliable ? escapeHtml(reliable.name) : "-",
      note: reliable
        ? `${safePercent(reliable.participationRateValue)} katılım ile düzenli ilerliyor.`
        : "Henüz veri yok.",
    },
    {
      label: "En verimli oyuncu",
      value: bestAverage ? escapeHtml(bestAverage.name) : "-",
      note: bestAverage
        ? `Tahmin başına ${bestAverage.average} puan ortalaması var.`
        : "Henüz veri yok.",
    },
    {
      label: "Sezon kapanış notu",
      value: champion
        ? escapeHtml(champion.name)
        : liveLeader
          ? escapeHtml(liveLeader.name)
          : "-",
      note: champion
        ? `${champion.total} puanla sezon tamamlandı.`
        : liveLeader
          ? `Şimdilik zirvede ${liveLeader.total} puan var.`
          : "Henüz veri yok.",
    },
  ]
    .map(
      (item) => `
        <article class="stats-deep-card">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
          <p>${item.note}</p>
        </article>`,
    )
    .join("");

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

function capturePageViewport() {
  return {
    windowX: window.scrollX || window.pageXOffset || 0,
    windowY: window.scrollY || window.pageYOffset || 0,
    capturedAt: Date.now(),
  };
}

/* Lig puan durumu - apisiz maç sonuçlarından hesaplanır */
function getLeagueStandingsCacheKey(seasonId) {
  return String(seasonId || getActiveSeasonId() || "default");
}

function normalizeLeagueStandingNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function buildLeagueStandingsFromResults(seasonId = getActiveSeasonId()) {
  const activeSeasonId = String(seasonId || "");
  const teamNames = new Set();

  state.teams
    .filter((team) => String(team.seasonId || "") === activeSeasonId)
    .forEach((team) => team.name && teamNames.add(String(team.name).trim()));

  state.matches
    .filter((match) => String(match.seasonId || "") === activeSeasonId)
    .forEach((match) => {
      if (match.homeTeam) teamNames.add(String(match.homeTeam).trim());
      if (match.awayTeam) teamNames.add(String(match.awayTeam).trim());
    });

  const tableMap = new Map();
  [...teamNames].filter(Boolean).forEach((teamName) => {
    tableMap.set(teamName, {
      teamName,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
    });
  });

  const playedMatches = state.matches.filter((match) => {
    if (String(match.seasonId || "") !== activeSeasonId) return false;
    if (!match.played) return false;
    const homeScore = Number(match.homeScore);
    const awayScore = Number(match.awayScore);
    return Number.isFinite(homeScore) && Number.isFinite(awayScore);
  });

  playedMatches.forEach((match) => {
    const homeName = String(match.homeTeam || "").trim();
    const awayName = String(match.awayTeam || "").trim();
    if (!homeName || !awayName) return;

    if (!tableMap.has(homeName))
      tableMap.set(homeName, {
        teamName: homeName,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0,
        points: 0,
      });
    if (!tableMap.has(awayName))
      tableMap.set(awayName, {
        teamName: awayName,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0,
        points: 0,
      });

    const home = tableMap.get(homeName);
    const away = tableMap.get(awayName);
    const homeScore = Number(match.homeScore);
    const awayScore = Number(match.awayScore);

    home.played += 1;
    away.played += 1;
    home.goalsFor += homeScore;
    home.goalsAgainst += awayScore;
    away.goalsFor += awayScore;
    away.goalsAgainst += homeScore;

    if (homeScore > awayScore) {
      home.won += 1;
      away.lost += 1;
      home.points += 3;
    } else if (homeScore < awayScore) {
      away.won += 1;
      home.lost += 1;
      away.points += 3;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  });

  const rows = Array.from(tableMap.values()).map((row) => ({
    ...row,
    goalDiff: row.goalsFor - row.goalsAgainst,
  }));

  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      a.teamName.localeCompare(b.teamName, "tr"),
  );

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function getCachedLeagueStandings(seasonId = getActiveSeasonId()) {
  const cache = state.settings.leagueStandingsCache || {};
  const saved = cache[getLeagueStandingsCacheKey(seasonId)];
  return saved && Array.isArray(saved.rows) ? saved : null;
}

async function persistLeagueStandingsCache(seasonId, rows) {
  const key = getLeagueStandingsCacheKey(seasonId);
  if (!state.settings.leagueStandingsCache)
    state.settings.leagueStandingsCache = {};
  const payload = {
    seasonId: String(seasonId || ""),
    updatedAt: new Date().toISOString(),
    rows,
  };
  state.settings.leagueStandingsCache[key] = payload;
  saveState();

  if (
    typeof isFirebaseReady === "function" &&
    isFirebaseReady() &&
    typeof firebaseUpdate === "function"
  ) {
    await firebaseUpdate("settings", {
      leagueStandingsCache: state.settings.leagueStandingsCache,
      updatedAt: new Date().toISOString(),
    });
  }

  return payload;
}

function renderLeagueStandingsModal(payload) {
  const modal = document.getElementById("leagueStandingsModal");

  const title = document.getElementById("leagueStandingsModalTitle");
  const meta = document.getElementById("leagueStandingsModalMeta");
  const body = document.getElementById("leagueStandingsModalBody");
  if (!modal || !body) return;

  const season = getSeasonById(payload?.seasonId || getActiveSeasonId());
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const playedTotal =
    rows.reduce(
      (sum, row) => sum + normalizeLeagueStandingNumber(row.played),
      0,
    ) / 2;
  const updatedText = payload?.updatedAt
    ? new Date(payload.updatedAt).toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Henüz güncellenmedi";

  if (title) title.textContent = `${season?.name || "Aktif sezon"} Puan Durumu`;
  if (meta)
    meta.textContent = `${Math.round(playedTotal)} oynanmış maçtan hesaplandı • Son çekim: ${updatedText}`;

  if (!rows.length) {
    body.innerHTML = createEmptyState(
      "Henüz oynanmış maç sonucu yok. Skorlar geldikçe burada lig puan durumu oluşacak.",
    );
  } else {
    body.innerHTML = `
      <div class="league-standings-table-shell">
        <div class="league-standings-row league-standings-head-row">
          <span>#</span>
          <span>Takım</span>
          <span>O</span>
          <span>Av</span>
          <span>P</span>
        </div>
        ${rows
          .map(
            (row) => `
            <div class="league-standings-row ${row.rank <= 4 ? "is-europe" : ""} ${row.rank >= rows.length - 3 ? "is-danger" : ""}">
              <span class="league-standings-rank">${row.rank}</span>
              <span class="league-standings-team">
                ${teamLogoHtml(row.teamName, payload?.seasonId || getActiveSeasonId(), "league-standings-logo")}
                <strong>${escapeHtml(row.teamName)}</strong>
              </span>
              <span>${normalizeLeagueStandingNumber(row.played)}</span>
              <span>${normalizeLeagueStandingNumber(row.goalDiff) > 0 ? "+" : ""}${normalizeLeagueStandingNumber(row.goalDiff)}</span>
              <span class="league-standings-points">${normalizeLeagueStandingNumber(row.points)}</span>
            </div>
          `,
          )
          .join("")}
      </div>
    `;
    hydrateTeamLogosIn(body);
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  requestAnimationFrame(() => {
    modal.classList.add("is-open");
  });
}

let leagueStandingsCloseTimer = null;

function closeLeagueStandingsModal() {
  const modal = document.getElementById("leagueStandingsModal");
  if (!modal || modal.classList.contains("hidden")) return;

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");

  window.clearTimeout(leagueStandingsCloseTimer);
  leagueStandingsCloseTimer = window.setTimeout(() => {
    if (!modal.classList.contains("is-open")) {
      modal.classList.add("hidden");
    }
  }, 300);
}

async function pullLeagueStandingsFromCurrentResults(buttonOrEvent) {
  const actionButton = getActionButtonFromArg(buttonOrEvent);
  const modal = document.getElementById("leagueStandingsModal");

  if (modal?.classList.contains("is-open")) {
    closeLeagueStandingsModal();
    return;
  }

  const seasonId = getActiveSeasonId();
  if (!seasonId) {
    return showAlert("Önce aktif sezon seçmelisin.", {
      title: "Eksik seçim",
      type: "warning",
    });
  }

  setAsyncButtonState(actionButton, "loading", { loading: "" });
  try {
    const rows = buildLeagueStandingsFromResults(seasonId);
    const playedTeamRows = rows.filter(
      (row) => normalizeLeagueStandingNumber(row.played) > 0,
    );
    const payload = await persistLeagueStandingsCache(seasonId, rows);
    renderLeagueStandingsModal(payload);
    setAsyncButtonState(actionButton, "success", { success: "" });
    if (!playedTeamRows.length) {
      showAlert(
        "Puan durumu hazırlandı ama henüz oynanmış maç sonucu bulunamadı.",
        { title: "Bilgi", type: "info" },
      );
    }
  } catch (error) {
    const cached = getCachedLeagueStandings(seasonId);
    if (cached) renderLeagueStandingsModal(cached);
    setAsyncButtonState(actionButton, "error", { error: "Hata" });
    showAlert(error?.message || "Puan durumu çekilirken hata oluştu.", {
      title: "Hata",
      type: "error",
    });
  }
}
/* 05-actions-init.js */

function renderCurrentTabOnly(
  tabName = state.settings.currentTab || "dashboard",
) {
  switch (tabName) {
    case "dashboard":
      renderDashboardOverview();
      renderDashboardSyncCard();
      renderMatches("dashboardMatches", state.settings.activeWeekId);
      renderStats();
      break;

    case "seasons":
      renderSeasons();
      break;

    case "players":
      renderPlayers();
      renderFirebaseAdminPanel();
      bindAdminPanelTableScroll();
      updateAdminSyncPanel();
      break;

    case "weeks":
      renderWeeks();
      break;

    case "matches":
      renderMatches(
        "matchesList",
        document.getElementById("matchesFilterWeek").value ||
          state.settings.activeWeekId,
      );
      break;

    case "predictions":
      renderPredictions();
      break;

    case "standings":
      renderStandings();
      break;

    case "stats":
      renderAdvancedStats();
      renderStats();
      break;

    case "notifications":
      if (typeof renderNotificationCenter === "function")
        renderNotificationCenter();
      break;

    case "logs":
      if (typeof renderPredictionLogs === "function") {
        renderPredictionLogs({ force: true });
      }
      break;

    case "backup":
      renderBackupPanel();
      break;

    case "settings":
      renderWelcomeSettingsPanel();
      break;

    default:
      renderDashboardOverview();
      renderMatches("dashboardMatches", state.settings.activeWeekId);
      renderStats();
      break;
  }
}

function renderAll() {
  if (typeof persistCurrentViewportForActiveTab === "function") {
    persistCurrentViewportForActiveTab();
  }
  if (typeof logAutoSyncDebug === "function") {
    logAutoSyncDebug("renderAll:start", {
      currentTab: state.settings.currentTab || "dashboard",
    });
  }
  const viewportSnapshot = capturePredictionViewport();
  const pageViewportSnapshot = capturePageViewport();
  const runSafe = (label, fn) => {
    try {
      return fn();
    } catch (error) {
      console.error(`[renderAll:${label}]`, error);
      return null;
    }
  };

  runSafe("ensureActiveSelections", () => ensureActiveSelections());
  runSafe("recalculateAllPoints", () => recalculateAllPoints());
  runSafe("renderSelects", () => renderSelects());

  runSafe("updateLoginOverlay", () => updateLoginOverlay());
  runSafe("updateAdminSyncToggleButton", () => updateAdminSyncToggleButton());
  runSafe("applyRolePermissions", () => applyRolePermissions());
  runSafe("ensureHeaderSyncButtons", () => ensureHeaderSyncButtons());
  runSafe("updateNavSelection", () =>
    updateNavSelection(state.settings.currentTab || "dashboard"),
  );

  runSafe("renderCurrentTabOnly", () =>
    renderCurrentTabOnly(state.settings.currentTab || "dashboard"),
  );

  if (typeof refreshAvatarImages === "function") {
    runSafe("refreshAvatarImages", () => refreshAvatarImages(document));
  }

  runSafe("schedulePredictionViewportRestore", () =>
    schedulePredictionViewportRestore(viewportSnapshot),
  );
  runSafe("schedulePageViewportRestore", () =>
    schedulePageViewportRestore(pageViewportSnapshot),
  );

  if (window.refreshPlayerDetailModal) {
    runSafe("refreshPlayerDetailModal", () => refreshPlayerDetailModal());
  }

  if (typeof logAutoSyncDebug === "function") {
    logAutoSyncDebug("renderAll:end", {
      currentTab: state.settings.currentTab || "dashboard",
    });
  }
}

async function addSeason(event) {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde bu alan sadece görüntülenir.", {
      title: "Yetki yok",
      type: "warning",
    });

  const button =
    event?.currentTarget || document.getElementById("addSeasonBtn");
  if (button?.disabled) return;

  const nameInput = document.getElementById("seasonName");
  const leagueInput = document.getElementById("seasonLeague");
  const name = String(nameInput?.value || "").trim();
  const leagueName = String(leagueInput?.value || "").trim();

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
    (season) => normalizeText(season.name) === normalizeText(name),
  );
  if (seasonExists)
    return showAlert("Bu sezon zaten var.", {
      title: "Tekrarlayan kayıt",
      type: "warning",
    });

  const seasonId = uid("season");
  const newSeason = { id: seasonId, name, leagueName };
  const previousSeasons = state.seasons.map((season) => ({ ...season }));
  const previousPlayers = state.players.map((player) => ({
    ...player,
    seasonStates: { ...getPlayerSeasonStateMap(player) },
  }));
  const previousActiveSeasonId = state.settings.activeSeasonId;
  const previousActiveWeekId = state.settings.activeWeekId;

  if (button) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = "Oluşturuluyor...";
  }

  try {
    state.seasons.push(newSeason);
    state.players = state.players.map((player) => {
      if (getPlayerRole(player) === "admin") return player;
      return {
        ...player,
        seasonStates: {
          ...createDefaultSeasonStateMap(true),
          ...getPlayerSeasonStateMap(player),
          [seasonId]: true,
        },
      };
    });
    state.settings.activeSeasonId = seasonId;
    state.settings.activeWeekId = null;

    if (useOnlineMode && isFirebaseReady()) {
      await persistSeasonRegistryToFirebase();

      const remoteSettings = (await firebaseRead("settings")) || {};
      const remoteSeasons = Array.isArray(remoteSettings.seasonsMeta)
        ? remoteSettings.seasonsMeta
            .map(normalizeSeasonRegistryItem)
            .filter(Boolean)
        : [];
      if (!remoteSeasons.some((season) => season.id === seasonId)) {
        throw new Error("Sezon Firebase'e doğrulanmış şekilde kaydedilemedi.");
      }

      for (const player of state.players) {
        if (getPlayerRole(player) === "admin") continue;
        await updateOnlineUser({
          id: player.id,
          seasonStates: getPlayerSeasonStateMap(player),
        });
      }
    }

    if (nameInput) nameInput.value = "";
    if (leagueInput) leagueInput.value = "";
    saveState(true);
    renderAll();

    if (typeof window.writeAppAuditLogEntry === "function") {
      window.writeAppAuditLogEntry({
        actionType: "season_create",
        actionLabel: "Sezon eklendi",
        detail: `${name} sezonu eklendi`,
        entityType: "season",
        entityId: seasonId,
        newValue: { season: name, leagueName },
      });
    }
  } catch (error) {
    state.seasons = previousSeasons;
    state.players = previousPlayers;
    state.settings.activeSeasonId = previousActiveSeasonId;
    state.settings.activeWeekId = previousActiveWeekId;
    saveState(true);
    renderAll();
    return showAlert(error?.message || "Sezon Firebase'e kaydedilemedi.", {
      title: "Kayıt Hatası",
      type: "warning",
    });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.originalText || "Sezon Oluştur";
      delete button.dataset.originalText;
    }
  }
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
const MOBILE_SYNC_SUCCESS_ICON_DURATION = 180000; // 3 dakika
function setAsyncButtonState(button, state = "idle", labels = {}) {
  if (!button) return;

  const isIconButton = button.classList.contains("dashboard-mobile-sync-btn");
  const iconEl = isIconButton
    ? button.querySelector(".dashboard-mobile-sync-btn__icon")
    : null;

  if (!isIconButton && !button.dataset.originalText) {
    button.dataset.originalText = (button.textContent || "").trim();
  }

  const original =
    button.dataset.originalText || (button.textContent || "").trim();

  const loadingText = labels.loading || labels.pending || "";
  const successText = labels.success || "⟳";
  const errorText = labels.error || "Tekrar dene";

  button.classList.remove("btn-loading", "btn-success", "btn-error");
  button.disabled = false;
  button.removeAttribute("aria-busy");

  if (isIconButton && iconEl) {
    if (state === "loading") {
      button.classList.add("btn-loading");
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-label", "Skorlar güncelleniyor");
      button.setAttribute("title", "Skorlar güncelleniyor");
      iconEl.textContent = "⟳";
      return;
    }

    if (state === "success") {
      button.classList.add("btn-success");
      button.disabled = false;
      button.setAttribute("aria-label", "Skorlar güncellendi");
      button.setAttribute("title", "Skorlar güncellendi");
      iconEl.textContent = "✓";

      window.setTimeout(() => {
        button.classList.remove("btn-success");
        button.disabled = false;
        button.setAttribute("aria-label", "Skorları Güncelle");
        button.setAttribute("title", "Skorları Güncelle");
        iconEl.textContent = "⟳";
      }, 1200);
      return;
    }

    if (state === "error") {
      button.classList.add("btn-error");
      button.disabled = false;
      button.setAttribute("aria-label", "Skor güncelleme hatası");
      button.setAttribute("title", "Skor güncelleme hatası");
      iconEl.textContent = "!";

      window.setTimeout(() => {
        button.classList.remove("btn-error");
        button.setAttribute("aria-label", "Skorları Güncelle");
        button.setAttribute("title", "Skorları Güncelle");
        iconEl.textContent = "⟳";
      }, 1600);
      return;
    }

    button.setAttribute("aria-label", "Skorları Güncelle");
    button.setAttribute("title", "Skorları Güncelle");
    iconEl.textContent = "⟳";
    return;
  }

  if (state === "loading") {
    button.classList.add("btn-loading");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-label", loadingText);
    button.setAttribute("title", loadingText);
    button.textContent = loadingText;
    return;
  }

  if (state === "success") {
    button.classList.add("btn-success");
    button.disabled = false;
    button.setAttribute("aria-label", successText);
    button.setAttribute("title", successText);
    button.textContent = successText;

    window.setTimeout(() => {
      button.classList.remove("btn-success");
      button.disabled = false;
      button.setAttribute("aria-label", original || successText);
      button.setAttribute("title", original || successText);
      button.textContent = original;
    }, 1200);
    return;
  }

  if (state === "error") {
    button.classList.add("btn-error");
    button.disabled = false;
    button.setAttribute("aria-label", errorText);
    button.setAttribute("title", errorText);
    button.textContent = errorText;

    window.setTimeout(() => {
      button.classList.remove("btn-error");
      button.disabled = false;
      button.setAttribute("aria-label", original || errorText);
      button.setAttribute("title", original || errorText);
      button.textContent = original;
    }, 1600);
    return;
  }

  button.disabled = false;
  button.setAttribute("aria-label", original || "İşlem");
  button.setAttribute("title", original || "İşlem");
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
  const supportedTeamInput = document.getElementById("playerSupportedTeam");
  const name = input?.value?.trim() || "";
  const password = passwordInput?.value?.trim() || "1234";
  const supportedTeam = supportedTeamInput?.value?.trim() || "";
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
    panelAdmin: false,
    seasonStates: createDefaultSeasonStateMap(true),
    supportedTeam,
    avatar: "",
  };

  if (useOnlineMode) {
    addUserOnline(newPlayer, actionButton);
    return;
  }

  state.players.push(newPlayer);
  input.value = "";
  passwordInput.value = "";
  if (supportedTeamInput) supportedTeamInput.value = "";
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
      supportedTeam: player.supportedTeam || "",
      panelAdmin: player.panelAdmin === true,
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
    const supportedTeamField = document.getElementById("playerSupportedTeam");
    if (supportedTeamField) supportedTeamField.value = "";
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

async function addWeek() {
  if (isReadOnlyMode())
    return showAlert("Kullanıcı görünümünde bu alan sadece görüntülenir.", {
      title: "Yetki yok",
      type: "warning",
    });
  const seasonId = getActiveSeasonId();
  const number = Number(document.getElementById("weekNumber").value);
  const status = "hazirlaniyor";
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
  if (isFirebaseReady()) {
    try {
      await persistWeekRegistryToFirebase();
    } catch (error) {
      console.warn("Hafta hazırlık kaydı Firebase'e yazılamadı:", error);
    }
  }
  if (typeof window.writeAppAuditLogEntry === "function") {
    const season = getSeasonById(seasonId);
    window.writeAppAuditLogEntry({
      actionType: "week_create",
      actionLabel: "Hafta eklendi",
      detail: `${season?.name || "Sezon"} · ${number}. hafta eklendi`,
      entityType: "week",
      entityId: week.id,
      newValue: { season: season?.name || "", weekNo: number, status },
    });
  }
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
  if (useOnlineMode && shouldPublishMatchChanges(newMatch.weekId)) {
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
  if (typeof window.writeAppAuditLogEntry === "function") {
    const season = getSeasonById(seasonId);
    const week = state.weeks.find((item) => String(item.id) === String(weekId));
    window.writeAppAuditLogEntry({
      actionType: "match_create",
      actionLabel: "Maç eklendi",
      detail: `${homeTeam} - ${awayTeam} maçı eklendi (${season?.name || "Sezon"}, ${week?.number || "?"}. hafta)`,
      entityType: "match",
      entityId: newMatch.id,
      newValue: {
        homeTeam,
        awayTeam,
        date,
        season: season?.name || "",
        weekNo: week?.number || "",
      },
    });
  }
  renderAll();
}

function setWelcomeSettingsStatus(message, type = "") {
  const el = document.getElementById("welcomeSettingsStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("success", type === "success");
  el.classList.toggle("error", type === "error");
}

function readWelcomeSettingsForm() {
  return normalizeWelcomeCardSettings({
    enabled: document.getElementById("welcomeEnabled")?.checked ?? true,
    title: document.getElementById("welcomeTitleInput")?.value || "Hoş geldin!",
    message:
      document.getElementById("welcomeMessageInput")?.value ||
      "İyi haftalar, bol şans! ✨",
    imageFile: document.getElementById("welcomeImageInput")?.value || "",
    imageFit:
      document.getElementById("welcomeImageFitSelect")?.value || "cover",
    showOnce: document.getElementById("welcomeShowOnce")?.checked ?? false,
    updatedAt: state.settings?.welcomeCard?.updatedAt || "",
  });
}

function updateWelcomeSettingsPreview(config = readWelcomeSettingsForm()) {
  const title = document.getElementById("welcomeAdminPreviewTitle");
  const message = document.getElementById("welcomeAdminPreviewMessage");
  const image = document.getElementById("welcomeAdminPreviewImage");
  if (image) {
    image.classList.toggle("is-contain", config.imageFit === "contain");
    image.classList.toggle("is-cover", config.imageFit !== "contain");
  }
  if (title) title.textContent = config.title || "Hoş geldin!";
  if (message)
    message.textContent = config.message || "İyi haftalar, bol şans! ✨";
  if (image) {
    const src = getWelcomeImageSrc(config.imageFile);
    image.src = src || "";
    image.classList.toggle("hidden", !src);
  }
}

function renderWelcomeSettingsPanel() {
  const config = getWelcomeCardSettings();
  const enabled = document.getElementById("welcomeEnabled");
  const title = document.getElementById("welcomeTitleInput");
  const message = document.getElementById("welcomeMessageInput");
  const image = document.getElementById("welcomeImageInput");
  const imageFit = document.getElementById("welcomeImageFitSelect");
  const showOnce = document.getElementById("welcomeShowOnce");
  if (!enabled || !title || !message || !image || !imageFit || !showOnce)
    return;
  enabled.checked = config.enabled;
  title.value = config.title;
  message.value = config.message;
  image.value = config.imageFile;
  imageFit.value = config.imageFit || "cover";
  showOnce.checked = config.showOnce;
  updateWelcomeSettingsPreview(config);
}

async function saveWelcomeSettingsFromPanel() {
  if (getCurrentRole() !== "admin") return;
  const config = {
    ...readWelcomeSettingsForm(),
    updatedAt: new Date().toISOString(),
  };
  state.settings.welcomeCard = config;
  saveState(true);
  try {
    if (
      typeof firebaseUpdate === "function" &&
      typeof isFirebaseReady === "function" &&
      isFirebaseReady()
    ) {
      await firebaseUpdate("settings", {
        welcomeCard: config,
        updatedAt: new Date().toISOString(),
      });
    }
    renderWelcomeSettingsPanel();
    setWelcomeSettingsStatus("Karşılama kartı ayarları kaydedildi.", "success");
  } catch (error) {
    console.error("Karşılama kartı kaydetme hatası:", error);
    setWelcomeSettingsStatus(
      "Yerel kayıt alındı ama Firebase'e yazılamadı.",
      "error",
    );
  }
}

function previewWelcomeSettingsFromPanel() {
  const config = readWelcomeSettingsForm();
  updateWelcomeSettingsPreview(config);
  showWelcomeOverlay(getAuthUser?.(), { config, force: true, duration: 5000 });
}

function switchTab(tabName, options = {}) {
  if (
    getCurrentRole() !== "admin" &&
    [
      "backup",
      "notifications",
      "seasons",
      "weeks",
      "matches",
      "settings",
    ].includes(tabName)
  ) {
    tabName = "dashboard";
  }

  const previousTab = state.settings.currentTab || "dashboard";
  if (
    typeof persistViewportForTab === "function" &&
    !options.skipPersistPrevious
  ) {
    persistViewportForTab(previousTab);
  }

  state.settings.currentTab = tabName;
  closeMobileAdminMenu();
  updateNavSelection(tabName);
  ensureHeaderSyncButtons();

  document
    .querySelectorAll(".tab-panel")
    .forEach((panel) =>
      panel.classList.toggle("active", panel.id === `tab-${tabName}`),
    );

  renderCurrentTabOnly(tabName);

  const activePanel = document.getElementById(`tab-${tabName}`);
  if (activePanel && !options.skipViewportRestore) {
    requestAnimationFrame(() => {
      if (typeof scheduleTabViewportRestore === "function") {
        scheduleTabViewportRestore(tabName, { fallbackToTop: true });
      }
    });
  }

  if (tabName === "dashboard") {
    maybeAutoSyncResults();
  }

  if (typeof refreshAvatarImages === "function") {
    refreshAvatarImages(document);
  }

  if (tabName === "stats") {
    triggerStatsCelebration();
  }

  closeLandscapeSidebar();
  saveState(true);
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

function getBackupSelectedSeasonId() {
  const select = document.getElementById("backupSeasonSelect");
  return select?.value || getActiveSeasonId() || state.seasons?.[0]?.id || "";
}

function getBackupSelectedSeason() {
  const seasonId = getBackupSelectedSeasonId();
  return seasonId ? getSeasonById(seasonId) : null;
}

function backupMapToArray(map) {
  if (!map || typeof map !== "object") return [];
  return Object.entries(map).map(([key, value]) => ({
    _firebaseKey: key,
    ...(value || {}),
    id: value?.id || key,
  }));
}

function backupArrayToFirebaseMap(rows = []) {
  const out = {};
  (rows || []).forEach((item) => {
    const key = sanitizeFirebaseKey(item._firebaseKey || item.id || uid("row"));
    if (!key) return;
    const clean = { ...(item || {}) };
    delete clean._firebaseKey;
    out[key] = clean;
  });
  return out;
}

function isSeasonRelatedBackupRecord(item = {}, ctx = {}) {
  const seasonId = normalizeText(ctx.seasonId || "");
  const seasonName = normalizeText(ctx.seasonName || "");
  const matchIds = ctx.matchIds || new Set();
  const weekIds = ctx.weekIds || new Set();
  const itemSeasonId = normalizeText(
    item.seasonId || item.localSeasonId || item.sezonId || "",
  );
  const itemSeasonName = normalizeText(
    item.season || item.sezon || item.seasonName || "",
  );
  const itemMatchId = String(
    item.matchId || item.localMatchId || item.macId || "",
  ).trim();
  const itemWeekId = String(
    item.weekId || item.localWeekId || item.haftaId || "",
  ).trim();

  if (seasonId && itemSeasonId && itemSeasonId === seasonId) return true;
  if (seasonName && itemSeasonName && itemSeasonName === seasonName)
    return true;
  if (itemMatchId && matchIds.has(itemMatchId)) return true;
  if (itemWeekId && weekIds.has(itemWeekId)) return true;
  return false;
}

async function buildFirebaseSeasonBackupData(season, appStateData = null) {
  if (!season || !isFirebaseReady()) return null;

  const [
    settings,
    users,
    matches,
    predictions,
    predictionLogs,
    auditLogs,
    notificationLogs,
    queue,
    sent,
  ] = await Promise.all([
    firebaseRead("settings").catch(() => null),
    firebaseRead("users").catch(() => null),
    firebaseRead("matches").catch(() => null),
    firebaseRead("predictions").catch(() => null),
    firebaseRead("predictionLogs").catch(() => null),
    firebaseRead("settings/auditLogs").catch(() => null),
    firebaseRead("notificationLogs").catch(() => null),
    firebaseRead("adminNotificationQueue").catch(() => null),
    firebaseRead("sentNotifications").catch(() => null),
  ]);

  const localMatches = getMatchesBySeasonId(season.id);
  const localWeeks = getWeeksBySeasonId(season.id);
  const ctx = {
    seasonId: String(season.id || ""),
    seasonName: String(season.name || ""),
    matchIds: new Set(localMatches.map((match) => String(match.id))),
    weekIds: new Set(localWeeks.map((week) => String(week.id))),
  };

  const remoteMatches = backupMapToArray(matches).filter((item) =>
    isSeasonRelatedBackupRecord(item, ctx),
  );
  remoteMatches.forEach((match) =>
    ctx.matchIds.add(String(match.id || match._firebaseKey || "")),
  );

  const remotePredictions = backupMapToArray(predictions).filter((item) =>
    isSeasonRelatedBackupRecord(item, ctx),
  );

  const usedPlayerIds = new Set(
    remotePredictions
      .map((pred) =>
        String(pred.playerId || pred.kullaniciId || pred.userId || ""),
      )
      .filter(Boolean),
  );

  const remoteUsers = backupMapToArray(users).filter((user) => {
    const userId = String(user.id || user._firebaseKey || "");
    if (usedPlayerIds.has(userId)) return true;
    const seasonStates = normalizeSeasonStateMap(
      user.seasonStates || user.seasonMemberships || user.activeSeasons || {},
    );
    return Object.prototype.hasOwnProperty.call(seasonStates, season.id);
  });

  const filterMap = (map) =>
    backupMapToArray(map).filter((item) =>
      isSeasonRelatedBackupRecord(item, ctx),
    );

  return {
    exportedFromFirebaseAt: new Date().toISOString(),
    appState: appStateData ? serializeStateForBackup(appStateData) : null,
    settings: {
      seasonsMeta: Array.isArray(settings?.seasonsMeta)
        ? settings.seasonsMeta.filter(
            (item) =>
              normalizeText(item.id || "") === normalizeText(season.id || "") ||
              normalizeText(item.name || "") ===
                normalizeText(season.name || ""),
          )
        : [],
    },
    users: remoteUsers,
    matches: remoteMatches,
    predictions: remotePredictions,
    predictionLogs: filterMap(predictionLogs),
    auditLogs: filterMap(auditLogs),
    notificationLogs: filterMap(notificationLogs),
    adminNotificationQueue: filterMap(queue),
    sentNotifications: filterMap(sent),
  };
}

async function buildSeasonBackupPayload(seasonId) {
  const season = getSeasonById(seasonId);
  if (!season) return null;

  const weeks = getWeeksBySeasonId(season.id);
  const teams = state.teams.filter(
    (team) => String(team.seasonId) === String(season.id),
  );
  const matches = getMatchesBySeasonId(season.id);
  const matchIds = new Set(matches.map((match) => String(match.id)));
  const predictions = state.predictions.filter((pred) =>
    matchIds.has(String(pred.matchId)),
  );
  const players = state.players.map((player) => ({ ...player }));

  const localData = {
    seasons: [{ ...season }],
    weeks,
    teams,
    matches,
    predictions,
    players,
    settings: {
      activeSeasonId: season.id,
      activeWeekId: weeks[0]?.id || null,
      celebratedChampions: state.settings?.celebratedChampions?.[season.id]
        ? { [season.id]: state.settings.celebratedChampions[season.id] }
        : {},
    },
  };

  return {
    type: "season-full-backup",
    app: "super-lig-tahmin-paneli",
    version: 2,
    exportedAt: new Date().toISOString(),
    season: {
      id: season.id,
      name: season.name,
      leagueName: season.leagueName || "",
    },
    firebaseData: await buildFirebaseSeasonBackupData(season, localData),
  };
}

async function restoreFirebaseSeasonBackupData(firebaseData) {
  if (!firebaseData || !isFirebaseReady()) return false;

  const writeRows = async (path, rows) => {
    const entries = Object.entries(backupArrayToFirebaseMap(rows));
    for (const [key, value] of entries) {
      await firebaseWrite(`${path}/${key}`, value);
    }
  };

  await Promise.all([
    writeRows("users", firebaseData.users || []),
    writeRows("matches", firebaseData.matches || []),
    writeRows("predictions", firebaseData.predictions || []),
    writeRows("predictionLogs", firebaseData.predictionLogs || []),
    writeRows("settings/auditLogs", firebaseData.auditLogs || []),
    writeRows("notificationLogs", firebaseData.notificationLogs || []),
    writeRows(
      "adminNotificationQueue",
      firebaseData.adminNotificationQueue || [],
    ),
    writeRows("sentNotifications", firebaseData.sentNotifications || []),
  ]);

  const seasonsMeta = firebaseData.settings?.seasonsMeta || [];
  if (seasonsMeta.length) {
    const currentSettings =
      (await firebaseRead("settings").catch(() => null)) || {};
    const currentMeta = Array.isArray(currentSettings.seasonsMeta)
      ? currentSettings.seasonsMeta
      : [];
    const metaMap = new Map(
      currentMeta.map((item) => [String(item.id || item.name), item]),
    );
    seasonsMeta.forEach((item) =>
      metaMap.set(String(item.id || item.name), item),
    );
    await firebaseUpdate("settings", {
      seasonsMeta: Array.from(metaMap.values()),
    });
  }

  return true;
}

function getSeasonBackupAppState(payload) {
  return payload?.firebaseData?.appState || payload?.data || null;
}

function mergeSeasonBackupIntoState(payload) {
  const incoming = getSeasonBackupAppState(payload) || {};
  const season = incoming.seasons?.[0] || payload?.season || null;
  if (!season?.id) throw new Error("Sezon bilgisi bulunamadı.");

  const next = serializeStateForBackup(state);
  const seasonId = String(season.id);
  const incomingMatches = incoming.matches || [];
  const incomingMatchIds = new Set(
    incomingMatches.map((match) => String(match.id)),
  );

  next.seasons = [
    ...(next.seasons || []).filter((item) => String(item.id) !== seasonId),
    { ...season },
  ];
  next.weeks = [
    ...(next.weeks || []).filter((item) => String(item.seasonId) !== seasonId),
    ...(incoming.weeks || []),
  ];
  next.teams = [
    ...(next.teams || []).filter((item) => String(item.seasonId) !== seasonId),
    ...(incoming.teams || []),
  ];

  const removedMatchIds = new Set(
    (next.matches || [])
      .filter((match) => String(match.seasonId) === seasonId)
      .map((match) => String(match.id)),
  );
  incomingMatchIds.forEach((id) => removedMatchIds.add(id));

  next.matches = [
    ...(next.matches || []).filter(
      (match) => String(match.seasonId) !== seasonId,
    ),
    ...incomingMatches,
  ];
  next.predictions = [
    ...(next.predictions || []).filter(
      (pred) => !removedMatchIds.has(String(pred.matchId)),
    ),
    ...(incoming.predictions || []),
  ];

  const playerMap = new Map(
    (next.players || []).map((player) => [String(player.id), player]),
  );
  (incoming.players || []).forEach((player) => {
    if (!player?.id) return;
    playerMap.set(String(player.id), {
      ...(playerMap.get(String(player.id)) || {}),
      ...player,
    });
  });
  next.players = Array.from(playerMap.values());

  next.settings = { ...(next.settings || {}) };
  next.settings.activeSeasonId = seasonId;
  next.settings.activeWeekId =
    incoming.settings?.activeWeekId ||
    (incoming.weeks || [])[0]?.id ||
    next.settings.activeWeekId ||
    null;
  next.settings.celebratedChampions = {
    ...(next.settings.celebratedChampions || {}),
    ...(incoming.settings?.celebratedChampions || {}),
  };

  return next;
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

async function exportSelectedSeasonBackup() {
  const season = getBackupSelectedSeason();
  if (!season) {
    showAlert("Önce dışa aktarmak istediğin sezonu seçmelisin.", {
      title: "Sezon seçilmedi",
      type: "warning",
    });
    return;
  }

  const payload = await buildSeasonBackupPayload(season.id);
  if (!payload) {
    showAlert("Sezon yedeği hazırlanamadı.", {
      title: "Yedek hatası",
      type: "danger",
    });
    return;
  }

  downloadTextFile(
    JSON.stringify(payload, null, 2),
    `fikstur-${slugify(season.name || "sezon")}-tam-sezon-yedegi-${formatBackupDateStamp()}.json`,
    "application/json",
  );
  setBackupImportStatus(`${season.name} sezon yedeği indirildi.`);
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

async function importData(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      let nextState = null;

      if (parsed?.type === "full-backup" && parsed?.data) {
        nextState = parsed.data;
      } else if (
        parsed?.type === "season-full-backup" &&
        (parsed?.firebaseData?.appState || parsed?.data)
      ) {
        nextState = mergeSeasonBackupIntoState(parsed);
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

      const isSeasonFullBackup =
        parsed?.type === "season-full-backup" && parsed?.firebaseData;
      await applyImportedState(nextState, {
        syncFirebase: !isSeasonFullBackup,
      });
      if (isSeasonFullBackup) {
        await restoreFirebaseSeasonBackupData(parsed.firebaseData);
      }
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
  const seasonSelect = document.getElementById("backupSeasonSelect");
  const seasonSummary = document.getElementById("backupSeasonSummary");
  if (!seasonSelect || !seasonSummary) return;

  if (seasonSelect) {
    const selectedSeasonId =
      seasonSelect.value ||
      state.settings.activeSeasonId ||
      state.seasons?.[0]?.id ||
      "";
    seasonSelect.innerHTML = state.seasons?.length
      ? state.seasons
          .map(
            (item) =>
              `<option value="${item.id}" ${String(item.id) === String(selectedSeasonId) ? "selected" : ""}>${item.name || "İsimsiz sezon"}</option>`,
          )
          .join("")
      : '<option value="">Sezon bulunamadı</option>';

    const backupSeason = selectedSeasonId
      ? getSeasonById(selectedSeasonId)
      : null;
    const seasonMatches = backupSeason
      ? getMatchesBySeasonId(backupSeason.id)
      : [];
    const seasonWeeks = backupSeason ? getWeeksBySeasonId(backupSeason.id) : [];
    const seasonMatchIds = new Set(
      seasonMatches.map((match) => String(match.id)),
    );
    const seasonPredictionCount = state.predictions.filter((pred) =>
      seasonMatchIds.has(String(pred.matchId)),
    ).length;
    const seasonTeamCount = backupSeason
      ? state.teams.filter(
          (team) => String(team.seasonId) === String(backupSeason.id),
        ).length
      : 0;

    if (seasonSummary) {
      seasonSummary.textContent = backupSeason
        ? `${backupSeason.name} • ${seasonWeeks.length} hafta • ${seasonMatches.length} maç • ${seasonTeamCount} takım • ${seasonPredictionCount} tahmin`
        : "Dışa aktarmak için sezon seçmelisin.";
    }
  }
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

async function fetchSeasonTeamReferences(seasonLabel) {
  const url = `https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=${LEAGUE_ID}&s=${encodeURIComponent(seasonLabel)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Sezon takım listesi API'den alınamadı.");
  const data = await res.json();
  const events = Array.isArray(data.events) ? data.events : [];
  const teamMap = new Map();

  events.forEach((event) => {
    [
      { id: event.idHomeTeam, name: event.strHomeTeam },
      { id: event.idAwayTeam, name: event.strAwayTeam },
    ].forEach((team) => {
      const apiTeamId = String(team.id || "").trim();
      const name = String(team.name || "").trim();
      if (!apiTeamId && !name) return;
      const key = apiTeamId || normalizeText(name);
      if (!teamMap.has(key)) teamMap.set(key, { apiTeamId, name });
    });
  });

  return Array.from(teamMap.values());
}

async function fetchTeamDetailsById(apiTeamId) {
  if (!apiTeamId) return null;
  const url = `https://www.thesportsdb.com/api/v1/json/123/lookupteam.php?id=${encodeURIComponent(apiTeamId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Takım detayı alınamadı (${apiTeamId}).`);
  const data = await res.json();
  return Array.isArray(data.teams) ? data.teams[0] || null : null;
}

function mapSportsDbTeamToLocal(teamRef, apiTeam, seasonId, seasonLabel) {
  const name = String(apiTeam?.strTeam || teamRef?.name || "").trim();
  return {
    seasonId,
    name,
    slug: DEFAULT_TEAM_SLUGS[name] || slugify(name),
    apiTeamId: String(apiTeam?.idTeam || teamRef?.apiTeamId || "").trim(),
    teamId: String(apiTeam?.idTeam || teamRef?.apiTeamId || "").trim(),
    leagueId: String(apiTeam?.idLeague || LEAGUE_ID),
    season: seasonLabel,
    badgeUrl: String(apiTeam?.strBadge || "").trim(),
    shortName: String(
      apiTeam?.strTeamShort || apiTeam?.strAlternate || "",
    ).trim(),
    leagueName: String(apiTeam?.strLeague || "").trim(),
    stadium: String(apiTeam?.strStadium || "").trim(),
    country: String(apiTeam?.strCountry || "").trim(),
    website: String(apiTeam?.strWebsite || "").trim(),
    apiUpdatedAt: new Date().toISOString(),
  };
}

function buildSeasonTeamLogoCache(seasonId) {
  const seasonMap = {};
  getTeamsBySeasonId(seasonId).forEach((team) => {
    const badgeUrl = String(team.badgeUrl || team.logoUrl || "").trim();
    if (!badgeUrl) return;
    seasonMap[getTeamLogoCacheKey(team.name)] = {
      teamName: String(team.name || "").trim(),
      apiTeamId: String(team.apiTeamId || team.teamId || "").trim(),
      badgeUrl,
      updatedAt: team.apiUpdatedAt || new Date().toISOString(),
    };
  });
  return seasonMap;
}

async function persistSeasonTeamLogoCache(seasonId) {
  const cache = getStoredTeamLogoCache();
  const seasonMap = buildSeasonTeamLogoCache(seasonId);
  cache[String(seasonId)] = seasonMap;
  saveState();
  if (isFirebaseReady()) {
    await firebaseWrite(
      `settings/teamLogoCache/${sanitizeFirebaseKey(seasonId)}`,
      seasonMap,
    );
  }
  return seasonMap;
}

async function importSeasonTeamsFromApi(buttonOrEvent) {
  if (isReadOnlyMode()) {
    return showAlert("Kullanıcı görünümünde takım aktarımı yapılamaz.", {
      title: "Yetki yok",
      type: "warning",
    });
  }

  const seasonId = getActiveSeasonId();
  const season = getSeasonById(seasonId);
  const status = document.getElementById("apiStatus");
  const actionButton = getActionButtonFromArg(buttonOrEvent);

  if (!season) {
    return showAlert("Önce listeden bir sezon seç.", {
      title: "Eksik seçim",
      type: "warning",
    });
  }

  const seasonLabel = String(season.name || "").trim();
  if (!seasonLabel) {
    return showAlert("Seçilen sezonun adı boş olamaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  }

  if (status)
    status.textContent = `${seasonLabel} sezonunun takımları alınıyor...`;
  setAsyncButtonState(actionButton, "loading", {
    loading: "Takımlar getiriliyor...",
  });

  try {
    const references = await fetchSeasonTeamReferences(seasonLabel);
    if (!references.length) {
      throw new Error("Bu sezon için takım verisi bulunamadı.");
    }

    const detailResults = await Promise.allSettled(
      references.map((team) => fetchTeamDetailsById(team.apiTeamId)),
    );

    let addedCount = 0;
    let updatedCount = 0;

    references.forEach((teamRef, index) => {
      const result = detailResults[index];
      const apiTeam = result?.status === "fulfilled" ? result.value : null;
      const mapped = mapSportsDbTeamToLocal(
        teamRef,
        apiTeam,
        seasonId,
        seasonLabel,
      );
      if (!mapped.name) return;

      const existing = state.teams.find(
        (team) =>
          String(team.seasonId) === String(seasonId) &&
          ((mapped.apiTeamId &&
            String(team.apiTeamId || team.teamId || "") === mapped.apiTeamId) ||
            normalizeText(team.name) === normalizeText(mapped.name)),
      );

      if (existing) {
        const preservedSlug = existing.slug || mapped.slug;
        Object.assign(existing, mapped, {
          id: existing.id,
          slug: preservedSlug,
        });
        updatedCount += 1;
      } else {
        state.teams.push({ id: uid("team"), ...mapped });
        addedCount += 1;
      }
    });

    await persistSeasonTeamLogoCache(seasonId);
    shareLogoImageCache.clear();
    saveState();
    renderAll();

    const detailFailureCount = detailResults.filter(
      (result) => result.status === "rejected",
    ).length;
    const message = `${seasonLabel}: ${addedCount} takım eklendi, ${updatedCount} takım güncellendi.${detailFailureCount ? ` ${detailFailureCount} takımın temel bilgisi kaydedildi; detay isteği yanıt vermedi.` : ""}`;
    if (document.getElementById("apiStatus")) {
      document.getElementById("apiStatus").textContent = message;
    }
    setAsyncButtonState(actionButton, "success", {
      success: "Takımlar getirildi",
    });
    recordAdminSyncActivity({
      lastAction: `${seasonLabel} sezonunun takım bilgileri API'den alındı.`,
      success: true,
    });
    return true;
  } catch (error) {
    console.error("Sezon takımları API aktarım hatası:", error);
    if (status) status.textContent = `API hatası: ${error.message}`;
    setAsyncButtonState(actionButton, "error", { error: "Tekrar dene" });
    showAlert(`Takımlar API'den getirilemedi: ${error.message}`, {
      title: "API hatası",
      type: "danger",
    });
    return false;
  }
}

async function fetchRoundEvents(seasonLabel, weekNumber) {
  const url = `https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id=${LEAGUE_ID}&r=${encodeURIComponent(weekNumber)}&s=${encodeURIComponent(seasonLabel)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Hafta API cevabı alınamadı.");
  const data = await res.json();
  return (data.events || []).map(parseApiEvent).filter(Boolean);
}

function inferWeekStatusFromMatches(weekId) {
  const week = getWeekById(weekId);
  const currentStatus = String(week?.status || "hazirlaniyor");
  const matches = getMatchesByWeekId(weekId);
  if (currentStatus === "hazirlaniyor") return "hazirlaniyor";
  if (!matches.length)
    return currentStatus === "tamamlandi" ? "tamamlandi" : "aktif";
  if (matches.every((match) => match.played)) return "tamamlandi";
  return "aktif";
}

function syncWeekStatus(weekId) {
  const week = getWeekById(weekId);
  if (!week) return;
  const previousStatus = String(week.status || "hazirlaniyor");
  const nextStatus = inferWeekStatusFromMatches(weekId);
  if (previousStatus === nextStatus) return;
  week.status = nextStatus;
  if (nextStatus === "tamamlandi" && !week.completedAt) {
    week.completedAt = new Date().toISOString();
  }
  if (!isReadOnlyMode() && isFirebaseReady()) {
    persistWeekRegistryToFirebase().catch((error) =>
      console.warn("Otomatik hafta durumu Firebase'e yazılamadı:", error),
    );
  }
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
  const manualScoreLocked = !!target.manualScoreLocked;
  if (event.postponed) {
    target.postponed = true;
    target.wasPostponed = true;
  } else if (target.postponed) {
    target.postponed = false;
  }
  if (hasScore && !manualScoreLocked) {
    target.homeScore = event.homeScore;
    target.awayScore = event.awayScore;
    target.played = true;
    if (target.wasPostponed || event.postponed) target.wasPostponed = true;
    target.postponed = false;
  } else if (!hasScore && !target.played && !manualScoreLocked) {
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

const AUTO_RESULTS_SYNC_INTERVAL = 30 * 60 * 1000;
const AUTO_RESULTS_SYNC_LOCK_TTL = 90 * 1000;
let autoResultsSyncPromise = null;

function getAutoSyncActorLabel() {
  const user = getAuthUser?.() || state.settings?.auth?.user || null;
  return String(
    user?.name ||
      user?.username ||
      user?.kullaniciAdi ||
      getCurrentRole?.() ||
      "kullanici",
  ).trim();
}

async function maybeAutoSyncResults(options = {}) {
  const { force = false } = options;
  if (typeof logAutoSyncDebug === "function") {
    logAutoSyncDebug("maybeAutoSyncResults:entered", { force });
  }
  if (!isAuthenticated() || !isFirebaseReady()) return false;
  if (!force && (state.settings.currentTab || "dashboard") !== "dashboard")
    return false;
  if (autoResultsSyncPromise) return autoResultsSyncPromise;

  const seasonId = getActiveSeasonId();
  const weekId = state.settings.activeWeekId;
  const week = getWeekById(weekId);
  if (!seasonId || !weekId || !week) return false;

  autoResultsSyncPromise = (async () => {
    const now = Date.now();
    let remoteSettings = {};

    try {
      remoteSettings = (await firebaseRead("settings")) || {};
      if (typeof logAutoSyncDebug === "function") {
        logAutoSyncDebug("maybeAutoSyncResults:remoteSettingsRead", {
          remoteLastSyncAt: Number(remoteSettings.resultsLastAutoSyncAt || 0),
          remoteLockAt: Number(remoteSettings.resultsAutoSyncInProgressAt || 0),
        });
      }
    } catch (error) {
      console.warn("Otomatik sync ayarları okunamadı:", error);
    }

    const remoteLastSyncAt = Number(remoteSettings.resultsLastAutoSyncAt || 0);
    const remoteLockAt = Number(
      remoteSettings.resultsAutoSyncInProgressAt || 0,
    );

    state.settings.resultsLastAutoSyncAt = remoteLastSyncAt;
    state.settings.resultsAutoSyncInProgressAt = remoteLockAt;
    saveState(true);
    renderDashboardAutoSyncStatus();
    renderDashboardSyncCard();

    if (
      !force &&
      remoteLastSyncAt &&
      now - remoteLastSyncAt < AUTO_RESULTS_SYNC_INTERVAL
    ) {
      if (typeof logAutoSyncDebug === "function") {
        logAutoSyncDebug("maybeAutoSyncResults:skippedByInterval", {
          remoteLastSyncAt,
          now,
          interval: AUTO_RESULTS_SYNC_INTERVAL,
        });
      }
      return false;
    }

    if (remoteLockAt && now - remoteLockAt < AUTO_RESULTS_SYNC_LOCK_TTL) {
      if (typeof logAutoSyncDebug === "function") {
        logAutoSyncDebug("maybeAutoSyncResults:skippedByLock", {
          remoteLockAt,
          now,
          ttl: AUTO_RESULTS_SYNC_LOCK_TTL,
        });
      }
      renderDashboardAutoSyncStatus(
        "⏳ Başka bir cihaz şu anda sonuçları kontrol ediyor",
      );
      return false;
    }

    const lockStamp = Date.now();
    state.settings.resultsAutoSyncInProgressAt = lockStamp;
    saveState(true);
    renderDashboardAutoSyncStatus();

    try {
      await firebaseUpdate("settings", {
        resultsAutoSyncInProgressAt: lockStamp,
        resultsAutoSyncRequestedBy: getAutoSyncActorLabel(),
        updatedAt: new Date().toISOString(),
      });

      renderDashboardAutoSyncStatus("⏳ Sonuçlar otomatik kontrol ediliyor");
      await syncSelectedWeekFromApi({ silentAuto: true });

      if (typeof logAutoSyncDebug === "function") {
        logAutoSyncDebug("maybeAutoSyncResults:syncSelectedWeekFromApi:done");
      }

      const finishedAt = Date.now();
      state.settings.resultsLastAutoSyncAt = finishedAt;
      state.settings.resultsAutoSyncInProgressAt = 0;
      saveState();

      await firebaseUpdate("settings", {
        resultsLastAutoSyncAt: finishedAt,
        resultsAutoSyncInProgressAt: 0,
        resultsAutoSyncRequestedBy: getAutoSyncActorLabel(),
        updatedAt: new Date().toISOString(),
      });

      if (typeof logAutoSyncDebug === "function") {
        logAutoSyncDebug("maybeAutoSyncResults:firebaseUpdateDone", {
          finishedAt,
          finishedText: formatDashboardAutoSyncTime(finishedAt),
        });
      }

      renderDashboardSyncCard();
      renderDashboardAutoSyncStatus(
        "✅ Sonuçlar gerektiği için otomatik güncellendi",
        finishedAt,
      );

      setTimeout(() => {
        renderDashboardSyncCard();
        renderDashboardAutoSyncStatus("", finishedAt);
      }, 150);

      if (typeof logAutoSyncDebug === "function") {
        logAutoSyncDebug("maybeAutoSyncResults:success:returningTrue", {
          stateLastSyncAt: Number(state.settings.resultsLastAutoSyncAt || 0),
        });
      }
      return true;
    } catch (error) {
      state.settings.resultsAutoSyncInProgressAt = 0;
      saveState(true);
      try {
        await firebaseUpdate("settings", {
          resultsAutoSyncInProgressAt: 0,
          updatedAt: new Date().toISOString(),
        });
      } catch {}
      console.warn("Otomatik sonuç güncelleme uyarısı:", error);
      renderDashboardAutoSyncStatus(
        "⚠️ Otomatik kontrol denendi ama bu tur güncellenemedi",
      );
      return false;
    } finally {
      if (typeof logAutoSyncDebug === "function") {
        logAutoSyncDebug("maybeAutoSyncResults:finally", {
          stateLastSyncAt: Number(state.settings.resultsLastAutoSyncAt || 0),
          stateLockAt: Number(state.settings.resultsAutoSyncInProgressAt || 0),
        });
      }
      autoResultsSyncPromise = null;
    }
  })();

  return autoResultsSyncPromise;
}

async function syncSelectedWeekFromApi(options = {}) {
  const seasonId = getActiveSeasonId();
  const weekId = state.settings.activeWeekId;
  const week = getWeekById(weekId);
  const seasonLabel = getApiSeasonLabel();
  const status = document.getElementById("weekApiStatus");

  const setWeekApiStatus = (message) => {
    if (status) status.textContent = message;
  };

  if (!seasonId || !weekId || !week) {
    return showAlert("Önce sezon ve hafta seç.", {
      title: "Eksik seçim",
      type: "warning",
    });
  }

  if (!seasonLabel) {
    return showAlert("API sezon etiketi boş olamaz.", {
      title: "Eksik bilgi",
      type: "warning",
    });
  }

  setWeekApiStatus(`${week.number}. hafta API'den kontrol ediliyor...`);

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

    if (!weekEvents.length && !movedCount) {
      throw new Error(`${week.number}. hafta için API verisi bulunamadı.`);
    }

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

      if (event.weekNumber) {
        relocateMatchToApiWeek(existing, seasonId, event.weekNumber);
      }

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

    // API'den alınan sonuç, sayfa yenilenmeden önce mutlaka Firebase'e
    // kalıcı yazılır. Bu yazma yalnızca admin kilidi yoksa skoru günceller.
    // Böylece kullanıcı/API skoru görüp yenilediğinde tekrar bekleniyor olmaz.
    const apiResultMatches = getMatchesByWeekId(week.id).filter(
      (match) => match.played && match.homeScore != null && match.awayScore != null,
    );
    if (apiResultMatches.length) {
      try {
        sheetSyncResult = await sendMatchesToSheet(apiResultMatches, { force: true });
      } catch (scorePersistError) {
        console.warn("API skorları Firebase'e kalıcı yazılamadı:", scorePersistError);
      }
    }

    if (!sheetSyncResult && shouldPublishMatchChanges(week.id)) {
      try {
        sheetSyncResult = await syncWeekMatchesToSheet(week.id);
      } catch (sheetError) {
        console.warn("Hafta Firebase senkron uyarısı:", sheetError);
      }
    }

    const finishedAt = Date.now();

    if (typeof logAutoSyncDebug === "function") {
      logAutoSyncDebug("syncSelectedWeekFromApi:finishedAtCreated", {
        finishedAt,
        updatedCount,
        scoreCount,
        createdCount,
        movedCount,
      });
    }

    setWeekApiStatus(
      `${week.number}. hafta güncellendi. ${updatedCount} maç işlendi, ${scoreCount} maçta skor var${createdCount ? `, ${createdCount} eksik maç eklendi` : ""}${movedCount ? `, ${movedCount} maç başka haftaya taşındı` : ""}${sheetSyncResult?.success ? `, Sheets senkronu tamamlandı` : ", Sheets yanıtı gecikti ama yerel güncelleme tamamlandı"}.`,
    );

    state.settings.resultsLastAutoSyncAt = finishedAt;
    state.settings.resultsAutoSyncInProgressAt = 0;
    saveState();

    if (typeof renderDashboardAutoSyncStatus === "function") {
      renderDashboardAutoSyncStatus("", finishedAt);
    }

    if (typeof renderDashboardSyncCard === "function") {
      renderDashboardSyncCard();
    }

    setTimeout(() => {
      if (typeof logAutoSyncDebug === "function") {
        logAutoSyncDebug("syncSelectedWeekFromApi:setTimeout150", {
          finishedAt,
        });
      }
      if (typeof renderDashboardAutoSyncStatus === "function") {
        renderDashboardAutoSyncStatus("", finishedAt);
      }

      if (typeof renderDashboardSyncCard === "function") {
        renderDashboardSyncCard();
      }
    }, 150);

    recordAdminSyncActivity({
      lastAction: `${week.number}. hafta API ile güncellendi.`,
      success: true,
      updatedMatchCount: updatedCount + createdCount,
    });
  } catch (error) {
    setWeekApiStatus(`Hafta API hatası: ${error.message}`);

    state.settings.resultsAutoSyncInProgressAt = 0;
    saveState();
    if (typeof renderDashboardAutoSyncStatus === "function") {
      renderDashboardAutoSyncStatus("⚠️ API kontrolünde hata oluştu");
    }

    if (typeof renderDashboardSyncCard === "function") {
      renderDashboardSyncCard();
    }

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
      if (e.cancelable) e.preventDefault();
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
        if (e.cancelable) e.preventDefault();
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
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      const { matchId, playerId } = target.dataset;
      if (!matchId || !playerId) return;
      delete target.dataset.pointerPressed;
      window.handlePredictionSaveButtonClick?.(matchId, playerId);
    },
    true,
  );

  document.addEventListener(
    "touchend",
    (e) => {
      const target = e.target.closest?.('button[data-pred-role="save-btn"]');
      if (!target || target.disabled) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      const { matchId, playerId } = target.dataset;
      if (!matchId || !playerId) return;
      window.handlePredictionSaveButtonClick?.(matchId, playerId);
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
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        delete target.dataset.pointerPressed;
        window.handlePredictionSaveButtonClick?.(matchId, playerId);
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target.closest?.('button[data-pred-role="save-btn"]');
      if (!target) return;

      if (e.cancelable) e.preventDefault();
      e.stopPropagation();

      if (target.disabled) return;

      const { matchId, playerId } = target.dataset;
      if (!matchId || !playerId) return;

      window.handlePredictionSaveButtonClick?.(matchId, playerId);
    },
    true,
  );

  on("addSeasonBtn", "click", addSeason);
  on("addSeasonTeamBtn", "click", addSeasonTeam);
  on("addPlayerBtn", "click", (event) => addPlayer(event.currentTarget));
  on("addWeekBtn", "click", addWeek);
  on("addMatchBtn", "click", addMatch);
  on("exportSeasonBackupBtn", "click", exportSelectedSeasonBackup);
  on("exportFullBackupBtn", "click", exportFullBackup);
  on("apiImportTeamsBtn", "click", (event) =>
    importSeasonTeamsFromApi(event.currentTarget),
  );
  on("apiSyncWeekBtn", "click", syncSelectedWeekFromApi);
  on("dashboardSyncWeekBtn", "click", syncDashboardWeek);
  on("dashboardSyncSeasonBtn", "click", syncDashboardSeason);
  on("dashboardWeekScoreUpdateBtn", "click", runDashboardWeekScoreUpdate);
  on("dashboardMobileWeekScoreUpdateBtn", "click", runDashboardWeekScoreUpdate);
  on("dashboardSyncToggleBtn", "click", toggleDashboardSyncCard);
  on("adminSyncToggleBtn", "click", toggleAdminSyncOverview);
  on("firebaseAdminRefreshBtn", "click", refreshFirebaseAdminPanel);
  on("firebaseAdminTestBtn", "click", testFirebaseAdminConnection);
  on("pullLeagueStandingsBtn", "click", pullLeagueStandingsFromCurrentResults);
  on("leagueStandingsModalClose", "click", closeLeagueStandingsModal);
  on("leagueStandingsModal", "click", (event) => {
    const card = event.currentTarget.querySelector(
      ".league-standings-modal-card",
    );

    if (!card) return;

    // Kartın DIŞINA tıklanırsa kapat
    if (!card.contains(event.target)) {
      closeLeagueStandingsModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLeagueStandingsModal();
  });
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
  on("saveWelcomeSettingsBtn", "click", saveWelcomeSettingsFromPanel);
  on("previewWelcomeSettingsBtn", "click", previewWelcomeSettingsFromPanel);
  [
    "welcomeEnabled",
    "welcomeTitleInput",
    "welcomeMessageInput",
    "welcomeImageInput",
    "welcomeImageFitSelect",
    "welcomeShowOnce",
  ].forEach((id) => {
    on(id, "input", () => updateWelcomeSettingsPreview());
    on(id, "change", () => updateWelcomeSettingsPreview());
  });
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
  on("desktopAccountBtn", "click", (e) => {
    e.stopPropagation();
    toggleAccountMenu("desktop");
  });
  on("mobileTopProfileBtn", "click", (e) => {
    e.stopPropagation();
    toggleAccountMenu("mobile");
  });
  on("mobileAdminMenuBtn", "click", () => toggleMobileAdminMenu());
  on("mobileAdminMenuCloseBtn", "click", closeMobileAdminMenu);
  on("mobileAdminMenuBackdrop", "click", closeMobileAdminMenu);
  document
    .querySelectorAll(".mobile-admin-menu-item[data-tab]")
    .forEach((btn) =>
      btn.addEventListener("click", () => switchTab(btn.dataset.tab)),
    );
  on("desktopPlayersPageBtn", "click", () => {
    closeAccountMenus();
    switchTab("players");
  });
  on("mobilePlayersPageBtn", "click", () => {
    closeAccountMenus();
    switchTab("players");
  });
  on("desktopChangePasswordBtn", "click", changeOwnPassword);
  on("mobileChangePasswordBtn", "click", changeOwnPassword);
  on("loginBtn", "click", loginUser);
  on("loginPassword", "keydown", (e) => {
    if (e.key === "Enter") loginUser();
  });
  on("loginUsername", "input", clearLoginErrorState);
  on("loginPassword", "input", clearLoginErrorState);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clickedDesktop = target.closest(
      "#desktopAccountBtn, #desktopAccountMenu",
    );
    const clickedMobile = target.closest(
      "#mobileTopProfileBtn, #mobileAccountMenu",
    );
    if (!clickedDesktop && !clickedMobile) closeAccountMenus();
  });

  let resizeRenderTimer = null;
  let lastViewportBucket = getViewportRenderBucket();

  function getViewportRenderBucket() {
    const width = window.innerWidth;
    const isLandscapeMobile = window.matchMedia(
      "(max-width: 950px) and (orientation: landscape)",
    ).matches;

    if (isLandscapeMobile) return "mobile-landscape";
    if (width <= 768) return "mobile";
    if (width <= 1100) return "tablet";
    return "desktop";
  }

  window.addEventListener("resize", () => {
    clearTimeout(resizeRenderTimer);

    resizeRenderTimer = setTimeout(() => {
      const nextBucket = getViewportRenderBucket();

      if (nextBucket !== lastViewportBucket) {
        lastViewportBucket = nextBucket;
        renderAll();
      }

      updateAdminSyncToggleButton();
    }, 180);
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
  on("backupSeasonSelect", "change", () => {
    renderBackupPanel();
  });
}

const IDLE_LOGOUT_LIMIT_MS = 15 * 60 * 1000;
const IDLE_LOGOUT_STORAGE_KEY = "fikstur:lastUserActivityAt";
const BACKGROUND_ENTERED_AT_STORAGE_KEY = "fikstur:backgroundEnteredAt";
let idleLogoutTimer = null;

function getLastUserActivityAt() {
  const storedValue = Number(
    localStorage.getItem(IDLE_LOGOUT_STORAGE_KEY) || 0,
  );
  return Number.isFinite(storedValue) ? storedValue : 0;
}

function clearIdleLogoutTimer() {
  if (idleLogoutTimer) {
    clearTimeout(idleLogoutTimer);
    idleLogoutTimer = null;
  }
}

function clearSessionRuntimeCaches() {
  localStorage.removeItem(IDLE_LOGOUT_STORAGE_KEY);
  localStorage.removeItem(BACKGROUND_ENTERED_AT_STORAGE_KEY);

  try {
    Object.keys(sessionStorage).forEach((key) => {
      if (
        key.startsWith("fikstur_presence_") ||
        key.startsWith("fikstur_session_")
      ) {
        sessionStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.warn("Oturum önbelleği temizlenemedi:", error);
  }

  if (window.caches?.keys) {
    window.caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => /fikstur|firebase/i.test(key))
            .map((key) => window.caches.delete(key)),
        ),
      )
      .catch(() => {});
  }
}

function performIdleLogout() {
  clearIdleLogoutTimer();
  clearSessionRuntimeCaches();

  if (!isAuthenticated()) return;

  logoutUser();
}

function scheduleIdleLogoutCheck() {
  clearIdleLogoutTimer();

  if (!isAuthenticated()) return;

  const lastActivityAt = getLastUserActivityAt() || Date.now();
  const remainingMs = IDLE_LOGOUT_LIMIT_MS - (Date.now() - lastActivityAt);

  if (remainingMs <= 0) {
    performIdleLogout();
    return;
  }

  idleLogoutTimer = setTimeout(performIdleLogout, remainingMs);
}

function markUserActivityForIdleLogout() {
  if (!isAuthenticated()) return;

  localStorage.setItem(IDLE_LOGOUT_STORAGE_KEY, String(Date.now()));
  scheduleIdleLogoutCheck();
}

function checkIdleLogoutAfterResume() {
  if (!isAuthenticated()) return false;

  const backgroundEnteredAt = Number(
    localStorage.getItem(BACKGROUND_ENTERED_AT_STORAGE_KEY) || 0,
  );
  const lastActivityAt = getLastUserActivityAt();
  const referenceAt = backgroundEnteredAt || lastActivityAt;

  if (referenceAt && Date.now() - referenceAt >= IDLE_LOGOUT_LIMIT_MS) {
    performIdleLogout();
    return true;
  }

  localStorage.removeItem(BACKGROUND_ENTERED_AT_STORAGE_KEY);
  markUserActivityForIdleLogout();
  return false;
}

function bindIdleLogoutHooks() {
  if (window.__idleLogoutHooksBound) return;
  window.__idleLogoutHooksBound = true;

  [
    "click",
    "keydown",
    "pointerdown",
    "touchstart",
    "mousemove",
    "scroll",
  ].forEach((eventName) => {
    document.addEventListener(eventName, markUserActivityForIdleLogout, {
      passive: true,
      capture: true,
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      localStorage.setItem(
        BACKGROUND_ENTERED_AT_STORAGE_KEY,
        String(Date.now()),
      );
      clearIdleLogoutTimer();
      return;
    }

    if (document.visibilityState === "visible") {
      checkIdleLogoutAfterResume();
    }
  });

  window.addEventListener("focus", checkIdleLogoutAfterResume);
  window.addEventListener("pageshow", checkIdleLogoutAfterResume);
  window.addEventListener("pagehide", () => {
    if (isAuthenticated()) {
      localStorage.setItem(
        BACKGROUND_ENTERED_AT_STORAGE_KEY,
        String(Date.now()),
      );
      clearIdleLogoutTimer();
    }
  });

  if (isAuthenticated()) {
    if (!getLastUserActivityAt()) {
      localStorage.setItem(IDLE_LOGOUT_STORAGE_KEY, String(Date.now()));
    }
    scheduleIdleLogoutCheck();
  }
}

window.resetIdleLogoutTimer = markUserActivityForIdleLogout;
window.stopIdleLogoutTimer = () => {
  clearIdleLogoutTimer();
  localStorage.removeItem(IDLE_LOGOUT_STORAGE_KEY);
};

const APP_RESUME_REFRESH_LOG_TAG = "[APP_RESUME_REFRESH]";
let appResumeRefreshPromise = null;
let appWasHiddenAt = 0;
let appLastResumeRefreshAt = 0;

function logAppResumeRefresh(step, details = {}) {}

async function runAppResumeRefresh(reason = "visible") {
  if (!isAuthenticated()) {
    logAppResumeRefresh("skip:not-authenticated", { reason });
    return false;
  }

  if (appResumeRefreshPromise) {
    logAppResumeRefresh("skip:already-running", { reason });
    return appResumeRefreshPromise;
  }

  const now = Date.now();
  const hiddenForMs = appWasHiddenAt ? now - appWasHiddenAt : 0;
  const sinceLastResumeMs = appLastResumeRefreshAt
    ? now - appLastResumeRefreshAt
    : 0;

  if (sinceLastResumeMs && sinceLastResumeMs < 1500) {
    logAppResumeRefresh("skip:cooldown", {
      reason,
      sinceLastResumeMs,
    });
    return false;
  }

  appResumeRefreshPromise = (async () => {
    logAppResumeRefresh("start", { reason, hiddenForMs });

    const resumeTabName = state.settings?.currentTab || "dashboard";
    const resumeViewportSnapshot =
      typeof getWindowScrollPosition === "function"
        ? getWindowScrollPosition()
        : { x: window.scrollX || 0, y: window.scrollY || 0 };
    if (typeof persistViewportForTab === "function") {
      persistViewportForTab(resumeTabName, {
        windowX: resumeViewportSnapshot.x,
        windowY: resumeViewportSnapshot.y,
      });
    }
    logAppResumeRefresh("viewport:capture", {
      tab: resumeTabName,
      y: resumeViewportSnapshot.y,
    });

    try {
      if (
        typeof hydrateFromFirebaseRealtime === "function" &&
        isFirebaseReady()
      ) {
        const hydrateOk = await hydrateFromFirebaseRealtime(
          `app-resume:${reason}`,
        );
        logAppResumeRefresh("hydrate:done", { hydrateOk });
      } else {
        logAppResumeRefresh("hydrate:skipped", {
          hasHydrate: typeof hydrateFromFirebaseRealtime === "function",
          firebaseReady: isFirebaseReady(),
        });
      }

      renderAll();
      logAppResumeRefresh("renderAll:done", {
        currentTab: state.settings?.currentTab || "dashboard",
      });
      if (typeof scheduleTabViewportRestore === "function") {
        scheduleTabViewportRestore(resumeTabName, { fallbackToTop: false });
      }

      if ((state.settings?.currentTab || "dashboard") === "dashboard") {
        const syncResult = await maybeAutoSyncResults({ force: false });
        logAppResumeRefresh("maybeAutoSyncResults:done", { syncResult });
        renderDashboardSyncCard();
        renderDashboardAutoSyncStatus();
      } else {
        logAppResumeRefresh("maybeAutoSyncResults:skipped-tab", {
          currentTab: state.settings?.currentTab || "dashboard",
        });
      }

      renderAll();
      logAppResumeRefresh("renderAll:after-sync");
      if (typeof scheduleTabViewportRestore === "function") {
        scheduleTabViewportRestore(resumeTabName, { fallbackToTop: false });
      }
      appLastResumeRefreshAt = Date.now();
      return true;
    } catch (error) {
      console.warn(APP_RESUME_REFRESH_LOG_TAG, "error", error);
      return false;
    } finally {
      appResumeRefreshPromise = null;
    }
  })();

  return appResumeRefreshPromise;
}

function bindAppResumeRefreshHooks() {
  if (window.__appResumeRefreshHooksBound) return;
  window.__appResumeRefreshHooksBound = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      appWasHiddenAt = Date.now();
      logAppResumeRefresh("app:hidden", { hiddenAt: appWasHiddenAt });
      return;
    }

    if (document.visibilityState === "visible") {
      logAppResumeRefresh("app:visible", {
        hiddenForMs: appWasHiddenAt ? Date.now() - appWasHiddenAt : 0,
      });
      runAppResumeRefresh("visibilitychange");
    }
  });

  window.addEventListener("pageshow", (event) => {
    logAppResumeRefresh("app:pageshow", {
      persisted: !!event.persisted,
    });
    runAppResumeRefresh(event.persisted ? "pageshow-persisted" : "pageshow");
  });

  window.addEventListener("focus", () => {
    logAppResumeRefresh("app:focus", {
      hiddenForMs: appWasHiddenAt ? Date.now() - appWasHiddenAt : 0,
    });
    runAppResumeRefresh("focus");
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

async function bootstrapApplication() {
  if (window.__fiksturAppBootstrapPromise)
    return window.__fiksturAppBootstrapPromise;

  window.__fiksturAppBootstrapPromise = (async () => {
    try {
      await initializeFirebaseOnce();
      await ensureFirebaseDefaults();
      ensureFirebaseRealtimeBridge();
    } catch (error) {
      console.error("Uygulama Firebase olmadan başlatılmadı:", error);
      appBootstrapInProgress = false;
      updateLoginOverlay();
      return false;
    }

    bindEvents();
    ensureHeaderSyncButtons();
    ensureAvatarDirectoryReady();

    if (typeof suspendViewportPersistence === "function") {
      suspendViewportPersistence(900);
    }
    switchTab(state.settings.currentTab || "dashboard", {
      skipPersistPrevious: true,
      skipViewportRestore: true,
    });
    if (typeof scheduleTabViewportRestore === "function") {
      scheduleTabViewportRestore(state.settings.currentTab || "dashboard", {
        fallbackToTop: false,
      });
    }
    updateLoginOverlay();
    updateAdminSyncToggleButton();
    bindIdleLogoutHooks();
    bindAppResumeRefreshHooks();

    if (isFirebaseReady()) {
      ensureFirebaseDefaults().catch((error) =>
        console.warn("Firebase varsayılanları hazırlanamadı:", error),
      );
      ensureFirebaseRealtimeBridge();
    }
    console.log("[START] Firebase Ready :", isFirebaseReady());
    console.log("[START] Authenticated  :", isAuthenticated());
    console.log("[START] Current User   :", getAuthUser?.());
    if (isAuthenticated()) {
      const expiredOnColdStart = checkIdleLogoutAfterResume();

      if (!expiredOnColdStart && isAuthenticated()) {
        appBootstrapInProgress = true;
        startPresenceTracking();
        renderAll();
        console.log("[START] Birleşik başlangıç eşitlemesi başladı");

        (async () => {
          try {
            const sessionHydrationOk = await runSessionHydrationWithFastOverlay(
              {
                loadingMessage:
                  "Aktif sezon ve en güncel yayınlanan hafta Firebase üzerinden doğrulanıyor...",
                sessionRestore: true,
                suppressOverlay: false,
              },
            );
            console.log("[START] Session Hydration bitti:", sessionHydrationOk);

            const fullHydrationOk =
              await hydrateFromFirebaseRealtime("startup-auto");
            validateFreshActiveSelection({ forceNewestPublished: true });
            ensureActiveSelections();
            saveState(true);

            console.log(
              "[START] Tam Firebase eşitlemesi bitti:",
              fullHydrationOk,
              {
                seasons: state.seasons?.length || 0,
                weeks: state.weeks?.length || 0,
                activeSeasonId: state.settings.activeSeasonId || null,
                activeWeekId: state.settings.activeWeekId || null,
                matches: state.matches?.length || 0,
                predictions: state.predictions?.length || 0,
              },
            );

            if ((state.settings.currentTab || "dashboard") === "dashboard") {
              await maybeAutoSyncResults();
              renderDashboardSyncCard();
              renderDashboardAutoSyncStatus();
            }
          } catch (error) {
            console.warn("Başlangıç maç/tahmin senkron uyarısı:", error);
          } finally {
            appBootstrapInProgress = false;
            renderAll();
          }
        })();
      } else {
        appBootstrapInProgress = false;
        renderAll();
      }
    } else {
      appBootstrapInProgress = false;
      renderAll();
    }
    return true;
  })();

  return window.__fiksturAppBootstrapPromise;
}

function startApplicationBootstrap() {
  bootstrapApplication().catch((error) => {
    console.error("Uygulama bootstrap hatası:", error);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApplicationBootstrap, {
    once: true,
  });
} else {
  startApplicationBootstrap();
}

window.refreshFirebaseAdminPanel = refreshFirebaseAdminPanel;
window.testFirebaseAdminConnection = testFirebaseAdminConnection;
window.toggleFirebaseAdminCard = toggleFirebaseAdminCard;
window.toggleDashboardSyncCard = toggleDashboardSyncCard;
window.toggleAdminSyncOverview = toggleAdminSyncOverview;
window.handleTeamLogoError = handleTeamLogoError;
document.addEventListener("keydown", (e) => {
  const key = String(e?.key || "").toLowerCase();

  if (key !== "c") return;

  const standingsTab = document.getElementById("tab-standings");
  if (!standingsTab || !standingsTab.classList.contains("active")) return;

  document.body.classList.toggle("standings-shot-mode");
});

let dashboardClockRefreshTimer = null;
let dashboardClockRefreshBusy = false;
let dashboardClockLastPhaseMap = new Map();

function getPremiumMatchState(match) {
  const now = Date.now();
  const visual =
    typeof getMatchVisualState === "function"
      ? getMatchVisualState(match)
      : "waiting";
  const runtime =
    typeof getMatchRuntimeInfo === "function"
      ? getMatchRuntimeInfo(match, now)
      : { diffMs: null, elapsedMs: null, minute: null, phase: visual };
  const diff = runtime.diffMs;
  const countdown =
    diff !== null && diff > 0
      ? formatPredictionLockCountdown(diff)
      : "00sa 00dk 00sn";

  if (match?.played || visual === "played" || visual === "played-postponed") {
    return { phase: visual, label: "BİTTİ", kicker: "FULL TIME" };
  }

  if (visual === "finished-time") {
    return { phase: visual, label: "BİTTİ", kicker: "SONUÇ BEKLİYOR" };
  }

  if (visual === "live") {
    const liveMinute = runtime.minute
      ? `${runtime.minute}'`
      : String(match?.statusText || "Canlı")
          .replace(/live|in play/gi, "")
          .trim() || "Canlı";
    return { phase: visual, label: "CANLI", kicker: liveMinute };
  }

  if (visual === "locked") {
    return { phase: visual, label: "KİLİTLİ", kicker: countdown };
  }

  return { phase: visual, label: "BEKLİYOR", kicker: countdown };
}

function startDashboardClockRefresh() {
  if (dashboardClockRefreshTimer) return;

  const tickDashboardClock = () => {
    if (dashboardClockRefreshBusy) return;
    if ((state.settings.currentTab || "dashboard") !== "dashboard") return;

    const container = document.getElementById("dashboardMatches");
    if (!container) return;

    dashboardClockRefreshBusy = true;

    try {
      let needsFullRender = false;

      container
        .querySelectorAll(".premium-match-card[data-match-id]")
        .forEach((card) => {
          const matchId = card.dataset.matchId;
          const match = state.matches.find(
            (item) => String(item.id) === String(matchId),
          );
          if (!match) return;

          const premium = getPremiumMatchState(match);
          const countdownEl = card.querySelector(
            "[data-countdown-text], .premium-countdown strong",
          );

          if (countdownEl) {
            countdownEl.textContent = premium.kicker || "";
          }

          const oldPhase = dashboardClockLastPhaseMap.get(matchId);
          const newPhase = premium.phase || premium.label || "";

          if (oldPhase && oldPhase !== newPhase) {
            needsFullRender = true;
          }

          dashboardClockLastPhaseMap.set(matchId, newPhase);
        });

      if (needsFullRender) {
        renderDashboardOverview();
        renderMatches("dashboardMatches", state.settings.activeWeekId);
      }
    } catch (error) {
      console.warn("Dashboard saat yenileme hatası:", error);
    } finally {
      dashboardClockRefreshBusy = false;
    }
  };

  tickDashboardClock();
  dashboardClockRefreshTimer = setInterval(tickDashboardClock, 1000);
}

startDashboardClockRefresh();
/* 06-notifications.js */

const PREDICTION_NOTIFICATION_STORAGE_KEY =
  "fikstur_prediction_notifications_enabled_v1";
const PREDICTION_NOTIFICATION_SENT_KEY =
  "fikstur_prediction_notifications_sent_v1";
const PREDICTION_NOTIFICATION_FCM_TOKEN_KEY = "fikstur_prediction_fcm_token_v1";
const PREDICTION_NOTIFICATION_DEVICE_ID_KEY =
  "fikstur_prediction_fcm_device_id_v1";
const PREDICTION_NOTIFICATION_CHECK_INTERVAL_MS = 60 * 1000;

const PREDICTION_NOTIFICATION_REMINDERS = [
  { id: "2h", label: "2 saat", ms: 2 * 60 * 60 * 1000 },
  { id: "1h", label: "1 saat", ms: 60 * 60 * 1000 },
];

let predictionNotificationTimer = null;
const FIKSTUR_FOREGROUND_NOTIFICATION_DEDUPE_KEY =
  "fikstur_foreground_notification_dedupe_v1";
const FIKSTUR_FOREGROUND_NOTIFICATION_DEDUPE_MS = 15000;

function shouldSkipForegroundFiksturNotification(key) {
  const safeKey = String(key || "").trim();
  if (!safeKey) return false;

  let cache = {};
  try {
    cache = JSON.parse(
      sessionStorage.getItem(FIKSTUR_FOREGROUND_NOTIFICATION_DEDUPE_KEY) ||
        "{}",
    );
  } catch {
    cache = {};
  }

  const now = Date.now();
  Object.keys(cache).forEach((cacheKey) => {
    if (
      now - Number(cache[cacheKey] || 0) >
      FIKSTUR_FOREGROUND_NOTIFICATION_DEDUPE_MS
    ) {
      delete cache[cacheKey];
    }
  });

  if (
    now - Number(cache[safeKey] || 0) <
    FIKSTUR_FOREGROUND_NOTIFICATION_DEDUPE_MS
  ) {
    return true;
  }

  cache[safeKey] = now;
  try {
    sessionStorage.setItem(
      FIKSTUR_FOREGROUND_NOTIFICATION_DEDUPE_KEY,
      JSON.stringify(cache),
    );
  } catch {}

  return false;
}

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
    return JSON.parse(
      localStorage.getItem(PREDICTION_NOTIFICATION_SENT_KEY) || "{}",
    );
  } catch {
    return {};
  }
}

function writePredictionNotificationSentMap(map) {
  localStorage.setItem(
    PREDICTION_NOTIFICATION_SENT_KEY,
    JSON.stringify(map || {}),
  );
}

function getNextPredictionLockTarget() {
  const seasonId = state?.settings?.activeSeasonId;
  const weeks = Array.isArray(state?.weeks) ? state.weeks : [];
  const now = Date.now();

  return (
    weeks
      .filter((week) => !seasonId || String(week.seasonId) === String(seasonId))
      .filter(
        (week) =>
          week.predictionManualLocked !== true &&
          week.predictionManualOpen !== true,
      )
      .map((week) => {
        const lockTs = getWeekPredictionLockTimestamp(week.id);
        return {
          week,
          lockTs,
          diff: typeof lockTs === "number" ? lockTs - now : null,
        };
      })
      .filter((item) => typeof item.lockTs === "number" && item.diff > 0)
      .sort((a, b) => a.lockTs - b.lockTs)[0] || null
  );
}

function showPredictionReminderNotification(target, reminder) {
  const weekNumber =
    target?.week?.number || getWeekNumberById(target?.week?.id) || "?";
  const title = "⏳ Tahminler yakında kilitleniyor";
  const body = `${weekNumber}. hafta tahminlerinin kilitlenmesine ${reminder.label} kaldı. Tahminini son kez kontrol etmeyi unutma!`;

  const notificationTag = `prediction-reminder-${target.week.id}-${reminder.id}`;

  try {
    console.log("[PAGE] new Notification çalıştı", title, notificationTag);
    new Notification(title, {
      body,
      tag: notificationTag,
      renotify: true,
      icon: getFiksturNotificationAssetUrl("/app-icons/pwa-icon-192-v3.png"),
      badge: getFiksturNotificationAssetUrl("/notification-icons/badge-72.png"),
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

function getFiksturNotificationDeviceId() {
  let deviceId = localStorage.getItem(PREDICTION_NOTIFICATION_DEVICE_ID_KEY);
  if (!deviceId) {
    const randomPart =
      window.crypto?.randomUUID?.() ||
      `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    deviceId = `web_${String(randomPart).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    localStorage.setItem(PREDICTION_NOTIFICATION_DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

function getFiksturNotificationAssetUrl(path) {
  try {
    return new URL(path, window.location.origin + "/").toString();
  } catch {
    return path;
  }
}

async function cleanupDuplicateFiksturFcmTokens(
  currentDeviceKey,
  token,
  owner,
) {
  if (!token || !currentDeviceKey || !isFirebaseReady?.()) return;

  try {
    const rows =
      typeof firebaseRead === "function"
        ? await firebaseRead("fcmTokens")
        : null;
    const updates = {};
    const ownerIds = [owner?.userId, owner?.playerId]
      .filter(Boolean)
      .map(String);

    Object.entries(rows || {}).forEach(([key, value]) => {
      if (!value || key === currentDeviceKey) return;

      const rowToken = String(value.token || "");
      const rowDeviceId = String(value.deviceId || key || "");
      const rowIds = [value.userId, value.playerId].filter(Boolean).map(String);

      const sameToken = rowToken && rowToken === token;
      const sameDevice = rowDeviceId && rowDeviceId === currentDeviceKey;
      const sameOwnerSameToken =
        sameToken &&
        ownerIds.length &&
        rowIds.some((id) => ownerIds.includes(id));

      if (sameToken || sameDevice || sameOwnerSameToken) {
        updates[`fcmTokens/${key}`] = null;
      }
    });

    if (Object.keys(updates).length) {
      await firebaseUpdate("", updates);
      console.log(
        `[FCM] Eski/çift token kayıtları temizlendi: ${Object.keys(updates).length}`,
      );
    }
  } catch (error) {
    console.warn("[FCM] Çift token temizliği yapılamadı:", error);
  }
}

function getFcmTokenOwnerInfo() {
  const authUser = getAuthUser?.() || state?.settings?.auth?.user || null;
  const player = getCurrentPlayer?.() || null;
  const authPlayerId = state?.settings?.auth?.playerId || null;
  const isLoggedIn = !!(state?.settings?.auth?.isAuthenticated && authUser);

  if (!isLoggedIn) {
    return null;
  }

  const userId = String(
    player?.id ||
      authPlayerId ||
      authUser?.playerId ||
      authUser?.id ||
      authUser?.kisiId ||
      "",
  ).trim();
  const playerId = String(
    player?.id || authPlayerId || authUser?.playerId || authUser?.kisiId || "",
  ).trim();
  const displayName = String(
    player?.adSoyad ||
      player?.name ||
      authUser?.adSoyad ||
      authUser?.name ||
      authUser?.kullaniciAdi ||
      authUser?.username ||
      "",
  ).trim();

  if (!userId || !displayName) {
    return null;
  }

  return {
    userId,
    playerId: playerId || userId,
    displayName,
    username: authUser?.kullaniciAdi || authUser?.username || "",
    role: authUser?.rol || state?.settings?.auth?.role || null,
  };
}

async function registerFiksturMessagingServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Bu tarayıcı service worker desteklemiyor.");
  }

  const swUrl = new URL(
    "./firebase-messaging-sw.js",
    window.location.href,
  ).toString();

  const registration = await navigator.serviceWorker.register(
    "./firebase-messaging-sw.js",
    {
      scope: "./",
    },
  );

  await navigator.serviceWorker.ready;

  return registration;
}

async function saveFiksturFcmTokenToFirebase(token) {
  if (!token) return false;

  const owner = getFcmTokenOwnerInfo();
  if (!owner) {
    console.warn(
      "[FCM] Kullanıcı oturumu hazır olmadığı için token kaydı bekletildi.",
    );
    return false;
  }

  const deviceId = getFiksturNotificationDeviceId();
  const safeDeviceKey =
    sanitizeFirebaseKey?.(deviceId) || deviceId.replace(/[.#$\[\]/]/g, "_");
  const previousToken =
    localStorage.getItem(PREDICTION_NOTIFICATION_FCM_TOKEN_KEY) || "";

  const payload = {
    token,
    previousToken:
      previousToken && previousToken !== token ? previousToken : null,
    deviceId: safeDeviceKey,
    ...owner,
    permission: Notification.permission,
    userAgent: navigator.userAgent,
    platform: navigator.platform || "",
    updatedAt: new Date().toISOString(),
  };

  try {
    if (typeof firebaseUpdate === "function") {
      await firebaseUpdate(`fcmTokens/${safeDeviceKey}`, payload);
    } else if (window.firebase?.database) {
      await window.firebase
        .database()
        .ref(`fcmTokens/${safeDeviceKey}`)
        .update(payload);
    } else {
      throw new Error("Firebase Database kayıt fonksiyonu bulunamadı.");
    }

    await cleanupDuplicateFiksturFcmTokens(safeDeviceKey, token, owner);
    localStorage.setItem(PREDICTION_NOTIFICATION_FCM_TOKEN_KEY, token);
    return true;
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
    console.warn(
      "[FCM] VAPID key henüz girilmedi. index.html içindeki FIKSTUR_FIREBASE_VAPID_KEY alanını doldur.",
    );
    return null;
  }

  const registration = await registerFiksturMessagingServiceWorker();
  const messaging = window.firebase.messaging();

  messaging.onMessage((payload) => {
    const title =
      payload?.data?.title || payload?.notification?.title || "Tahmin Paneli";
    const body =
      payload?.data?.body ||
      payload?.notification?.body ||
      "Yeni bildirimin var.";
    const dedupeKey =
      payload?.data?.dedupeKey || payload?.data?.tag || `${title}|${body}`;
    if (shouldSkipForegroundFiksturNotification(dedupeKey)) {
      console.log(
        "[FCM] Aynı ön plan bildirimi kısa süre içinde tekrar geldi, gösterilmedi:",
        dedupeKey,
      );
      return;
    }

    try {
      new Notification(title, {
        body,
        icon:
          payload?.data?.icon ||
          payload?.notification?.icon ||
          getFiksturNotificationAssetUrl("/app-icons/pwa-icon-192-v3.png"),
        badge:
          payload?.data?.badge ||
          getFiksturNotificationAssetUrl("/notification-icons/badge-72.png"),
        image:
          payload?.data?.image ||
          getFiksturNotificationAssetUrl("/app-icons/pwa-icon-512-v3.png"),
        tag:
          payload?.data?.tag ||
          String(dedupeKey)
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(0, 120),
        renotify: false,
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
    console.warn(
      "[FCM] Token alınamadı. İzin verilmemiş veya tarayıcı desteklemiyor olabilir.",
    );
    return null;
  }

  const saved = await saveFiksturFcmTokenToFirebase(token);
  return saved ? token : null;
}

async function enablePredictionNotifications() {
  if (!isPredictionNotificationSupported()) {
    alert("Bu tarayıcı bildirim desteklemiyor.");
    return;
  }

  if (!window.isSecureContext && location.hostname !== "localhost") {
    alert(
      "Bildirim izni için site HTTPS üzerinden açılmalı. GitHub Pages yayını uygundur.",
    );
    console.warn("[Bildirim] HTTPS olmadığı için izin istenemedi.");
    return;
  }

  let permission = Notification.permission;

  try {
    permission = await Notification.requestPermission();
  } catch (error) {
    console.warn("[Bildirim] İzin penceresi açılamadı:", error);
    alert(
      "Bildirim izin penceresi açılamadı. Sayfayı yenileyip butona tekrar bas.",
    );
    return;
  }

  if (permission !== "granted") {
    localStorage.removeItem(PREDICTION_NOTIFICATION_STORAGE_KEY);
    alert(
      "Bildirim izni verilmedi. Tekrar denemek için Bildirimleri aç butonuna basabilirsin.",
    );
    renderPredictionLockBanner?.(state?.settings?.activeWeekId);
    return;
  }

  localStorage.setItem(PREDICTION_NOTIFICATION_STORAGE_KEY, "1");

  try {
    const token = await setupFiksturFcmToken();
    if (token) {
      alert("Bildirimler açıldı ve bu cihaz Firebase'e kaydedildi.");
    } else {
      alert(
        "Bildirim izni açıldı. FCM token için VAPID key girildikten sonra tekrar dene.",
      );
    }
  } catch (error) {
    console.error("[FCM] Token alma sırasında hata oluştu:", {
      code: error?.code,
      message: error?.message,
      name: error?.name,
      error,
    });
    alert(
      `Bildirim izni açıldı ama Firebase token alınamadı. Hata: ${error?.code || error?.message || "Bilinmeyen hata"}`,
    );
  }

  checkPredictionNotifications();
  renderPredictionLockBanner?.(state?.settings?.activeWeekId);
}

window.refreshFiksturFcmTokenOwner =
  async function refreshFiksturFcmTokenOwner() {
    if (
      isPredictionNotificationSupported() &&
      Notification.permission === "granted" &&
      hasValidFiksturVapidKey()
    ) {
      return setupFiksturFcmToken();
    }
    return null;
  };

function bindPredictionNotificationHooks() {
  document.addEventListener("click", (event) => {
    const enableButton = event.target.closest?.(
      '[data-action="enable-prediction-notifications"]',
    );
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

  if (
    isPredictionNotificationSupported() &&
    Notification.permission === "granted" &&
    hasValidFiksturVapidKey()
  ) {
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
  {
    id: "default",
    emoji: "🔔",
    label: "Genel",
    iconPath: "/notification-icons/notif-default.png",
    badgePath: "/notification-icons/badge-default.png",
  },
  {
    id: "match",
    emoji: "⚽",
    label: "Maç",
    iconPath: "/notification-icons/notif-match.png",
    badgePath: "/notification-icons/badge-match.png",
  },
  {
    id: "cup",
    emoji: "🏆",
    label: "Sonuç",
    iconPath: "/notification-icons/notif-cup.png",
    badgePath: "/notification-icons/badge-cup.png",
  },
  {
    id: "alert",
    emoji: "🚨",
    label: "Acil",
    iconPath: "/notification-icons/notif-alert.png",
    badgePath: "/notification-icons/badge-alert.png",
  },
  {
    id: "announce",
    emoji: "📢",
    label: "Duyuru",
    iconPath: "/notification-icons/notif-announce.png",
    badgePath: "/notification-icons/badge-announce.png",
  },
  {
    id: "star",
    emoji: "⭐",
    label: "Öne Çıkan",
    iconPath: "/notification-icons/notif-star.png",
    badgePath: "/notification-icons/badge-star.png",
  },
];

function getAdminNotificationAssetUrls(iconId) {
  const meta = getAdminNotificationIconMeta(iconId);
  return {
    iconUrl: getFiksturNotificationAssetUrl(
      meta.iconPath || "/notification-icons/notif-default.png",
    ),
    badgeUrl: getFiksturNotificationAssetUrl(
      meta.badgePath || "/notification-icons/badge-default.png",
    ),
  };
}

function getAdminNotificationIconMeta(iconId) {
  return (
    ADMIN_NOTIFICATION_ICONS.find((item) => item.id === iconId) ||
    ADMIN_NOTIFICATION_ICONS[0]
  );
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
    const count = Array.isArray(row?.targetUserIds)
      ? row.targetUserIds.length
      : 0;
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
      "İsimsiz",
  ).trim();
}

function normalizeNotificationArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object")
    return Object.values(value).filter(Boolean);
  return [];
}

function getPlayerNotificationId(player) {
  return String(
    player?.id || player?.kullaniciAdi || player?.username || "",
  ).trim();
}

function normalizeFcmTokenRows(tokens) {
  const rows = Object.entries(tokens || {})
    .map(([id, item]) => ({
      id,
      token: item?.token || id,
      deviceId: item?.deviceId || id,
      userId: String(
        item?.userId ||
          item?.playerId ||
          item?.kisiId ||
          item?.username ||
          item?.kullaniciAdi ||
          "",
      ).trim(),
      playerId: String(
        item?.playerId ||
          item?.userId ||
          item?.kisiId ||
          item?.username ||
          item?.kullaniciAdi ||
          "",
      ).trim(),
      displayName:
        item?.displayName ||
        item?.name ||
        item?.userName ||
        "Bilinmeyen kullanıcı",
      role: item?.role || "",
      permission: item?.permission || "unknown",
      updatedAt: item?.updatedAt || item?.createdAt || "",
      userAgent: item?.userAgent || "",
    }))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const uniqueRows = [];
  const seenTokens = new Set();
  const seenOwners = new Set();

  rows.forEach((row) => {
    const tokenKey = row.token || row.deviceId || row.id;
    const ownerKey = row.userId || row.playerId || row.displayName || tokenKey;
    if (!tokenKey || seenTokens.has(tokenKey) || seenOwners.has(ownerKey))
      return;
    seenTokens.add(tokenKey);
    seenOwners.add(ownerKey);
    uniqueRows.push(row);
  });

  return uniqueRows;
}

function getNotificationUserRows(tokenRows) {
  const tokenByUser = new Map();
  tokenRows.forEach((token) => {
    const keys = [
      ...new Set([token.userId, token.playerId].filter(Boolean).map(String)),
    ];
    keys.forEach((key) => {
      if (!tokenByUser.has(key)) tokenByUser.set(key, new Map());
      tokenByUser
        .get(key)
        .set(token.token || token.deviceId || token.id, token);
    });
  });

  return getNotificationSelectablePlayers()
    .map((player) => {
      const id = getPlayerNotificationId(player);
      const tokens = [...(tokenByUser.get(id)?.values() || [])];
      const grantedTokens = tokens.filter(
        (token) =>
          token.permission === "granted" || token.permission === "unknown",
      );
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
    })
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

function getNotificationDeliveryList(row) {
  const rawSuccess = normalizeNotificationArray(
    row?.successUsers ||
      row?.sentUsers ||
      row?.deliveredUsers ||
      row?.successUserIds,
  );
  const rawFailed = normalizeNotificationArray(
    row?.failedUsers || row?.errorUsers || row?.failedUserIds,
  );
  const rawTargets = normalizeNotificationArray(row?.targetUserIds);
  return { rawSuccess, rawFailed, rawTargets };
}

function getNotificationUserNameById(userId) {
  const user = adminNotificationLastUserRows.find(
    (item) => item.id === String(userId),
  );
  return user?.name || String(userId || "Bilinmeyen kişi");
}

function getNotificationSelectablePlayers() {
  return (Array.isArray(state?.players) ? state.players : [])
    .filter(
      (player) =>
        String(
          getPlayerRole?.(player) || player?.role || "user",
        ).toLowerCase() !== "admin",
    )
    .sort((a, b) =>
      getNotificationPlayerDisplayName(a).localeCompare(
        getNotificationPlayerDisplayName(b),
        "tr",
      ),
    );
}

function getSelectedManualNotificationUserIds() {
  return Array.from(
    document.querySelectorAll("[data-notification-user-checkbox]:checked"),
  )
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

  wrap.innerHTML = players
    .map((player) => {
      const id = escapeHtml(
        String(player.id || player.kullaniciAdi || player.username || ""),
      );
      const name = escapeHtml(getNotificationPlayerDisplayName(player));
      return `
      <label class="notification-user-chip">
        <input type="checkbox" value="${id}" data-notification-user-checkbox>
        <span>${name}</span>
      </label>
    `;
    })
    .join("");
}

function updateManualNotificationCustomTargetVisibility() {
  const target =
    document.getElementById("manualNotificationTarget")?.value || "all";
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
  const target =
    document.getElementById("manualNotificationTarget")?.value || "all";
  const icon =
    document.getElementById("manualNotificationIcon")?.value || "default";
  const targetUserIds =
    target === "custom" ? getSelectedManualNotificationUserIds() : [];
  return {
    title:
      document.getElementById("manualNotificationTitle")?.value.trim() || "",
    message:
      document.getElementById("manualNotificationMessage")?.value.trim() || "",
    target,
    icon,
    targetUserIds,
  };
}

function updateManualNotificationPreview() {
  const preview = document.getElementById("manualNotificationPreview");
  const previewTitle = document.getElementById(
    "manualNotificationPreviewTitle",
  );
  const previewTarget = document.getElementById(
    "manualNotificationPreviewTarget",
  );
  const previewIcon = document.getElementById("manualNotificationPreviewIcon");
  const charCounter = document.getElementById("manualNotificationCharCounter");
  const { title, message, target, icon, targetUserIds } =
    getManualNotificationFormValues();
  const maxLength = 300;

  if (charCounter) {
    charCounter.textContent = `${message.length} / ${maxLength}`;
    charCounter.classList.toggle(
      "is-warning",
      message.length >= 240 && message.length < maxLength,
    );
    charCounter.classList.toggle("is-danger", message.length >= maxLength);
  }

  if (previewTarget)
    previewTarget.textContent =
      target === "custom"
        ? getNotificationTargetLabel(target, { targetUserIds })
        : getNotificationTargetLabel(target);
  if (previewIcon)
    previewIcon.textContent = getAdminNotificationIconMeta(icon).emoji;
  if (previewTitle)
    previewTitle.textContent = title || "Başlık burada görünecek";
  if (!preview) return;

  if (!title && !message) {
    preview.textContent =
      "Mesaj yazıldığında telefonda nasıl görüneceğini buradan kontrol edebilirsin.";
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
  return {
    queue: queue || {},
    logs: logs || {},
    sent: sent || {},
    tokens: tokens || {},
  };
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
      successUsers: normalizeNotificationArray(
        item.successUsers ||
          item.sentUsers ||
          item.deliveredUsers ||
          item.successUserIds,
      ),
      failedUsers: normalizeNotificationArray(
        item.failedUsers || item.errorUsers || item.failedUserIds,
      ),
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
      successUsers: normalizeNotificationArray(
        item.successUsers ||
          item.sentUsers ||
          item.deliveredUsers ||
          item.successUserIds,
      ),
      failedUsers: normalizeNotificationArray(
        item.failedUsers || item.errorUsers || item.failedUserIds,
      ),
      raw: item,
    });
  });

  Object.entries(data.sent || {}).forEach(([id, item]) => {
    rows.push({
      id,
      sourcePath: `${ADMIN_NOTIFICATION_SENT_PATH}/${id}`,
      canDelete: true,
      date: item.sentAt,
      type: item.weekNo
        ? "Otomatik hafta"
        : item.type
          ? `Otomatik ${item.type}`
          : "Otomatik",
      title:
        item.title ||
        (item.weekNo
          ? `${item.weekNo}. hafta bildirimi`
          : "Maç hatırlatma bildirimi"),
      body:
        item.message ||
        (item.weekNo
          ? `${item.weekNo}. hafta bildirimi gönderildi`
          : "Maç hatırlatma bildirimi gönderildi"),
      rawTarget: item.target || "all",
      icon: item.icon || "match",
      targetUserIds: normalizeNotificationArray(item.targetUserIds),
      message: item.weekNo
        ? `${item.weekNo}. hafta bildirimi gönderildi`
        : "Maç hatırlatma bildirimi gönderildi",
      target: getNotificationTargetLabel(item.target || "all", item),
      status: item.sent ? "sent" : "done",
      successCount: item.successCount || 0,
      errorCount: item.errorCount || 0,
      errorMessage: item.errorMessage || "",
      successUsers: normalizeNotificationArray(
        item.successUsers ||
          item.sentUsers ||
          item.deliveredUsers ||
          item.successUserIds,
      ),
      failedUsers: normalizeNotificationArray(
        item.failedUsers || item.errorUsers || item.failedUserIds,
      ),
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

  const totalPages = Math.max(
    1,
    Math.ceil(totalRows / ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE),
  );
  adminNotificationHistoryPage = Math.min(
    Math.max(1, adminNotificationHistoryPage),
    totalPages,
  );

  if (info) {
    const start = totalRows
      ? (adminNotificationHistoryPage - 1) *
          ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE +
        1
      : 0;
    const end = Math.min(
      adminNotificationHistoryPage * ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE,
      totalRows,
    );
    info.textContent = totalRows
      ? `${start}-${end} / ${totalRows} kayıt`
      : "0 kayıt";
  }

  if (totalPages <= 1) {
    wrap.innerHTML = "";
    return;
  }

  const pageButtons = getCompactNotificationPageNumbers(
    adminNotificationHistoryPage,
    totalPages,
  )
    .map((page) => {
      if (page === "...")
        return `<span class="notification-page-dots">…</span>`;
      const isActive = page === adminNotificationHistoryPage;
      return `<button class="notification-page-btn ${isActive ? "is-active" : ""}" type="button" data-notification-page="${page}" aria-label="${page}. sayfaya git">${page}</button>`;
    })
    .join("");

  wrap.innerHTML = `
    <button class="notification-page-btn" type="button" data-notification-page="prev" ${adminNotificationHistoryPage === 1 ? "disabled" : ""}>‹</button>
    ${pageButtons}
    <button class="notification-page-btn" type="button" data-notification-page="next" ${adminNotificationHistoryPage === totalPages ? "disabled" : ""}>›</button>
  `;
}

function getFilteredNotificationRows(rows) {
  const filter = adminNotificationHistoryFilter;
  if (filter === "sent") {
    return rows.filter((row) =>
      ["sent", "done", "processed", "success"].includes(
        String(row.status || "").toLowerCase(),
      ),
    );
  }
  if (filter === "pending") {
    return rows.filter((row) =>
      [
        "pending",
        "queued",
        "draft",
        "processing",
        "scheduled",
        "planned",
      ].includes(String(row.status || "").toLowerCase()),
    );
  }
  if (filter === "failed") {
    return rows.filter(
      (row) =>
        ["error", "failed", "fail"].includes(
          String(row.status || "").toLowerCase(),
        ) || row.errorMessage,
    );
  }
  if (filter === "manual") {
    return rows.filter((row) =>
      String(row.type || "")
        .toLowerCase()
        .includes("manuel"),
    );
  }
  return rows;
}

function updateNotificationHistoryFilterButtons() {
  document.querySelectorAll("[data-notification-filter]").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.notificationFilter === adminNotificationHistoryFilter,
    );
  });
}

function renderNotificationHistoryRows(rows) {
  const tbody = document.getElementById("notificationHistoryBody");
  if (!tbody) return;

  adminNotificationHistoryRows = Array.isArray(rows) ? rows : [];
  updateNotificationHistoryFilterButtons();
  const visibleRows = getFilteredNotificationRows(adminNotificationHistoryRows);
  const totalPages = Math.max(
    1,
    Math.ceil(visibleRows.length / ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE),
  );
  adminNotificationHistoryPage = Math.min(
    Math.max(1, adminNotificationHistoryPage),
    totalPages,
  );

  if (!visibleRows.length) {
    tbody.innerHTML = `<tr><td colspan="6">Bu filtrede bildirim kaydı yok.</td></tr>`;
    renderNotificationPagination(0);
    return;
  }

  const startIndex =
    (adminNotificationHistoryPage - 1) * ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE;
  const pageRows = visibleRows.slice(
    startIndex,
    startIndex + ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE,
  );

  tbody.innerHTML = pageRows
    .map((row) => {
      const status = String(row.status || "pending");
      const isPending = ["pending", "queued", "processing"].includes(status);
      const statusMeta = getNotificationStatusMeta(status);
      const iconMeta = getAdminNotificationIconMeta(row.icon);
      const extra = row.successCount
        ? ` (${row.successCount} başarılı)`
        : row.errorMessage
          ? ` - ${row.errorMessage}`
          : "";
      const titleAttr = isPending
        ? "Gönderilmeden önce bu kaydı kuyruktan sil"
        : "Bu geçmiş kaydını sil";
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
    })
    .join("");

  renderNotificationPagination(visibleRows.length);
}

function refillNotificationFormFromHistory(sourcePath) {
  const row = adminNotificationHistoryRows.find(
    (item) => item.sourcePath === sourcePath,
  );
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
    document
      .querySelectorAll("[data-notification-user-checkbox]")
      .forEach((input) => {
        input.checked = row.targetUserIds.includes(input.value);
      });
  }
  updateManualNotificationPreview();
  document
    .querySelector(".notification-compose-card")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const row = adminNotificationHistoryRows.find(
    (item) => item.sourcePath === sourcePath,
  );
  const status = String(row?.status || "");
  const isPending = ["pending", "queued", "processing"].includes(status);
  const message = isPending
    ? "Bu bildirim henüz gönderilmemiş görünüyor. Silersen cron-job artık bunu göndermeyecek. Silinsin mi?"
    : "Bu işlem sadece geçmiş kaydını siler; daha önce gönderilmiş bildirimi kullanıcı cihazlarından geri almaz. Silinsin mi?";

  if (!confirm(message)) return;

  await firebaseRemove(sourcePath);
  const totalAfterDelete = Math.max(0, adminNotificationHistoryRows.length - 1);
  const lastPageAfterDelete = Math.max(
    1,
    Math.ceil(totalAfterDelete / ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE),
  );
  adminNotificationHistoryPage = Math.min(
    adminNotificationHistoryPage,
    lastPageAfterDelete,
  );
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

  list.innerHTML = userRows
    .map(
      (user) => `
    <div class="notification-audience-row ${user.isOpen ? "is-open" : "is-closed"}">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <small>${user.hasToken ? `${escapeHtml(String(user.tokenCount))} cihaz · son kayıt ${escapeHtml(formatNotificationCenterDate(user.lastSeen))}` : "Bu kullanıcıdan kayıtlı cihaz/token yok"}</small>
      </div>
      <span class="badge ${user.isOpen ? "success" : "gray"}">${user.isOpen ? "🔔 Açık" : "🔕 Kapalı"}</span>
    </div>
  `,
    )
    .join("");
}

function renderNotificationDetailModal(sourcePath) {
  const modal = document.getElementById("notificationDetailModal");
  const body = document.getElementById("notificationDetailBody");
  if (!modal || !body) return;

  const row = adminNotificationHistoryRows.find(
    (item) => item.sourcePath === sourcePath,
  );
  if (!row) {
    alert("Bildirim detayı bulunamadı.");
    return;
  }

  const statusMeta = getNotificationStatusMeta(row.status);
  const iconMeta = getAdminNotificationIconMeta(row.icon);
  const { rawSuccess, rawFailed, rawTargets } =
    getNotificationDeliveryList(row);
  const targetUsers = rawTargets.map((id) => getNotificationUserNameById(id));
  const successUsers = rawSuccess.map((item) =>
    typeof item === "string"
      ? getNotificationUserNameById(item)
      : item?.displayName ||
        item?.name ||
        getNotificationUserNameById(item?.userId || item?.playerId || item?.id),
  );
  const failedUsers = rawFailed.map((item) =>
    typeof item === "string"
      ? getNotificationUserNameById(item)
      : item?.displayName ||
        item?.name ||
        getNotificationUserNameById(item?.userId || item?.playerId || item?.id),
  );

  const makeList = (items, emptyText) =>
    items.length
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
  const pendingCount = rows.filter((r) =>
    ["pending", "queued", "draft", "processing"].includes(
      String(r.status || "").toLowerCase(),
    ),
  ).length;
  const successTotal = rows.reduce(
    (sum, r) => sum + (Number(r.successCount) || 0),
    0,
  );
  const errorTotal = rows.reduce(
    (sum, r) => sum + (Number(r.errorCount) || 0),
    0,
  );
  const lastRow = rows[0];
  const lastError = rows.find(
    (r) => r.status === "error" || r.status === "failed" || r.errorMessage,
  );

  setNotificationText("notificationPendingCountText", String(pendingCount));
  setNotificationText("notificationSuccessCountText", String(successTotal));
  setNotificationText("notificationErrorCountText", String(errorTotal));
  setNotificationText(
    "notificationLastTitleText",
    lastRow ? lastRow.title || lastRow.message || "Başlıksız" : "Henüz yok",
  );
  setNotificationText(
    "notificationLastCronText",
    lastRow ? formatNotificationCenterDate(lastRow.date) : "Henüz kayıt yok",
  );
  setNotificationText(
    "notificationLastCronMeta",
    lastRow
      ? `${lastRow.type} · ${lastRow.status}`
      : "GitHub Action çalışınca buraya yazılacak.",
  );
  setNotificationText(
    "notificationLastErrorText",
    lastError
      ? `Son hata: ${lastError.errorMessage || "Hata var"}`
      : "Son hata: Yok",
  );
  setNotificationText(
    "notificationFirebaseStatus",
    isFirebaseReady() ? "Bağlı" : "Kapalı",
  );

  const fbBadge = document.getElementById("notificationFirebaseStatusBadge");
  if (fbBadge) {
    fbBadge.textContent = isFirebaseReady()
      ? "Firebase bağlı"
      : "Firebase kapalı";
    fbBadge.className = `badge ${isFirebaseReady() ? "success" : "warn"}`;
  }

  const queueBadge = document.getElementById("notificationQueueStatusBadge");
  if (queueBadge) {
    queueBadge.textContent = pendingCount
      ? `${pendingCount} bekleyen`
      : "Kuyruk boş";
    queueBadge.className = `badge ${pendingCount ? "warn" : "gray"}`;
  }
}

async function renderNotificationCenter() {
  if (!document.getElementById("tab-notifications")) return;
  renderManualNotificationUserPicker();
  updateManualNotificationCustomTargetVisibility();
  updateManualNotificationPreview();

  const draft = (() => {
    try {
      return JSON.parse(
        localStorage.getItem(ADMIN_NOTIFICATION_DRAFT_KEY) || "null",
      );
    } catch {
      return null;
    }
  })();
  if (
    draft &&
    !document.getElementById("manualNotificationTitle")?.value &&
    !document.getElementById("manualNotificationMessage")?.value
  ) {
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
      document
        .querySelectorAll("[data-notification-user-checkbox]")
        .forEach((input) => {
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
    setNotificationText(
      "notificationLastErrorText",
      error.message || "Yüklenemedi",
    );
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

  const { title, message, target, icon, targetUserIds } =
    getManualNotificationFormValues();
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
  const assetUrls = getAdminNotificationAssetUrls(icon);
  const payload = {
    id,
    type: "manual",
    status: "pending",
    title,
    message,
    target,
    icon,
    iconEmoji: getAdminNotificationIconMeta(icon).emoji,
    iconUrl: assetUrls.iconUrl,
    badgeUrl: assetUrls.badgeUrl,
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
  document
    .querySelectorAll("[data-notification-user-checkbox]")
    .forEach((input) => {
      input.checked = false;
    });
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

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const oldRows = adminNotificationHistoryRows.filter((row) => {
    if (
      ["pending", "queued", "processing"].includes(
        String(row.status || "").toLowerCase(),
      )
    )
      return false;
    const time = new Date(row.date || 0).getTime();
    return time && time < cutoff && row.sourcePath;
  });

  if (!oldRows.length) {
    alert("30 günden eski silinecek kayıt bulunamadı kanka.");
    return;
  }

  if (
    !confirm(
      `${oldRows.length} adet eski geçmiş kaydı silinecek. Bekleyen bildirimlere dokunulmayacak. Devam edilsin mi?`,
    )
  )
    return;

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
    if (
      ["manualNotificationTitle", "manualNotificationMessage"].includes(
        event.target?.id,
      ) ||
      event.target?.matches?.("[data-notification-user-checkbox]")
    ) {
      updateManualNotificationPreview();
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target?.id === "manualNotificationTarget") {
      updateManualNotificationCustomTargetVisibility();
      updateManualNotificationPreview();
    }
    if (event.target?.id === "manualNotificationIcon")
      updateManualNotificationPreview();
    if (event.target?.matches?.("[data-notification-user-checkbox]"))
      updateManualNotificationPreview();
  });

  document.addEventListener("click", async (event) => {
    const draftButton = event.target.closest?.(
      "#saveManualNotificationDraftBtn",
    );
    const queueButton = event.target.closest?.("#queueManualNotificationBtn");
    const deleteButton = event.target.closest?.(
      "[data-notification-delete-path]",
    );
    const detailButton = event.target.closest?.(
      "[data-notification-detail-path]",
    );
    const detailCloseButton = event.target.closest?.(
      "[data-notification-detail-close]",
    );
    const detailBackdrop = event.target.classList?.contains(
      "notification-detail-modal",
    )
      ? event.target
      : null;
    const repeatButton = event.target.closest?.(
      "[data-notification-repeat-path]",
    );
    const pageButton = event.target.closest?.("[data-notification-page]");
    const filterButton = event.target.closest?.("[data-notification-filter]");
    const cleanupButton = event.target.closest?.("#cleanupOldNotificationsBtn");
    const selectAllButton = event.target.closest?.(
      "#selectAllNotificationUsersBtn",
    );
    const clearSelectedButton = event.target.closest?.(
      "#clearNotificationUsersBtn",
    );

    if (detailCloseButton || detailBackdrop) {
      event.preventDefault();
      closeNotificationDetailModal();
      return;
    }

    if (detailButton) {
      event.preventDefault();
      renderNotificationDetailModal(
        detailButton.dataset.notificationDetailPath,
      );
      return;
    }

    if (draftButton) {
      event.preventDefault();
      saveManualNotificationDraft();
      return;
    }

    if (selectAllButton) {
      event.preventDefault();
      document
        .querySelectorAll("[data-notification-user-checkbox]")
        .forEach((input) => {
          input.checked = true;
        });
      updateManualNotificationPreview();
      return;
    }

    if (clearSelectedButton) {
      event.preventDefault();
      document
        .querySelectorAll("[data-notification-user-checkbox]")
        .forEach((input) => {
          input.checked = false;
        });
      updateManualNotificationPreview();
      return;
    }

    if (filterButton) {
      event.preventDefault();
      adminNotificationHistoryFilter =
        filterButton.dataset.notificationFilter || "all";
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
      refillNotificationFormFromHistory(
        repeatButton.dataset.notificationRepeatPath,
      );
      return;
    }

    if (deleteButton) {
      event.preventDefault();
      deleteButton.disabled = true;
      try {
        await deleteNotificationHistoryItem(
          deleteButton.dataset.notificationDeletePath,
        );
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
      const totalPages = Math.max(
        1,
        Math.ceil(
          getFilteredNotificationRows(adminNotificationHistoryRows).length /
            ADMIN_NOTIFICATION_HISTORY_PAGE_SIZE,
        ),
      );
      const target = pageButton.dataset.notificationPage;
      if (target === "prev")
        adminNotificationHistoryPage = Math.max(
          1,
          adminNotificationHistoryPage - 1,
        );
      else if (target === "next")
        adminNotificationHistoryPage = Math.min(
          totalPages,
          adminNotificationHistoryPage + 1,
        );
      else
        adminNotificationHistoryPage = Math.min(
          totalPages,
          Math.max(1, Number(target) || 1),
        );
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
    renderNotificationCenter().catch((error) =>
      console.warn("Bildirim merkezi ilk yükleme hatası:", error),
    );
  });
} else {
  renderNotificationCenter().catch((error) =>
    console.warn("Bildirim merkezi ilk yükleme hatası:", error),
  );
}
/* 07-prediction-logs.js */

const predictionLogState = {
  logs: [],
  filtered: [],
  page: 1,
  pageSize: 10,
  loading: false,
  loadedOnce: false,
};

function predictionLogEscape(value) {
  return typeof escapeHtml === "function"
    ? escapeHtml(value)
    : String(value ?? "");
}

function predictionLogDateText(value) {
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

function predictionLogDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function predictionLogScore(value) {
  if (!value) return "-";
  const home =
    value.homePred === "" ||
    value.homePred === undefined ||
    value.homePred === null
      ? "-"
      : value.homePred;
  const away =
    value.awayPred === "" ||
    value.awayPred === undefined ||
    value.awayPred === null
      ? "-"
      : value.awayPred;
  return `${home} - ${away}`;
}

function getPredictionLogCurrentPlayerId() {
  return String(
    state.settings?.auth?.playerId ||
      getAuthUser?.()?.playerId ||
      getAuthUser?.()?.id ||
      "",
  );
}

function canSeePredictionLogItem(item) {
  if (getCurrentRole() === "admin") return true;
  const currentPlayerId = getPredictionLogCurrentPlayerId();
  if (!currentPlayerId) return false;
  return (
    String(item.targetPlayerId || "") === currentPlayerId ||
    String(item.actorId || "") === currentPlayerId
  );
}

async function fetchPredictionLogs(force = false) {
  if (predictionLogState.loading) return predictionLogState.logs;
  if (predictionLogState.loadedOnce && !force) return predictionLogState.logs;

  predictionLogState.loading = true;
  try {
    let raw = {};
    try {
      raw = (await firebaseRead("predictionLogs")) || {};
    } catch (primaryError) {
      console.warn(
        "predictionLogs yolu okunamadı, settings/auditLogs deneniyor:",
        primaryError,
      );
    }

    let fallbackRaw = {};
    try {
      fallbackRaw = (await firebaseRead("settings/auditLogs")) || {};
    } catch (fallbackError) {
      console.warn("settings/auditLogs yolu okunamadı:", fallbackError);
    }

    predictionLogState.logs = Object.entries({ ...fallbackRaw, ...raw })
      .map(([id, item]) => ({ id, ...(item || {}) }))
      .filter(canSeePredictionLogItem)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    predictionLogState.loadedOnce = true;
  } catch (error) {
    console.warn("Tahmin logları yüklenemedi:", error);
    predictionLogState.logs = [];
  } finally {
    predictionLogState.loading = false;
  }
  return predictionLogState.logs;
}

function fillPredictionLogFilters() {
  const userFilter = document.getElementById("predictionLogUserFilter");
  const weekFilter = document.getElementById("predictionLogWeekFilter");
  const matchFilter = document.getElementById("predictionLogMatchFilter");
  if (!userFilter || !weekFilter || !matchFilter) return;

  const previousUser = userFilter.value || "all";
  const previousWeek = weekFilter.value || "all";
  const previousMatch = matchFilter.value || "all";

  const users = Array.from(
    new Map(
      predictionLogState.logs.map((item) => [
        String(item.targetPlayerId || item.targetPlayerName || ""),
        item.targetPlayerName || "Bilinmeyen kişi",
      ]),
    ).entries(),
  ).filter(([id]) => id);

  const weeks = Array.from(
    new Set(
      predictionLogState.logs
        .map((item) => String(item.weekNo || ""))
        .filter(Boolean),
    ),
  ).sort((a, b) => Number(a) - Number(b));

  const matches = Array.from(
    new Map(
      predictionLogState.logs.map((item) => [
        String(item.matchId || item.matchLabel || ""),
        item.matchLabel ||
          `${item.homeTeam || "Ev sahibi"} - ${item.awayTeam || "Deplasman"}`,
      ]),
    ).entries(),
  ).filter(([id]) => id);

  userFilter.innerHTML = `<option value="all">Tüm kullanıcılar</option>${users
    .map(
      ([id, name]) =>
        `<option value="${predictionLogEscape(id)}">${predictionLogEscape(name)}</option>`,
    )
    .join("")}`;
  weekFilter.innerHTML = `<option value="all">Tüm haftalar</option>${weeks
    .map(
      (week) =>
        `<option value="${predictionLogEscape(week)}">${predictionLogEscape(week)}. Hafta</option>`,
    )
    .join("")}`;
  matchFilter.innerHTML = `<option value="all">Tüm maçlar</option>${matches
    .map(
      ([id, label]) =>
        `<option value="${predictionLogEscape(id)}">${predictionLogEscape(label)}</option>`,
    )
    .join("")}`;

  userFilter.value = users.some(([id]) => id === previousUser)
    ? previousUser
    : "all";
  weekFilter.value = weeks.includes(previousWeek) ? previousWeek : "all";
  matchFilter.value = matches.some(([id]) => id === previousMatch)
    ? previousMatch
    : "all";
}

function getPredictionLogFilters() {
  return {
    user: document.getElementById("predictionLogUserFilter")?.value || "all",
    week: document.getElementById("predictionLogWeekFilter")?.value || "all",
    match: document.getElementById("predictionLogMatchFilter")?.value || "all",
    action:
      document.getElementById("predictionLogActionFilter")?.value || "all",
    start: document.getElementById("predictionLogStartDate")?.value || "",
    end: document.getElementById("predictionLogEndDate")?.value || "",
  };
}

function applyPredictionLogFilters() {
  const filters = getPredictionLogFilters();
  predictionLogState.filtered = predictionLogState.logs.filter((item) => {
    if (
      filters.user !== "all" &&
      String(item.targetPlayerId || item.targetPlayerName || "") !==
        filters.user
    )
      return false;
    if (filters.week !== "all" && String(item.weekNo || "") !== filters.week)
      return false;
    if (
      filters.match !== "all" &&
      String(item.matchId || item.matchLabel || "") !== filters.match
    )
      return false;
    if (filters.action === "admin" && item.isAdminAction !== true) return false;
    if (
      !["all", "admin"].includes(filters.action) &&
      String(item.actionType || "") !== filters.action
    )
      return false;

    const itemDate = predictionLogDateInputValue(item.createdAt);
    if (filters.start && itemDate && itemDate < filters.start) return false;
    if (filters.end && itemDate && itemDate > filters.end) return false;
    return true;
  });

  const maxPage = Math.max(
    1,
    Math.ceil(predictionLogState.filtered.length / predictionLogState.pageSize),
  );
  if (predictionLogState.page > maxPage) predictionLogState.page = maxPage;
}

function updatePredictionLogClearButtonVisibility() {
  const btn = document.getElementById("clearPredictionLogsBtn");
  if (!btn) return;
  btn.style.display = getCurrentRole() === "admin" ? "inline-flex" : "none";
}

async function clearPredictionLogsOnly() {
  if (getCurrentRole() !== "admin") {
    showAlert?.("Log temizleme işlemini sadece admin yapabilir.", {
      title: "Yetki yok",
      type: "warning",
    });
    return;
  }

  const confirmed = await showConfirm?.(
    "Sadece log kayıtları silinecek. Kullanıcılar, maçlar, tahminler ve puanlar silinmeyecek. Devam edilsin mi?",
    {
      title: "Loglar temizlensin mi?",
      type: "danger",
      confirmText: "Logları Temizle",
      cancelText: "Vazgeç",
    },
  );
  if (!confirmed) return;

  try {
    await firebaseRemove("predictionLogs");
    await firebaseRemove("settings/auditLogs");

    if (typeof writeAppAuditLogEntry === "function") {
      await writeAppAuditLogEntry({
        actionType: "logs_clear",
        actionLabel: "Loglar temizlendi",
        detail:
          "Admin sadece log kayıtlarını temizledi. Ana veriler silinmedi.",
        entityType: "logs",
        entityId: "predictionLogs",
      });
    }

    predictionLogState.logs = [];
    predictionLogState.filtered = [];
    predictionLogState.page = 1;
    predictionLogState.loadedOnce = false;
    await renderPredictionLogs({ force: true });
    showAlert?.("Log listesi temizlendi. Ana veriler korunuyor.", {
      title: "Tamam",
      type: "success",
    });
  } catch (error) {
    console.error("Log temizleme hatası:", error);
    showAlert?.(
      "Loglar temizlenemedi. Console ekranından hataya bakabilirsin.",
      {
        title: "Hata",
        type: "danger",
      },
    );
  }
}

function renderPredictionLogStats() {
  updatePredictionLogClearButtonVisibility();
  const totalEl = document.getElementById("predictionLogTotalCount");
  const adminEl = document.getElementById("predictionLogAdminCount");
  const lastActionEl = document.getElementById("predictionLogLastAction");
  const lastDateEl = document.getElementById("predictionLogLastDate");
  const badge = document.getElementById("predictionLogVisibilityBadge");
  const filtered = predictionLogState.filtered;
  const last = filtered[0] || null;

  if (totalEl) totalEl.textContent = String(filtered.length);
  if (adminEl)
    adminEl.textContent = String(
      filtered.filter((item) => item.isAdminAction === true).length,
    );
  if (lastActionEl) lastActionEl.textContent = last?.actionLabel || "Yok";
  if (lastDateEl)
    lastDateEl.textContent = last
      ? predictionLogDateText(last.createdAt)
      : "Henüz log kaydı görünmüyor.";
  if (badge) {
    badge.textContent =
      getCurrentRole() === "admin"
        ? "Admin görünümü: tüm loglar"
        : "Kullanıcı görünümü: sadece kendi logların";
    badge.className = `badge ${getCurrentRole() === "admin" ? "warn" : "gray"}`;
  }
}

function predictionLogActionBadge(item) {
  const type = String(item.actionType || "");
  const label =
    item.actionLabel ||
    (type === "create" ? "Eklendi" : type === "update" ? "Değişti" : "Silindi");
  return `<span class="prediction-log-action prediction-log-action--${predictionLogEscape(type)}">${predictionLogEscape(label)}</span>`;
}

function renderPredictionLogRows() {
  const body = document.getElementById("predictionLogBody");
  const mobileList = document.getElementById("predictionLogMobileList");
  const pageInfo = document.getElementById("predictionLogPageInfo");
  const pagination = document.getElementById("predictionLogPagination");
  if (!body || !mobileList || !pageInfo || !pagination) return;

  const start = (predictionLogState.page - 1) * predictionLogState.pageSize;
  const rows = predictionLogState.filtered.slice(
    start,
    start + predictionLogState.pageSize,
  );
  const totalPages = Math.max(
    1,
    Math.ceil(predictionLogState.filtered.length / predictionLogState.pageSize),
  );

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7">Bu filtrelere uygun log kaydı bulunamadı.</td></tr>`;
    mobileList.innerHTML = `<div class="prediction-log-empty">Bu filtrelere uygun log kaydı bulunamadı.</div>`;
  } else {
    body.innerHTML = rows
      .map(
        (item) => `
        <tr class="${item.isAdminAction ? "is-admin-log" : ""}">
          <td>${predictionLogEscape(predictionLogDateText(item.createdAt))}</td>
          <td><strong>${predictionLogEscape(item.targetPlayerName || "Bilinmeyen kişi")}</strong></td>
          <td>
            <strong>${predictionLogEscape(item.matchLabel || `${item.homeTeam || ""} - ${item.awayTeam || ""}`)}</strong>
            <small>${predictionLogEscape(item.weekNo ? `${item.weekNo}. Hafta` : "Hafta yok")}</small>
          </td>
          <td>${predictionLogActionBadge(item)}</td>
          <td><span class="prediction-log-score old">${predictionLogEscape(predictionLogScore(item.oldValue))}</span></td>
          <td><span class="prediction-log-score new">${predictionLogEscape(predictionLogScore(item.newValue))}</span></td>
          <td>
            <strong>${predictionLogEscape(item.actorName || "Bilinmeyen")}</strong>
            ${item.isAdminAction ? '<span class="prediction-log-admin-pill">Admin</span>' : ""}
          </td>
        </tr>`,
      )
      .join("");

    mobileList.innerHTML = rows
      .map(
        (item) => `
        <article class="prediction-log-mobile-card ${item.isAdminAction ? "is-admin-log" : ""}">
          <div class="prediction-log-mobile-top">
            ${predictionLogActionBadge(item)}
            <span>${predictionLogEscape(predictionLogDateText(item.createdAt))}</span>
          </div>
          <h4>${predictionLogEscape(item.targetPlayerName || "Bilinmeyen kişi")}</h4>
          <p>${predictionLogEscape(item.matchLabel || `${item.homeTeam || ""} - ${item.awayTeam || ""}`)} · ${predictionLogEscape(item.weekNo ? `${item.weekNo}. Hafta` : "Hafta yok")}</p>
          <div class="prediction-log-compare">
            <span>Eski <b>${predictionLogEscape(predictionLogScore(item.oldValue))}</b></span>
            <span>Yeni <b>${predictionLogEscape(predictionLogScore(item.newValue))}</b></span>
          </div>
          <div class="prediction-log-mobile-actor">
            Yapan: <strong>${predictionLogEscape(item.actorName || "Bilinmeyen")}</strong>
            ${item.isAdminAction ? '<span class="prediction-log-admin-pill">Admin</span>' : ""}
          </div>
        </article>`,
      )
      .join("");
  }

  pageInfo.textContent = `${predictionLogState.filtered.length} kayıt · Sayfa ${predictionLogState.page}/${totalPages}`;
  pagination.innerHTML = `
    <button class="secondary small" type="button" data-log-page="prev" ${predictionLogState.page <= 1 ? "disabled" : ""}>Önceki</button>
    <button class="secondary small" type="button" data-log-page="next" ${predictionLogState.page >= totalPages ? "disabled" : ""}>Sonraki</button>
  `;
}

async function renderPredictionLogs(options = {}) {
  const body = document.getElementById("predictionLogBody");
  if (body && !predictionLogState.loadedOnce) {
    body.innerHTML = `<tr><td colspan="7">Log kayıtları yükleniyor...</td></tr>`;
  }
  await fetchPredictionLogs(options.force === true);
  fillPredictionLogFilters();
  applyPredictionLogFilters();
  renderPredictionLogStats();
  renderPredictionLogRows();
}

function bindPredictionLogEvents() {
  document
    .getElementById("refreshPredictionLogsBtn")
    ?.addEventListener("click", () => {
      predictionLogState.page = 1;
      renderPredictionLogs({ force: true });
    });

  document
    .getElementById("clearPredictionLogsBtn")
    ?.addEventListener("click", () => {
      clearPredictionLogsOnly();
    });

  document
    .getElementById("clearPredictionLogFiltersBtn")
    ?.addEventListener("click", () => {
      [
        "predictionLogUserFilter",
        "predictionLogWeekFilter",
        "predictionLogMatchFilter",
        "predictionLogActionFilter",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "all";
      });
      const start = document.getElementById("predictionLogStartDate");
      const end = document.getElementById("predictionLogEndDate");
      if (start) start.value = "";
      if (end) end.value = "";
      predictionLogState.page = 1;
      applyPredictionLogFilters();
      renderPredictionLogStats();
      renderPredictionLogRows();
    });

  [
    "predictionLogUserFilter",
    "predictionLogWeekFilter",
    "predictionLogMatchFilter",
    "predictionLogActionFilter",
    "predictionLogStartDate",
    "predictionLogEndDate",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      predictionLogState.page = 1;
      applyPredictionLogFilters();
      renderPredictionLogStats();
      renderPredictionLogRows();
    });
  });

  document
    .getElementById("predictionLogPagination")
    ?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-log-page]");
      if (!btn || btn.disabled) return;
      const direction = btn.dataset.logPage;
      const totalPages = Math.max(
        1,
        Math.ceil(
          predictionLogState.filtered.length / predictionLogState.pageSize,
        ),
      );
      if (direction === "prev")
        predictionLogState.page = Math.max(1, predictionLogState.page - 1);
      if (direction === "next")
        predictionLogState.page = Math.min(
          totalPages,
          predictionLogState.page + 1,
        );
      renderPredictionLogRows();
    });
}

bindPredictionLogEvents();
