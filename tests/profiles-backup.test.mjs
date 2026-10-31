import test from 'node:test';
import assert from 'node:assert/strict';

const data = new Map(); let writes = 0, failNth = 0, allFail = false, removeFail = '', failAfter = 0, quota = Infinity;
const used = () => [...data].reduce((n, [k, v]) => n + 2 * (k.length + v.length), 0);
globalThis.localStorage = {
  get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
  getItem: k => data.get(k) ?? null,
  setItem(k, v) { writes++; if (allFail || failNth === writes || failAfter && writes >= failAfter
    || used() - (data.has(k) ? 2 * (k.length + data.get(k).length) : 0) + 2 * (k.length + String(v).length) > quota) throw new DOMException('test full', 'QuotaExceededError'); data.set(k, String(v)); },
  removeItem(k) { if (k === removeFail) throw new Error('remove denied'); data.delete(k); }
};
const storage = await import('../src/core/storage.js');
const profile = await import('../src/domain/profile.js');
const backup = await import('../src/domain/backup.js');
const { inspectBackupPayload } = await import('../src/core/schema.js');
const history = await import('../src/domain/history.js');
const mistakes = await import('../src/domain/mistakes.js');
const stats = await import('../src/domain/stats.js');
const quiz = await import('../src/app/quizSession.js');
const { generatePaper } = await import('../src/domain/generator.js');
const { settleSession, judgeAnswer } = await import('../src/domain/grader.js');
const clone = v => structuredClone(v), snapshot = () => [...data].sort(([a], [b]) => a.localeCompare(b));
function reset() { quota = Infinity; writes = failNth = failAfter = 0; allFail = false; removeFail = ''; data.clear(); storage.__resetForTest(); return profile.ensureProfile(); }
const paper = (seed = 2) => generatePaper({ kpIds: ['G2-01'], count: 5, types: ['horizontal'], seed });
function seedHistory(p, count = 1) {
  const rows = Array.from({ length: count }, (_, i) => {
    const ppr = paper(i + 2), answers = Object.fromEntries(ppr.questions.map((q, n) => { const answer = n ? q.answer : '-999'; return [q.id, { userAnswer: answer, ...judgeAnswer(q, answer), elapsedMs: 500 }]; }));
    return { ...settleSession(ppr, answers, 2500), id: `record-${i}`, profileId: p.id, finishedAt: Date.now() - i * 1000 };
  });
  storage.write(`sessions:${p.id}`, rows); return rows;
}

test('档案最多3个，昵称12字及空值默认，非法输入不写入', () => {
  reset(); const p2 = profile.createProfile({ name: '', grade: 2 }); assert.equal(p2.name, '小朋友');
  profile.createProfile({ name: 'abcdefghijkl', grade: 3 });
  const before = snapshot(); assert.throws(() => profile.createProfile({ name: 'fourth' })); assert.deepEqual(snapshot(), before);
  assert.throws(() => profile.updateProfile(p2.id, { name: 'abcdefghijklm' }));
  assert.throws(() => profile.updateProfile(p2.id, { grade: '2' })); assert.deepEqual(snapshot(), before);
});
test('事务删除所有登记分区且隔离其它档案和同源其它应用，最后档案可为空', () => {
  const a = reset(), b = profile.createProfile({ name: '保留', grade: 2 });
  for (const fn of profile.PARTITION_KEY_TEMPLATES) { storage.write(fn(a.id), { a: 1 }); storage.write(fn(b.id), { b: 1 }); }
  data.set('other:application', 'keep');
  profile.removeProfile(a.id); assert.equal(profile.getActiveProfile().id, b.id);
  assert.ok(profile.PARTITION_KEY_TEMPLATES.every(fn => !data.has('km-preview-b10:' + fn(a.id)) && data.has('km-preview-b10:' + fn(b.id))));
  profile.removeProfile(b.id); assert.equal(profile.getActiveProfile(), null); assert.equal(data.get('other:application'), 'keep');
});
test('分区删除失败不报告成功，日志保留原数据并可恢复', () => {
  const p = reset(); seedHistory(p); const before = snapshot();
  removeFail = `km-preview-b10:sessions:${p.id}`; assert.throws(() => profile.removeProfile(p.id));
  assert.ok(data.has('km-preview-b10:__transaction__')); assert.equal(profile.getActiveProfile().id, p.id);
  assert.equal(history.listHistory().length, 1);
  removeFail = ''; assert.equal(storage.recoverTransaction().ok, true); assert.deepEqual(snapshot(), before);
});
test('标准备份回导保留A错题V2、归档防重、徽章日期和音效', () => {
  const p = reset(), [r] = seedHistory(p); assert.equal(mistakes.archiveSession(r).ok, true);
  storage.write(`badges:${p.id}`, { version: 1, items: [{ id: 'd7', earnedAt: '2026-10-01' }] });
  storage.write('settings', { sound: true, theme: 'auto' });
  const payload = backup.buildBackup(); assert.equal(payload.format, 'kidsmath-backup'); assert.equal(payload.version, '1.0');
  assert.ok(Array.isArray(payload.data[p.id].mistakes)); assert.equal(payload.data[p.id].mistakeState.archivedSessions[0], r.id);
  const response = backup.applyBackup(payload, { mode: 'overwrite' }); assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(mistakes.readStore(p.id).items.length, 1); assert.equal(mistakes.archiveSession(r).duplicate, true);
  assert.equal(stats.badges(p.id)[0].earnedAt, '2026-10-01'); assert.equal(storage.read('settings').sound, true);
  assert.deepEqual(backup.takeImportReceipt(), { profiles: 1, records: 1, mistakes: 1 });
});
test('所有知识点与支持题型的实际生成题可备份，摘要可回导', () => {
  const p = reset();
  return import('../src/domain/syllabus.js').then(({ SYLLABUS }) => {
    const rows = [];
    for (const kp of SYLLABUS) for (const type of kp.types) {
      const pp = generatePaper({ kpIds: [kp.id], count: 5, types: [type], seed: 5 });
      const answers = Object.fromEntries(pp.questions.map(q => [q.id, { userAnswer: q.answer, ...judgeAnswer(q, q.answer), elapsedMs: 100 }]));
      rows.push({ ...settleSession(pp, answers, 500), id: `kp-${rows.length}`, profileId: p.id });
    }
    storage.write(`sessions:${p.id}`, rows);
    assert.doesNotThrow(() => backup.buildBackup());
    const compressed = history.retainHistory(Array.from({ length: 501 }, (_, i) => ({ ...rows[0], id: 'r' + i, finishedAt: Date.now() - i })));
    storage.write(`sessions:${p.id}`, compressed); const b = backup.buildBackup();
    assert.equal(b.data[p.id].sessions.filter(r => r.compressed).length, 1);
    assert.equal(backup.applyBackup(b, { mode: 'overwrite' }).ok, true);
  });
});
test('旧标准格式及早期C备份兼容，缺设置时保留现有音效', () => {
  const p = reset(); storage.write('settings', { sound: true });
  const b = backup.buildBackup(); delete b.settings; delete b.active; delete b.data[p.id].mistakeState;
  assert.equal(backup.applyBackup(b, { mode: 'overwrite' }).ok, true); assert.equal(storage.read('settings').sound, true);
  const legacy = { ...b, app: 'kidsmath', version: 1, exportedAt: Date.now() }; delete legacy.format;
  const checked = inspectBackupPayload(legacy); assert.equal(checked.ok, true); assert.ok(checked.warnings.length);
});
test('持续配额失败发生在暂存阶段，原数据逐字节保持不变', () => {
  const p = reset(); seedHistory(p); const payload = backup.buildBackup(), before = snapshot();
  allFail = true; const r = backup.applyBackup(payload, { mode: 'overwrite' }); allFail = false;
  assert.equal(r.ok, false); assert.equal(r.code, 'STAGING_FAILED'); assert.deepEqual(snapshot(), before);
  assert.ok(!r.errors[0].message.includes('已恢复原有数据'));
});
test('导入每个写入阶段单次失败均回滚，不出现半份档案或历史', () => {
  for (let nth = 1; nth <= 10; nth++) {
    const p = reset(); seedHistory(p); const b = backup.buildBackup(), before = snapshot(); b.profiles[0].name = '改名';
    writes = 0; failNth = nth;
    const r = backup.applyBackup(b, { mode: 'overwrite' }); failNth = 0;
    if (!r.ok) { assert.deepEqual(snapshot(), before, `write ${nth}`); assert.equal(profile.getActiveProfile().name, '小朋友'); }
    else assert.equal(profile.getActiveProfile().name, '改名');
  }
});
test('事务中持续失败保留撤销日志，读到旧视图，重启后恢复', async () => {
  const p = reset(); seedHistory(p); const b = backup.buildBackup(), before = snapshot(); b.profiles[0].name = '未提交';
  writes = 0; failAfter = 3;
  const r = backup.applyBackup(b, { mode: 'overwrite' }); assert.equal(r.code, 'RECOVERY_REQUIRED');
  assert.ok(data.has('km-preview-b10:__transaction__')); assert.equal(profile.getActiveProfile().name, '小朋友'); assert.equal(history.listHistory().length, 1);
  assert.equal(storage.write('settings', { sound: true }), false);
  failAfter = 0;
  const cold = await import(`../src/core/storage.js?recovery=${Math.random()}`);
  assert.equal(cold.recoverTransaction().ok, true); assert.deepEqual(snapshot(), before);
});
test('构造崩溃后的日志与部分新值，启动恢复精确还原；坏日志不删除', () => {
  const p = reset(); const raw = data.get('km-preview-b10:profiles');
  data.set('km-preview-b10:__transaction__', JSON.stringify({ version: 1, before: [['profiles', raw], ['temporary', null]] }));
  data.set('km-preview-b10:profiles', '[]'); data.set('km-preview-b10:temporary', '"partial"');
  assert.equal(storage.recoverTransaction().ok, true); assert.equal(profile.getActiveProfile().id, p.id); assert.equal(data.has('km-preview-b10:temporary'), false);
  data.set('km-preview-b10:__transaction__', 'bad-json'); assert.equal(storage.recoverTransaction().ok, false); assert.equal(data.get('km-preview-b10:__transaction__'), 'bad-json');
});
test('导入清理内存恢复点，恢复后答题不覆盖新会话；三种模式均保留', () => {
  for (const mode of ['practice', 'retry', 'variant']) {
    const p = reset(), pp = paper(); if (mode !== 'practice') { pp[mode] = true; pp.sourceMistakeIds = ['source']; }
    quiz.createSession(pp); const b = backup.buildBackup(); b.data[p.id].quizActive.id = 'restored-' + mode;
    assert.equal(backup.applyBackup(b, { mode: 'overwrite' }).ok, true);
    assert.equal(quiz.resumeSession().id, 'restored-' + mode); assert.equal(quiz.resumeSession().mode, mode);
    quiz.saveDraft('42'); assert.equal(storage.read(`quiz:active:${p.id}`).id, 'restored-' + mode);
  }
});
test('删除历史清掉最近结果内存/存储，但保留独立错题与归档防重', () => {
  const p = reset(); quiz.createSession(paper()); quiz.recordAttempt('-999'); const r = quiz.finishSession();
  const before = storage.read(`mistakes:${p.id}`);
  assert.equal(history.deleteHistoryRecord(r.id), true); assert.equal(quiz.getLastResult(), null);
  assert.equal(history.getHistoryRecord(r.id), null); assert.deepEqual(storage.read(`mistakes:${p.id}`), before);
});
test('合并按记录id去重、同题错题不重复累加，重复导入幂等', () => {
  const p = reset(), [r] = seedHistory(p); mistakes.archiveSession(r); const b = backup.buildBackup();
  const m = b.data[p.id].mistakes[0]; m.id = 'incoming-m'; m.lastWrongAt += 1;
  const s = quiz.createSession({ ...paper(7), retry: true, sourceMistakeIds: ['incoming-m'] });
  b.data[p.id].quizActive = clone(s); b.data[p.id].quizActive.savedAt += 0;
  const first = backup.applyBackup(b, { mode: 'merge' }); assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(history.listHistory().length, 1); assert.equal(mistakes.readStore(p.id).items.length, 1);
  const count = mistakes.readStore(p.id).items[0].wrongCount;
  assert.equal(backup.applyBackup(b, { mode: 'merge' }).ok, true); assert.equal(mistakes.readStore(p.id).items[0].wrongCount, count);
});
test('合并超过3档案拒绝，覆盖删除旧档案且不触碰其它应用', () => {
  const p = reset(); const b = backup.buildBackup();
  b.profiles[0].id = 'imported-profile'; b.active = 'imported-profile'; b.data['imported-profile'] = b.data[p.id]; delete b.data[p.id];
  profile.createProfile({ name: '二', grade: 2 }); profile.createProfile({ name: '三', grade: 3 });
  const before = snapshot(); assert.equal(backup.applyBackup(b, { mode: 'merge' }).ok, false); assert.deepEqual(snapshot(), before);
  data.set('other-app:item', 'keep'); assert.equal(backup.applyBackup(b, { mode: 'overwrite' }).ok, true);
  assert.equal(profile.listProfiles().length, 1); assert.equal(profile.getActiveProfile().id, 'imported-profile'); assert.equal(data.get('other-app:item'), 'keep');
});
test('逐字段拒绝坏备份：版本/上限/关联/坏试卷/错误计数/非法徽章', () => {
  const p = reset(); seedHistory(p); const base = backup.buildBackup();
  const bad = [b => b.version = -1, b => b.version = 0, b => b.exportedAt = 'invalid', b => b.profiles[0].name = '   ',
    b => b.profiles[0].grade = '2', b => b.data = {}, b => b.active = 'missing',
    b => { for (let i = 0; i < 3; i++) { b.profiles.push({ ...b.profiles[0], id: 'x' + i }); b.data['x' + i] = b.data[p.id]; } },
    b => b.data[p.id].sessions[0].total = 999,
    b => b.data[p.id].sessions[0].paper.questions[1].id = b.data[p.id].sessions[0].paper.questions[0].id,
    b => b.data[p.id].sessions[0].paper.questions[0].params.denom = 0,
    b => b.data[p.id].sessions[0].paper.questions = [], b => b.data[p.id].sessions[0].paper.questions = {},
    b => b.data[p.id].sessions[0].detail = [], b => b.data[p.id].mistakes = [{ unexpected: true }],
    b => b.data[p.id].badges = { version: 999, items: [] }, b => b.data[p.id].quizActive = { schemaVersion: 1, cursor: -1 }];
  const before = snapshot();
  for (const mutate of bad) { const b = clone(base); mutate(b); assert.equal(backup.applyBackup(b, { mode: 'overwrite' }).ok, false); assert.deepEqual(snapshot(), before); }
});
test('坏JSON/null档案/危险属性/超大文件在预览前拒绝，不执行HTML', async () => {
  reset(); const before = snapshot();
  for (const content of ['bad-json', '{"profiles":[null]}', '{"__proto__":{"polluted":true}}']) {
    const r = await backup.parseBackupFile({ size: content.length, text: async () => content }); assert.equal(r.ok, false);
  }
  assert.equal((await backup.parseBackupFile({ size: backup.MAX_BACKUP_BYTES + 1 })).ok, false);
  const b = backup.buildBackup(); b.profiles[0].name = '<script>x';
  assert.equal(backup.applyBackup(b, { mode: 'overwrite' }).ok, true); assert.equal({}.polluted, undefined);
  assert.equal(profile.getActiveProfile().name, '<script>x');
});

test('真实容量模型：暂存可用而大备份写入超限时，释放本次空间并恢复原值', () => {
  const p = reset(); seedHistory(p); const before = snapshot(), baseline = used();
  const b = backup.buildBackup(), original = b.data[p.id].sessions[0];
  b.data[p.id].sessions = Array.from({ length: 30 }, (_, i) => ({ ...clone(original), id: 'larger-' + i }));
  quota = baseline * 4;
  const r = backup.applyBackup(b, { mode: 'overwrite' });
  assert.equal(r.ok, false); assert.equal(r.code, 'WRITE_FAILED'); assert.equal(r.recovered, true); assert.deepEqual(snapshot(), before);
});
test('提交标记无法删除时不报告成功，保留日志直到恢复完成', () => {
  const p = reset(); seedHistory(p); const b = backup.buildBackup(), before = snapshot(); b.profiles[0].name = '新昵称';
  removeFail = 'km-preview-b10:__transaction__'; const r = backup.applyBackup(b, { mode: 'overwrite' });
  assert.equal(r.ok, false); assert.equal(r.code, 'RECOVERY_REQUIRED'); assert.equal(profile.getActiveProfile().name, '小朋友');
  removeFail = ''; assert.equal(storage.recoverTransaction().ok, true); assert.deepEqual(snapshot(), before);
});
test('合并同题不同错题ID时，导入的重练来源映射到保留ID', () => {
  const p = reset(), [r] = seedHistory(p); mistakes.archiveSession(r);
  const m = mistakes.readStore(p.id).items[0];
  quiz.createSession({ ...paper(8), retry: true, sourceMistakeIds: [m.id] });
  const b = backup.buildBackup(); b.data[p.id].mistakes[0].id = 'from-backup';
  b.data[p.id].quizActive.id = 'newer-active'; b.data[p.id].quizActive.savedAt += 10;
  b.data[p.id].quizActive.paper.sourceMistakeIds = ['from-backup'];
  const clock = Date.now; Date.now = () => clock() + 20;
  try {
    assert.equal(backup.applyBackup(b, { mode: 'merge' }).ok, true);
    assert.equal(quiz.resumeSession().id, 'newer-active'); assert.deepEqual(quiz.resumeSession().paper.sourceMistakeIds, [m.id]);
  } finally { Date.now = clock; }
});
test('超过24小时的临时练习明确告知并忽略，其余备份仍恢复', () => {
  const p = reset(); quiz.createSession(paper()); const b = backup.buildBackup(), s = b.data[p.id].quizActive;
  s.startAt = s.questionAt = s.savedAt = Date.now() - 25 * 3600000;
  const r = backup.applyBackup(b, { mode: 'overwrite' }); assert.equal(r.ok, true); assert.ok(r.warnings.some(w => w.includes('24小时')));
  assert.equal(quiz.resumeSession(), null); assert.equal(profile.getActiveProfile().id, p.id);
});
test('存储不可用时可临时练习，但导入不伪装为持久保存成功', () => {
  reset(); data.clear(); storage.__resetForTest(); allFail = true;
  const p = profile.ensureProfile(); assert.equal(storage.isAvailable(), false); assert.equal(profile.getActiveProfile().id, p.id);
  const r = backup.applyBackup(backup.buildBackup(), { mode: 'overwrite' });
  assert.equal(r.ok, false); assert.ok(r.errors[0].message.includes('不可用')); assert.deepEqual(snapshot(), []);
  allFail = false;
});
