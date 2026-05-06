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
  if (isDashboard) {
    renderDashboardMatchCards(container, matches);
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
          ${
            isDashboard
              ? ""
              : `
            <div class="match-action-buttons">
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
async function saveSingleMatchChange(match, successMessage) {
  recalculateAllPoints();
  saveState();
  renderAll();

  if (!useOnlineMode) {
    showAlert(successMessage, {
      title: "İşlem tamamlandı",
      type: "success",
    });
    return;
  }

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

  await saveSingleMatchChange(match, "Maç skoru temizlendi.");
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
  return [slug ? `logos/${slug}.png` : ""].filter(Boolean);
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
  const neutralCard = {
    bg: "rgba(15,23,42,0.72)",
    border: "rgba(148,163,184,0.12)",
  };

  if (!hasPrediction) {
    return {
      ...neutralCard,
      accent: "#94a3b8",
      scoreBg: "rgba(15,23,42,0.82)",
      scoreBorder: "rgba(148,163,184,0.14)",
      chipBg: "rgba(15,23,42,0.82)",
      chipBorder: "rgba(148,163,184,0.14)",
      label: shareView === "pre" ? "—" : "Boş",
    };
  }

  if (!match.played || shareView === "pre") {
    return {
      bg: "rgba(15,23,42,0.82)",
      border: "rgba(56,189,248,0.22)",
      accent: "#e2e8f0",
      scoreBg: "rgba(15,23,42,0.86)",
      scoreBorder: "rgba(56,189,248,0.22)",
      chipBg: "rgba(15,23,42,0.84)",
      chipBorder: "rgba(56,189,248,0.18)",
      label: "Tahmin",
    };
  }

  const pts = Number(pred.points || 0);
  if (pts >= 3) {
    return {
      ...neutralCard,
      accent: "#dcfce7",
      scoreBg: "rgba(22,101,52,0.72)",
      scoreBorder: "rgba(74,222,128,0.42)",
      chipBg: "rgba(22,101,52,0.70)",
      chipBorder: "rgba(74,222,128,0.34)",
      label: "Tam skor",
    };
  }
  if (pts >= 1) {
    return {
      ...neutralCard,
      accent: "#fef3c7",
      scoreBg: "rgba(202,138,4,0.75)",
      scoreBorder: "rgba(250,204,21,0.50)",
      chipBg: "rgba(202,138,4,0.70)",
      chipBorder: "rgba(250,204,21,0.40)",
      label: "Yakın",
    };
  }
  return {
    ...neutralCard,
    accent: "#fee2e2",
    scoreBg: "rgba(153,27,27,0.70)",
    scoreBorder: "rgba(248,113,113,0.40)",
    chipBg: "rgba(153,27,27,0.64)",
    chipBorder: "rgba(248,113,113,0.32)",
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
      ? players
          .map((player) => {
            const row = weeklyStandings.find(
              (item) => item.id === player.id,
            ) || {
              id: player.id,
              total: 0,
              exact: 0,
              resultOnly: 0,
            };
            return { ...row, id: player.id, name: player.name };
          })
          .sort(
            (a, b) =>
              Number(b.total || 0) - Number(a.total || 0) ||
              Number(b.exact || 0) - Number(a.exact || 0) ||
              Number(b.resultOnly || 0) - Number(a.resultOnly || 0) ||
              String(a.name || "").localeCompare(String(b.name || ""), "tr"),
          )
      : [];
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
      const pred =
        getPrediction(match.id, player.id) ||
        createEmptyPredictionRecord(match.id, player.id);
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
        shareView === "post" ? "rgba(2,6,23,0.10)" : "rgba(2,6,23,0.12)",
        palette.border,
      );

      const scoreBoxW = Math.min(playerColW - 48, 92);
      const scoreBoxH = 34;
      fillRoundedRect(
        ctx,
        cellX + playerColW / 2 - scoreBoxW / 2,
        rowY + 15,
        scoreBoxW,
        scoreBoxH,
        17,
        shareView === "post" ? palette.scoreBg : "rgba(15,23,42,0.86)",
        shareView === "post" ? palette.scoreBorder : palette.border,
      );
      ctx.fillStyle = palette.accent;
      ctx.font = "900 24px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        getPredictionDisplayValue(pred),
        cellX + playerColW / 2,
        rowY + 39,
      );

      const status =
        shareView === "post"
          ? palette.label
          : pred.homePred !== "" && pred.awayPred !== ""
            ? "Tahmin var"
            : "Tahmin yok";
      const chipW = Math.min(playerColW - 44, 104);
      fillRoundedRect(
        ctx,
        cellX + playerColW / 2 - chipW / 2,
        rowY + 55,
        chipW,
        20,
        10,
        shareView === "post" ? palette.chipBg : "rgba(15,23,42,0.84)",
        shareView === "post" ? palette.chipBorder : "rgba(56,189,248,0.18)",
      );
      ctx.font = "800 12px Inter, Arial, sans-serif";
      ctx.fillStyle = shareView === "post" ? palette.accent : "#bfdbfe";
      ctx.fillText(status, cellX + playerColW / 2, rowY + 69);
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
      const rank = index + 1;
      const cardY = tableY + 68 + index * (summaryCardH + summaryGap);
      const cardX = sumX + 12;
      const cardW = sumWidth - 24;
      const rankFill =
        rank === 1
          ? "rgba(255,215,64,0.26)"
          : rank === 2
            ? "rgba(226,232,240,0.82)"
            : rank === 3
              ? "rgba(251,191,116,0.30)"
              : "rgba(15,23,42,0.06)";

      const rankStroke =
        rank === 1
          ? "rgba(234,179,8,0.55)"
          : rank === 2
            ? "rgba(148,163,184,0.40)"
            : rank === 3
              ? "rgba(180,83,9,0.36)"
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
      if (rank === 1) {
        const goldGlow = ctx.createLinearGradient(
          cardX,
          cardY,
          cardX + cardW,
          cardY + summaryCardH,
        );
        goldGlow.addColorStop(0, "rgba(255,255,255,0.22)");
        goldGlow.addColorStop(0.45, "rgba(255,255,255,0.06)");
        goldGlow.addColorStop(1, "rgba(255,215,64,0.10)");

        fillRoundedRect(
          ctx,
          cardX + 1,
          cardY + 1,
          cardW - 2,
          summaryCardH - 2,
          15,
          goldGlow,
          "",
        );
      }
      fillRoundedRect(
        ctx,
        cardX + 12,
        cardY + 12,
        30,
        30,
        15,
        rank === 1
          ? "#facc15"
          : rank === 2
            ? "#cbd5e1"
            : rank === 3
              ? "#d97706"
              : "#334155",
        rank === 1
          ? "rgba(234,179,8,0.65)"
          : rank === 2
            ? "rgba(148,163,184,0.55)"
            : rank === 3
              ? "rgba(146,64,14,0.45)"
              : "",
      );
      ctx.fillStyle = rank === 2 ? "#0f172a" : "#ffffff";
      ctx.font = "900 15px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(rank === 1 ? "1" : String(rank), cardX + 27, cardY + 32);
      ctx.textAlign = "left";

      if (rank === 1) {
        ctx.font = "900 13px Inter, Arial, sans-serif";
        ctx.fillText("👑", cardX + 19, cardY + 10);
      }

      ctx.fillStyle = "#0f172a";
      ctx.font =
        rank === 1
          ? "900 17px Inter, Arial, sans-serif"
          : "900 16px Inter, Arial, sans-serif";
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
