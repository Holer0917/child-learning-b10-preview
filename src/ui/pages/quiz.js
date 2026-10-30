import { el } from '../../utils/dom.js';
import { formatDuration } from '../../utils/format.js';
import { go } from '../../core/router.js';
import { resumeSession, saveDraft, recordAttempt, advance, finishSession,
  discardSession, elapsedMs, expired, savedDurably } from '../../app/quizSession.js';
import { mountKeypad } from '../components/keypad.js';
import { icon } from '../components/icon.js';
import { focusElement } from '../../utils/accessibility.js';
import { consecutiveCorrect, createAnswerFeedback } from '../components/feedback.js';
import { readStore, mistakeKeyOf } from '../../domain/mistakes.js';
import { startMistakePractice } from '../../app/mistakePractice.js';

export function renderQuiz(root, ctx) {
  let autoNext = null, ticker = null, disposed = false, retrying = false;
  const answerFeedback = createAnswerFeedback(updateSoundControls);
  function updateSoundControls() {
    const state = answerFeedback.state(), button = root.querySelector('#toggle-sound');
    if (button) {
      button.textContent = `提示音：${state.enabled ? '开启' : '关闭'}`;
      button.setAttribute('aria-pressed', String(state.enabled));
    }
    const notice = root.querySelector('#sound-status');
    if (notice) { notice.textContent = state.message; notice.hidden = !state.message; }
  }
  const initial = resumeSession();
  const clearAuto = () => { clearTimeout(autoNext); autoNext = null; };
  function empty() {
    root.replaceChildren(el('section', { class: 'card' }, [
      el('h1', { text: '还没有进行中的练习' }),
      el('a', { class: 'btn btn-primary', href: '#/practice', text: '去出题' })
    ]));
  }
  function finish(reason) {
    clearAuto();
    clearInterval(ticker);
    const result = finishSession(reason);
    go(result ? '/result' : '/home');
  }
  function next() {
    clearAuto();
    if (!resumeSession()) return;
    retrying = false;
    if (advance()) go('/result');
    else draw(true);
  }
  function tick() {
    const s = resumeSession();
    if (!s || disposed) return;
    if (expired(s)) { finish('timeout'); return; }
    const label = root.querySelector('[data-timer]');
    if (label) label.textContent = `已用 ${formatDuration(elapsedMs(s))}`
      + (s.limitMs === null ? '' : ` · 剩余 ${formatDuration(Math.max(0, s.limitMs - elapsedMs(s)))}`);
  }
  function exit() {
    clearAuto();
    answerFeedback.stop();
    const cancelExit = () => { dialog.close(); dialog.remove(); draw(false, 'exit-quiz'); };
    const dialog = el('dialog', { class: 'confirm-dialog', 'aria-labelledby': 'exit-title',
      'aria-describedby': 'exit-description' }, [
      el('h2', { id: 'exit-title', text: '结束本次练习？' }),
      el('p', { id: 'exit-description', text: '已答题会结算，剩余题记为未作答。' }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn', text: '继续答题', autofocus: true, onclick: cancelExit }),
        el('button', { class: 'btn btn-primary', text: '确认结束', onclick: () => { dialog.close(); dialog.remove(); finish('exit'); } })
      ])
    ]);
    root.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancelExit(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.querySelectorAll('button')];
      const target = event.shiftKey && document.activeElement === buttons[0] ? buttons.at(-1)
        : !event.shiftKey && document.activeElement === buttons.at(-1) ? buttons[0] : null;
      if (target) { event.preventDefault(); focusElement(target); }
    });
    dialog.showModal();
  }
  function draw(reveal = false, restoreId) {
    clearAuto();
    answerFeedback.stop();
    const s = resumeSession();
    if (!s) { empty(); return; }
    if (expired(s)) { finish('timeout'); return; }
    const q = s.paper.questions[s.cursor];
    const coarse = matchMedia('(pointer: coarse)').matches;
    const vertical = q.type === 'vertical' && q.layout?.rows;
    const keypadMode = q.kind === 'sign' || q.type === 'compare' ? 'compare'
      : q.params?.rem ? 'remainder' : q.kind === 'fraction' ? 'fraction'
        : q.kind === 'decimal' ? 'decimal' : 'integer';
    const first = s.attempts[q.id], correction = s.retries[q.id];
    const feedback = correction ?? first;
    const editing = !first || retrying;
    const status = el('p', { id: 'answer-status', class: 'answer-feedback', role: 'status',
      'aria-live': 'polite', 'aria-atomic': 'true' });
    const input = el('input', { id: 'quiz-answer', class: 'answer-input', type: 'text',
      inputmode: coarse ? 'none' : 'text', enterkeyhint: 'done',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      maxlength: 40, 'aria-describedby': 'quiz-question answer-hint answer-error' });
    input.value = editing ? s.draft : feedback.userAnswer;
    input.disabled = !editing;
    const error = el('p', { id: 'answer-error', class: 'warn-text', role: 'alert' });
    const warnSave = () => {
      if (!savedDurably()) error.textContent = '进度暂存在当前页面，关闭或刷新可能丢失。';
    };
    function submit(skip = false) {
      if (!editing) return;
      try {
        const a = recordAttempt(input.value, { retry: retrying, skip });
        if (a.timedOut) { finish('timeout'); return; }
        retrying = false;
        draw(true);
        if (a.correct) root.querySelector('#answer-status')?.classList.add('feedback-pulse');
        if (!a.skipped) answerFeedback.play(a.correct);
      } catch (e) {
        error.textContent = e.message;
        input.setAttribute('aria-invalid', 'true');
        focusElement(input);
        if (coarse) input.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
    const changed = value => {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
      saveDraft(value);
      warnSave();
    };
    input.addEventListener('input', () => changed(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing && !e.repeat) { e.preventDefault(); submit(); }
    });
    if (feedback && !retrying) {
      status.classList.add(feedback.correct ? 'is-correct' : 'is-wrong');
      status.textContent = feedback.skipped ? '已跳过，本题记为未作答。'
        : feedback.correct ? (correction ? '✓ 订正正确！首次成绩保留。' : '✓ 答对了！')
          : `✗ ${correction ? '再练练，' : ''}正确答案是 ${feedback.expected}`;
      const streak = consecutiveCorrect(s);
      if (streak >= 5 && !correction) status.textContent += ` 连对 ${streak} 题，继续加油！`;
    } else if (retrying) status.textContent = '再试一次；首次成绩不会改变。';
    const actions = editing ? [
      el('button', { id: 'submit-answer', class: 'btn btn-primary', text: '提交答案', onclick: () => submit() }),
      retrying ? el('button', { id: 'cancel-retry', class: 'btn', text: '不再订正', onclick: () => { retrying = false; draw(); } })
        : el('button', { id: 'skip-question', class: 'btn', text: '跳过', onclick: () => submit(true) })
    ] : [
      el('button', { id: 'next-question', class: 'btn btn-primary', 'aria-describedby': 'answer-status',
        text: s.cursor === s.paper.questions.length - 1 ? '查看成绩' : '下一题', onclick: next }),
      first && !first.correct && !first.skipped && !correction ? el('button', {
        id: 'retry-answer', class: 'btn', text: '再试一次', onclick: () => { retrying = true; draw(true); }
      }) : null,
      first && !first.correct && !first.skipped ? el('button', {
        id: 'variant-from-answer', class: 'btn', text: '举一反三', onclick: () => {
          if (!window.confirm('先结束并保存本次练习，再生成 5 道同类题？未答题记为未作答。')) return;
          clearAuto(); clearInterval(ticker);
          const result = finishSession('exit');
          const m = readStore(s.profileId).items.find(m => m.key === mistakeKeyOf(q));
          if (!m || result?.saved === false) { go('/result'); return; }
          const started = startMistakePractice([m.id], { kind: 'variant' });
          if (!started.ok) { go('/result'); }
        }
      }) : null
    ];
    root.replaceChildren(el('section', { class: 'page quiz-page' }, [
      el('div', { class: 'row-between quiz-heading' }, [
        el('div', {}, [el('span', { class: 'eyebrow' }, [icon('leaf'), '专注的小小时间']),
          el('h1', { id: 'quiz-title', tabindex: -1, text: '口算练习' }), el('p', { class: 'muted', text: '慢慢想，你一定可以。' })]),
        el('div', { class: 'quiz-tools' }, [
          el('button', { id: 'toggle-sound', class: 'btn sound-toggle', type: 'button',
            'aria-pressed': String(answerFeedback.state().enabled), 'aria-describedby': 'sound-status',
            text: `提示音：${answerFeedback.state().enabled ? '开启' : '关闭'}`,
            onclick: () => answerFeedback.setSoundEnabled(!answerFeedback.state().enabled) }),
          el('button', { id: 'exit-quiz', class: 'link-btn', text: '退出练习', onclick: exit })
        ])
      ]),
      el('div', { class: 'paper-meta quiz-meta' }, [
        el('span', { class: 'progress-label', text: `第 ${s.cursor + 1} / 共 ${s.paper.questions.length} 题` }),
        el('span', { class: 'timer-label' }, [icon('clock'), el('span', { 'data-timer': '', role: 'timer' })])
      ]),
      el('progress', { class: 'quiz-progress', max: s.paper.questions.length, value: s.cursor,
        'aria-label': '已完成题数' }),
      el('p', { id: 'sound-status', class: 'sound-status muted small', role: 'status', hidden: true }),
      el('section', { class: 'card quiz-card' + (feedback && !editing ? ' has-feedback' : '') }, [
        el('div', { class: 'quiz-problem' }, [
        el('span', { class: 'question-tag', text: `QUESTION ${String(s.cursor + 1).padStart(2, '0')}` }),
        el('h2', { id: 'quiz-question', class: 'quiz-question' + (vertical ? ' visually-hidden' : ''), text: q.text }),
        vertical ? el('pre', { class: 'vertical-question', 'aria-hidden': 'true',
          text: q.layout.rows.join('\n') + '\n' + '─'.repeat(Math.max(4, q.layout.width || 4)) }) : null,
        el('label', { for: 'quiz-answer', class: 'field-label', text: '你的答案' }), input,
        el('p', { id: 'answer-hint', class: 'muted small', text: keypadMode === 'fraction' ? '分数写成 1/2，点击“/”输入分数线。'
          : keypadMode === 'compare' ? '选择 <、= 或 >，再提交答案。'
            : keypadMode === 'remainder' ? '有余数时写成 9余2，点击“余”分开商和余数。'
              : keypadMode === 'decimal' ? '小数写成 3.5，点击“.”输入小数点。' : '输入答案，按回车或点击提交。' }),
        q.difficultyNote ? el('p', { class: 'variant-note', text: q.difficultyNote }) : null,
        status, error]),
        el('div', { class: 'quiz-controls' }, [
        el('div', { class: 'keypad-caption' }, [icon('grid'), editing ? '敲下你的答案' : '每一步，都算进步']),
        mountKeypad(input, changed, { mode: keypadMode, focusInput: !coarse }),
        el('div', { class: 'actions quiz-actions' }, actions)
        ])
      ])
    ]));
    updateSoundControls();
    warnSave();
    tick();
    focusElement(restoreId ? root.querySelector(`#${restoreId}`)
      : editing ? (coarse ? root.querySelector('#quiz-title') : input) : root.querySelector('#next-question'));
    if (coarse && reveal) root.querySelector('.quiz-page')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (feedback?.correct && !editing) autoNext = setTimeout(next, 700);
  }
  function begin() {
    draw(true);
    if (resumeSession()) ticker = setInterval(tick, 500);
  }
  if (!initial) empty();
  else if (ctx.query.get('start') === '1') {
    window.history.replaceState(null, '', '#/quiz');
    begin();
  } else {
    root.replaceChildren(el('section', { class: 'card' }, [
      el('h1', { text: '继续上次练习？' }),
      el('p', { text: `已保留第 ${initial.cursor + 1} / ${initial.paper.questions.length} 题的进度。计时包含离开页面的时间。` }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn btn-primary', text: '继续练习', onclick: begin }),
        el('button', { class: 'btn', text: '放弃练习', onclick: () => {
          if (window.confirm('放弃本次练习？未结算的进度将被删除。')) { discardSession(); go('/home'); }
        } })
      ])
    ]));
  }
  return { dispose() { disposed = true; clearAuto(); clearInterval(ticker); answerFeedback.dispose(); },
    beforeLeave() { return !resumeSession() || window.confirm('离开答题页？进度已暂存，可回首页继续练习。'); } };
}
