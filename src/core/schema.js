const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const time = (v) => Number.isSafeInteger(v) && v >= 0;
const text = (v, max = 200) => typeof v === 'string' && v.length <= max;

/** 恢复前验证结构；不执行存储中的任何表达式或 HTML。 */
export function validatePaper(paper, isKnownPoint) {
  if (!object(paper) || !text(paper.id) || !Array.isArray(paper.questions)
      || paper.questions.length < 1 || paper.questions.length > 100) return false;
  const ids = new Set();
  return paper.questions.every((q) => {
    if (!object(q) || !text(q.id) || !q.id || ids.has(q.id)
        || !isKnownPoint(q.kpId) || !text(q.text, 500) || !text(q.answer, 40)
        || !q.answer.trim() || !['int', 'decimal', 'fraction', 'sign'].includes(q.kind)
        || !['horizontal', 'vertical', 'fill', 'chain', 'compare'].includes(q.type)) return false;
    ids.add(q.id);
    return true;
  });
}

export function validateActiveSession(s, profileId, now, isKnownPoint) {
  if (!object(s) || s.schemaVersion !== 1 || !text(s.id) || !s.id
      || s.profileId !== profileId || s.mode !== 'practice' || !validatePaper(s.paper, isKnownPoint)
      || !time(s.startAt) || !time(s.savedAt) || s.startAt > s.savedAt || s.savedAt > now
      || now - s.savedAt > 86400000 || !time(s.questionAt) || s.questionAt > s.savedAt
      || s.questionAt < s.startAt || !Number.isInteger(s.cursor) || s.cursor < 0
      || s.cursor >= s.paper.questions.length || !text(s.draft, 40)
      || !(s.limitMs === null || (Number.isInteger(s.limitMs) && s.limitMs >= 60000 && s.limitMs <= 3600000))
      || !object(s.attempts) || !object(s.retries)) return false;
  const ids = new Set(s.paper.questions.map(q => q.id));
  const validAttempt = (a, first) => object(a) && text(a.userAnswer, 40)
    && typeof a.correct === 'boolean' && typeof a.skipped === 'boolean'
    && !(a.correct && a.skipped) && time(a.elapsedMs) && a.first === first;
  if (!Object.entries(s.attempts).every(([id, a]) => ids.has(id) && validAttempt(a, true))) return false;
  if (!Object.entries(s.retries).every(([id, a]) => ids.has(id) && validAttempt(a, false)
    && s.attempts[id] && !s.attempts[id].correct && !s.attempts[id].skipped)) return false;
  // 已完成题目必须连续，最多包含当前题的反馈；不能伪造未来题目的记录。
  return s.paper.questions.every((q, i) => i < s.cursor ? !!s.attempts[q.id]
    : i > s.cursor ? !s.attempts[q.id] : true);
}
