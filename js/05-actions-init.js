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
      if (typeof renderNotificationCenter === "function") renderNotificationCenter();
      break;

    case "logs":
      if (typeof renderPredictionLogs === "function") {
        renderPredictionLogs({ force: true });
      }
      break;

    case "backup":
      renderBackupPanel();
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

  const loadingText = labels.loading || labels.pending || "Bekleniyor...";
  const successText = labels.success || "Tamam";
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
  if (typeof window.writeAppAuditLogEntry === "function") {
    const season = getSeasonById(seasonId);
    const week = state.weeks.find((item) => String(item.id) === String(weekId));
    window.writeAppAuditLogEntry({
      actionType: "match_create",
      actionLabel: "Maç eklendi",
      detail: `${homeTeam} - ${awayTeam} maçı eklendi (${season?.name || "Sezon"}, ${week?.number || "?"}. hafta)`,
      entityType: "match",
      entityId: newMatch.id,
      newValue: { homeTeam, awayTeam, date, season: season?.name || "", weekNo: week?.number || "" },
    });
  }
  renderAll();
}

function switchTab(tabName, options = {}) {
  if (
    getCurrentRole() !== "admin" &&
    ["backup", "notifications", "seasons", "weeks", "matches"].includes(tabName)
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
  const itemSeasonId = normalizeText(item.seasonId || item.localSeasonId || item.sezonId || "");
  const itemSeasonName = normalizeText(item.season || item.sezon || item.seasonName || "");
  const itemMatchId = String(item.matchId || item.localMatchId || item.macId || "").trim();
  const itemWeekId = String(item.weekId || item.localWeekId || item.haftaId || "").trim();

  if (seasonId && itemSeasonId && itemSeasonId === seasonId) return true;
  if (seasonName && itemSeasonName && itemSeasonName === seasonName) return true;
  if (itemMatchId && matchIds.has(itemMatchId)) return true;
  if (itemWeekId && weekIds.has(itemWeekId)) return true;
  return false;
}

async function buildFirebaseSeasonBackupData(season, appStateData = null) {
  if (!season || !isFirebaseReady()) return null;

  const [settings, users, matches, predictions, predictionLogs, auditLogs, notificationLogs, queue, sent] =
    await Promise.all([
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
  remoteMatches.forEach((match) => ctx.matchIds.add(String(match.id || match._firebaseKey || "")));

  const remotePredictions = backupMapToArray(predictions).filter((item) =>
    isSeasonRelatedBackupRecord(item, ctx),
  );

  const usedPlayerIds = new Set(
    remotePredictions
      .map((pred) => String(pred.playerId || pred.kullaniciId || pred.userId || ""))
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

  const filterMap = (map) => backupMapToArray(map).filter((item) => isSeasonRelatedBackupRecord(item, ctx));

  return {
    exportedFromFirebaseAt: new Date().toISOString(),
    appState: appStateData ? serializeStateForBackup(appStateData) : null,
    settings: {
      seasonsMeta: Array.isArray(settings?.seasonsMeta)
        ? settings.seasonsMeta.filter((item) =>
            normalizeText(item.id || "") === normalizeText(season.id || "") ||
            normalizeText(item.name || "") === normalizeText(season.name || ""),
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
  const teams = state.teams.filter((team) => String(team.seasonId) === String(season.id));
  const matches = getMatchesBySeasonId(season.id);
  const matchIds = new Set(matches.map((match) => String(match.id)));
  const predictions = state.predictions.filter((pred) => matchIds.has(String(pred.matchId)));
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
    season: { id: season.id, name: season.name, leagueName: season.leagueName || "" },
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
    writeRows("adminNotificationQueue", firebaseData.adminNotificationQueue || []),
    writeRows("sentNotifications", firebaseData.sentNotifications || []),
  ]);

  const seasonsMeta = firebaseData.settings?.seasonsMeta || [];
  if (seasonsMeta.length) {
    const currentSettings = (await firebaseRead("settings").catch(() => null)) || {};
    const currentMeta = Array.isArray(currentSettings.seasonsMeta) ? currentSettings.seasonsMeta : [];
    const metaMap = new Map(currentMeta.map((item) => [String(item.id || item.name), item]));
    seasonsMeta.forEach((item) => metaMap.set(String(item.id || item.name), item));
    await firebaseUpdate("settings", { seasonsMeta: Array.from(metaMap.values()) });
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
  const incomingMatchIds = new Set(incomingMatches.map((match) => String(match.id)));

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
    ...(next.matches || []).filter((match) => String(match.seasonId) !== seasonId),
    ...incomingMatches,
  ];
  next.predictions = [
    ...(next.predictions || []).filter((pred) => !removedMatchIds.has(String(pred.matchId))),
    ...(incoming.predictions || []),
  ];

  const playerMap = new Map((next.players || []).map((player) => [String(player.id), player]));
  (incoming.players || []).forEach((player) => {
    if (!player?.id) return;
    playerMap.set(String(player.id), { ...(playerMap.get(String(player.id)) || {}), ...player });
  });
  next.players = Array.from(playerMap.values());

  next.settings = { ...(next.settings || {}) };
  next.settings.activeSeasonId = seasonId;
  next.settings.activeWeekId = incoming.settings?.activeWeekId || (incoming.weeks || [])[0]?.id || next.settings.activeWeekId || null;
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
      } else if (parsed?.type === "season-full-backup" && (parsed?.firebaseData?.appState || parsed?.data)) {
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

      const isSeasonFullBackup = parsed?.type === "season-full-backup" && parsed?.firebaseData;
      await applyImportedState(nextState, { syncFirebase: !isSeasonFullBackup });
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
      seasonSelect.value || state.settings.activeSeasonId || state.seasons?.[0]?.id || "";
    seasonSelect.innerHTML = state.seasons?.length
      ? state.seasons
          .map(
            (item) =>
              `<option value="${item.id}" ${String(item.id) === String(selectedSeasonId) ? "selected" : ""}>${item.name || "İsimsiz sezon"}</option>`,
          )
          .join("")
      : '<option value="">Sezon bulunamadı</option>';

    const backupSeason = selectedSeasonId ? getSeasonById(selectedSeasonId) : null;
    const seasonMatches = backupSeason ? getMatchesBySeasonId(backupSeason.id) : [];
    const seasonWeeks = backupSeason ? getWeeksBySeasonId(backupSeason.id) : [];
    const seasonMatchIds = new Set(seasonMatches.map((match) => String(match.id)));
    const seasonPredictionCount = state.predictions.filter((pred) =>
      seasonMatchIds.has(String(pred.matchId)),
    ).length;
    const seasonTeamCount = backupSeason
      ? state.teams.filter((team) => String(team.seasonId) === String(backupSeason.id)).length
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

    try {
      sheetSyncResult = await syncWeekMatchesToSheet(week.id);
    } catch (sheetError) {
      console.warn("Hafta Sheets senkron uyarısı:", sheetError);
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
      window.queuePredictionSave(matchId, playerId, true);
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
        if (e.cancelable) e.preventDefault();
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

      if (e.cancelable) e.preventDefault();
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
  on("exportSeasonBackupBtn", "click", exportSelectedSeasonBackup);
  on("exportFullBackupBtn", "click", exportFullBackup);
  on("apiImportFixturesBtn", "click", () => importFixturesFromApi(false));
  on("apiUpdateResultsBtn", "click", () => importFixturesFromApi(true));
  on("apiSyncWeekBtn", "click", syncSelectedWeekFromApi);
  on("dashboardSyncWeekBtn", "click", syncDashboardWeek);
  on("dashboardSyncSeasonBtn", "click", syncDashboardSeason);
  on("dashboardWeekScoreUpdateBtn", "click", runDashboardWeekScoreUpdate);
  on("dashboardMobileWeekScoreUpdateBtn", "click", runDashboardWeekScoreUpdate);
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

function performIdleLogout() {
  clearIdleLogoutTimer();
  localStorage.removeItem(IDLE_LOGOUT_STORAGE_KEY);

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

  const lastActivityAt = getLastUserActivityAt();
  if (lastActivityAt && Date.now() - lastActivityAt >= IDLE_LOGOUT_LIMIT_MS) {
    performIdleLogout();
    return true;
  }

  scheduleIdleLogoutCheck();
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
    if (document.visibilityState === "visible") {
      checkIdleLogoutAfterResume();
    }
  });

  window.addEventListener("focus", checkIdleLogoutAfterResume);
  window.addEventListener("pageshow", checkIdleLogoutAfterResume);

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

function logAppResumeRefresh(step, details = {}) {

}

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

if (isAuthenticated()) {
  startPresenceTracking();
  renderAll();
  runSessionHydrationWithFastOverlay({
    loadingMessage:
      "Kayıtlı veriler açılıyor, güncel bilgiler arka planda senkronlanıyor...",
    sessionRestore: true,
    suppressOverlay: true,
  })
    .then(async () => {
      if ((state.settings.currentTab || "dashboard") === "dashboard") {
        await maybeAutoSyncResults();
        renderDashboardSyncCard();
        renderDashboardAutoSyncStatus();
      }
    })
    .catch((error) =>
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
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "c") return;

  const standingsTab = document.getElementById("tab-standings");
  if (!standingsTab || !standingsTab.classList.contains("active")) return;

  document.body.classList.toggle("standings-shot-mode");
});
