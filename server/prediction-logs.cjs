'use strict';
// This reader is called only after the account API has authenticated the actor.
async function getPredictionLogs(db, actor) {
  const read = async path => (await db.ref(path).get()).val() || {};
  const [primary, legacy, matches, settings, users] = await Promise.all([
    read('predictionLogs'), read('settings/auditLogs'), read('matches'), read('settings'), read('users'),
  ]);
  const idText = value => String(value ?? '').trim();
  const score = row => row && typeof row === 'object' ? {
    homePred: row.homePred ?? row.tahminEv ?? '', awayPred: row.awayPred ?? row.tahminDep ?? '',
  } : null;
  const rows = [];
  for (const [id, item] of Object.entries({...legacy, ...primary})) {
    if (!item || typeof item !== 'object') continue;
    const old = item.oldRecord || item.oldValue || null;
    const next = item.newRecord || item.newValue || null;
    const target = idText(item.targetPlayerId || item.playerId || next?.playerId || next?.kullaniciId || old?.playerId || old?.kullaniciId);
    // Never authorize by actorId: an admin editing another person's prediction
    // must be visible to the target, not to an unrelated viewer.
    if (!actor.admin && (!target || target !== idText(actor.playerId))) continue;
    const sheetId = idText(item.sheetMatchId || next?.sheetMatchId || old?.sheetMatchId);
    const matchId = idText(item.matchId || next?.matchId || old?.matchId);
    const match = matches[sheetId] || matches[matchId] || Object.values(matches).find(m => m && [idText(m.id),idText(m.localMatchId),idText(m.matchId)].includes(matchId) && matchId) || {};
    const weekId = idText(item.weekId || next?.weekId || old?.weekId || match.weekId);
    const week = Object.values(settings.weeksMeta || {}).find(w => w && idText(w.id) === weekId) || {};
    const homeTeam = idText(item.homeTeam || next?.homeTeam || old?.homeTeam || match.homeTeam);
    const awayTeam = idText(item.awayTeam || next?.awayTeam || old?.awayTeam || match.awayTeam);
    const actionType = idText(item.actionType);
    rows.push({
      id, type:idText(item.type), actionType,
      actionLabel:idText(item.actionLabel) || ({create:'Tahmin eklendi',update:'Tahmin değiştirildi',delete:'Tahmin silindi'}[actionType] || 'İşlem'),
      targetPlayerId:target,
      targetPlayerName:idText(item.targetPlayerName || next?.playerName || next?.adSoyad || old?.playerName || old?.adSoyad || users[target]?.adSoyad || users[target]?.name || users[target]?.kullaniciAdi) || 'Bilinmeyen kişi',
      actorId:idText(item.actorId), actorName:idText(item.actorName || users[item.actorId]?.adSoyad || users[item.actorId]?.name) || 'Bilinmeyen',
      actorRole:idText(item.actorRole), isAdminAction:item.actorRole === 'admin' || item.isAdminAction === true,
      matchId, sheetMatchId:sheetId, matchLabel:idText(item.matchLabel) || `${homeTeam} - ${awayTeam}`,
      homeTeam, awayTeam, weekId,
      weekNo:idText(item.weekNo || next?.weekNo || next?.haftaNo || old?.weekNo || old?.haftaNo || match.weekNo || match.haftaNo || week.number),
      seasonId:idText(item.seasonId || next?.seasonId || old?.seasonId || match.seasonId),
      oldValue:score(old), newValue:score(next), createdAt:idText(item.createdAt), source:idText(item.source) || 'account-api',
    });
  }
  rows.sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
  return {success:true,logs:rows};
}
module.exports = {getPredictionLogs};
