/** 每题五道变式；大批量明确分卷，有限题库按实际数量继续。 */
import { generatePaper, dedupeKey } from './generator.js';
import { readStore } from './mistakes.js';
import { read } from '../core/storage.js';
import { makeId } from '../utils/random.js';
import { calculatePaperStats } from './paper.js';
import { getKnowledgePoint } from './syllabus.js';

export function buildVariantPaper(pid, ids, { excludeKeys = [], seed } = {}) {
  const store = readStore(pid), wanted = [...new Set(ids ?? [])];
  if (store.error) return { ok: false, code: store.error };
  if (!wanted.length) return { ok: false, code: 'NO_MISTAKES' };
  const byId = new Map(store.items.map(m => [m.id, m]));
  if (wanted.some(id => !byId.get(id)?.question)) return { ok: false, code: 'STALE_SELECTION' };
  const batch = wanted.slice(0, 20).map(id => byId.get(id)), remainingIds = wanted.slice(20);
  const excluded = new Set(excludeKeys);
  const sessions = read(`sessions:${pid}`, []);
  const source = new Map((Array.isArray(sessions) ? sessions : []).filter(s => s && typeof s.id === 'string').map(s => [s.id, s]));
  for (const m of batch) {
    excluded.add(dedupeKey(m.question, true));
    for (const key of m.sourcePaperKeys) excluded.add(key);
    for (const sid of m.sourceSessions) {
      for (const q of source.get(sid)?.paper?.questions ?? []) if (q?.kpId) excluded.add(dedupeKey(q, true));
    }
  }
  const questions = [];
  for (const [i, m] of batch.entries()) {
    try {
      const generated = generatePaper({ kpIds: [m.kpId], count: 5, types: [m.question.type],
        difficulty: 'normal', excludeKeys: excluded, seed: seed == null ? undefined : seed + i });
      for (const q of generated.questions) {
        const key = dedupeKey(q, true), delta = q.difficulty - (m.question.difficulty ?? getKnowledgePoint(m.kpId).difficulty);
        if (excluded.has(key) || !Number.isFinite(delta) || Math.abs(delta) > 1) continue;
        excluded.add(key);
        questions.push({ ...q, id: `q${questions.length + 1}`,
          ...(delta ? { difficultyNote: delta > 0 ? '难度略高' : '难度略低' } : {}) });
      }
    } catch (e) {
      if (!['GENERATION_EXHAUSTED', 'UNSUPPORTED_COMBINATION'].includes(e.code)) return { ok: false, code: e.code ?? 'GENERATION_FAILED' };
    }
  }
  if (!questions.length) return { ok: false, code: 'NO_VARIANTS', remainingIds };
  const requested = batch.length * 5, shortfall = requested - questions.length;
  return { ok: true, requested, shortfall, remainingIds, totalRequested: wanted.length * 5,
    paper: { id: makeId('p'), questions, stats: calculatePaperStats(questions),
      options: { kpIds: [...new Set(questions.map(q => q.kpId))], types: [...new Set(questions.map(q => q.type))],
        count: questions.length, requested, difficulty: 'normal' },
      shortfall, createdAt: Date.now(), variant: true, sourceMistakeIds: batch.map(m => m.id),
      variantRemainingIds: remainingIds, variantPreviousKeys: [...new Set(excludeKeys)].slice(-100) } };
}
