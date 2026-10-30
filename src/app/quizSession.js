import { read, write, remove, isAvailable } from '../core/storage.js';
import { validatePaper, validateActiveSession } from '../core/schema.js';
import { getActiveProfile } from '../domain/profile.js';
import { judgeAnswer, settleSession } from '../domain/grader.js';
import { makeId } from '../utils/random.js';
import { getKnowledgePoint } from '../domain/syllabus.js';
import { archiveSession } from '../domain/mistakes.js';
import { updateAwards } from '../domain/stats.js';

const volatile = new Map();
const copy = (v) => JSON.parse(JSON.stringify(v));
const activeKey = (id) => `quiz:active:${id}`;
let lastSaved = true;

export function savedDurably() { return lastSaved && isAvailable(); }

function persist(s) {
  s.savedAt = Date.now();
  volatile.set(activeKey(s.profileId), copy(s));
  lastSaved = write(activeKey(s.profileId), s);
  return s;
}

export function resumeSession() {
  const pid = getActiveProfile()?.id;
  if (!pid) return null;
  const s = volatile.has(activeKey(pid)) ? volatile.get(activeKey(pid)) : read(activeKey(pid), null);
  if (!s) return null;
  if (!validateActiveSession(s, pid, Date.now(), getKnowledgePoint)) {
    remove(activeKey(pid));
    volatile.delete(activeKey(pid));
    return null;
  }
  // 存储中的 correct 标记不能作为判分依据，恢复时重新计算。
  for (const q of s.paper.questions) {
    for (const records of [s.attempts, s.retries]) {
      const a = records[q.id];
      if (a) Object.assign(a, judgeAnswer(q, a.skipped ? '' : a.userAnswer));
    }
  }
  return copy(s);
}

export function createSession(paper, { limitMs = null } = {}) {
  const pid = getActiveProfile()?.id;
  if (!pid || !validatePaper(paper, getKnowledgePoint)) throw new Error('试卷无效，请重新出题。');
  if (resumeSession()) throw new Error('请先继续或放弃上次练习。');
  if (limitMs !== null && (!Number.isInteger(limitMs) || limitMs < 60000 || limitMs > 3600000)) {
    throw new Error('倒计时须为 1～60 分钟。');
  }
  const now = Date.now();
  return copy(persist({ schemaVersion: 1, id: makeId('s'), profileId: pid,
    mode: paper.retry ? 'retry' : paper.variant ? 'variant' : 'practice', paper: copy(paper), attempts: {}, retries: {}, cursor: 0,
    startAt: now, questionAt: now, savedAt: now, limitMs, draft: '' }));
}

export function discardSession() {
  const pid = getActiveProfile()?.id;
  if (!pid) return;
  remove(activeKey(pid));
  volatile.delete(activeKey(pid));
}

function required() {
  const s = resumeSession();
  if (!s) throw new Error('没有进行中的练习，请返回出题台。');
  return s;
}

export function elapsedMs(s, now = Date.now()) { return Math.max(0, now - s.startAt); }
export function expired(s) { return s.limitMs !== null && elapsedMs(s) >= s.limitMs; }

export function saveDraft(answer) {
  const s = required();
  s.draft = String(answer).slice(0, 40);
  persist(s);
}

export function recordAttempt(raw, { retry = false, skip = false } = {}) {
  const s = required();
  if (expired(s)) return { timedOut: true };
  const q = s.paper.questions[s.cursor];
  const previous = s.attempts[q.id];
  if (retry && (!previous || previous.correct || previous.skipped || s.retries[q.id])) {
    throw new Error('本题已完成重试。');
  }
  if (!retry && previous) throw new Error('本题已经提交。');
  const answer = skip ? '' : String(raw).trim();
  if (answer.length > 40) throw new Error('答案最多 40 个字符。');
  if (answer && !(q.kind === 'sign' ? /^[<>＝=＞＜﹤﹥]$/.test(answer)
    : q.kind === 'fraction' ? /^-?\d+(?:\s*\/\s*[1-9]\d*)?$/.test(answer)
      : /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(answer) || /^\d+\s*余\s*\d+$/.test(answer))) {
    throw new Error(q.kind === 'fraction' ? '请填写整数或分数（例如 1/2），分母不能为 0。'
      : q.kind === 'sign' ? '请输入 <、> 或 =。' : '请填写数字；有余数时写成 9余2。');
  }
  const judgment = judgeAnswer(q, answer);
  const a = { userAnswer: answer, ...judgment, first: !retry,
    elapsedMs: skip || judgment.skipped ? 0 : Math.max(0, Date.now() - s.questionAt) };
  (retry ? s.retries : s.attempts)[q.id] = a;
  s.draft = '';
  persist(s);
  return a;
}

export function advance() {
  const s = required();
  if (!s.attempts[s.paper.questions[s.cursor].id]) throw new Error('请先提交或跳过本题。');
  if (s.cursor === s.paper.questions.length - 1) return finishSession();
  s.cursor++;
  s.questionAt = Date.now();
  s.draft = '';
  persist(s);
  return null;
}

export function getLastResult() {
  const pid = getActiveProfile()?.id;
  return pid ? volatile.get(`result:${pid}`) ?? read(`quiz:result:${pid}`, null) : null;
}

export function finishSession(reason = 'completed') {
  const s = resumeSession();
  if (!s) return getLastResult();
  const answered = Object.values(s.attempts).filter(a => !a.skipped).length;
  // 主动退出且零作答不产生成绩；超时仍展示全卷的未作答情况。
  if (!answered && reason === 'exit') { discardSession(); return null; }
  const result = { ...settleSession(s.paper, s.attempts, elapsedMs(s)),
    id: s.id, profileId: s.profileId, mode: s.mode, answered, reason, compressed: false };
  const key = `sessions:${s.profileId}`;
  const stored = read(key, []);
  const records = Array.isArray(stored) ? stored.filter(r => r.id !== s.id) : [];
  records.unshift(result);
  // 第 501 条起保留统计摘要；历史页在后续步骤实现。
  const retained = records.slice(0, 2500).map((r, i) => {
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
  const recordSaved = write(key, retained);
  // 成绩先保存为恢复来源；错题写入失败可在成绩页/错题本回补，不回滚或重复追加成绩。
  const archive = recordSaved ? archiveSession(result) : { ok: false, code: 'HISTORY_NOT_SAVED' };
  result.mistakesSaved = archive.ok;
  result.mistakeError = archive.ok ? null : archive.code;
  result.awardsSaved = recordSaved ? updateAwards(s.profileId) : false;
  result.saved = recordSaved && isAvailable();
  volatile.set(`result:${s.profileId}`, result);
  const resultSaved = write(`quiz:result:${s.profileId}`, result);
  result.saved = result.saved && resultSaved;
  if (recordSaved && resultSaved) discardSession();
  else volatile.set(activeKey(s.profileId), null); // 保留磁盘恢复点，当前页面仍可查看结果。
  return result;
}
