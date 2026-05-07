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
  return typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? "");
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
  const home = value.homePred === "" || value.homePred === undefined || value.homePred === null ? "-" : value.homePred;
  const away = value.awayPred === "" || value.awayPred === undefined || value.awayPred === null ? "-" : value.awayPred;
  return `${home} - ${away}`;
}

function getPredictionLogCurrentPlayerId() {
  return String(
    state.settings?.auth?.playerId || getAuthUser?.()?.playerId || getAuthUser?.()?.id || "",
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
      console.warn("predictionLogs yolu okunamadı, settings/auditLogs deneniyor:", primaryError);
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
    new Set(predictionLogState.logs.map((item) => String(item.weekNo || "")).filter(Boolean)),
  ).sort((a, b) => Number(a) - Number(b));

  const matches = Array.from(
    new Map(
      predictionLogState.logs.map((item) => [
        String(item.matchId || item.matchLabel || ""),
        item.matchLabel || `${item.homeTeam || "Ev sahibi"} - ${item.awayTeam || "Deplasman"}`,
      ]),
    ).entries(),
  ).filter(([id]) => id);

  userFilter.innerHTML = `<option value="all">Tüm kullanıcılar</option>${users
    .map(([id, name]) => `<option value="${predictionLogEscape(id)}">${predictionLogEscape(name)}</option>`)
    .join("")}`;
  weekFilter.innerHTML = `<option value="all">Tüm haftalar</option>${weeks
    .map((week) => `<option value="${predictionLogEscape(week)}">${predictionLogEscape(week)}. Hafta</option>`)
    .join("")}`;
  matchFilter.innerHTML = `<option value="all">Tüm maçlar</option>${matches
    .map(([id, label]) => `<option value="${predictionLogEscape(id)}">${predictionLogEscape(label)}</option>`)
    .join("")}`;

  userFilter.value = users.some(([id]) => id === previousUser) ? previousUser : "all";
  weekFilter.value = weeks.includes(previousWeek) ? previousWeek : "all";
  matchFilter.value = matches.some(([id]) => id === previousMatch) ? previousMatch : "all";
}

function getPredictionLogFilters() {
  return {
    user: document.getElementById("predictionLogUserFilter")?.value || "all",
    week: document.getElementById("predictionLogWeekFilter")?.value || "all",
    match: document.getElementById("predictionLogMatchFilter")?.value || "all",
    action: document.getElementById("predictionLogActionFilter")?.value || "all",
    start: document.getElementById("predictionLogStartDate")?.value || "",
    end: document.getElementById("predictionLogEndDate")?.value || "",
  };
}

function applyPredictionLogFilters() {
  const filters = getPredictionLogFilters();
  predictionLogState.filtered = predictionLogState.logs.filter((item) => {
    if (filters.user !== "all" && String(item.targetPlayerId || item.targetPlayerName || "") !== filters.user) return false;
    if (filters.week !== "all" && String(item.weekNo || "") !== filters.week) return false;
    if (filters.match !== "all" && String(item.matchId || item.matchLabel || "") !== filters.match) return false;
    if (filters.action === "admin" && item.isAdminAction !== true) return false;
    if (!["all", "admin"].includes(filters.action) && String(item.actionType || "") !== filters.action) return false;

    const itemDate = predictionLogDateInputValue(item.createdAt);
    if (filters.start && itemDate && itemDate < filters.start) return false;
    if (filters.end && itemDate && itemDate > filters.end) return false;
    return true;
  });

  const maxPage = Math.max(1, Math.ceil(predictionLogState.filtered.length / predictionLogState.pageSize));
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
        detail: "Admin sadece log kayıtlarını temizledi. Ana veriler silinmedi.",
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
    showAlert?.("Loglar temizlenemedi. Console ekranından hataya bakabilirsin.", {
      title: "Hata",
      type: "danger",
    });
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
  if (adminEl) adminEl.textContent = String(filtered.filter((item) => item.isAdminAction === true).length);
  if (lastActionEl) lastActionEl.textContent = last?.actionLabel || "Yok";
  if (lastDateEl) lastDateEl.textContent = last ? predictionLogDateText(last.createdAt) : "Henüz log kaydı görünmüyor.";
  if (badge) {
    badge.textContent = getCurrentRole() === "admin" ? "Admin görünümü: tüm loglar" : "Kullanıcı görünümü: sadece kendi logların";
    badge.className = `badge ${getCurrentRole() === "admin" ? "warn" : "gray"}`;
  }
}

function predictionLogActionBadge(item) {
  const type = String(item.actionType || "");
  const label = item.actionLabel || (type === "create" ? "Eklendi" : type === "update" ? "Değişti" : "Silindi");
  return `<span class="prediction-log-action prediction-log-action--${predictionLogEscape(type)}">${predictionLogEscape(label)}</span>`;
}

function renderPredictionLogRows() {
  const body = document.getElementById("predictionLogBody");
  const mobileList = document.getElementById("predictionLogMobileList");
  const pageInfo = document.getElementById("predictionLogPageInfo");
  const pagination = document.getElementById("predictionLogPagination");
  if (!body || !mobileList || !pageInfo || !pagination) return;

  const start = (predictionLogState.page - 1) * predictionLogState.pageSize;
  const rows = predictionLogState.filtered.slice(start, start + predictionLogState.pageSize);
  const totalPages = Math.max(1, Math.ceil(predictionLogState.filtered.length / predictionLogState.pageSize));

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7">Bu filtrelere uygun log kaydı bulunamadı.</td></tr>`;
    mobileList.innerHTML = `<div class="prediction-log-empty">Bu filtrelere uygun log kaydı bulunamadı.</div>`;
  } else {
    body.innerHTML = rows
      .map((item) => `
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
            ${item.isAdminAction ? '<span class="prediction-log-admin-pill">Admin</span>' : ''}
          </td>
        </tr>`)
      .join("");

    mobileList.innerHTML = rows
      .map((item) => `
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
            ${item.isAdminAction ? '<span class="prediction-log-admin-pill">Admin</span>' : ''}
          </div>
        </article>`)
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
  document.getElementById("refreshPredictionLogsBtn")?.addEventListener("click", () => {
    predictionLogState.page = 1;
    renderPredictionLogs({ force: true });
  });

  document.getElementById("clearPredictionLogsBtn")?.addEventListener("click", () => {
    clearPredictionLogsOnly();
  });

  document.getElementById("clearPredictionLogFiltersBtn")?.addEventListener("click", () => {
    ["predictionLogUserFilter", "predictionLogWeekFilter", "predictionLogMatchFilter", "predictionLogActionFilter"].forEach((id) => {
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

  document.getElementById("predictionLogPagination")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-log-page]");
    if (!btn || btn.disabled) return;
    const direction = btn.dataset.logPage;
    const totalPages = Math.max(1, Math.ceil(predictionLogState.filtered.length / predictionLogState.pageSize));
    if (direction === "prev") predictionLogState.page = Math.max(1, predictionLogState.page - 1);
    if (direction === "next") predictionLogState.page = Math.min(totalPages, predictionLogState.page + 1);
    renderPredictionLogRows();
  });
}

bindPredictionLogEvents();
