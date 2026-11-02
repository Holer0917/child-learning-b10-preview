/** B09：隔离浏览器验证真实会话、动画、Web Audio 与故障；不操作用户学习数据。 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const checks = [], errors = [], samples = [], layouts = [];
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    let data = await fs.readFile(file);
    // 普通交互测试禁用 SW；真正离线仍由独立 PWA 套件验证。
    if (path.extname(file) === '.html') data = Buffer.from(data.toString().replace('</head>', '<meta name="kidsmath-development" content="true"></head>'));
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
let browser;
(async () => {
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const newPage = async ({ mode = 'real', preference, quota = false, reducedMotion = 'no-preference', mobile = false, viewport = { width: 1440, height: 900 } } = {}) => {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion });
    await context.addInitScript(({ mode, preference, quota }) => {
      window.__audioTrace = { contexts: 0, notes: [], stops: 0, closes: 0, resumes: 0 };
      const Native = window.AudioContext || window.webkitAudioContext;
      if (mode === 'unsupported') {
        window.AudioContext = undefined; window.webkitAudioContext = undefined;
      } else if (mode === 'blocked' || mode === 'pending') {
        window.AudioContext = class {
          constructor() { window.__audioTrace.contexts++; this.state = 'suspended'; }
          resume() {
            window.__audioTrace.resumes++;
            return mode === 'blocked' ? Promise.reject(new Error('test browser policy'))
              : new Promise(resolve => { window.__releaseAudio = () => { this.state = 'running'; resolve(); }; });
          }
          createOscillator() { window.__audioTrace.notes.push('UNEXPECTED'); throw new Error('must remain silent'); }
          close() { this.state = 'closed'; window.__audioTrace.closes++; return Promise.resolve(); }
        };
      } else {
        window.AudioContext = class extends Native {
          constructor() { super(); window.__audioTrace.contexts++; }
          createOscillator() {
            const osc = super.createOscillator(), start = osc.start.bind(osc), stop = osc.stop.bind(osc);
            const setFrequency = osc.frequency.setValueAtTime.bind(osc.frequency); let hz;
            osc.frequency.setValueAtTime = (value, when) => { hz = value; return setFrequency(value, when); };
            osc.start = when => { window.__audioTrace.notes.push({ frequency: hz, when, state: this.state }); return start(when); };
            osc.stop = when => { window.__audioTrace.stops++; return stop(when); };
            return osc;
          }
          close() { window.__audioTrace.closes++; return super.close(); }
        };
      }
      if (preference !== undefined && !localStorage.getItem('km-preview-b10:settings')) localStorage.setItem('km-preview-b10:settings', JSON.stringify(preference));
      if (quota) {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === 'km-preview-b10:settings') throw new DOMException('test quota', 'QuotaExceededError');
          return set.call(this, key, value);
        };
      }
    }, { mode, preference, quota });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/#/home');
    await page.getByRole('button', {name:'创建档案',exact:true}).click();
    await page.locator('#profile-name').fill('音效反馈检查');
    await page.getByRole('button', {name:'创建档案',exact:true}).click();
    await page.locator('.start-page').waitFor(); return page;
  };
  const active = page => page.evaluate(async () => (await import('/src/app/quizSession.js')).resumeSession());
  const prepare = async (page, count = 10) => {
    await page.evaluate(async count => {
      const { generatePaper } = await import('/src/domain/generator.js');
      const { createSession } = await import('/src/app/quizSession.js');
      createSession(generatePaper({ kpIds: ['G1-01'], count, types: ['horizontal'], seed: 20 }));
    }, count);
    await page.goto(base + '/#/quiz?start=1'); await page.locator('#quiz-answer').waitFor();
  };
  const answer = async (page, correct = true) => {
    const s = await active(page), q = s.paper.questions[s.cursor];
    await page.locator('#quiz-answer').fill(correct ? q.answer : '999999');
    await page.locator('#submit-answer').click();
    await page.locator('#next-question').waitFor();
  };
  const next = async page => {
    const s = await active(page);
    await page.locator('#next-question').click({ force: true });
    if (s.cursor < s.paper.questions.length - 1) await page.getByText(`第 ${s.cursor + 2} / 共 ${s.paper.questions.length} 题`, { exact: true }).waitFor();
  };
  const trace = page => page.evaluate(() => window.__audioTrace);
  const animation = page => page.locator('#answer-status').evaluate(node => {
    const style = getComputedStyle(node), a = node.getAnimations()[0];
    return { name: style.animationName, duration: style.animationDuration, effectMs: a?.effect.getTiming().duration,
      nextEnabled: !document.querySelector('#next-question').disabled, text: node.textContent };
  });

  const defaults = await newPage(); await prepare(defaults);
  assert.equal(await defaults.locator('#toggle-sound').getAttribute('aria-pressed'), 'false');
  assert.equal(await defaults.locator('#toggle-sound').textContent(), '');
  assert.equal(await defaults.locator('#toggle-sound').getAttribute('aria-label'), '答题提示音');
  assert.equal(await defaults.locator('#toggle-sound').getAttribute('title'), '开启提示音');
  assert.equal(await defaults.locator('#toggle-sound svg[aria-hidden="true"]').count(), 1);
  assert.equal(await defaults.locator('#toggle-sound svg').isVisible(), true);
  const mutedPaths = await defaults.locator('#toggle-sound path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));
  assert.equal((await trace(defaults)).contexts, 0);
  await defaults.locator('#quiz-answer').fill('abc'); await defaults.locator('#submit-answer').click();
  assert.equal(Object.keys((await active(defaults)).attempts).length, 0);
  assert.equal(await defaults.locator('#answer-status.feedback-pulse').count(), 0);
  await answer(defaults); const pulse = await animation(defaults); samples.push(pulse);
  assert.equal(pulse.duration, '0.3s'); assert.equal(pulse.effectMs, 300); assert.equal(pulse.nextEnabled, true);
  // 同一任务内在动效存在时激活“下一题”，直接证明不依赖 animationend 或音频完成。
  const manual = await defaults.evaluate(() => {
    const activeAnimation = document.querySelector('#answer-status').getAnimations().some(a => a.playState === 'running');
    const before = performance.now(); document.querySelector('#next-question').click();
    return { activeAnimation, elapsedMs: performance.now() - before, label: document.querySelector('.progress-label').textContent };
  });
  assert.equal(manual.activeAnimation, true); assert.equal(manual.label, '第 2 / 共 10 题'); assert.ok(manual.elapsedMs < 100); samples.push(manual);
  await defaults.waitForTimeout(900); assert.equal((await active(defaults)).cursor, 1);
  await defaults.locator('#skip-question').click(); assert.equal(await defaults.locator('#answer-status.feedback-pulse').count(), 0);
  assert.equal((await trace(defaults)).contexts, 0); await defaults.context().close();
  checks.push('PASS AC-15.1/4: 默认静音且不创建音频上下文；动效实测配置300ms，播放中可立即切题，无延迟双跳；非法输入与跳过不播放');

  const streak = await newPage(); await prepare(streak);
  for (let i = 0; i < 5; i++) {
    await answer(streak);
    assert.equal((await streak.locator('#answer-status').textContent()).includes('连对'), i === 4);
    if (i < 4) await next(streak);
  }
  assert.match(await streak.locator('#answer-status').textContent(), /连对 5 题/);
  // 退出确认取消会重新绘制，不能重放反馈。
  await streak.locator('#exit-quiz').click(); await streak.getByRole('button', { name: '继续答题', exact: true }).click();
  assert.match(await streak.locator('#answer-status').textContent(), /连对 5 题/);
  assert.equal(await streak.locator('#answer-status.feedback-pulse').count(), 0);
  await streak.reload(); await streak.getByRole('button', { name: '继续练习', exact: true }).click();
  assert.match(await streak.locator('#answer-status').textContent(), /连对 5 题/);
  assert.equal(await streak.locator('#answer-status.feedback-pulse').count(), 0); assert.equal((await trace(streak)).contexts, 0);
  await next(streak); await answer(streak); assert.match(await streak.locator('#answer-status').textContent(), /连对 6 题/);
  await streak.context().close();
  checks.push('PASS AC-15.2: 第1～4题无连对提示，第5/6题按真实连续次数提示；刷新恢复与关闭弹窗保留次数，不重播动画/音效');

  const retry = await newPage(); await prepare(retry);
  await answer(retry, false); await retry.locator('#retry-answer').click(); await answer(retry);
  assert.equal((await retry.locator('#answer-status').textContent()).includes('连对'), false);
  let s = await active(retry); assert.equal(s.attempts[s.paper.questions[0].id].correct, false); assert.equal(s.retries[s.paper.questions[0].id].correct, true);
  await next(retry);
  for (let i = 0; i < 4; i++) { await answer(retry); assert.doesNotMatch(await retry.locator('#answer-status').textContent(), /连对/); await next(retry); }
  await retry.locator('#skip-question').click(); await next(retry); await answer(retry);
  assert.doesNotMatch(await retry.locator('#answer-status').textContent(), /连对/);
  await retry.locator('#exit-quiz').click(); await retry.getByRole('button', { name: '确认结束', exact: true }).click();
  await retry.locator('.result-page').waitFor(); assert.equal(await retry.locator('#perfect-feedback').count(), 0);
  await retry.context().close();
  checks.push('PASS AC-15.2/3: 首错后订正不补入连对，不覆盖首次成绩；跳过中断连续计数，含首错/未答时不出现全对庆祝');

  const perfect = await newPage(); await prepare(perfect, 5);
  for (let i = 0; i < 5; i++) { await answer(perfect); await next(perfect); }
  await perfect.locator('#perfect-feedback').waitFor();
  assert.match(await perfect.locator('#perfect-feedback').textContent(), /全对/);
  assert.equal(await perfect.locator('#perfect-feedback').evaluate(n => getComputedStyle(n).animationDuration), '0.3s');
  const resultId = await perfect.evaluate(async () => (await import('/src/app/quizSession.js')).getLastResult().id);
  await perfect.goto(base + '/#/result?id=' + resultId); await perfect.locator('#perfect-feedback').waitFor();
  assert.equal(await perfect.locator('#perfect-feedback.feedback-pulse').count(), 0);
  assert.equal((await trace(perfect)).contexts, 0); await perfect.context().close();
  checks.push('PASS AC-15.3: 5题首次全对后出现300ms“全对”庆祝；查看历史保留文字但不重播庆祝，不额外播音');

  const sound = await newPage({ preference: { sound: false, theme: 'auto' } }); await prepare(sound);
  await sound.locator('#toggle-sound').click();
  assert.deepEqual(await sound.evaluate(() => JSON.parse(localStorage.getItem('km-preview-b10:settings'))), { sound: true, theme: 'auto' });
  assert.equal(await sound.locator('#toggle-sound').getAttribute('aria-pressed'), 'true');
  assert.equal(await sound.locator('#toggle-sound').getAttribute('title'), '静音');
  assert.notDeepEqual(await sound.locator('#toggle-sound path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d'))), mutedPaths);
  assert.equal(await sound.locator('#toggle-sound').evaluate(n => n === document.activeElement), true);
  await answer(sound); await sound.waitForFunction(() => window.__audioTrace.notes.length === 2);
  await next(sound); await answer(sound, false); await sound.waitForFunction(() => window.__audioTrace.notes.length === 3);
  const realAudio = await trace(sound); samples.push({ realAudio });
  assert.deepEqual(realAudio.notes.map(n => n.frequency), [660, 880, 220]);
  assert.ok(realAudio.notes.every(n => n.state === 'running')); assert.equal(realAudio.contexts, 1);
  await sound.locator('#toggle-sound').click(); const beforeMute = (await trace(sound)).notes.length;
  assert.equal(await sound.locator('#toggle-sound').getAttribute('title'), '开启提示音');
  assert.deepEqual(await sound.locator('#toggle-sound path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d'))), mutedPaths);
  await sound.locator('#retry-answer').click(); await answer(sound); assert.equal((await trace(sound)).notes.length, beforeMute);
  await sound.reload(); await sound.getByRole('button', { name: '继续练习', exact: true }).click();
  assert.equal(await sound.locator('#toggle-sound').getAttribute('aria-pressed'), 'false'); assert.equal((await trace(sound)).contexts, 0);
  await sound.locator('#toggle-sound').click(); await sound.reload(); await sound.getByRole('button', { name: '继续练习', exact: true }).click();
  assert.equal(await sound.locator('#toggle-sound').getAttribute('aria-pressed'), 'true'); assert.equal((await trace(sound)).contexts, 0);
  await sound.context().close();
  checks.push('PASS AC-15.4/5: 真实Web Audio正确双音660/880Hz、错误单音220Hz，复用1个上下文；开关保留焦点，关闭立即停止且刷新保留偏好，开启后刷新不自动播音');

  for (const mode of ['unsupported', 'blocked']) {
    const failure = await newPage({ mode }); await prepare(failure);
    await failure.locator('#toggle-sound').click(); await failure.locator('#sound-status:not([hidden])').waitFor();
    await answer(failure, false); assert.match(await failure.locator('#answer-status').textContent(), /正确答案/);
    await next(failure); await answer(failure); await next(failure);
    assert.equal((await active(failure)).cursor, 2); assert.equal((await trace(failure)).notes.length, 0);
    await failure.context().close();
  }
  checks.push('PASS: 浏览器无AudioContext或拒绝resume时明确提示，文字判分/订正入口/手动下一题仍可用，无未处理异常');

  const pending = await newPage({ mode: 'pending', preference: { sound: true } }); await prepare(pending);
  await answer(pending, false); assert.equal((await trace(pending)).resumes, 1);
  await pending.locator('#toggle-sound').click(); await pending.evaluate(() => window.__releaseAudio());
  assert.deepEqual((await trace(pending)).notes, []);
  await next(pending); await pending.context().close();
  const pendingLeave = await newPage({ mode: 'pending', preference: { sound: true } }); await prepare(pendingLeave);
  await answer(pendingLeave, false);
  await pendingLeave.locator('#exit-quiz').click(); await pendingLeave.getByRole('button', { name: '确认结束', exact: true }).click();
  await pendingLeave.locator('.result-page').waitFor(); await pendingLeave.evaluate(() => window.__releaseAudio());
  assert.deepEqual((await trace(pendingLeave)).notes, []); assert.equal((await trace(pendingLeave)).closes, 1); await pendingLeave.context().close();
  checks.push('PASS: 异步resume未完成时关闭音效或离开练习可取消迟到声音，释放上下文；不等待音频即可结算');

  const quota = await newPage({ quota: true }); await prepare(quota);
  await quota.locator('#toggle-sound').click(); assert.match(await quota.locator('#sound-status').textContent(), /本次打开期间/);
  assert.equal(await quota.locator('#toggle-sound').getAttribute('aria-pressed'), 'true');
  await answer(quota, false); assert.equal(Object.keys((await active(quota)).attempts).length, 1); await quota.context().close();
  const malformed = await newPage({ preference: { sound: 'true' } }); await prepare(malformed);
  assert.equal(await malformed.locator('#toggle-sound').getAttribute('aria-pressed'), 'false'); await malformed.context().close();
  checks.push('PASS: 偏好写入容量失败说明仅本次有效、不影响作答存储；非布尔偏好回退默认静音');

  const reduced = await newPage({ reducedMotion: 'reduce' }); await prepare(reduced);
  await answer(reduced); const reducedSample = await animation(reduced); samples.push({ reducedSample });
  assert.equal(reducedSample.name, 'none'); assert.equal(reducedSample.nextEnabled, true); assert.match(reducedSample.text, /答对/);
  await next(reduced); await reduced.context().close();
  checks.push('PASS: 系统减少动态效果时禁用非必要动效，完整保留文字、焦点与可立即操作的按钮');

  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 1440, height: 900 }]) {
    const mobile = viewport.width !== 1440;
    const page = await newPage({ viewport, mobile }); await prepare(page);
    const layout = await page.evaluate(() => {
      const button = document.querySelector('#toggle-sound'), r = button.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
        button: { width: r.width, height: r.height }, background: getComputedStyle(document.body).backgroundColor };
    });
    assert.equal(layout.overflow, false); assert.ok(layout.button.width >= 44 && layout.button.height >= 44); assert.equal(layout.background, 'rgb(255, 255, 255)'); layouts.push(layout);
    assert.equal(await page.locator('#toggle-sound svg').isVisible(), true);
    if (viewport.width === 390) await page.screenshot({ path: path.join(root, '.tmp', 'b09-mobile.png'), fullPage: false });
    await page.context().close();
  }
  checks.push('PASS: 360/390/667横屏/1440桌面新增控件无横向溢出、触控≥44px，页面白底');

  const automatic = await newPage(); await prepare(automatic);
  await answer(automatic); await automatic.getByText('第 2 / 共 10 题', { exact: true }).waitFor();
  assert.equal((await active(automatic)).cursor, 1); assert.equal(Object.keys((await active(automatic)).attempts).length, 1);
  await automatic.context().close();
  assert.deepEqual(errors, []);
  checks.push('PASS: 正确作答仍按既有700ms自动下一题且只前进一次；全部场景未捕获页面JavaScript异常');
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true });
  await fs.writeFile(path.join(root, '.tmp', 'b09-browser-results.json'), JSON.stringify({ executedAt: new Date().toISOString(), browser: await browser.version(), checks, samples, layouts }, null, 2));
  console.log(checks.join('\n'));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });
