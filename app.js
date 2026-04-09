const STORAGE_KEY = "fikstur_tahmin_paneli_v4";
const DB_NAME = "fiksturLocalDb";
const DB_STORE = "handles";
const HANDLE_KEY = "backupHandle";
const LEAGUE_ID = 4339; // Turkish Super Lig on TheSportsDB
const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwIcUAropb7sIXmvT3uKn6Ly6JAZ6kMQ-t3Y9vaURG_kR0-8szafkIZ9fpRR8ZzPA/exec";

let currentSessionUser = null;
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
    "Lütfen bekleyin, maçlar ve tahminler Google Sheets üzerinden getiriliyor...",
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
          : "Veriler Google ile eşitlendi.",
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
    let actions = header.querySelector(".header-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "header-actions";
      header.appendChild(actions);
    }

    let btn = actions.querySelector('[data-role="global-sync-btn"]');
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary header-sync-btn";
      btn.dataset.role = "global-sync-btn";
      btn.innerHTML =
        '<span class="sync-btn-icon" aria-hidden="true">↻</span><span>Verileri Çek</span>';
      actions.appendChild(btn);
    }
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
      reject(new Error("Google Script isteği yüklenemedi."));
    };

    const url = buildApiUrl(action, { ...params, callback: callbackName });
    script.src = url.toString();
    document.body.appendChild(script);

    setTimeout(() => {
      if (window[callbackName]) {
        cleanup();
        reject(new Error("Google Script isteği zaman aşımına uğradı."));
      }
    }, 30000);
  });
}

async function apiGet(action, params = {}) {
  return await jsonpRequest(action, params);
}

async function apiPost(action, payload = {}) {
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

  let season = state.seasons.find(
    (item) => normalizeText(item.name) === normalizeText(normalizedLabel),
  );

  if (!season) {
    season = {
      id: uid("season"),
      name: normalizedLabel,
      leagueName: fallbackLeagueName || "",
    };
    state.seasons.push(season);
  } else if (fallbackLeagueName && !season.leagueName) {
    season.leagueName = fallbackLeagueName;
  }

  if (!state.settings.activeSeasonId) state.settings.activeSeasonId = season.id;
  return season;
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

    if (!rows.length) return false;

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

async function syncUsersFromSheet(options = {}) {
  if (!useOnlineMode) return [];
  const result = await fetchOnlineUsers();
  if (!result?.success || !Array.isArray(result.users)) {
    throw new Error(result?.message || "Kullanıcı listesi alınamadı.");
  }
  const users = result.users
    .filter((user) => String(user.rol || "user").toLowerCase() !== "admin")
    .map((user) => ({
      id: String(user.id),
      name: user.adSoyad || user.kullaniciAdi || "",
      password: user.sifre || "1234",
      username: user.kullaniciAdi || "",
      role: user.rol || "user",
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

async function sendMatchesToSheet(matches) {
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
  return await sendMatchesToSheet(matches);
}

async function syncSeasonMatchesToSheet(seasonId) {
  const matches = getMatchesBySeasonId(seasonId);
  if (!matches.length) return null;
  return await sendMatchesToSheet(matches);
}

function isMobileView() {
  return window.innerWidth <= 720;
}

function ensureAuthState(stateObj) {
  stateObj.settings = stateObj.settings || {};
  stateObj.settings.auth = {
    adminUsername: "admin",
    adminPassword: "admin123",
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

function canEditPrediction(playerId) {
  if (getCurrentRole() === "admin") return true;

  const currentPlayerId = getCurrentPlayerId();
  const normalizedPlayerId = normalizeEntityId(playerId);
  const normalizedCurrentPlayerId = normalizeEntityId(currentPlayerId);

  if (!normalizedPlayerId || !normalizedCurrentPlayerId) return false;
  return normalizedPlayerId === normalizedCurrentPlayerId;
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
  const players = [...state.players];
  const currentPlayerId = getCurrentPlayerId();
  if (getCurrentRole() !== "user" || !currentPlayerId) return players;
  return players.sort((a, b) => {
    if (a.id === currentPlayerId) return -1;
    if (b.id === currentPlayerId) return 1;
    return a.name.localeCompare(b.name, "tr");
  });
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

  const seasonId = options.seasonId || getActiveSeasonId();
  const weekId =
    options.weekId === undefined ? state.settings.activeWeekId : options.weekId;
  const seasonLabel =
    options.seasonLabel || getSeasonById(seasonId)?.name || "";
  const weekNumber =
    options.weekNumber || (weekId ? getWeekNumberById(weekId) : "");

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
          : "Google Sheets bağlantısı kuruluyor...",
        percent: 12,
        showSuccess: !isSessionRestore,
      });
      setAppLoadingCheck(
        "login",
        isSessionRestore ? "active" : "done",
        isSessionRestore ? "Kayıtlı oturum doğrulanıyor..." : "Giriş başarılı oldu",
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
        message: "Bekleyen tahminler Google Sheets ile eşitleniyor...",
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
        `${queueResult.flushed} bekleyen tahmin Google Sheets ile eşitlendi.`,
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
          error?.message || "Google Sheets verileri alınırken bir sorun oluştu.",
        stepLabel: "Tekrar giriş yapabilir veya sayfayı yenileyebilirsin.",
        percent: 100,
        showSuccess: false,
      });
    }
    return false;
  }
}

function updateSessionCard() {
  const summary = document.getElementById("sessionSummaryText");
  const mobileSummary = document.getElementById("mobileMoreSessionText");
  const logoutBtn = document.getElementById("logoutBtn");
  const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");

  const sessionText = !isAuthenticated()
    ? "Giriş yapılmadı."
    : getCurrentRole() === "admin"
      ? "Admin oturumu açık. Tüm alanları yönetebilirsin."
      : `${getCurrentPlayer()?.name || "Kullanıcı"} olarak giriş yapıldı. Sadece kendi tahminini düzenleyebilirsin.`;

  const syncText = isAuthenticated() ? ` • ${getSyncSummaryText()}` : "";

  if (summary) summary.textContent = `${sessionText}${syncText}`;
  if (mobileSummary) mobileSummary.textContent = `${sessionText}${syncText}`;
  if (logoutBtn) logoutBtn.disabled = !isAuthenticated();
  if (mobileLogoutBtn) mobileLogoutBtn.disabled = !isAuthenticated();
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

function updateLoginOverlay() {
  const overlay = document.getElementById("loginOverlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden", isAuthenticated());
  if (!isAuthenticated()) {
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
      setLoginFeedback("error", result?.message || "Kullanıcı adı veya şifre hatalı.");
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

function closeMobileMoreSheet() {
  document.getElementById("mobileMoreSheet")?.classList.remove("open");
}

function openMobileMoreSheet() {
  document.getElementById("mobileMoreSheet")?.classList.add("open");
}

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
    .querySelectorAll(".mobile-more-item")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.tab === tabName),
    );
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

  const currentTab = state.settings.currentTab || "dashboard";
  if (
    role !== "admin" &&
    (currentTab === "players" || currentTab === "backup")
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
      window.queuePredictionSave(matchId, playerId);
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
            const canEdit = canEditPrediction(player.id);
            const statusClass = hasPrediction
              ? "filled-prediction"
              : "empty-prediction";
            const lockedClass =
              locked || !canEdit
                ? "locked-cell locked-mobile-card"
                : "editable-cell";
            const ownClass =
              player.id === currentPlayerId ? "own-player-card" : "";
            const outcomeClass = getPredictionOutcomeClass(pred, match);
            const uiKey = getPredictionUiKey(match.id, player.id);
            const isSaving = predictionUiState[uiKey] === "saving";

            const statusText = getPredictionBaseStatus(match.id, player.id);
            const showDeleteAction = hasPrediction || pred.remoteId || isSaving;

            return `
            <div class="mobile-user-prediction premium-user-card ${pointLabel(pred.points)} ${outcomeClass} ${statusClass} ${lockedClass} ${ownClass}">
              <div class="mobile-user-head premium-user-head">
                <strong>${escapeHtml(player.name)}${player.id === currentPlayerId ? '<span class="own-pill">Sen</span>' : ""}</strong>
                <span class="mini-points premium-points">${locked ? "Kilitli" : `${pred.points || 0} puan`}</span>
              </div>

              <div class="score-inputs compact-inputs center-mode premium-score-inputs pred-score-row">
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
                <span class="premium-dash">-</span>
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

              ${locked ? `<div class="mobile-lock-warning">🔒 Tahmin kapandı</div>` : ""}

              <div class="pred-action-area">
                ${
                  canEdit
                    ? `
                  <div class="mobile-save-row pred-btn-slot prediction-button-row">
                    <button
                      class="prediction-mobile-save-btn"
                      type="button"
                      id="pred_btn_${match.id}_${player.id}"
                      data-pred-role="save-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      ${locked ? "disabled" : ""}
                      onclick="if(!this.disabled && window.queuePredictionSave){ event.preventDefault(); event.stopPropagation(); window.queuePredictionSave('${match.id}','${player.id}', true); } return false;"
                    >
                      ${locked ? "Kilitli" : getPredictionSaveLabel(match.id, player.id)}
                    </button>
                    <button
                      class="prediction-mobile-save-btn danger prediction-delete-btn ${showDeleteAction ? "" : "is-hidden"}"
                      type="button"
                      id="pred_delete_${match.id}_${player.id}"
                      data-pred-role="delete-btn"
                      data-match-id="${match.id}"
                      data-player-id="${player.id}"
                      ${locked ? "disabled" : ""}
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
        ${row.id === leaderId ? `<span class="weekly-leader-pill">Haftalık lider</span>` : ""}
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

function saveState(skipFileWrite = false) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!skipFileWrite) writeLocalFileBackup();
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
  if (!state.settings.activeSeasonId && activeSeasonId)
    state.settings.activeSeasonId = activeSeasonId;
  const seasonWeeks = getWeeksBySeasonId(getActiveSeasonId());
  if (!seasonWeeks.length) {
    state.settings.activeWeekId = null;
    return;
  }
  const exists = seasonWeeks.some((w) => w.id === state.settings.activeWeekId);
  if (!exists) state.settings.activeWeekId = seasonWeeks[0].id;
}

async function setActiveSeason(seasonId) {
  state.settings.activeSeasonId = seasonId || null;
  const firstWeek = getWeeksBySeasonId(seasonId)[0];
  state.settings.activeWeekId = firstWeek?.id || null;
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

function teamLogoHtml(teamName, seasonId, extraClass = "") {
  const team = getTeamMetaByName(teamName, seasonId);
  const slug = team.slug || slugify(teamName);
  return `
    <span class="team-logo-wrap ${extraClass}">
      <img class="team-logo-img" src="logos/${slug}.png" alt="${escapeHtml(teamName)} logosu" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';" />
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
        if (!predictionLockRerenderPending) {
          predictionLockRerenderPending = true;
          setTimeout(() => {
            predictionLockRerenderPending = false;
            renderPredictions();
          }, 80);
        }
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
  if (visual === "locked") return { text: "Kilitli", cls: "red" };
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
    .map((player) => {
      const preds = state.predictions.filter(
        (p) => p.playerId === player.id && matchIds.includes(p.matchId),
      );
      const total = preds.reduce((sum, p) => sum + (p.points || 0), 0);
      const exact = preds.filter((p) => p.points === 3).length;
      const resultOnly = preds.filter((p) => p.points === 1).length;
      return {
        id: player.id,
        name: player.name,
        total,
        exact,
        resultOnly,
        predictionCount: preds.filter(
          (p) => p.homePred !== "" && p.awayPred !== "",
        ).length,
      };
    })
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
    .map((player) => {
      const preds = state.predictions.filter(
        (p) => p.playerId === player.id && matchIds.includes(p.matchId),
      );
      return {
        id: player.id,
        name: player.name,
        total: preds.reduce((sum, p) => sum + (p.points || 0), 0),
        exact: preds.filter((p) => p.points === 3).length,
        resultOnly: preds.filter((p) => p.points === 1).length,
        predictionCount: preds.filter(
          (p) => p.homePred !== "" && p.awayPred !== "",
        ).length,
      };
    })
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
  const weeks = getWeeksBySeasonId(seasonId);
  select.innerHTML = includePlaceholder
    ? '<option value="">Hafta seç</option>'
    : "";
  weeks.forEach((week) => {
    const selected = week.id === state.settings.activeWeekId ? "selected" : "";
    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${week.id}" ${selected}>${week.number}. Hafta</option>`,
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
  if (seasonBadge)
    seasonBadge.textContent = `Aktif sezon: ${season?.name || "-"}`;
  if (weekBadge)
    weekBadge.textContent = `Aktif hafta: ${week ? `${week.number}. Hafta` : "-"}`;
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
    status.textContent = `${season.name} / ${week.number}. hafta için API güncellemesi başlatıldı...`;
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
      lastAction: `${season.name} / ${week.number}. hafta güncellendi.`,
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
    status.textContent = `${season.name} sezonu için API güncellemesi başlatıldı...`;
  recordAdminSyncActivity({
    lastAction: `${season.name} sezon güncellemesi başladı...`,
  });
  try {
    await importFixturesFromApi(true);
    const apiStatus =
      document.getElementById("apiStatus")?.textContent || "Sezon güncellendi.";
    if (status) status.textContent = `${apiStatus} • ${getSyncSummaryText()}`;
    recordAdminSyncActivity({
      lastAction: `${season.name} sezonu güncellendi.`,
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
    ["Aktif Sezon", season?.name || "-"],
    ["Kişi Sayısı", state.players.length],
    ["Haftadaki Maç", matches.length],
    ["Oynanmış Maç", matches.filter((m) => m.played).length],
    ["Eksik Tahmin", activeWeekId ? countMissingPredictions(activeWeekId) : 0],
    ["Lider", leader ? `${leader.name} (${leader.total})` : "-"],
  ];
  document.getElementById("statsGrid").innerHTML = cards
    .map(
      ([label, value]) => `
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
  if (!state.players.length)
    return (container.innerHTML = createEmptyState("Henüz kişi eklenmedi."));
  container.innerHTML = `<div class="excel-list">${state.players
    .map(
      (player) => `
    <div class="excel-list-row player-row player-admin-row">
      <div class="player-name-cell">${escapeHtml(player.name)}</div>
      <div class="small-meta">Şifre: <strong>${escapeHtml(player.password || "1234")}</strong> · ${state.predictions.filter((p) => p.playerId === player.id && p.homePred !== "" && p.awayPred !== "").length} kayıtlı tahmin</div>
      <div class="inline-actions compact wrap-actions">
        <button class="small secondary" onclick="renamePlayer('${player.id}', this)">Adı Düzenle</button>
        <button class="small secondary" onclick="changePlayerPassword('${player.id}', this)">Şifre Değiştir</button>
        <button class="small danger" onclick="removePlayer('${player.id}', this)">Sil</button>
      </div>
    </div>`,
    )
    .join("")}</div>`;
}

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
      showAlert(error?.message || "Google Sheets güncellemesi başarısız.", {
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
      showAlert(error?.message || "Google Sheets güncellemesi başarısız.", {
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
      showAlert(error?.message || "Google Sheets silme işlemi başarısız.", {
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
    container.innerHTML = createEmptyState("Önce bir sezon oluştur.");
    return;
  }
  const seasonRows = state.seasons
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
    ? teams
        .map(
          (team) => `
    <div class="excel-list-row player-row">
      <div class="player-name-cell team-row-cell">${teamLogoHtml(team.name, seasonId)} <span>${escapeHtml(team.name)}</span></div>
      <div class="small-meta">logo: ${escapeHtml(team.slug || "-")}</div>
      <div class="inline-actions compact">
        <button class="small secondary" onclick="renameSeasonTeam('${team.id}')">Düzenle</button>
        <button class="small danger" onclick="removeSeasonTeam('${team.id}')">Sil</button>
      </div>
    </div>
  `,
        )
        .join("")
    : createEmptyState("Bu sezonda henüz takım yok.");

  container.innerHTML = `
    <div class="stack-actions">
      <div class="excel-list season-list-scroll">${seasonRows}</div>
      <div class="card-subtitle">${escapeHtml(season.name)} takımları</div>
      <div class="excel-list team-list-scroll">${teamRows}</div>
    </div>
  `;
}

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
  )
    return;
  const weekIds = getWeeksBySeasonId(id).map((w) => w.id);
  const matchIds = getMatchesBySeasonId(id).map((m) => m.id);
  state.seasons = state.seasons.filter((s) => s.id !== id);
  state.teams = state.teams.filter((t) => t.seasonId !== id);
  state.weeks = state.weeks.filter((w) => w.seasonId !== id);
  state.matches = state.matches.filter((m) => m.seasonId !== id);
  state.predictions = state.predictions.filter(
    (p) => !matchIds.includes(p.matchId),
  );
  delete state.settings.celebratedChampions[id];
  state.settings.activeSeasonId = state.seasons[0]?.id || null;
  state.settings.activeWeekId =
    getWeeksBySeasonId(state.settings.activeSeasonId)[0]?.id || null;
  saveState();
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
  const week = getWeekById(id);
  if (!week) return;
  if (
    !(await showConfirm(
      `${week.number}. haftayı ve bu haftadaki tüm maç/tahminleri silmek istiyor musun?`,
      { title: "Hafta silinsin mi?", type: "danger", confirmText: "Sil" },
    ))
  )
    return;
  const matchIds = getMatchesByWeekId(id).map((m) => m.id);
  state.weeks = state.weeks.filter((w) => w.id !== id);
  state.matches = state.matches.filter((m) => m.weekId !== id);
  state.predictions = state.predictions.filter(
    (p) => !matchIds.includes(p.matchId),
  );
  if (state.settings.activeWeekId === id)
    state.settings.activeWeekId =
      getWeeksBySeasonId(getActiveSeasonId())[0]?.id || null;
  saveState();
  renderAll();
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
window.saveResult = function (matchId) {
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
  state.matches = state.matches.filter((m) => m.id !== matchId);
  state.predictions = state.predictions.filter((p) => p.matchId !== matchId);
  saveState();
  renderAll();
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
  renderAll();
}

function setPredictionShareView(view) {
  state.settings.predictionShareView = view === "post" ? "post" : "pre";
  saveState();
  renderPredictions();
}

function setPredictionShareCompact(enabled) {
  state.settings.predictionShareCompact = !!enabled;
  saveState();
  renderPredictions();
}

function setPredictionShareFadeEmpty(enabled) {
  state.settings.predictionShareFadeEmpty = !!enabled;
  saveState();
  renderPredictions();
}

function canUsePredictionShareMode() {
  return !(isMobileView() && getCurrentRole() !== "admin");
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
  btn.textContent = `Paylaşım Modu: ${active ? "Açık" : "Kapalı"}`;
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
                ? `${pred.points || 0} puan`
                : ""
              : locked && !match.played
                ? "Kilitli"
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
}

function renderPredictions() {
  const container = document.getElementById("predictionsTable");
  if (!container) return;
  const weekId = state.settings.activeWeekId;

  renderPredictionLockBanner(weekId);

  if (!weekId) {
    container.innerHTML = createEmptyState("Önce bir hafta seç.");
    return;
  }

  const matches = getMatchesByWeekId(weekId);
  const players = getVisiblePlayersOrdered();

  if (!matches.length || !players.length) {
    container.innerHTML = createEmptyState(
      "Tahmin girmek için en az bir hafta, bir maç ve bir kişi olmalı.",
    );
    return;
  }

  if (isMobileView()) {
    renderMobilePredictions(container, matches);
    updatePredictionShareModeButton();
    bindPredictionActionElements(container);
    saveState(true);
    return;
  }

  if (isPredictionShareMode()) {
    renderPredictionShareTable(container, matches, players);
    updatePredictionShareModeButton();
    bindPredictionActionElements(container);
    saveState(true);
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
            pred.homeScore !== "" &&
            pred.homeScore !== null &&
            pred.homeScore !== undefined &&
            pred.awayScore !== "" &&
            pred.awayScore !== null &&
            pred.awayScore !== undefined;
          const outcomeClass = getPredictionOutcomeClass(pred, match);
          const ownClass =
            player.id === currentPlayerId ? " own-player-cell" : "";
          const uiKey = getPredictionUiKey(match.id, player.id);
          const isSaving = predictionUiState[uiKey] === "saving";

          const statusText = getPredictionBaseStatus(match.id, player.id);
          const showDeleteAction = hasPrediction || pred.remoteId || isSaving;

          return `
        <div class="prediction-cell ${pointLabel(pred.points)} ${outcomeClass} ${locked || !canEdit ? "locked-cell" : ""}${ownClass}">
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
                      class="secondary small prediction-action-btn"
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

          <div class="mini-points">${locked && !match.played ? "Kilitli" : `${pred.points || 0} puan`}</div>
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

  container.innerHTML = `<div class="excel-predictions" style="--player-count:${players.length};"><div class="prediction-grid-head"><div>Maç</div>${headerPlayers}</div><div class="prediction-grid-body">${rows}</div></div>`;

  updatePredictionShareModeButton();
  bindPredictionActionElements(container);
  saveState(true);
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
  if (!match.played && isMatchLocked(match)) return "Kilitli";
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
      status.textContent = "Google Sheets'e gönderiliyor...";
      status.dataset.saveState = "saving";
    } else if (uiState === "deleting") {
      status.textContent = "Tahmin Google Sheets'ten siliniyor...";
      status.dataset.saveState = "saving";
    } else if (uiState === "saved") {
      status.textContent = "Google Sheets ile eşitlendi";
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
      status.textContent = "Google Sheets kaydı başarısız";
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
window.queuePredictionSave = function (matchId, playerId, immediate = false) {
  const key = getPredictionUiKey(matchId, playerId);
  clearTimeout(predictionTimers[key]);

  if (immediate) {
    window.savePrediction(matchId, playerId);
    return;
  }

  setPredictionUiState(matchId, playerId, "dirty");
  updatePredictionDeleteButton(matchId, playerId, true);
};

window.deletePredictionEntry = async function (matchId, playerId) {
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
  }
};

window.savePrediction = async function (matchId, playerId) {
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

  if (homePred === "" || awayPred === "") {
    setPredictionUiState(matchId, playerId, "dirty");
    return;
  }

  if (!useOnlineMode || !isAuthenticated()) {
    setPredictionUiState(matchId, playerId, "saved");
    updatePredictionDeleteButton(matchId, playerId, true);
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
      showAlert(result?.message || "Tahmin Google Sheets'e kaydedilemedi.", {
        title: "Kayıt Hatası",
        type: "warning",
      });
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
        "Google Sheets yanıtı geç geldi. Tahmin yerelde korundu ve sıraya alındı. Bağlantı uygun olduğunda otomatik tekrar gönderilecek.",
        {
          title: "Geciken Yanıt",
          type: "info",
        },
      );
      return;
    }

    enqueuePredictionRetry(payload);
    setPredictionUiState(matchId, playerId, "queued");
    recordAdminSyncActivity({
      lastAction: `${getPlayerById(playerId)?.name || "Kullanıcı"} tahmini çevrimdışı sıraya alındı.`,
      lastError: error?.message || "Bağlantı gecikmesi",
    });
    showAlert(
      "Google Sheets bağlantısında hata oluştu. Tahmin kaybolmadı; sıraya alındı ve bağlantı geldiğinde otomatik tekrar gönderilecek.",
      {
        title: "Bağlantı Hatası",
        type: "warning",
      },
    );
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
      return `<div class="excel-tr standings-tr ${i === 0 ? "leader-row" : ""}${rankClass}${leaderClass}"><div class="rank-pill">${badge}</div><div class="standing-name-cell">${escapeHtml(row.name)}${row.id === leaderId ? '<span class="weekly-leader-pill">Haftanın Lideri</span>' : ""}</div><div><strong>${row.total}</strong></div><div>${row.exact}</div><div>${row.resultOnly}</div><div>${showPredictionCount ? row.predictionCount : row.total}</div></div>`;
    })
    .join("")}</div></div>`;
}

function renderStandings() {
  const seasonId = getActiveSeasonId();
  const general = getGeneralStandings(seasonId);
  const weekId = state.settings.activeWeekId;
  const weekly = weekId ? getWeeklyStandings(weekId) : [];
  const weeklyLeaderId = weekly[0]?.id || null;
  document.getElementById("standingsTable").innerHTML = general.length
    ? isMobileView()
      ? standingsRowsMobile(general, true, { leaderId: weeklyLeaderId })
      : standingsRows(general, true, { leaderId: weeklyLeaderId })
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
    state.players.forEach((player) => {
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

function renderAdvancedStats() {
  const seasonId = getActiveSeasonId();
  const info = getSeasonInsights(seasonId);
  const champion = getChampion(seasonId);
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
    [
      "En Çok Tahmin",
      info.mostPredictions
        ? `${info.mostPredictions.name} (${info.mostPredictions.predictionCount})`
        : "-",
    ],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`,
    )
    .join("");

  const insights = [
    info.bestExact
      ? `${info.bestExact.name}, ${info.bestExact.exact} kez tam skor buldu.`
      : "Henüz tam skor verisi yok.",
    info.bestResult
      ? `${info.bestResult.name}, ${info.bestResult.resultOnly} maçta doğru sonucu bildi.`
      : "Henüz doğru sonuç verisi yok.",
    info.mostPredictions
      ? `${info.mostPredictions.name}, en istikrarlı tahmin girişini yaptı.`
      : "Henüz tahmin verisi yok.",
    champion
      ? `${champion.name}, sezonu ${champion.total} puanla şampiyon kapattı.`
      : "Şampiyonluk için tüm maçların oynanması gerekiyor.",
  ];
  document.getElementById("insightsList").innerHTML =
    `<div class="excel-list">${insights.map((text) => `<div class="excel-list-row"><div class="soft-text">${escapeHtml(text)}</div></div>`).join("")}</div>`;
  document.getElementById("championCard").innerHTML = champion
    ? `
    <div class="champion-inner">
      <div class="champion-name">🏆 ${escapeHtml(champion.name)}</div>
      <div class="champion-score">${champion.total} puan</div>
      <div class="small-meta">Sezon şampiyonu hazır. Kutlama için butona bas.</div>
      <button onclick="celebrateChampion('${seasonId}', true)">Şampiyonu Kutla</button>
    </div>`
    : createEmptyState("Şampiyon kartı, sezon tamamlanınca burada görünür.");

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

function createConfettiBurst() {
  const layer = document.getElementById("confettiLayer");
  layer.innerHTML = "";
  for (let i = 0; i < 120; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    piece.style.transform = `translateY(-20px) rotate(${Math.random() * 360}deg)`;
    layer.appendChild(piece);
  }
  setTimeout(() => (layer.innerHTML = ""), 4500);
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
  ensureActiveSelections();
  recalculateAllPoints();
  saveState(true);
  renderSelects();
  renderStats();
  renderDashboardSyncCard();
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
  renderBackupStatus();
  updateLoginOverlay();
  updateAdminSyncToggleButton();
  applyRolePermissions();
  ensureHeaderSyncButtons();
  updateNavSelection(state.settings.currentTab || "dashboard");
}

function addSeason() {
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
  if (state.seasons.some((s) => s.name === name))
    return showAlert("Bu sezon zaten var.", {
      title: "Tekrarlayan kayıt",
      type: "warning",
    });
  const seasonId = uid("season");
  state.seasons.push({ id: seasonId, name, leagueName });
  state.settings.activeSeasonId = seasonId;
  state.settings.activeWeekId = null;
  document.getElementById("seasonName").value = "";
  saveState();
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
    id: uid("player"),
    name: name.toUpperCase(),
    password,
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
    showAlert("Kullanıcı Google Sheets'e eklendi.", {
      title: "Başarılı",
      type: "success",
    });
  } catch (error) {
    setAsyncButtonState(actionButton, "error", { error: "Hata" });
    console.error("Kullanıcı ekleme hatası:", error);
    showAlert(error?.message || "Google Sheets kullanıcı kaydı yapılamadı.", {
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
    sendMatchesToSheet([newMatch]).catch((error) =>
      console.error("Tek maç Sheets senkron hatası:", error),
    );
  }
  document.getElementById("homeTeam").value = "";
  document.getElementById("awayTeam").value = "";
  document.getElementById("matchDate").value = "";
  saveState();
  renderAll();
}

function switchTab(tabName) {
  if (getCurrentRole() !== "admin" && ["players", "backup"].includes(tabName))
    tabName = "dashboard";
  state.settings.currentTab = tabName;
  updateNavSelection(tabName);
  document
    .querySelectorAll(".tab-panel")
    .forEach((panel) =>
      panel.classList.toggle("active", panel.id === `tab-${tabName}`),
    );
  closeMobileMoreSheet();
  saveState(true);
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fikstur-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      state = migrateLegacyState(JSON.parse(e.target.result));
      saveState();
      renderAll();
      showAlert("Yedek başarıyla yüklendi.", {
        title: "İşlem tamam",
        type: "success",
      });
    } catch {
      showAlert("Geçerli bir JSON dosyası seçmelisin.", {
        title: "Dosya hatası",
        type: "danger",
      });
    }
  };
  reader.readAsText(file);
}

async function saveHandleToDb(handle) {
  try {
    const db = await openHandleDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}
async function loadHandleFromDb() {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
async function verifyPermission(handle, readWrite = true) {
  if (!handle) return false;
  const options = readWrite ? { mode: "readwrite" } : {};
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}
async function connectLocalBackupFile() {
  if (!window.showSaveFilePicker)
    return showAlert("Bu özellik için Chrome veya Edge kullanmalısın.", {
      title: "Tarayıcı desteği yok",
      type: "warning",
    });
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: "fikstur-verileri.json",
      types: [
        { description: "JSON", accept: { "application/json": [".json"] } },
      ],
    });
    backupHandle = handle;
    await saveHandleToDb(handle);
    localBackupStatus = `Yerel dosya bağlı: ${handle.name}`;
    await writeLocalFileBackup(true);
    renderBackupStatus();
  } catch (error) {
    if (error?.name !== "AbortError")
      showAlert("Yerel dosya bağlanırken bir hata oluştu.", {
        title: "Dosya bağlantı hatası",
        type: "danger",
      });
  }
}
async function writeLocalFileBackup(showAlert = false) {
  if (!backupHandle) return false;
  try {
    const allowed = await verifyPermission(backupHandle, true);
    if (!allowed) {
      localBackupStatus =
        "Yerel dosya izni verilmedi. Sadece tarayıcı hafızası aktif.";
      renderBackupStatus();
      return false;
    }
    const writable = await backupHandle.createWritable();
    await writable.write(JSON.stringify(state, null, 2));
    await writable.close();
    localBackupStatus = `Yerel dosyaya kaydedildi: ${backupHandle.name}`;
    renderBackupStatus();
    if (showAlert)
      window.showAlert("Yerel dosyaya kayıt tamamlandı.", {
        title: "Kayıt tamam",
        type: "success",
      });
    return true;
  } catch {
    localBackupStatus =
      "Yerel dosyaya yazılamadı. Tarayıcı hafızası açık kalmaya devam ediyor.";
    renderBackupStatus();
    return false;
  }
}
async function restoreBackupHandle() {
  if (!window.showSaveFilePicker) {
    localBackupStatus =
      "Bu tarayıcı yerel dosya bağlantısını desteklemiyor. JSON yedek kullanabilirsin.";
    renderBackupStatus();
    return;
  }
  backupHandle = await loadHandleFromDb();
  if (!backupHandle) {
    localBackupStatus =
      "Yerel dosya bağlı değil. İstersen aşağıdan bağlayabilirsin.";
    renderBackupStatus();
    return;
  }
  const allowed = await verifyPermission(backupHandle, true);
  localBackupStatus = allowed
    ? `Yerel dosya hazır: ${backupHandle.name}`
    : "Kayıt dosyası bulundu ama izin bekliyor. Dosyayı tekrar bağla.";
  renderBackupStatus();
}
function renderBackupStatus() {
  const el = document.getElementById("localSaveStatus");
  if (el) el.textContent = localBackupStatus;
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
    ];
    teamNames.forEach((name) => {
      if (!getTeamsBySeasonId(seasonId).some((t) => t.name === name)) {
        state.teams.push({
          id: uid("team"),
          seasonId,
          name,
          slug: DEFAULT_TEAM_SLUGS[name] || slugify(name),
        });
      }
    });

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
      : `Sezonun tüm haftaları ve maçları API üzerinden içeri aktarıldı${movedCount ? `, ${movedCount} ertelenen maç doğru haftaya taşındı` : ""}${sheetSyncResult?.success ? `, Sheets senkronu tamamlandı` : ", Sheets yanıtı gecikti ama yerel güncelleme tamamlandı"}.`;
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

function updateAdminSyncToggleButton() {
  const card = document.getElementById("adminSyncOverviewCard");
  const btn = document.getElementById("adminSyncToggleBtn");
  if (!card || !btn) return;
  const isMobile = window.innerWidth <= 640;
  if (!isMobile) {
    card.classList.add("is-open");
    btn.textContent = "Gizle";
    btn.setAttribute("aria-expanded", "true");
    return;
  }
  const isOpen = card.classList.contains("is-open");
  btn.textContent = isOpen ? "Gizle" : "Göster";
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function toggleAdminSyncOverview() {
  const card = document.getElementById("adminSyncOverviewCard");
  if (!card) return;
  if (window.innerWidth > 640) {
    card.classList.add("is-open");
  } else {
    card.classList.toggle("is-open");
  }
  updateAdminSyncToggleButton();
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

      window.queuePredictionSave(matchId, playerId);
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
  on("exportBtn", "click", exportData);
  on("connectLocalFileBtn", "click", connectLocalBackupFile);
  on("saveLocalFileBtn", "click", () => writeLocalFileBackup(true));
  on("apiImportFixturesBtn", "click", () => importFixturesFromApi(false));
  on("apiUpdateResultsBtn", "click", () => importFixturesFromApi(true));
  on("apiSyncWeekBtn", "click", syncSelectedWeekFromApi);
  on("dashboardSyncWeekBtn", "click", syncDashboardWeek);
  on("dashboardSyncSeasonBtn", "click", syncDashboardSeason);
  on("adminSyncToggleBtn", "click", toggleAdminSyncOverview);
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
  on("closeChampionModalBtn", "click", () =>
    document.getElementById("championModal")?.classList.add("hidden"),
  );
  on("resetBtn", "click", async () => {
    if (
      !(await showConfirm("Tüm veriler silinsin mi?", {
        title: "Tüm veriler silinsin mi?",
        type: "danger",
        confirmText: "Sil",
      }))
    )
      return;
    state = createInitialState();
    ensureDefaultSeason(state);
    saveState();
    renderAll();
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
  document
    .querySelectorAll(".mobile-more-item[data-tab]")
    .forEach((btn) =>
      btn.addEventListener("click", () => switchTab(btn.dataset.tab)),
    );

  on("mobileMoreBtn", "click", openMobileMoreSheet);
  on("mobileMoreCloseBtn", "click", closeMobileMoreSheet);
  on("mobileMoreBackdrop", "click", closeMobileMoreSheet);
  on("logoutBtn", "click", logoutUser);
  on("mobileLogoutBtn", "click", () => {
    closeMobileMoreSheet();
    logoutUser();
  });
  on("loginBtn", "click", loginUser);
  on("loginPassword", "keydown", (e) => {
    if (e.key === "Enter") loginUser();
  });
  on("loginUsername", "input", clearLoginErrorState);
  on("loginPassword", "input", clearLoginErrorState);

  let lastWindowWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    const currentWidth = window.innerWidth;
    if (currentWidth !== lastWindowWidth) {
      lastWindowWidth = currentWidth;
      renderAll();
      updateAdminSyncToggleButton();
      closeMobileMoreSheet();
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
restoreBackupHandle();
switchTab(state.settings.currentTab || "dashboard");
updateLoginOverlay();
updateAdminSyncToggleButton();

if (isAuthenticated()) {
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
try {
  // fetch işlemi
} catch (err) {
  console.error(err);
  alert("Veri alınamadı!");
}
