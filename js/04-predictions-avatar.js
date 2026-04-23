/* 04-predictions-avatar.js */

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
          const pred = getPrediction(match.id, player.id) || createEmptyPredictionRecord(match.id, player.id);
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
        <div class="prediction-cell ${pointLabel(pred.points)} ${outcomeClass} ${locked || !canEdit ? "locked-cell" : ""}${ownClass}${showPointBadge ? " has-point-badge" : ""}">
        ${showPointBadge ? `<div class="points-badge-inline" style="background:${badgeBg};">${badgeText}</div>` : ""}
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
  const pred = getPrediction(matchId, playerId) || createEmptyPredictionRecord(matchId, playerId);
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

    console.log("DELETE RESULT:", result);

    btn.innerText = "Sil";
    btn.disabled = false;

    if (result?.success) {
      clearLocalPredictionRecord(matchId, playerId);
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
      const manifestResponse = await fetch(`avatars/avatars.json?v=${Date.now()}`, {
        cache: "no-store",
      });
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
      const contentType = String(directoryResponse.headers.get("content-type") || "").toLowerCase();
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
    const startsWithMatch = Object.entries(directoryMap).find(([fileKey]) =>
      fileKey.startsWith(key) || key.startsWith(fileKey),
    );
    if (startsWithMatch?.[1]) return startsWithMatch[1];
  }

  for (const key of candidateKeys) {
    const includesMatch = Object.entries(directoryMap).find(([fileKey]) =>
      fileKey.includes(key) || key.includes(fileKey),
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
  return escapeHtml(String(row?.name || row?.username || row?.displayName || "?").trim().charAt(0) || "?");
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

    const resolvedSrc = String(img.dataset.avatarSrc || "").trim() || findAvatarFromDirectory(candidateKeys);

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
  const dataSrcAttr = avatarSrc ? ` data-avatar-src="${escapeHtml(avatarSrc)}"` : "";
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
    const match = weekMatches.find((item) => String(item.id) === String(pred.matchId));
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

  const resolvedMatches = typeof getResolvedWeekMatches === "function"
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

  const generalRankMap = Object.fromEntries(general.map((row, index) => [row.id, index + 1]));
  const weeklyRankMap = Object.fromEntries(weekly.map((row, index) => [row.id, index + 1]));
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
      ? standingsRowsMobile(general, true, { leaderId: generalLeaderId, rankDeltaMap: generalDeltaMap })
      : standingsRows(general, true, { leaderId: generalLeaderId, rankDeltaMap: generalDeltaMap })
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
      const exactRateValue = filledPreds.length ? (exact / filledPreds.length) * 100 : 0;
      const participationRateValue = totalMatches
        ? (filledPreds.length / totalMatches) * 100
        : 0;
      const missed = Math.max(totalMatches - filledPreds.length, 0);

      const weeklyPlayedSummaries = seasonWeeks
        .map((week) => {
          const playedWeekMatches = getMatchesByWeekId(week.id).filter((match) => {
            if (match?.played) return true;
            return (
              match?.homeScore !== "" &&
              match?.awayScore !== "" &&
              match?.homeScore != null &&
              match?.awayScore != null
            );
          });
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
      const worstWeekScore = weeklyTotals.length ? Math.min(...weeklyTotals) : 0;
      const weekWins = seasonWeeks.reduce((count, week) => {
        const playedWeekMatches = getMatchesByWeekId(week.id).filter((match) => {
          if (match?.played) return true;
          return (
            match?.homeScore !== "" &&
            match?.awayScore !== "" &&
            match?.homeScore != null &&
            match?.awayScore != null
          );
        });
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
              total: weekPreds.reduce((sum, pred) => sum + Number(pred.points || 0), 0),
              exact: weekPreds.filter((pred) => Number(pred.points || 0) === 3).length,
              resultOnly: weekPreds.filter((pred) => Number(pred.points || 0) === 1).length,
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

      const recentPlayedMatches = seasonMatches
        .filter((match) => {
          if (match?.played) return true;
          return match?.homeScore !== "" && match?.awayScore !== "" && match?.homeScore != null && match?.awayScore != null;
        })
        .slice(-5);

      const recentForm = recentPlayedMatches.map((match) => {
        const pred = preds.find((item) => String(item.matchId) === String(match.id));
        if (!pred || pred.homePred === "" || pred.awayPred === "") {
          return { label: "-", value: 0, type: "missing" };
        }
        const points = Number(pred.points || 0);
        return {
          label: `${points}p`,
          value: points,
          type: points === 3 ? "exact" : points === 1 ? "result" : "zero",
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

  if (!heroTarget || !overviewTarget || !leadersTarget || !playerCardsTarget || !deepTarget) {
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
      note: liveLeader ? `Başarı ${safePercent(liveLeader.accuracyValue)} • Ortalama ${liveLeader.average}` : "Henüz veri yok",
    },
    {
      tag: "🎯 En isabetli",
      name: mostAccurate?.name || "-",
      value: mostAccurate ? safePercent(mostAccurate.accuracyValue) : "Veri yok",
      note: mostAccurate ? `${mostAccurate.exact + mostAccurate.resultOnly} doğru tahmin` : "Henüz veri yok",
    },
    {
      tag: "🔥 Tam skor kralı",
      name: sharpShooter?.name || "-",
      value: sharpShooter ? `${sharpShooter.exact} tam skor` : "Veri yok",
      note: sharpShooter ? `Tam skor oranı ${safePercent(sharpShooter.exactRateValue)}` : "Henüz veri yok",
    },
    {
      tag: "🛡️ En disiplinli",
      name: reliable?.name || "-",
      value: reliable ? safePercent(reliable.participationRateValue) : "Veri yok",
      note: reliable ? `${reliable.predictionCount} dolu tahmin` : "Henüz veri yok",
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
                  (item) => `<span class="form-pill ${item.type ? `is-${item.type}` : ""}">${item.label}</span>`,
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
                <span class="player-card-caption">Son 5 maç formu</span>
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
      note: risingStar ? `Son 5 maçta ${risingStar.recentFormPoints} puan topladı.` : "Henüz veri yok.",
    },
    {
      label: "En iyi tek hafta",
      value: bestWeekPlayer ? `${bestWeekPlayer.bestWeekScore} puan` : "-",
      note: bestWeekPlayer ? escapeHtml(bestWeekPlayer.name) : "Henüz veri yok.",
    },
    {
      label: "En düşük hafta",
      value: worstWeekPlayer ? `${worstWeekPlayer.worstWeekScore} puan` : "-",
      note: worstWeekPlayer ? `${escapeHtml(worstWeekPlayer.name)} için sezonun en düşük dolu haftası.` : "Henüz veri yok.",
    },
    {
      label: "En güvenli tahmin profili",
      value: reliable ? escapeHtml(reliable.name) : "-",
      note: reliable ? `${safePercent(reliable.participationRateValue)} katılım ile düzenli ilerliyor.` : "Henüz veri yok.",
    },
    {
      label: "En verimli oyuncu",
      value: bestAverage ? escapeHtml(bestAverage.name) : "-",
      note: bestAverage ? `Tahmin başına ${bestAverage.average} puan ortalaması var.` : "Henüz veri yok.",
    },
    {
      label: "Sezon kapanış notu",
      value: champion ? escapeHtml(champion.name) : liveLeader ? escapeHtml(liveLeader.name) : "-",
      note: champion ? `${champion.total} puanla sezon tamamlandı.` : liveLeader ? `Şimdilik zirvede ${liveLeader.total} puan var.` : "Henüz veri yok.",
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

