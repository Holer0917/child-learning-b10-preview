/** 错题存储 V2；归档与重练回写在同一键内完成，失败不写入半份结果。 */
import { read, write } from '../core/storage.js';
import { bus } from '../core/bus.js';
import { makeId } from '../utils/random.js';
import { dedupeKey } from './generator.js';
import { judgeAnswer } from './grader.js';
import { validatePaper } from '../core/schema.js';
import { getKnowledgePoint } from './syllabus.js';
import { listHistory } from './history.js';
import { calculatePaperStats } from './paper.js';

export const RETRY_MIN = 1, RETRY_MAX = 100, MAX_MISTAKES = 500;
const MAX_ARCHIVED = 2500; // 与已保留练习记录窗口一致；清理错题不清除此索引。
const keyOf = pid => `mistakes:${pid}`;
const clone = v => JSON.parse(JSON.stringify(v));
const strings = (v, max) => [...new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])].slice(-max);
const empty = () => ({ version: 2, archivedSessions: [], items: [], invalidCount: 0 });
const number = v => Number.isFinite(Number(v)) ? String(Number(v)) : String(v ?? '');
const operand = v => (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v))) && Number.isFinite(Number(v));
const validQuestion = q => validatePaper({ id: 'check', questions: [q] }, getKnowledgePoint)
  && q.params && typeof q.params === 'object' && !Array.isArray(q.params)
  && [q.params.a, q.params.b].every(operand)
  && (q.params.denom == null ? q.kind !== 'fraction' : Number.isInteger(q.params.denom) && q.params.denom > 0)
  && (q.op !== 'mix' || (Number.isFinite(q.params.c) && ['+', '-', '×', '÷', '*', '/'].includes(q.params.op1)
    && ['+', '-', '×', '÷', '*', '/'].includes(q.params.op2)))
  && ['add', 'sub', 'mul', 'div', 'mix', 'compare'].includes(q.op);

/** 错题键保留题型、空位和比较目标；卷内生成器的旧键/签名保持不变。 */
export function mistakeKeyOf(q) {
  const p = q.params ?? {};
  let values;
  if (q.op === 'mix') values = [p.a, p.b, p.c].map(number).concat([p.op1, p.op2, !!p.paren]);
  else if (p.denom) {
    const fraction = n => {
      let a = Math.abs(Number(n)), b = Math.abs(Number(p.denom));
      while (b) [a, b] = [b, a % b];
      return `${Number(n) / (a || 1)}/${Number(p.denom) / (a || 1)}`;
    };
    values = [fraction(p.a), fraction(p.b)];
  } else values = [number(p.a), number(p.b)];
  if (q.type === 'horizontal' && ['add', 'mul'].includes(q.op)) values.sort();
  return JSON.stringify([q.kpId, q.type, q.op, values,
    q.type === 'fill' ? p.hide ?? q.hide ?? 'result' : null,
    q.type === 'compare' ? number(p.compareTo ?? q.compareTo ?? '') : null]);
}

export function createMistakeRecord(q, answer, now = Date.now(), sessionId = null, sourceKeys = []) {
  return { id: makeId('m'), key: mistakeKeyOf(q), kpId: q.kpId, type: q.type,
    text: q.text, answer: q.answer, userAnswer: String(answer), firstUserAnswer: String(answer),
    params: clone(q.params), kind: q.kind, op: q.op, question: clone(q),
    sourceSessions: sessionId ? [sessionId] : [], sourcePaperKeys: strings(sourceKeys, 100),
    wrongCount: 1, mastered: false, firstWrongAt: now, lastWrongAt: now };
}

/** V1 在内存中规范化，业务成功写入才升级；不伪造已丢失的首次错误答案。 */
export function readStore(pid) {
  const raw = read(keyOf(pid), null);
  if (raw == null) return empty();
  const rows = Array.isArray(raw) ? raw : raw?.items;
  if (!Array.isArray(rows) || ![1, 2].includes(raw.version ?? 1)) return { ...empty(), error: 'INVALID_STORE' };
  const store = { ...empty(), archivedSessions: strings(raw.archivedSessions, MAX_ARCHIVED) };
  const seen = new Set();
  for (const m of rows) {
    if (!m || typeof m.id !== 'string' || !m.id || seen.has(m.id)
        || !getKnowledgePoint(m.kpId) || typeof m.text !== 'string' || typeof m.answer !== 'string'
        || !Number.isInteger(m.wrongCount) || m.wrongCount < 1
        || typeof m.mastered !== 'boolean'
        || !Number.isSafeInteger(m.firstWrongAt) || m.firstWrongAt < 0 || !Number.isFinite(new Date(m.firstWrongAt).getTime())
        || !Number.isSafeInteger(m.lastWrongAt) || m.lastWrongAt < 0 || !Number.isFinite(new Date(m.lastWrongAt).getTime())
        || (m.question && !validQuestion(m.question))) { store.invalidCount++; continue; }
    seen.add(m.id);
    store.items.push({ ...m, key: m.question ? mistakeKeyOf(m.question) : String(m.key),
      mastered: !!m.mastered, sourceSessions: strings(m.sourceSessions, 10),
      sourcePaperKeys: strings(m.sourcePaperKeys, 100) });
  }
  if (store.invalidCount) store.error = 'INVALID_STORE';
  return store;
}
function save(pid, store) {
  const { error, invalidCount, ...data } = store;
  return write(keyOf(pid), data);
}

/** 以首次作答原始答案重新判分，不把跳过当错题。 */
function submissions(record) {
  if (!record || typeof record.id !== 'string' || !record.id || typeof record.profileId !== 'string'
      || !record.profileId || !Number.isSafeInteger(record.finishedAt)
      || !validatePaper(record.paper, getKnowledgePoint) || !record.paper.questions.every(validQuestion)) return null;
  const rows = Array.isArray(record.detail) ? record.detail : record.wrongList?.map(w => ({
    questionId: w?.question?.id, userAnswer: w?.userAnswer, skipped: false }));
  if (!Array.isArray(rows)) return null;
  const byId = new Map(record.paper.questions.map(q => [q.id, q])), seen = new Set(), out = [];
  for (const a of rows) {
    if (!a || a.skipped) continue;
    const id = a.questionId ?? a.id ?? a.qid, q = byId.get(id);
    if (!q || seen.has(id) || typeof a.userAnswer !== 'string' || a.userAnswer.length > 40) return null;
    seen.add(id);
    const judgment = judgeAnswer(q, a.userAnswer);
    if (!judgment.skipped) out.push({ q, answer: a.userAnswer, ...judgment });
  }
  return out;
}
export function archiveSession(record) {
  const answers = submissions(record);
  if (!answers) return { ok: false, code: 'INVALID_RECORD', archivedCount: 0 };
  const pid = record.profileId, store = readStore(pid);
  if (store.error) return { ok: false, code: store.error, archivedCount: 0 };
  if (store.archivedSessions.includes(record.id)) return { ok: true, archivedCount: 0, duplicate: true };
  const sourceKeys = record.paper.questions.map(q => dedupeKey(q, true));
  const retryIds = new Set(record.paper.retry ? record.paper.sourceMistakeIds ?? [] : []);
  let archivedCount = 0, masteredCount = 0;
  for (const a of answers) {
    const key = mistakeKeyOf(a.q), existing = store.items.find(m => m.key === key);
    if (a.correct) {
      if (existing && retryIds.has(existing.id) && !existing.mastered && record.finishedAt >= existing.lastWrongAt) {
        existing.mastered = true; existing.masteredAt = record.finishedAt; masteredCount++;
      }
      continue;
    }
    if (existing) {
      existing.wrongCount++;
      if (record.finishedAt < existing.firstWrongAt) {
        existing.firstWrongAt = record.finishedAt; existing.firstUserAnswer = a.answer;
        existing.sourcePaperKeys = strings(sourceKeys, 100);
      }
      if (record.finishedAt >= existing.lastWrongAt) {
        existing.userAnswer = a.answer; existing.lastWrongAt = record.finishedAt;
      }
      // 旧成绩回补只能增加历史次数，不能把较新的攻克状态覆盖掉。
      if (record.finishedAt >= (existing.masteredAt ?? 0)) {
        existing.mastered = false; delete existing.masteredAt;
      }
      existing.sourceSessions = strings([...existing.sourceSessions, record.id], 10);
      if (!existing.sourcePaperKeys.length) existing.sourcePaperKeys = strings(sourceKeys, 100);
    } else {
      if (store.items.length >= MAX_MISTAKES) return { ok: false, code: 'CAPACITY_LIMIT', archivedCount: 0 };
      store.items.push(createMistakeRecord(a.q, a.answer, record.finishedAt, record.id, sourceKeys));
    }
    archivedCount++;
  }
  store.archivedSessions = strings([...store.archivedSessions, record.id], MAX_ARCHIVED);
  if (!save(pid, store)) return { ok: false, code: 'WRITE_FAILED', archivedCount: 0 };
  bus.emit('mistakes:changed', { profileId: pid, sessionId: record.id, archivedCount, masteredCount });
  return { ok: true, archivedCount, masteredCount };
}

/** 仅回补已保留的完整成绩；失败即停，下一次可重试。 */
export function syncMistakes(pid) {
  const store = readStore(pid);
  if (store.error) return { ok: false, code: store.error };
  const done = new Set(store.archivedSessions);
  for (const record of listHistory(pid).slice().reverse()) {
    if (record.compressed || done.has(record.id)) continue;
    const result = archiveSession({ ...record, profileId: pid });
    if (!result.ok) return result;
  }
  return { ok: true };
}
export function listMistakes(pid, { kpId, status } = {}) {
  return readStore(pid).items.filter(m => (!kpId || m.kpId === kpId)
    && (!status || status === 'all' || (status === 'pending' ? !m.mastered : m.mastered)))
    .sort((a, b) => b.lastWrongAt - a.lastWrongAt || a.id.localeCompare(b.id));
}
export function countMistakes(pid) {
  const items = readStore(pid).items, mastered = items.filter(m => m.mastered).length;
  return { pending: items.length - mastered, mastered, total: items.length };
}
export function hasArchivedSession(pid, id) { return readStore(pid).archivedSessions.includes(id); }
export function buildRetryPaper(pid, ids) {
  const store = readStore(pid), wanted = new Set(ids ?? []);
  if (store.error) return { ok: false, code: store.error };
  const picked = store.items.filter(m => wanted.has(m.id) && m.question);
  if (!picked.length) return { ok: false, code: 'NO_QUESTIONS' };
  if (picked.length !== wanted.size) return { ok: false, code: 'STALE_SELECTION' };
  if (picked.length > RETRY_MAX) return { ok: false, code: 'TOO_MANY' };
  const questions = picked.map((m, i) => ({ ...clone(m.question), id: `q${i + 1}` }));
  return { ok: true, paper: { id: makeId('p'), questions, stats: calculatePaperStats(questions),
    options: { kpIds: [...new Set(questions.map(q => q.kpId))], count: questions.length,
      requested: questions.length, difficulty: 'normal', types: [...new Set(questions.map(q => q.type))] },
    shortfall: 0, createdAt: Date.now(), retry: true, sourceMistakeIds: picked.map(m => m.id) } };
}
function setMastered(pid, id, mastered) {
  const store = readStore(pid);
  if (store.error) return { ok: false, code: store.error };
  const m = store.items.find(x => x.id === id);
  if (!m) return { ok: false, code: 'NOT_FOUND' };
  if (m.mastered === mastered) return { ok: true, changed: false };
  m.mastered = mastered;
  if (mastered) m.masteredAt = Date.now(); else delete m.masteredAt;
  if (!save(pid, store)) return { ok: false, code: 'WRITE_FAILED' };
  bus.emit('mistakes:changed', { profileId: pid });
  return { ok: true, changed: true };
}
export const markMastered = (pid, id) => setMastered(pid, id, true);
export const unmarkMastered = (pid, id) => setMastered(pid, id, false);
export function clearMastered(pid) {
  const store = readStore(pid);
  if (store.error) return { ok: false, code: store.error };
  const before = store.items.length;
  store.items = store.items.filter(m => !m.mastered);
  const removed = before - store.items.length;
  if (removed && !save(pid, store)) return { ok: false, code: 'WRITE_FAILED' };
  if (removed) bus.emit('mistakes:changed', { profileId: pid });
  return { ok: true, removed };
}
