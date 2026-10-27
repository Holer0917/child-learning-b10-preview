import { read } from '../core/storage.js';
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
