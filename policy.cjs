'use strict';
const crypto = require('node:crypto');
class Fault extends Error { constructor(status, message) { super(message); this.status = status; } }
const normalizeName = v => String(v || '').trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/\s+/g, ' ');
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const accountEmail = name => `u.${hash(normalizeName(name))}@accounts.skorx.invalid`;
const accountUid = id => `skorx_${hash(String(id)).slice(0, 40)}`;
const key = v => { const s = String(v || '').trim(); if (!s || /[.#$\[\]\/]/.test(s) || s.length > 180) throw new Fault(400, 'Geçersiz kayıt kimliği.'); return s; };
const password = v => { if (typeof v !== 'string' || v.length < 12 || v.length > 128) throw new Fault(400, 'Şifre 12–128 karakter olmalı.'); return v; };
const temporaryPassword = () => crypto.randomBytes(18).toString('base64url');
const clean = value => {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !/^(sifre|password|adminPassword|temporaryPassword|email|authEmail)$/i.test(k)).map(([k,v]) => [k,clean(v)]));
};
function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const s = value.trim();
  return Date.parse(/Z$|[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}+03:00`);
}
function resolveMatch(payload, map) {
  const ids = [payload.sheetMatchId, payload.remoteMatchId, payload.matchId, payload.localMatchId].filter(Boolean).map(String);
  for (const id of ids) {
    const entry = Object.entries(map || {}).find(([k,m]) => [k,m.id,m.sheetMatchId,m.remoteMatchId,m.macId].filter(Boolean).map(String).includes(id));
    if (entry) return entry;
  }
  throw new Fault(409, 'Maç ortak veritabanında bulunamadı. Önce haftayı yayınlayın.');
}
function contextualMatch(match, settings) {
  const seasons=Object.values(settings.seasonsMeta || {}),weeks=Object.values(settings.weeksMeta || {});
  const season=seasons.find(s=>String(s.id)===String(match.seasonId)) || seasons.find(s=>normalizeName(s.name)===normalizeName(match.season || match.sezon));
  const seasonId=String(season?.id || match.seasonId || '');
  const week=weeks.find(w=>String(w.id)===String(match.weekId) && (!seasonId || String(w.seasonId)===seasonId)) || weeks.find(w=>String(w.seasonId)===seasonId && Number(w.number)===Number(match.weekNo || match.haftaNo));
  return {...match,seasonId,weekId:String(week?.id || match.weekId || ''),date:match.date || match.tarih || '',played:match.played===true || Number(match.oynandiMi)===1};
}
function weekContext(match, matches, settings) {
  match=contextualMatch(match,settings);
  const weeks = Object.values(settings.weeksMeta || {});
  const week = weeks.find(w => String(w.id) === String(match.weekId)) || weeks.find(w => String(w.seasonId) === String(match.seasonId) && Number(w.number) === Number(match.weekNo || match.haftaNo));
  const sameWeek = Object.values(matches).map(m=>contextualMatch(m,settings)).filter(m => String(m.seasonId || m.season || m.sezon) === String(match.seasonId || match.season || match.sezon) && (match.weekId ? String(m.weekId) === String(match.weekId) : Number(m.weekNo || m.haftaNo) === Number(match.weekNo || match.haftaNo)));
  const times = sameWeek.map(m => parseDate(m.date)).filter(Number.isFinite);
  return { week, first: times.length ? Math.min(...times) : NaN, sameWeek };
}
function assertPredictionAllowed(actor, playerId, match, matches, settings, now = Date.now()) {
  if (actor.admin) return;
  match=contextualMatch(match,settings);
  if (String(playerId) !== actor.playerId) throw new Fault(403, 'Başkasının tahminini değiştiremezsiniz.');
  if (actor.access.mustChangePassword) throw new Fault(403, 'Önce geçici şifrenizi değiştirin.');
  const memberships = actor.profile.seasonStates || actor.profile.seasonMemberships || actor.profile.activeSeasons || {};
  if (match.seasonId && memberships[match.seasonId] === false) throw new Fault(403, 'Bu sezonda tahmin yapma yetkiniz yok.');
  if (match.played === true || match.oynandiMi === 1) throw new Fault(403, 'Oynanmış maçın tahmini değiştirilemez.');
  const {week,first} = weekContext(match, matches, settings);
  if (!week || week.status === 'hazirlaniyor') throw new Fault(403, 'Hafta yayınlanmamış veya doğrulanamadı.');
  if (week.predictionManualLocked === true) throw new Fault(403, 'Hafta tahminleri kilitli.');
  if (week.predictionManualOpen === true) return;
  if (!Number.isFinite(first) || now >= first - 6*60*60*1000) throw new Fault(403, 'Tahmin süresi doldu veya maç tarihi doğrulanamadı.');
}
function canReveal(actor, prediction, matches, settings, now = Date.now()) {
  if (actor.admin || String(prediction.playerId || prediction.kullaniciId) === actor.playerId) return true;
  let match; try { match = resolveMatch(prediction, matches)[1]; } catch { return false; }
  const {week,first,sameWeek} = weekContext(match,matches,settings);
  if(!week) return false;
  if (week?.predictionManualLocked === true) return true;
  if (week?.predictionManualOpen !== true && Number.isFinite(first) && now >= first-6*60*60*1000) return true;
  return sameWeek.some(m => m.played === true || (Number.isFinite(parseDate(m.date)) && now >= parseDate(m.date)));
}
module.exports = { Fault,normalizeName,accountEmail,accountUid,key,password,temporaryPassword,clean,parseDate,resolveMatch,contextualMatch,assertPredictionAllowed,canReveal };
