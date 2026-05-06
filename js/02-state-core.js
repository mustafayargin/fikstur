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
    map.set(key, pred);
  });

  predictionIndexCache = map;
  predictionIndexCacheSource = state.predictions;
  predictionIndexCacheLength = state.predictions.length;
  return map;
}

function getPredictionCacheKey(matchId, playerId) {
  return `${normalizeEntityId(matchId)}__${normalizeEntityId(playerId)}`;
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
  state.settings.activeSeasonId = seasonId || null;
  state.settings.activeWeekId = getPreferredWeekIdForSeason(seasonId);
  saveState();
  renderAll();
  refreshPlayerDetailModal();
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
  return (
    getTeamsBySeasonId(seasonId).find((t) => t.name === name) ||
    state.teams.find((t) => t.name === name) || {
      name,
      slug: DEFAULT_TEAM_SLUGS[name] || slugify(name),
    }
  );
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
  return `
    <span class="team-logo-wrap ${extraClass}">
      <img class="team-logo-img" src="${localSrc}" data-local-src="${localSrc}" data-team-name="${escapeHtml(teamName)}" alt="${escapeHtml(teamName)} logosu" onerror="window.handleTeamLogoError && window.handleTeamLogoError(this);" />
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

    const notificationButton =
      typeof getPredictionNotificationButtonHtml === "function"
        ? getPredictionNotificationButtonHtml()
        : "";

    if (isAdmin) {
      banner.innerHTML = `<strong>🔓 Admin görünümü · ${countdown}</strong><span>Kullanıcılar için haftalık kilit bu sürenin sonunda devreye girer.</span>${notificationButton}`;
      return;
    }

    banner.innerHTML = `<strong>⏳ Tahmin vermek için kalan süre: ${countdown}</strong><span>Haftanın ilk maçına 10 dk kala tüm tahminler otomatik kilitlenir.</span>${notificationButton}`;
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

  return weeks[weeks.length - 1].id;
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

  const hasHomeScore = match.homeScore !== "" && match.homeScore !== null && match.homeScore !== undefined;
  const hasAwayScore = match.awayScore !== "" && match.awayScore !== null && match.awayScore !== undefined;
  return hasHomeScore && hasAwayScore;
}

function getResolvedWeekMatches(weekId) {
  return getMatchesByWeekId(weekId).filter((match) => isMatchResolvedForScoring(match));
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
      second: "2-digit"
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

  return (
    state.teams.find((team) => String(team.id) === teamId)?.name || ""
  );
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
  const teamNames = [...new Set(state.teams.map((team) => String(team.name || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "tr"));

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
          ${canManageThisProfile ? `
          <div class="player-stat-pill">
            <span class="player-stat-label">Şifre</span>
            <strong>${escapeHtml(player.password || "1234")}</strong>
          </div>
          ` : ""}
          <div class="player-stat-pill">
            <span class="player-stat-label">Tahmin</span>
            <strong>${predictionCount}</strong>
          </div>
        </div>
      </div>

      <div class="player-card-team-block">
        <div class="player-card-section-title">Takım kartı</div>
        ${supportedTeamMarkup}
        ${canManageThisProfile ? `
        <div class="player-team-editor-row">
          <select id="player_team_${player.id}" class="player-team-select user-self-control">
            ${teamSelectorOptions}
          </select>
          <button class="small secondary user-self-control" onclick="savePlayerSupportedTeam('${player.id}', this)">Takımı Kaydet</button>
        </div>
        ` : ""}
      </div>

      ${isAdminMode ? `
      <div class="player-card-seasons">
        <div class="player-card-section-title">Sezon katılımı</div>
        ${seasonMembershipMarkup}
      </div>
      ` : ""}

      <div class="player-card-actions">
        ${isAdminMode ? `
          <button class="small secondary" onclick="renamePlayer('${player.id}', this)">Düzenle</button>
          <button class="small secondary" onclick="changePlayerPassword('${player.id}', this)">Ş. Değiştir</button>
          ${isAdminUser ? "" : `<button class="small secondary" onclick="togglePanelAdmin('${player.id}', this)">${player.panelAdmin ? "Admin Yetkisini Kaldır" : "Admin Yap"}</button>`}
          ${isAdminUser ? "" : `<button class="small secondary" onclick="forceLogoutUserSession('${player.id}', this)">Sistemden At</button>`}
          ${isAdminUser ? "" : `<button class="small danger" onclick="removePlayer('${player.id}', this)">Sil</button>`}
        ` : isOwnUserProfile ? `
          <button class="small secondary user-self-control" onclick="changePlayerPassword('${player.id}', this)">Şifremi Değiştir</button>
        ` : `
          <span class="player-readonly-note">Bu kart sadece görüntülenebilir.</span>
        `}
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

