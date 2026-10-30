import { read, atomicChange } from '../core/storage.js';
import { bus, EVENTS } from '../core/bus.js';
import { getActiveProfile } from './profile.js';
import { gradeOf } from './grader.js';

/** 仅读取当前档案；过滤损坏的单条记录，不改写用户原有数据。 */
export function listHistory(profileId = getActiveProfile()?.id) {
  if (!profileId) return [];
  const stored = read(`sessions:${profileId}`, []);
  if (!Array.isArray(stored)) return [];
  const seen = new Set();
  return stored.filter(r => {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || seen.has(r.id)
      || (r.profileId != null && r.profileId !== profileId)
      || !Number.isFinite(r.finishedAt) || r.finishedAt <= 0 || !Number.isFinite(new Date(r.finishedAt).getTime())
      || ![r.total, r.correct, r.wrong, r.skipped].every(n => Number.isInteger(n) && n >= 0)
      || r.total < 1 || r.total > 100 || r.correct + r.wrong + r.skipped !== r.total) return false;
    seen.add(r.id);
    return true;
  }).map(r => {
    const accuracy = r.correct / r.total * 100;
    const fullPaper = Array.isArray(r.paper?.questions) && r.paper.questions.length === r.total
      && r.paper.questions.every(q => q && typeof q.kpId === 'string' && typeof q.text === 'string');
    return { ...r, accuracy: Math.round(accuracy * 10) / 10, grade: gradeOf(accuracy),
      elapsedMs: Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0 ? r.elapsedMs : 0,
      avgMs: Number.isFinite(r.avgMs) && r.avgMs >= 0 ? r.avgMs : null,
      compressed: !!r.compressed || !fullPaper,
      wrongList: Array.isArray(r.wrongList) ? r.wrongList.filter(w => w?.question && typeof w.question.text === 'string') : [] };
  }).sort((a, b) => b.finishedAt - a.finishedAt || b.id.localeCompare(a.id));
}

export function getHistoryRecord(id, profileId) {
  return listHistory(profileId).find(r => r.id === id) ?? null;
}

export function summarizeHistory(records) {
  const total = records.reduce((sum, r) => sum + r.total, 0);
  const correct = records.reduce((sum, r) => sum + r.correct, 0);
  return { count: records.length, total, accuracy: total ? Math.round(correct / total * 1000) / 10 : null };
}

export function deleteHistoryRecord(id, profileId = getActiveProfile()?.id) {
  if (!id || !profileId) return false;
  const stored = read(`sessions:${profileId}`, []);
  if (!Array.isArray(stored) || !stored.some(r => r?.id === id)) return false;
  const changes = { [`sessions:${profileId}`]: stored.filter(r => r?.id !== id) };
  if (read(`quiz:result:${profileId}`, null)?.id === id) changes[`quiz:result:${profileId}`] = null;
  const result = atomicChange(changes);
  if (result.ok) bus.emit(EVENTS.PROFILE_CHANGED, { profileId, historyDeleted: id });
  return result.ok;
}
export function filterHistory(records, { kpId = '', from = '', to = '' } = {}) {
  if (from && to && from > to) return [];
  const first = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
  const last = to ? new Date(to + 'T23:59:59.999').getTime() : Infinity;
  return records.filter(r => r.finishedAt >= first && r.finishedAt <= last
    && (!kpId || Object.hasOwn(r.kpCount ?? {}, kpId) || r.paper?.questions?.some(q => q.kpId === kpId)));
}
/** 结算和合并共享500明细+2000摘要规则，保留首次统计，不重新判分。 */
export function retainHistory(records) {
  return records.slice().sort((a, b) => b.finishedAt - a.finishedAt || b.id.localeCompare(a.id)).slice(0, 2500).map((r, i) => {
    if (i < 500 || r.compressed) return r;
    const kpCount = {}, kpCorrect = {}, kpAnswered = {};
    for (const q of r.paper?.questions ?? []) kpCount[q.kpId] = (kpCount[q.kpId] ?? 0) + 1;
    for (const a of r.detail ?? []) {
      if (!a.skipped) kpAnswered[a.kpId] = (kpAnswered[a.kpId] ?? 0) + 1;
      if (a.correct) kpCorrect[a.kpId] = (kpCorrect[a.kpId] ?? 0) + 1;
    }
    const { paper, detail, wrongList, ...summary } = r;
    return { ...summary, paper: null, detail: [], wrongList: [], kpCount, kpCorrect, kpAnswered, compressed: true };
  });
}
