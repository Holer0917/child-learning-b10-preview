/**
 * 判分服务
 *
 * 判分的核心难点不在"比较字符串"，而在**答案的规范化**：
 *   624 / 624.0 / 0624 / " 624 "  → 都应判为正确
 *   2/4 / 1/2                     → 都应判为正确
 *   0.50 / 0.5 / .5               → 都应判为正确
 *
 * 规范化逻辑集中在 utils/format.js 的 normalizeAnswer()，
 * 本模块只负责"取答案 → 规范化 → 比较 → 结算"这条链路。
 */

import { normalizeAnswer } from '../utils/format.js';
import { makeId } from '../utils/random.js';

/**
 * 单题判分
 * @param {Question} question
 * @param {string}   rawAnswer 用户输入的原始字符串
 * @returns {{correct:boolean, skipped:boolean, expected:string}}
 */
export function judgeAnswer(question, rawAnswer) {
  if (!question || question.answer == null) {
    console.error('[grader] 题目缺少标准答案：', question);
    return { correct: false, skipped: true, expected: '' };
  }

  const kind = question.kind ?? 'int';
  const expected = normalizeAnswer(question.answer, kind);

  const raw = rawAnswer == null ? '' : String(rawAnswer).trim();
  if (raw === '') return { correct: false, skipped: true, expected };

  // 用户写对但格式不规范（如 624.0 / 0624）也算对 —— 这符合家长的实际预期
  const user = normalizeAnswer(raw, kind);
  if (user === '') return { correct: false, skipped: false, expected };

  return { correct: user === expected || looseEqual(user, expected),
           skipped: false, expected };
}

/**
 * 容错判分：在严格判分的基础上，额外接受"与标准答案数值相等"的写法。
 *
 * 例：整数题答 "624.0"、小数题答 "3"（标准答案 "3.0"）均判为正确。
 * 这对一年级孩子尤其重要 —— 他们不该因为书写格式而丢分。
 */
function looseEqual(user, expected) {
  const a = Number(user);
  const b = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 1e-9;
}

/**
 * 整卷结算
 * @param {Paper}  paper
 * @param {Object} attempts  { [questionId]: {userAnswer, correct, skipped, elapsedMs} }
 * @param {number} elapsedMs 总用时
 * @returns {SessionResult}
 */
export function settleSession(paper, attempts = {}, elapsedMs = 0) {
  const questions = paper?.questions ?? [];

  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  const wrongList = [];
  const detail = [];

  for (const q of questions) {
    const at = attempts[q.id];

    if (!at || at.skipped) {
      skipped++;
      detail.push({ questionId: q.id, kpId: q.kpId, userAnswer: '',
                    correct: false, skipped: true, elapsedMs: at?.elapsedMs ?? 0 });
      continue;
    }

    if (at.correct) {
      correct++;
    } else {
      wrong++;
      wrongList.push({
        question: q,
        userAnswer: at.userAnswer,
        expected: normalizeAnswer(q.answer, q.kind ?? 'int')
      });
    }

    detail.push({
      questionId: q.id, kpId: q.kpId,
      userAnswer: at.userAnswer, correct: !!at.correct,
      skipped: false, elapsedMs: at.elapsedMs ?? 0
    });
  }

  const total = questions.length;
  // 正确率保留一位小数；跳过不计入分子，但计入分母（跳过 = 没做对）
  const accuracy = total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;

  return {
    id: makeId('s'),
    paperId: paper?.id ?? '',
    paper,                                   // 保存整卷，供历史详情与错题重练使用
    total, correct, wrong, skipped,
    accuracy,
    grade: gradeOf(total === 0 ? 0 : correct / total * 100),
    elapsedMs,
    avgMs: total === skipped ? null : Math.round(
      detail.reduce((sum, a) => sum + (a.skipped ? 0 : a.elapsedMs), 0) / (total - skipped)),
    wrongList,
    detail,
    finishedAt: Date.now()
  };
}

/**
 * 正确率 → 评价等级。
 * 分界值 95% / 80% 与需求评审问题 P-07 的结论一致。
 */
export function gradeOf(accuracy) {
  if (accuracy >= 95) return { key: 'excellent', label: '优秀', tip: '太棒了，几乎全对！' };
  if (accuracy >= 80) return { key: 'good',      label: '良好', tip: '做得不错，再接再厉！' };
  if (accuracy >= 60) return { key: 'fair',      label: '加油', tip: '有进步空间，把错题再练一遍吧。' };
  return { key: 'poor', label: '加油', tip: '别灰心，先把错题弄懂，明天再来一次。' };
}

/**
 * 重练结算：把错题卷的作答结果回写到错题本所需的形态
 * @param {Question[]} questions 重练用的题目
 * @param {Object} attempts
 */
export function settleRetry(questions, attempts = {}) {
  const results = questions.map((q) => {
    const at = attempts[q.id] ?? { userAnswer: '', skipped: true };
    const judged = at.skipped ? { correct: false, skipped: true }
                              : judgeAnswer(q, at.userAnswer);
    return {
      question: q,
      userAnswer: at.userAnswer ?? '',
      correct: judged.correct,
      skipped: judged.skipped
    };
  });

  const right = results.filter((r) => r.correct).length;
  return {
    results,
    correct: right,
    total: questions.length,
    accuracy: questions.length === 0
      ? 0
      : Math.round((right / questions.length) * 1000) / 10
  };
}

/** 是否应计入"作答题数"（跳过不计入统计分母，对应 FR-23 的口径说明） */
export function countsForMastery(attempt) {
  return !!attempt && !attempt.skipped;
}
