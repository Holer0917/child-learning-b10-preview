/** 页面共用的重练/变式入口，不另建判分流程。 */
import { getActiveProfile } from '../domain/profile.js';
import { buildRetryPaper } from '../domain/mistakes.js';
import { buildVariantPaper } from '../domain/variants.js';
import { createSession, resumeSession } from './quizSession.js';
import { go } from '../core/router.js';

export const mistakeErrorText = code => ({
  NO_QUESTIONS: '没有可重练的题目，请重新选择。', NO_MISTAKES: '请先选择错题。',
  STALE_SELECTION: '部分错题已变化或被清理，请返回错题本重新选择。',
  TOO_MANY: '重练每次最多 100 题，请分批选择。',
  CAPACITY_LIMIT: '错题本已达到 500 道，请先备份并清理已攻克错题，再重试归档。',
  WRITE_FAILED: '错题保存失败，成绩仍保留，请检查浏览器空间后重试。',
  INVALID_STORE: '错题数据格式异常，原数据未被覆盖，请先备份并检查。',
  NO_VARIANTS: '没有剩余的同类新题，请回到错题本重练原题。',
  UNFINISHED: '还有未完成的练习，请先继续或放弃该练习。',
  CANCELLED: '已取消，原练习记录保持不变。'
}[code] ?? '操作暂未完成，请重试。');

export function startMistakePractice(ids, { kind = 'retry', excludeKeys = [], seed } = {}, confirm = message => window.confirm(message)) {
  const pid = getActiveProfile()?.id;
  if (!pid) return { ok: false, code: 'NO_MISTAKES' };
  if (resumeSession()) return { ok: false, code: 'UNFINISHED' };
  const result = kind === 'variant' ? buildVariantPaper(pid, ids, { excludeKeys, seed }) : buildRetryPaper(pid, ids);
  if (kind === 'variant' && result.code === 'NO_VARIANTS' && result.remainingIds?.length) {
    if (!confirm(`本批原错题已没有可用的同类新题；还有 ${result.remainingIds.length} 道原错题待处理。继续下一批吗？`)) return { ok: false, code: 'CANCELLED' };
    return startMistakePractice(result.remainingIds, { kind, excludeKeys, seed }, confirm);
  }
  if (!result.ok) return result;
  if (kind === 'variant' && (result.shortfall || result.remainingIds.length)) {
    const message = `${result.remainingIds.length ? `所选错题分 ${Math.ceil(ids.length / 20)} 批练习，本批计划 ${result.requested} 道，剩余 ${result.remainingIds.length} 道原错题将在后续批次练习。\n` : ''}`
      + `本批实际生成 ${result.paper.questions.length} 道变式题${result.shortfall ? `（比计划少 ${result.shortfall} 道）` : ''}。继续答题吗？`;
    if (!confirm(message)) return { ok: false, code: 'CANCELLED' };
  }
  try { createSession(result.paper); go('/quiz?start=1'); return { ok: true }; }
  catch (e) { return { ok: false, code: 'START_FAILED', message: e.message }; }
}
