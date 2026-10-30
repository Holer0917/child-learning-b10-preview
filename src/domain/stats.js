/** 基于已保留记录的统计；显示舍入不参与等级判定，跳过不计练习量或打卡。 */
import { read, write } from '../core/storage.js';
import { listHistory } from './history.js';
import { getKnowledgePoint } from './syllabus.js';
import { judgeAnswer } from './grader.js';
import { dateStr } from '../utils/date.js';

export const readSessions = pid => listHistory(pid);
const validCount = s => s.total - s.skipped;
const shiftDay = (day, n) => {
  const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return dateStr(d);
};
export function accuracyTrend(pid, range = 30) {
  const all = readSessions(pid);
  if (all.length < 2) return { ok: false, code: 'INSUFFICIENT_DATA', count: all.length };
  const selected = range === 'all' ? all : all.slice(0, range === 7 ? 7 : 30);
  const delta = selected[0].accuracy - selected[1].accuracy;
  return { ok: true, delta: Math.round(delta * 10) / 10,
    direction: delta > 0 ? '上升' : delta < 0 ? '下降' : '持平',
    points: selected.slice().reverse().map(s => ({ id: s.id, finishedAt: s.finishedAt,
      label: `${dateStr(s.finishedAt)} ${new Date(s.finishedAt).toTimeString().slice(0, 5)}`, value: s.accuracy })) };
}
export function masteryByKP(pid) {
  const acc = new Map(), practiced = new Set();
  const add = (kpId, n, c) => {
    if (!getKnowledgePoint(kpId) || !Number.isInteger(n) || !Number.isInteger(c) || n < 0 || c < 0 || c > n) return;
    practiced.add(kpId);
    const old = acc.get(kpId) ?? { answered: 0, correct: 0 };
    old.answered += n; old.correct += c; acc.set(kpId, old);
  };
  for (const s of readSessions(pid)) {
    if (s.compressed) {
      const entries = Object.entries(s.kpAnswered ?? {});
      if (!entries.every(([kp, n]) => Number.isInteger(n) && n >= 0
          && Number.isInteger(s.kpCorrect?.[kp] ?? 0) && (s.kpCorrect?.[kp] ?? 0) >= 0 && (s.kpCorrect?.[kp] ?? 0) <= n)
          || entries.reduce((sum, [, n]) => sum + n, 0) > validCount(s)
          || entries.reduce((sum, [kp]) => sum + (s.kpCorrect?.[kp] ?? 0), 0) > s.correct) continue;
      for (const [kpId, n] of entries) {
        if (n <= s.total) add(kpId, n, s.kpCorrect?.[kpId] ?? 0);
      }
      continue;
    }
    const questions = new Map((s.paper?.questions ?? []).map(q => [q.id, q]));
    for (const q of questions.values()) if (getKnowledgePoint(q.kpId)) practiced.add(q.kpId);
    const seen = new Set();
    for (const a of s.detail ?? []) {
      const q = questions.get(a?.questionId);
      if (!q || seen.has(q.id) || a.skipped || typeof a.userAnswer !== 'string') continue;
      seen.add(q.id);
      const judged = judgeAnswer(q, a.userAnswer);
      if (!judged.skipped) add(q.kpId, 1, judged.correct ? 1 : 0);
    }
  }
  return [...practiced].map(kpId => {
    const e = acc.get(kpId) ?? { correct: 0, answered: 0 };
    const rate = e.answered ? e.correct / e.answered * 100 : null;
    return { kpId, name: getKnowledgePoint(kpId).name, ...e,
      mastery: rate === null ? null : Math.round(rate * 10) / 10,
      level: rate === null ? 'unpracticed' : rate >= 85 ? 'good' : rate >= 60 ? 'warn' : 'weak' };
  }).sort((a, b) => (a.mastery ?? 101) - (b.mastery ?? 101) || a.kpId.localeCompare(b.kpId));
}
function dailyActivity(pid) {
  const days = new Map();
  for (const s of readSessions(pid)) {
    if (validCount(s) > 0) {
      const day = dateStr(s.finishedAt);
      days.set(day, (days.get(day) ?? 0) + validCount(s));
    }
  }
  return days;
}
export function streakDays(pid, now = Date.now()) {
  const days = dailyActivity(pid), today = dateStr(now);
  let day = days.has(today) ? today : shiftDay(today, -1), streak = 0;
  while (days.has(day)) { streak++; day = shiftDay(day, -1); }
  return streak;
}
export function practiceSummary(pid) {
  const sessions = readSessions(pid).filter(s => validCount(s) > 0);
  return { days: dailyActivity(pid).size, sessions: sessions.length,
    totalQuestions: sessions.reduce((n, s) => n + validCount(s), 0),
    totalHours: Math.round(sessions.reduce((n, s) => n + s.elapsedMs, 0) / 36000) / 100,
    streak: streakDays(pid) };
}
export function activityCalendar(pid, now = Date.now()) {
  const counts = dailyActivity(pid), today = dateStr(now);
  return Array.from({ length: 56 }, (_, i) => {
    const date = shiftDay(today, i - 55);
    return { date, count: counts.get(date) ?? 0 };
  });
}
const RULES = [7, 30, 100];
function derivedAwards(pid) {
  const days = [...dailyActivity(pid).keys()].sort(), earned = new Map();
  let previous = null, streak = 0;
  for (const day of days) {
    streak = previous && shiftDay(previous, 1) === day ? streak + 1 : 1;
    for (const n of RULES) if (streak >= n && !earned.has(`d${n}`)) earned.set(`d${n}`, day);
    previous = day;
  }
  return earned;
}
function storedAwards(pid) {
  const data = read(`badges:${pid}`, null);
  const out = new Map();
  for (const a of Array.isArray(data?.items) ? data.items : []) {
    if (RULES.some(n => a?.id === `d${n}`) && typeof a.earnedAt === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(a.earnedAt) && dateStr(new Date(`${a.earnedAt}T12:00:00`)) === a.earnedAt) out.set(a.id, a.earnedAt);
  }
  return out;
}
export function badges(pid) {
  const earned = storedAwards(pid);
  for (const [id, date] of derivedAwards(pid)) if (!earned.has(id) || date < earned.get(id)) earned.set(id, date);
  return RULES.map(n => ({ id: `d${n}`, name: `连续 ${n} 天`, desc: `连续 ${n} 天至少完成一道有效作答`,
    earned: earned.has(`d${n}`), earnedAt: earned.get(`d${n}`) ?? null }));
}
/** 获得后保留日期，连续天数归零或记录压缩不会撤回徽章；最多三条。 */
export function updateAwards(pid) {
  const existing = storedAwards(pid), items = badges(pid).filter(b => b.earned).map(({ id, earnedAt }) => ({ id, earnedAt }));
  if (items.every(a => existing.get(a.id) === a.earnedAt)) return true;
  return write(`badges:${pid}`, { version: 1, items });
}
