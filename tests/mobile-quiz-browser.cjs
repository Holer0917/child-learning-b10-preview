/** B06：触屏模拟、真实出题/会话接口与明确的边界样本；不读写用户数据。 */
const { chromium } = require('playwright');
const { toKnowledgeStep, openKnowledge, toSettings, selectGrade } = require('./practice-navigation.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const checks = [], layoutResults = [], inputResults = [];
const server = http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (url === '/' ? '/index.html' : url));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const data = await fs.readFile(file);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
    res.end(data);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const errors = [];
  const newPage = async (viewport = { width: 360, height: 640 }, mobile = true) => {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#/practice');
    await page.getByRole('button', {name:'创建档案',exact:true}).click();
    await page.locator('#profile-name').fill('手机反馈检查');
    await page.getByRole('button', {name:'创建档案',exact:true}).click();
    await page.locator('.start-page').waitFor();
    await page.goto(base + '/#/practice');
    return page;
  };
  const active = page => page.evaluate(() => {
    const pid = JSON.parse(localStorage.getItem('km-preview-b10:active'));
    return JSON.parse(localStorage.getItem(`km-preview-b10:quiz:active:${pid}`));
  });
  const tapKey = async (page, key) => {
    const names = { '.': '小数点', '/': '分数线', '⌫': '删除一位' };
    await page.getByRole('group', { name: '答题键盘' }).getByRole('button', { name: names[key] ?? key, exact: true }).tap();
  };
  const typeTouch = async (page, value) => { for (const char of value) await tapKey(page, char); };
  const prepare = async (page, options) => {
    const question = await page.evaluate(async opts => {
      const { generatePaper } = await import('/src/domain/generator.js');
      const { createSession } = await import('/src/app/quizSession.js');
      let paper;
      // 固定种子搜索首题含指定符号的有效卷，不改写其算式、答案或题序。
      for (let seed = 1; seed <= 100; seed++) {
        paper = generatePaper({ kpIds: [opts.kpId], count: 5, types: [opts.type], seed });
        if (!opts.contains || paper.questions[0].answer.includes(opts.contains)) break;
      }
      if (opts.contains && !paper.questions[0].answer.includes(opts.contains)) throw new Error('未找到所需固定样本');
      createSession(paper);
      return paper.questions[0];
    }, options);
    await page.goto(base + '/#/quiz?start=1');
    await page.locator('#quiz-answer:enabled').waitFor();
    return question;
  };
  const assertNewQuestionVisible = async page => {
    const fit = await page.evaluate(() => {
      const node = document.querySelector('.vertical-question') ?? document.querySelector('.quiz-question');
      const rect = node.getBoundingClientRect();
      return rect.top >= -1 && rect.bottom <= innerHeight + 1;
    });
    assert.equal(fit, true, '进入下一题后题目必须重新出现在可视区域');
  };

  const scenarios = [
    { name: '横式整数', kpId: 'G1-01', type: 'horizontal', mode: 'integer' },
    { name: '竖式商含0', kpId: 'G3-04', type: 'vertical', mode: 'integer' },
    { name: '比较大小', kpId: 'G2-06', type: 'compare', mode: 'compare' },
    { name: '填空', kpId: 'G1-01', type: 'fill', mode: 'integer' },
    { name: '含括号连算', kpId: 'G3-06', type: 'chain', mode: 'integer' },
    { name: '分数', kpId: 'G3-07', type: 'horizontal', mode: 'fraction', contains: '/' },
    { name: '小数', kpId: 'G3-08', type: 'horizontal', mode: 'decimal', contains: '.' },
    { name: '有余数', kpId: 'G3-05', type: 'horizontal', mode: 'remainder', contains: '余' },
    { name: '竖式小数', kpId: 'G3-08', type: 'vertical', mode: 'decimal', contains: '.' },
    { name: '竖式有余数', kpId: 'G3-05', type: 'vertical', mode: 'remainder', contains: '余' }
  ];
  for (const scenario of scenarios) {
    const page = await newPage();
    const question = await prepare(page, scenario);
    assert.equal(await page.locator('.keypad').getAttribute('data-mode'), scenario.mode);
    assert.equal(await page.locator('.key').count(), scenario.mode === 'compare' ? 4 : 12);
    assert.equal(await page.locator('#quiz-answer').getAttribute('inputmode'), 'none');
    await tapKey(page, scenario.mode === 'compare' ? '=' : '1');
    assert.equal(await page.locator('#quiz-answer').evaluate(node => node === document.activeElement), false);
    await tapKey(page, '⌫');
    assert.equal(await page.locator('#quiz-answer').inputValue(), '');
    let value = question.answer;
    if (scenario.mode === 'fraction') value = value.split('/').map(Number).map(n => n * 2).join('/');
    if (scenario.mode === 'decimal') value += '0';
    if (scenario.mode === 'compare') {
      await tapKey(page, question.answer === '<' ? '>' : '<');
      await tapKey(page, question.answer); // 改选符号应替换，不拼接。
    } else await typeTouch(page, value);
    assert.equal(await page.locator('#quiz-answer').inputValue(), value);
    assert.equal((await active(page)).draft, value);
    await page.getByRole('button', { name: '提交答案', exact: true }).tap();
    await page.getByText('第 2 / 共 5 题', { exact: true }).waitFor();
    const session = await active(page);
    assert.equal(session.attempts[question.id].correct, true, scenario.name);
    assert.equal(Object.keys(session.attempts).length, 1);
    assert.equal(session.cursor, 1);
    assert.equal(await page.locator('#quiz-answer').inputValue(), '');
    await assertNewQuestionVisible(page);
    inputResults.push({ name: scenario.name, mode: scenario.mode, value, expected: question.answer, correct: true });
    await page.context().close();
  }
  checks.push('PASS: 10 类真实生成题通过触屏键完成输入、退格、草稿保存、判分与自动下一题；分数等价及小数尾零正确，比较符号改选不拼接');

  // 另从出题界面走完整入口，验证当前页面确实按题目启用余数键。
  const flow = await newPage();
  await selectGrade(flow, '三年级', true);
  await openKnowledge(flow, true);
  await flow.getByRole('button', { name: '全不选', exact: true }).tap();
  await flow.locator('#kp-G3-05').check();
  await flow.locator('#kp-confirm').tap();
  await flow.locator('.kp-dialog').waitFor({ state: 'detached' });
  await toSettings(flow, true);
  await flow.locator('#custom-count').fill('5');
  await flow.locator('#generate-paper').tap();
  await flow.getByRole('button', { name: '开始答题', exact: true }).tap();
  await flow.locator('#quiz-answer').waitFor();
  const flowQuestion = (await active(flow)).paper.questions[0];
  assert.equal(await flow.locator('.keypad').getAttribute('data-mode'), 'remainder');
  await typeTouch(flow, flowQuestion.answer);
  await flow.getByRole('button', { name: '提交答案', exact: true }).tap();
  await flow.getByText('第 2 / 共 5 题', { exact: true }).waitFor();
  assert.equal((await active(flow)).attempts[flowQuestion.id].correct, true);
  await flow.context().close();
  checks.push('PASS: 从三年级选有余数知识点→出题→开始答题，全触屏输入含“余”的答案后正常判对');

  const edit = await newPage();
  const fraction = await prepare(edit, { kpId: 'G3-07', type: 'horizontal', contains: '/' });
  await typeTouch(edit, '12/34');
  await edit.locator('#quiz-answer').evaluate(node => node.setSelectionRange(0, 2));
  await tapKey(edit, '5');
  assert.equal(await edit.locator('#quiz-answer').inputValue(), '5/34');
  await tapKey(edit, '⌫');
  assert.equal(await edit.locator('#quiz-answer').inputValue(), '/34');
  await edit.locator('#quiz-answer').evaluate(node => node.setSelectionRange(0, node.value.length));
  await tapKey(edit, '⌫');
  assert.equal(await edit.locator('#quiz-answer').inputValue(), '');
  await edit.locator('#quiz-answer').fill('1'.repeat(40));
  await tapKey(edit, '2');
  assert.equal(await edit.locator('#quiz-answer').inputValue(), '1'.repeat(40));
  await tapKey(edit, '⌫'); await tapKey(edit, '2');
  assert.equal((await active(edit)).draft.length, 40);
  await edit.locator('#quiz-answer').fill('1/0');
  await edit.getByRole('button', { name: '提交答案', exact: true }).tap();
  await edit.getByRole('alert').filter({ hasText: '分母不能为 0' }).waitFor();
  assert.deepEqual((await active(edit)).attempts, {});
  for (let i = 0; i < 3; i++) await tapKey(edit, '⌫');
  await typeTouch(edit, fraction.answer);
  await edit.getByRole('button', { name: '提交答案', exact: true }).tap();
  await edit.getByText('第 2 / 共 5 题', { exact: true }).waitFor();
  await edit.context().close();
  checks.push('PASS: 分数光标选区替换、选区/单字退格、40 字上限正常；1/0 不计分，触屏订正后可正常提交');

  const recovery = await newPage({ width: 390, height: 844 });
  const decimal = await prepare(recovery, { kpId: 'G3-08', type: 'horizontal', contains: '.' });
  await typeTouch(recovery, '12.5');
  await recovery.setViewportSize({ width: 667, height: 375 });
  assert.equal(await recovery.locator('#quiz-answer').inputValue(), '12.5');
  await recovery.reload();
  await recovery.getByRole('button', { name: '继续练习', exact: true }).tap();
  assert.equal(await recovery.locator('#quiz-answer').inputValue(), '12.5');
  assert.equal(await recovery.locator('.keypad').getAttribute('data-mode'), 'decimal');
  for (let i = 0; i < 4; i++) await tapKey(recovery, '⌫');
  await typeTouch(recovery, decimal.answer);
  await recovery.getByRole('button', { name: '提交答案', exact: true }).tap();
  await recovery.getByText('第 2 / 共 5 题', { exact: true }).waitFor();
  await assertNewQuestionVisible(recovery);
  await recovery.context().close();
  checks.push('PASS: 竖屏输入小数→横屏尺寸→刷新继续，草稿及小数键保留，提交后下一题重新可见');

  const boundary = [
    { name: '四位数被除数竖式', kpId: 'G3-03', type: 'vertical', op: 'div', kind: 'int', text: '8991 ÷ 9 = ___', answer: '999', difficulty: 3,
      params: { op: 'div', a: 8991, b: 9, quotient: 999, rem: 0, result: 999, digits: 3 } },
    { name: '含括号长连算', kpId: 'G3-06', type: 'chain', op: 'mix', kind: 'int', text: '(90 + 60) ÷ 2 = ___', answer: '75', difficulty: 3,
      params: { op: 'mix', a: 90, b: 60, c: 2, op1: '+', op2: '÷', paren: true, mid: 150, result: 75, digits: 2 } },
    { name: '双分数长算式', kpId: 'G3-07', type: 'horizontal', op: 'add', kind: 'fraction', text: '9/10 + 9/10 = ___', answer: '9/5', difficulty: 2,
      params: { op: 'add', a: 9, b: 9, denom: 10, result: 18, num: 18, denomRaw: 10, kind: 'fraction' } },
    { name: '小数竖式', kpId: 'G3-08', type: 'vertical', op: 'add', kind: 'decimal', text: '98.8 + 1.2 = ___', answer: '100', difficulty: 3,
      params: { op: 'add', a: '98.8', b: '1.2', result: 100, scale: 1, kind: 'decimal', digits: 2 } },
    { name: '四位数比较', kpId: 'G2-06', type: 'compare', op: 'compare', kind: 'sign', text: '9999 ○ 1000', answer: '>', difficulty: 2,
      params: { op: 'compare', a: 9999, b: 1000, result: '>', digits: 4 } }
  ];
  const sizes = [[320, 568], [360, 640], [390, 844], [414, 896], [360, 480], [568, 320], [667, 375], [844, 390], [768, 1024]];
  const prepareBoundary = async (page, fixture) => {
    await page.evaluate(async item => {
      const { buildVerticalLayout } = await import('/src/domain/generator.js');
      const { createSession, discardSession } = await import('/src/app/quizSession.js');
      discardSession();
      const { calculatePaperStats } = await import('/src/domain/paper.js');
      const q = { ...item, id: 'q-boundary' };
      if (q.type === 'vertical') q.layout = buildVerticalLayout(q);
      const questions = [q];
      createSession({ id: `boundary-${item.kpId}`, questions, stats: calculatePaperStats(questions), createdAt: Date.now(),
        options: { kpIds: [q.kpId], count: 1, requested: 5, difficulty: 'normal', types: [q.type] }, removedCount: 4, shortfall: 4 });
    }, fixture);
    await page.goto(base + '/?boundary=' + Date.now() + '#/quiz?start=1');
    await page.locator('#quiz-answer:enabled').waitFor();
  };
  for (const fixture of boundary) {
    const page = await newPage();
    await prepareBoundary(page, fixture);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await page.evaluate(() => {
        const stem = document.querySelector('.vertical-question') ?? document.querySelector('.quiz-question');
        const input = document.querySelector('#quiz-answer');
        const keypad = document.querySelector('.keypad');
        const field = input.getBoundingClientRect(), keys = keypad.getBoundingClientRect();
        const bottom = Math.max(field.bottom, keys.bottom) + scrollY;
        const top = Math.min(field.top, keys.top) + scrollY;
        window.scrollTo(0, Math.max(0, bottom - innerHeight + 12)); // 模拟用户滚动到可同时看到输入与按键的位置。
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          pageHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight,
          stemFits: stem.scrollWidth <= stem.clientWidth && stem.scrollHeight <= stem.clientHeight + 1,
          font: parseFloat(getComputedStyle(stem).fontSize), together: bottom - top <= innerHeight - 16,
          inner: [innerWidth, innerHeight], columns: getComputedStyle(document.querySelector('.quiz-card')).gridTemplateColumns,
          media: { coarse: matchMedia('(pointer: coarse)').matches, short: matchMedia('(max-height: 500px)').matches, wide: matchMedia('(min-width: 560px)').matches },
          compactQueries: [...document.styleSheets[0].cssRules].filter(rule => rule.conditionText?.includes('500px')).map(rule => rule.conditionText),
          field: { top: field.top, bottom: field.bottom }, keypad: { top: keys.top, bottom: keys.bottom },
          background: getComputedStyle(document.body).backgroundColor,
          keys: [...document.querySelectorAll('.key, .quiz-actions button')].map(node => ({ w: node.getBoundingClientRect().width, h: node.getBoundingClientRect().height }))
        };
      });
      assert.equal(metrics.overflow, false, `${fixture.name}/${width}×${height} 页面溢出`);
      assert.ok(metrics.pageHeight <= metrics.viewportHeight + 1, `${fixture.name}/${width}×${height} 需要滚动: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.media.coarse, true, '布局检查必须保持触屏模拟，避免截图改变模拟状态后得到失真的结果');
      assert.equal(metrics.stemFits, true, `${fixture.name}/${width}×${height} 题目被裁切`);
      assert.ok(metrics.font >= 32);
      assert.equal(metrics.together, true, `${fixture.name}/${width}×${height} 输入框与按键无法同时查看：${JSON.stringify(metrics)}`);
      assert.equal(metrics.background, 'rgb(255, 255, 255)');
      assert.ok(metrics.keys.every(key => key.w >= 44 && key.h >= 44));
      await tapKey(page, fixture.kind === 'sign' ? '<' : '1');
      const fieldVisible = await page.locator('#quiz-answer').evaluate(node => {
        const r = node.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === node;
      });
      assert.equal(fieldVisible, true, `${fixture.name}/${width}×${height} 点键后输入框被遮挡或离屏`);
      await tapKey(page, '⌫');
      await page.locator('#quiz-answer').evaluate((node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));},fixture.kind==='sign'?'<':'999999');
      await page.locator('#submit-answer').click();
      await page.locator('.feedback-animal[src$="/incorrect.png"]').waitFor();
      await page.waitForFunction(()=>document.querySelector('.feedback-animal')?.naturalWidth>0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),true,`${fixture.name}/${width}x${height} wrong-feedback needs scroll`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await prepareBoundary(page,fixture);
      layoutResults.push({ fixture: fixture.name, width, height, font: metrics.font, fits: true });
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
    if (fixture.type === 'vertical') {
      assert.equal(await page.locator('#quiz-question').getAttribute('class'), 'quiz-question visually-hidden');
      assert.equal(await page.locator('.vertical-question').getAttribute('aria-hidden'), 'true');
      assert.ok((await page.locator('#quiz-answer').getAttribute('aria-describedby')).includes('quiz-question'));
    }
    await page.context().close();
  }
  checks.push('PASS: 5 类合法边界样本×9 种手机/横屏/缩小视口/平板尺寸，共 45 组，无裁切/横溢出，题字 ≥32px、触控区 ≥44px，点键后输入框可见且不被覆盖');
  checks.push('PASS: 竖式视觉只显示上下版式，读屏保留完整题干；深色系统主题仍为白底');

  // 本机 Edge 的 fullPage 截图会改变 pointer 媒体状态；独立上下文仅截取视口。
  for (const [width, height] of [[390, 844], [667, 375]]) {
    const page = await newPage({ width, height });
    await prepareBoundary(page, boundary[0]);
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    if (height < 500) await page.evaluate(() => {
      const bottom = Math.max(document.querySelector('#quiz-answer').getBoundingClientRect().bottom,
        document.querySelector('.keypad').getBoundingClientRect().bottom) + scrollY;
      window.scrollTo(0, Math.max(0, bottom - innerHeight + 12));
    });
    await fs.mkdir(path.join(root, '.tmp'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.tmp', `b06-quiz-${width}x${height}.png`), fullPage: false });
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    await page.context().close();
  }

  const desktop = await newPage({ width: 1440, height: 900 }, false);
  const desktopQ = await prepare(desktop, { kpId: 'G3-07', type: 'horizontal', contains: '/' });
  assert.equal(await desktop.locator('#quiz-answer').evaluate(node => node === document.activeElement), true);
  await desktop.locator('#quiz-answer').fill(desktopQ.answer);
  await desktop.locator('#quiz-answer').press('Enter');
  await desktop.getByText('第 2 / 共 5 题', { exact: true }).waitFor();
  assert.equal((await active(desktop)).attempts[desktopQ.id].correct, true);
  await desktop.evaluate(async () => {
    const { mountKeypad } = await import('/src/ui/components/keypad.js');
    const input = document.createElement('input'); input.id = 'legacy-key-input';
    const wrapper = document.createElement('section'); wrapper.id = 'legacy-keyboard';
    wrapper.append(input, mountKeypad(input, value => { wrapper.dataset.draft = value; }));
    document.body.append(wrapper);
  });
  assert.equal(await desktop.locator('#legacy-keyboard .key').count(), 18);
  await desktop.locator('#legacy-keyboard').getByRole('button', { name: '1', exact: true }).click();
  assert.equal(await desktop.locator('#legacy-key-input').inputValue(), '1');
  assert.equal(await desktop.locator('#legacy-key-input').evaluate(node => node === document.activeElement), true);
  checks.push('PASS: 桌面原生输入与 Enter 判分正常；旧两参数 mountKeypad 调用保留 18 键及输入聚焦行为');
  assert.deepEqual(errors, []);
  checks.push('PASS: 全部手机作答、异常、旋转恢复及桌面路径未捕获页面异常为 0');
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true });
  await fs.writeFile(path.join(root, '.tmp', 'b06-browser-results.json'), JSON.stringify({ executedAt: new Date().toISOString(), browser: await browser.version(), checks, inputResults, layouts: layoutResults }, null, 2));
  console.log(checks.join('\n'));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
