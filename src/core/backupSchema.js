import { validatePaper, validateActiveSession } from './schema.js';
import { getKnowledgePoint } from '../domain/syllabus.js';
import { judgeAnswer } from '../domain/grader.js';
import { dateStr } from '../utils/date.js';

const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
const txt = (v, n = 500) => typeof v === 'string' && v.length <= n;
const count = (v, max = 100) => Number.isInteger(v) && v >= 0 && v <= max;
const time = v => Number.isSafeInteger(v) && v >= 0 && Number.isFinite(new Date(v).getTime());
const known = v => !!getKnowledgePoint(v);
const operand = v => (typeof v === 'number' || typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v)) && Number.isFinite(Number(v));
const strings = (v, max, length = 500) => Array.isArray(v) && v.length <= max && v.every(s => txt(s, length) && s.length > 0) && new Set(v).size === v.length;
const validDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dateStr(new Date(v + 'T12:00:00')) === v;
const avatars = ['🦊', '🐼', '🐯', '🐰', '🐨', '🐸', '🦁', '🐧', '🐢', '🦄'];

/** 纯校验/规范化，不接触存储。错误路径与文件结构相对应。 */
export function inspectBackupPayload(input) {
  const errors = [], warnings = [], fail = (path, message) => errors.push({ path, message });
  let p;
  try {
    const json = JSON.stringify(input);
    if (new TextEncoder().encode(json).length > 5 * 1024 * 1024) throw new Error('文件超过 5MB。');
    p = JSON.parse(json);
    const stack = [[p, 0]];
    while (stack.length) {
      const [v, depth] = stack.pop();
      if (depth > 30) throw new Error('嵌套层数过多。');
      if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) {
        if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('包含不支持的对象字段。');
        stack.push([child, depth + 1]);
      }
    }
  } catch (e) { return { ok: false, errors: [{ path: '$', message: e.message }], warnings }; }
  if (!obj(p)) return { ok: false, errors: [{ path: '$', message: '备份必须是 JSON 对象。' }], warnings };
  if (p.app === 'kidsmath' && p.version === 1) {
    p.format = 'kidsmath-backup'; p.version = '1.0';
    if (time(p.exportedAt)) p.exportedAt = new Date(p.exportedAt).toISOString();
    warnings.push('已兼容转换早期 C 测试版备份。');
  }
  if (p.format !== 'kidsmath-backup') fail('$.format', '不是口算小达人的备份文件。');
  if (p.version !== '1.0') fail('$.version', '仅支持版本 1.0；新版本请升级后再导入。');
  if (typeof p.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(p.exportedAt) || !Number.isFinite(Date.parse(p.exportedAt))) fail('$.exportedAt', '导出时间必须是 ISO 日期时间。');
  if (!Array.isArray(p.profiles) || p.profiles.length < 1 || p.profiles.length > 3) fail('$.profiles', '备份应包含 1～3 个档案。');
  if (!obj(p.data)) fail('$.data', '缺少档案数据对象。');
  if (errors.length) return { ok: false, errors, warnings };
  const ids = new Set();
  p.profiles.forEach((profile, i) => {
    const path = `$.profiles[${i}]`;
    if (!obj(profile)) { fail(path, '档案必须是对象。'); return; }
    if (!id(profile.id) || ids.has(profile.id)) fail(path + '.id', '档案编号无效或重复。');
    ids.add(profile.id);
    if (!txt(profile.name, 12) || !profile.name.trim() || profile.name !== profile.name.trim()) fail(path + '.name', '昵称需为去除首尾空格后的 1～12 个字符。');
    if (![1, 2, 3].includes(profile.grade)) fail(path + '.grade', '年级必须为数字 1、2 或 3。');
    if (!avatars.includes(profile.avatar)) fail(path + '.avatar', '请选择支持的头像。');
    if (!time(profile.createdAt)) fail(path + '.createdAt', '创建时间无效。');
    if (!obj(p.data[profile.id])) fail('$.data.' + profile.id, '该档案缺少数据分区。');
  });
  if (p.active == null) p.active = p.profiles[0]?.id;
  if (!ids.has(p.active)) fail('$.active', '当前档案编号不存在。');
  if (p.settings !== undefined && (!obj(p.settings) || typeof p.settings.sound !== 'boolean'
      || p.settings.theme !== undefined && !['auto', 'light', 'dark'].includes(p.settings.theme))) fail('$.settings', '音效设置必须是布尔值，主题必须是 auto/light/dark。');
  const question = (q, path) => {
    if (!validatePaper({ id: 'backup-check', questions: [q] }, known) || !id(q.id) || !q.text.trim()
        || !count(q.difficulty, 3) || q.difficulty < 1 || !obj(q.params)
        || !['add', 'sub', 'mul', 'div', 'mix', 'compare'].includes(q.op)
        || ![q.params.a, q.params.b].every(operand)
        || q.params.denom !== undefined && (!Number.isInteger(q.params.denom) || q.params.denom <= 0)
        || q.kind === 'fraction' && (!Number.isInteger(q.params.denom) || q.params.denom <= 0)
        || q.kind === 'fraction' && !/^-?\d+(?:\/[1-9]\d*)?$/.test(q.answer)
        || q.kind === 'sign' && !['<', '>', '='].includes(q.answer)
        || q.op === 'mix' && (!Number.isFinite(q.params.c) || !['+', '-', '×', '÷'].includes(q.params.op1) || !['+', '-', '×', '÷'].includes(q.params.op2))
        || q.op === 'div' && Number(q.params.b) === 0
        || q.params.hide !== undefined && !['a', 'b', 'result'].includes(q.params.hide)
        || q.params.compareTo !== undefined && !operand(q.params.compareTo)
        || q.layout !== undefined && !obj(q.layout)) fail(path, '题目编号、知识点、题型、参数、答案或难度不合法。');
  };
  const paper = (v, path) => {
    if (!validatePaper(v, known) || !id(v.id)) { fail(path, '试卷应包含 1～100 道不重复编号的有效题目。'); return; }
    v.questions.forEach((q, i) => question(q, path + `.questions[${i}]`));
    if (v.retry && v.variant) fail(path, '不能同时是重练和变式卷。');
    for (const field of ['sourceMistakeIds', 'variantRemainingIds', 'variantPreviousKeys']) {
      if (v[field] !== undefined && !strings(v[field], 500)) fail(path + '.' + field, '来源/批次字段必须是有界、不重复的字符串数组。');
    }
  };
  const record = (r, pid, path) => {
    if (!obj(r)) { fail(path, '练习记录必须是对象。'); return; }
    if (!id(r.id) || r.profileId != null && r.profileId !== pid || !time(r.finishedAt)
        || r.compressed !== undefined && typeof r.compressed !== 'boolean'
        || r.mode !== undefined && !['practice', 'retry', 'variant'].includes(r.mode)
        || ![r.total, r.correct, r.wrong, r.skipped].every(v => count(v)) || r.total < 1
        || r.correct + r.wrong + r.skipped !== r.total || !time(r.elapsedMs ?? 0)) fail(path, '记录编号、归属、时间或题数不合法。');
    if (r.compressed) {
      if (r.paper != null) fail(path + '.paper', '摘要记录不能包含完整试卷。');
      for (const [field, total] of [['kpCount', r.total], ['kpAnswered', r.total - r.skipped], ['kpCorrect', r.correct]]) {
        if (r[field] === undefined && field !== 'kpCount') continue;
        if (!obj(r[field]) || Object.entries(r[field]).some(([kp, n]) => !known(kp) || !count(n))
            || Object.values(r[field]).reduce((n, v) => n + v, 0) !== total) fail(path + '.' + field, '知识点摘要应与该记录题数一致。');
      }
    } else {
      paper(r.paper, path + '.paper');
      if (r.paper?.questions?.length !== r.total) fail(path + '.total', '题数与试卷不一致。');
      if (!Array.isArray(r.detail) || r.detail.length !== r.total) fail(path + '.detail', '缺少首次作答明细。');
      else {
        const seen = new Set(), byId = new Map((Array.isArray(r.paper?.questions) ? r.paper.questions : []).filter(obj).map(q => [q.id, q]));
        let correct = 0, skipped = 0;
        r.detail.forEach((a, i) => {
          const q = byId.get(a?.questionId), ap = path + `.detail[${i}]`;
          if (!q || seen.has(a.questionId) || !txt(a.userAnswer, 40) || typeof a.correct !== 'boolean' || typeof a.skipped !== 'boolean'
              || !time(a.elapsedMs ?? 0) || a.kpId !== q.kpId) { fail(ap, '首次作答明细无效。'); return; }
          seen.add(a.questionId);
          const judged = judgeAnswer(q, a.skipped ? '' : a.userAnswer);
          if (judged.correct !== a.correct || judged.skipped !== a.skipped) fail(ap, '作答标记与答案不一致。');
          correct += Number(a.correct); skipped += Number(a.skipped);
        });
        if (correct !== r.correct || skipped !== r.skipped) fail(path + '.counts', '汇总与首次作答不一致。');
      }
      if (r.wrongList !== undefined && (!Array.isArray(r.wrongList) || r.wrongList.length > r.total)) fail(path + '.wrongList', '错题回顾无效。');
      else for (const [i, w] of (r.wrongList ?? []).entries()) {
        question(w?.question, path + `.wrongList[${i}].question`);
        if (!txt(w?.userAnswer, 40)) fail(path + `.wrongList[${i}]`, '错误答案无效。');
      }
    }
  };
  for (const [pid, d] of Object.entries(p.data)) {
    const path = '$.data.' + pid;
    if (!ids.has(pid) || !obj(d)) { fail(path, '数据分区没有对应档案。'); continue; }
    if (!Array.isArray(d.sessions) || d.sessions.length > 2500) fail(path + '.sessions', '历史记录必须是最多 2500 条的数组。');
    else {
      const seen = new Set(); let full = 0;
      d.sessions.forEach((r, i) => { record(r, pid, path + `.sessions[${i}]`); if (seen.has(r?.id)) fail(path + '.sessions', '历史编号重复。'); seen.add(r?.id); if (!r?.compressed) full++; });
      if (full > 500) fail(path + '.sessions', '完整明细不能超过 500 条。');
    }
    if (d.quizActive != null) {
      const s = d.quizActive;
      paper(s.paper, path + '.quizActive.paper');
      if (!time(s.savedAt) || s.savedAt > Date.now() || !validateActiveSession(s, pid, s.savedAt, known)) fail(path + '.quizActive', '进行中练习的题号、模式、时间或作答不合法。');
      else if (Date.now() - s.savedAt > 86400000) { d.quizActive = null; warnings.push(`已忽略档案 ${pid} 超过24小时的进行中练习。`); }
    }
    if (d.quizResult != null) record(d.quizResult, pid, path + '.quizResult');
    const m = d.mistakes ?? [];
    if (d.mistakeState !== undefined && (!obj(d.mistakeState) || d.mistakeState.version !== 2 || !strings(d.mistakeState.archivedSessions, 2500, 40))) fail(path + '.mistakeState', '归档索引版本或内容无效。');
    if (Array.isArray(m)) d.mistakes = { version: 2, items: m, archivedSessions: d.mistakeState?.archivedSessions ?? (Array.isArray(d.sessions) ? d.sessions : []).filter(r => obj(r) && !r.compressed).map(r => r.id) };
    if (!obj(d.mistakes) || d.mistakes.version !== 2 || !Array.isArray(d.mistakes.items) || d.mistakes.items.length > 500
        || !strings(d.mistakes.archivedSessions, 2500, 40)) fail(path + '.mistakes', '错题容器或归档防重记录无效。');
    else {
      const seen = new Set(), seenKeys = new Set();
      d.mistakes.items.forEach((m, i) => {
        const mp = path + `.mistakes[${i}]`;
        if (!obj(m)) { fail(mp, '错题必须是对象。'); return; }
        if (!id(m.id) || seen.has(m.id) || seenKeys.has(m.key) || !known(m.kpId) || !txt(m.key) || !m.key || !txt(m.text) || !txt(m.answer, 40)
            || !txt(m.userAnswer, 40) || !count(m.wrongCount, Number.MAX_SAFE_INTEGER) || m.wrongCount < 1 || typeof m.mastered !== 'boolean'
            || !time(m.firstWrongAt) || !time(m.lastWrongAt) || m.firstWrongAt > m.lastWrongAt
            || m.firstUserAnswer !== undefined && !txt(m.firstUserAnswer, 40)
            || m.masteredAt !== undefined && !time(m.masteredAt)
            || m.sourceSessions !== undefined && !strings(m.sourceSessions, 10, 40)
            || m.sourcePaperKeys !== undefined && !strings(m.sourcePaperKeys, 100)) fail(mp, '错题字段、时间、次数或来源不合法。');
        seen.add(m.id); seenKeys.add(m.key);
        if (m.question != null) { question(m.question, mp + '.question'); if (m.question.kpId !== m.kpId || m.question.answer !== m.answer || m.question.type !== m.type) fail(mp, '错题快照与显示字段不一致。'); }
      });
    }
    const badges = d.badges ?? [];
    if (Array.isArray(badges)) d.badges = { version: 1, items: badges.map(b => ({ id: typeof b?.id === 'string' ? b.id.replace(/^streak/, 'd') : b?.id,
      earnedAt: time(b?.earnedAt) ? dateStr(b.earnedAt) : b?.earnedAt })) };
    if (!obj(d.badges) || d.badges.version !== 1 || !Array.isArray(d.badges.items) || d.badges.items.length > 3
        || d.badges.items.some(b => !['d7', 'd30', 'd100'].includes(b?.id) || !validDay(b.earnedAt))
        || new Set(d.badges.items.map(b => b.id)).size !== d.badges.items.length) fail(path + '.badges', '徽章编号、日期或版本无效。');
    if (d.stats != null && !obj(d.stats)) fail(path + '.stats', '旧统计应为对象或 null。');
  }
  return { ok: errors.length === 0, payload: p, errors, warnings };
}
export function validateBackupPayload(payload) { return inspectBackupPayload(payload).errors; }
