export const DIFFICULTY_RULES = Object.freeze({
  easy: Object.freeze({ star: 1, percent: 70, name: '简单' }),
  hard: Object.freeze({ star: 3, percent: 50, name: '挑战' })
});

/** 从当前题目计算预览统计；生成、预览和后续调整共用同一口径。 */
export function calculatePaperStats(questions = []) {
  const counts = new Map();
  let starSum = 0;
  for (const question of questions) {
    counts.set(question.kpId, (counts.get(question.kpId) ?? 0) + 1);
    starSum += question.difficulty;
  }
  return {
    total: questions.length,
    avgStar: questions.length ? Math.round(starSum * 10 / questions.length) / 10 : 0,
    dist: Object.fromEntries(counts)
  };
}

/** 预览中删除题目：保留剩余题目的稳定 ID，显示题号由列表重新排列。 */
export function removePaperQuestion(paper, questionId) {
  const questions = paper.questions.filter(question => question.id !== questionId);
  if (questions.length === paper.questions.length) return paper;
  const requested = paper.options?.requested ?? paper.options?.count ?? paper.questions.length;
  return {
    ...paper,
    questions,
    stats: calculatePaperStats(questions),
    options: { ...paper.options, requested, count: questions.length },
    removedCount: (paper.removedCount ?? 0) + paper.questions.length - questions.length,
    shortfall: Math.max(0, requested - questions.length)
  };
}

/** 编辑草稿也要遵守生成档位的星级约束；空卷不能进入正式会话。 */
export function checkPaperReadiness(paper) {
  const questions = paper.questions;
  if (!questions.length) return { ok: false, code: 'EMPTY_PAPER',
    message: '当前没有题目，请重新生成后再开始答题。' };
  const rule = DIFFICULTY_RULES[paper.options?.difficulty];
  if (rule) {
    const target = questions.filter(question => question.difficulty === rule.star).length;
    const minimum = Math.ceil(questions.length * rule.percent / 100);
    if (target < minimum) return { ok: false, code: 'DIFFICULTY_RATIO',
      message: `调整后${rule.name}档需至少 ${minimum} 道 ${rule.star} 星题，当前只有 ${target} 道。请删除其他星级题，或重新生成。` };
  }
  return { ok: true };
}
