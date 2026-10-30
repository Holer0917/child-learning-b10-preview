/**
 * 错题本页面（A03 + A04 + A05 + A06）
 */

import { el } from '../../utils/dom.js';
import { icon } from '../components/icon.js';
import { getActiveProfile } from '../../domain/profile.js';
import {
  readStore, syncMistakes,
  markMastered, unmarkMastered, clearMastered
} from '../../domain/mistakes.js';
import { startMistakePractice, mistakeErrorText } from '../../app/mistakePractice.js';
import { getKnowledgePoint } from '../../domain/syllabus.js';
import { formatDate } from '../../utils/date.js';
import { createSession, resumeSession } from '../../app/quizSession.js';
import { go } from '../../core/router.js';

const PAGE_SIZE = 20;

const state = {
  status: 'pending',
  kpId: '',
  selected: new Set(),
  visible: PAGE_SIZE,
  error: '',
  message: ''
};

const STATUS_LABELS = { pending: '待攻克', mastered: '已攻克', all: '全部' };

export function renderMistakes(root, ctx) {
  const status = ctx.query.get('status');
  state.status = ['pending', 'mastered', 'all'].includes(status) ? status : 'pending';
  state.kpId = ctx.query.get('kp') ?? '';
  state.selected = new Set();
  state.visible = PAGE_SIZE;
  state.error = '';
  state.message = '';
  const result = syncMistakes(getActiveProfile()?.id);
  if (!result.ok) state.error = mistakeErrorText(result.code);
  paint(root);
}

function paint(root, { resetScroll = false } = {}) {
  const scrollY = window.scrollY;
  const previousId = root.contains(document.activeElement) ? document.activeElement.id : null;
  const pid = getActiveProfile()?.id;

  if (!pid) {
    root.replaceChildren(el('section', { class: 'page' }, [
      el('h1', { text: '错题本', tabindex: -1 }),
      el('p', { class: 'muted', text: '还没有学习档案，请先返回首页。' }),
      el('a', { class: 'btn btn-primary', href: '#/home', text: '返回首页' })
    ]));
    return;
  }

  const store = readStore(pid);
  const all = store.items.slice().sort((a, b) => b.lastWrongAt - a.lastWrongAt);
  if (store.error) state.error = mistakeErrorText(store.error);
  const filtered = applyFilter(all);
  const selectableIds = new Set(filtered.filter(m => m.question).map(m => m.id));
  state.selected = new Set([...state.selected].filter(id => selectableIds.has(id)));
  const shown = filtered.slice(0, state.visible);
  const counts = {
    pending: all.filter((m) => !m.mastered).length,
    mastered: all.filter((m) => m.mastered).length,
    total: all.length
  };
  const kpOptions = buildKpOptions(all);

  root.replaceChildren(el('section', { class: 'page mistakes-page' }, [
    el('header', { class: 'page-head' }, [
      el('span', { class: 'eyebrow' }, [icon('book'), '把不会的，变成会的']),
      el('h1', { text: '错题本', tabindex: -1 }),
      el('p', { class: 'muted', text: '系统自动收集首次答错的题；可以勾选重练、举一反三，或标记已攻克。' }),
      el('div', { class: 'actions mistakes-head-actions' }, [
        el('a', { class: 'btn', href: '#/stats', text: '查看学习统计' })
      ])
    ]),

    el('section', { class: 'card mistakes-overview' }, [
      stat('待攻克', counts.pending),
      stat('已攻克', counts.mastered),
      stat('累计', counts.total)
    ]),

    el('section', { class: 'card' }, [
      el('div', { class: 'mistakes-toolbar' }, [
        el('div', { class: 'chips', 'aria-label': '按状态筛选' },
          ['pending', 'mastered', 'all'].map((s) =>
            el('button', {
              id: `status-${s}`, class: 'chip' + (state.status === s ? ' is-active' : ''),
              type: 'button',
              'aria-pressed': state.status === s ? 'true' : 'false',
              text: STATUS_LABELS[s],
              onclick: () => {
                if (state.status === s) return;
                state.status = s;
                state.selected.clear();
                state.visible = PAGE_SIZE;
                state.error = '';
                state.message = '';
                paint(root, { resetScroll: true });
              }
            })
          )),
        kpOptions.length > 1 ? el('select', {
          id: 'mistake-kp-select', class: 'mistake-kp-select',
          'aria-label': '按知识点筛选',
          onchange: (e) => {
            state.kpId = e.target.value;
            state.selected.clear();
            state.visible = PAGE_SIZE;
            state.error = '';
            state.message = '';
            paint(root, { resetScroll: true });
          }
        }, [
          el('option', { value: '', selected: !state.kpId, text: '全部知识点' }),
          ...kpOptions.map(({ id, name, count }) =>
            el('option', { value: id, selected: state.kpId === id, text: `${name}（${count}）` })
          )
        ]) : null
      ].filter(Boolean)),

      state.error ? el('div', { class: 'alert', role: 'alert' }, [
        el('p', { text: state.error }),
        el('button', { class: 'btn', text: '重试归档', onclick: () => {
          const result = syncMistakes(pid);
          state.error = result.ok ? '' : mistakeErrorText(result.code);
          state.message = result.ok ? '已重新核对归档。' : ''; paint(root);
        } })
      ]) : null,
      state.message ? el('p', { class: 'mistake-message', role: 'status', text: state.message }) : null,

      all.length === 0 ? emptyAll()
        : filtered.length === 0 ? emptyFiltered(root)
        : el('div', {}, [...new Set(shown.map(m => m.kpId))].map(kpId =>
          el('section', { class: 'mistake-group' }, [
            el('h2', { class: 'card-title', text: `${getKnowledgePoint(kpId)?.name ?? kpId} · ${filtered.filter(m => m.kpId === kpId).length} 道` }),
            el('ol', { class: 'mistake-list' }, shown.filter(m => m.kpId === kpId).map(m => mistakeRow(root, m)))
          ]))),

      filtered.length > state.visible ? el('button', {
        class: 'btn load-history',
        type: 'button',
        text: `再看 ${Math.min(PAGE_SIZE, filtered.length - state.visible)} 道更早的错题`,
        onclick: () => {
          state.visible += PAGE_SIZE;
          paint(root);
        }
      }) : null
    ]),

    counts.mastered > 0 ? el('section', { class: 'card mistake-cleanup' }, [
      el('h2', { class: 'card-title', text: '清理已攻克错题' }),
      el('p', { class: 'muted small', text: '清理后不可恢复；成绩历史与学习统计不受影响。' }),
      el('button', {
        class: 'link-btn',
        type: 'button',
        id: 'clear-mastered', text: '清理已攻克错题',
        onclick: () => confirmClearMastered(root)
      })
    ]) : null,

    el('p', { class: 'history-local-note' }, [
      icon('shield'),
      '错题保存在当前浏览器；更换设备或清理浏览器数据后无法自动找回。'
    ])
  ].filter(Boolean)));

  if (filtered.length > 0) root.appendChild(actionsBar(root, filtered));

  if (previousId) (document.getElementById(previousId) ?? root.querySelector('h1'))?.focus({ preventScroll: true });
  if (resetScroll) window.scrollTo(0, 0);
  else window.scrollTo(0, scrollY);
}

/* ------------------------------------------------------------------ *
 * 列表项
 * ------------------------------------------------------------------ */

function mistakeRow(root, m) {
  const checked = state.selected.has(m.id);
  const hasSnapshot = !!m.question;
  const kpName = getKnowledgePoint(m.kpId)?.name ?? m.kpId;

  const checkbox = el('input', {
    type: 'checkbox', id: `select-${m.id}`,
    checked,
    disabled: !hasSnapshot,
    'aria-label': `选择错题：${m.text}`
  });

  const toggleBtn = el('button', {
    id: `master-${m.id}`, class: 'link-btn mistake-master-btn',
    type: 'button',
    text: m.mastered ? '取消攻克' : '标记已攻克',
    'aria-label': m.mastered ? '取消这道错题的已攻克状态' : '把这道错题标记为已攻克',
    onclick: () => {
      const pid = getActiveProfile()?.id;
      if (!pid) return;
      const r = m.mastered ? unmarkMastered(pid, m.id) : markMastered(pid, m.id);
      if (!r.ok) { state.error = '操作失败，请重试。'; }
      else { state.error = ''; }
      paint(root);
    }
  });

  const li = el('li', {
    class: 'mistake-item' + (checked ? ' is-checked' : ''),
    dataset: { id: m.id }
  }, [
    el('label', { class: 'mistake-check' }, [checkbox]),
    el('div', { class: 'mistake-copy' }, [
      el('p', { class: 'mistake-question', text: m.text }),
      el('div', { class: 'mistake-meta' }, [
        el('span', { class: 'mistake-kp', text: kpName }),
        m.firstUserAnswer != null ? el('span', { class: 'wrong-answer', text: `首次错误：${m.firstUserAnswer}` }) : null,
        el('span', { class: 'wrong-answer', text: `${m.firstUserAnswer != null ? '最近错误' : '历史错误答案'}：${m.userAnswer}` }),
        el('span', { class: 'right-answer', text: `正确答案：${m.answer}` }),
        el('span', { text: `错 ${m.wrongCount} 次` }),
        el('span', { text: `首次：${formatDate(m.firstWrongAt, 'YYYY-MM-DD HH:mm')}` }),
        el('span', { text: `最近：${formatDate(m.lastWrongAt, 'YYYY-MM-DD HH:mm')}` }),
        m.mastered
          ? el('span', { class: 'mistake-tag', text: '已攻克' })
          : el('span', { class: 'mistake-tag is-pending', text: '待攻克' }),
        !hasSnapshot ? el('span', { class: 'warn-text', text: '旧记录，无法重练' }) : null
      ].filter(Boolean)),
      el('div', { class: 'mistake-inline-actions' }, [toggleBtn])
    ])
  ]);

  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) state.selected.add(m.id);
    else state.selected.delete(m.id);
    li.classList.toggle('is-checked', e.target.checked);
    refreshBar(root);
  });

  return li;
}

/* ------------------------------------------------------------------ *
 * 底部操作栏
 * ------------------------------------------------------------------ */

function actionsBar(root, filtered) {
  const selectable = filtered.filter((m) => m.question);
  const allSelected = selectable.length > 0
    && selectable.every((m) => state.selected.has(m.id));

  return el('div', { class: 'mistakes-actions card' }, [
    el('div', { class: 'row-between' }, [
      el('span', {
        class: 'muted small',
        'data-count': '',
        text: `已选 ${state.selected.size} 道（当前筛选共 ${filtered.length} 道）`
      }),
      el('button', {
        class: 'link-btn',
        type: 'button',
        'data-toggle': '',
        text: allSelected ? '取消全选' : '全选当前筛选',
        onclick: () => toggleAll(root)
      })
    ]),
    el('div', { class: 'mistakes-buttons' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        'aria-label': '生成重练卷并开始答题',
        onclick: () => startRetry(root)
      }, [
        el('span', {
          'data-retry-label': '',
          text: `生成重练卷并开始答题（${state.selected.size} 道）`
        }),
        icon('arrow')
      ]),
      el('button', {
        class: 'btn',
        type: 'button',
        'aria-label': '举一反三，每题 5 道变式',
        onclick: () => startVariant(root)
      }, [
        el('span', { text: '举一反三（每题 5 道）' })
      ])
    ])
  ]);
}

function toggleAll(root) {
  const pid = getActiveProfile()?.id;
  if (!pid) return;
  const filtered = applyFilter(readStore(pid).items);
  const selectable = filtered.filter((m) => m.question);
  const allSelected = selectable.length > 0
    && selectable.every((m) => state.selected.has(m.id));

  state.selected = allSelected ? new Set() : new Set(selectable.map((m) => m.id));

  root.querySelectorAll('.mistake-check input[type="checkbox"]').forEach((cb) => {
    const li = cb.closest('.mistake-item');
    const id = li?.dataset.id;
    if (!id) return;
    const next = state.selected.has(id);
    cb.checked = next;
    li.classList.toggle('is-checked', next);
  });

  state.error = '';
  state.message = '';
  refreshBar(root);
}

function refreshBar(root) {
  const bar = root.querySelector('.mistakes-actions');
  if (!bar) return;
  const pid = getActiveProfile()?.id;
  if (!pid) return;

  const filtered = applyFilter(readStore(pid).items);
  const selectable = filtered.filter((m) => m.question);
  const allSelected = selectable.length > 0
    && selectable.every((m) => state.selected.has(m.id));

  const countEl = bar.querySelector('[data-count]');
  const labelEl = bar.querySelector('[data-retry-label]');
  const toggleEl = bar.querySelector('[data-toggle]');

  if (countEl) countEl.textContent = `已选 ${state.selected.size} 道（当前筛选共 ${filtered.length} 道）`;
  if (labelEl) labelEl.textContent = `生成重练卷并开始答题（${state.selected.size} 道）`;
  if (toggleEl) toggleEl.textContent = allSelected ? '取消全选' : '全选当前筛选';
}

/* ------------------------------------------------------------------ *
 * 重练 / 变式
 * ------------------------------------------------------------------ */

function start(root, kind) {
  state.error = ''; state.message = '';
  const result = startMistakePractice([...state.selected], { kind });
  if (!result.ok) {
    state.error = result.message ?? mistakeErrorText(result.code);
    paint(root);
    if (result.code === 'NO_VARIANTS') root.querySelector('.mistakes-actions')?.appendChild(
      el('button', { class: 'btn', text: '重练原题', onclick: () => start(root, 'retry') }));
  }
}
function startRetry(root) { start(root, 'retry'); }
function startVariant(root) { start(root, 'variant'); }

/* ------------------------------------------------------------------ *
 * 清理已攻克
 * ------------------------------------------------------------------ */

function confirmClearMastered(root) {
  const count = readStore(getActiveProfile()?.id).items.filter(m => m.mastered).length;
  const dialog = el('dialog', {
    class: 'confirm-dialog', 'aria-labelledby': 'clear-title'
  }, [
    el('h2', { id: 'clear-title', text: '清理已攻克错题？' }),
    el('p', { text: `将清理 ${count} 道已攻克错题，不可恢复。成绩历史与学习统计不受影响。` }),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn', type: 'button', text: '取消',
        onclick: () => { dialog.close(); dialog.remove(); }
      }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: '确认清理',
        onclick: () => {
          const pid = getActiveProfile()?.id;
          if (pid) {
            const r = clearMastered(pid);
            state.message = r.ok
              ? `已清理 ${r.removed} 道已攻克错题`
              : '清理失败，请重试。';
            if (!r.ok) state.error = '清理失败，请检查浏览器存储空间。';
          }
          dialog.close();
          dialog.remove();
          paint(root);
        }
      })
    ])
  ]);
  root.append(dialog);
  dialog.addEventListener('cancel', () => { dialog.remove(); });
  dialog.showModal();
}

/* ------------------------------------------------------------------ *
 * 筛选与空状态
 * ------------------------------------------------------------------ */

function applyFilter(items) {
  return items.filter((m) => {
    if (state.status === 'pending' && m.mastered) return false;
    if (state.status === 'mastered' && !m.mastered) return false;
    if (state.kpId && m.kpId !== state.kpId) return false;
    return true;
  });
}

function buildKpOptions(items) {
  const map = new Map();
  for (const m of items) map.set(m.kpId, (map.get(m.kpId) ?? 0) + 1);
  return [...map.entries()].map(([id, count]) => ({
    id, count,
    name: getKnowledgePoint(id)?.name ?? id
  }));
}

function stat(label, value) {
  return el('div', { class: 'history-stat' }, [
    el('strong', { text: String(value) }),
    el('span', { text: label })
  ]);
}

function emptyAll() {
  return el('div', { class: 'history-empty' }, [
    icon('book'),
    el('h2', { text: '还没有错题' }),
    el('p', { class: 'muted', text: '完成一次练习后，首次答错的题会自动出现在这里。' }),
    el('a', { class: 'btn btn-primary', href: '#/practice', text: '去出题练习' })
  ]);
}

function emptyFiltered(root) {
  return el('div', { class: 'history-empty' }, [
    icon('book'),
    el('h2', { text: '当前筛选下没有错题' }),
    el('p', { class: 'muted', text: '试试切换状态或知识点筛选。' }),
    el('button', {
      class: 'btn', type: 'button', text: '查看全部错题',
      onclick: () => {
        state.status = 'all';
        state.kpId = '';
        state.selected.clear();
        state.visible = PAGE_SIZE;
        paint(root, { resetScroll: true });
      }
    })
  ]);
}