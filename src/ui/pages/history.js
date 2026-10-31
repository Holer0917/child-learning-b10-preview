import { el } from '../../utils/dom.js';
import { icon } from '../components/icon.js';
import {
  listHistory, summarizeHistory, deleteHistoryRecord, filterHistory
} from '../../domain/history.js';
import { getKnowledgePoint } from '../../domain/syllabus.js';
import { formatDate } from '../../utils/date.js';
import { formatAccuracy, humanDuration } from '../../utils/format.js';

export function renderHistory(root, ctx) {
  const requested = Number(ctx?.query.get('limit') ?? 10);
  const limit = [0, 5, 10, 30].includes(requested) ? requested : 10;
  let visible = 20;
  const filters = { from: '', to: '', kpId: '' };
  const stat = (label, value) => el('div', { class: 'history-stat' },
    [el('strong', { text: value }), el('span', { text: label })]);

  function paint(focusId = document.activeElement?.id) {
    const records = listHistory();
    const summary = summarizeHistory(records);
    const allKpIds = collectKpIds(records);
    const filtered = filterHistory(records, filters);
    const shown = filtered.slice(0, limit || visible);

    root.replaceChildren(el('section', { class: 'page history-page' }, [
      el('header', { class: 'page-head' }, [
        el('span', { class: 'eyebrow' }, [icon('trophy'), '每一次认真，都留在这里']),
        el('h1', { text: '成绩历史' }),
        el('p', { class: 'muted', text: '查看当前孩子的近期练习，点击“查看详情”回顾该次表现。' })
      ]),
      el('section', { class: 'card history-overview' }, [
        stat('累计练习', `${summary.count} 次`),
        stat('累计题量', `${summary.total} 道`),
        stat('整体正确率', summary.accuracy == null ? '—' : formatAccuracy(summary.accuracy))
      ]),
      el('section', { class: 'card' }, [
        el('div', { class: 'history-toolbar' }, [
          el('h2', { class: 'card-title' }, [icon('clock'), '练习记录']),
          el('div', { class: 'chips history-filters', 'aria-label': '显示范围' }, [5, 10, 30, 0].map(n => el('a', {
            class: 'chip' + (n === limit ? ' is-active' : ''), href: `#/history?limit=${n}`,
            'aria-current': n === limit ? 'true' : null, text: n ? `最近 ${n} 次` : '全部记录'
          })))
        ]),

        filterBar(allKpIds, filters, () => paint()),
        filters.from && filters.to && filters.from > filters.to ? el('p', { class: 'alert', role: 'alert', text: '开始日期不能晚于结束日期。' }) : null,

        filtered.length ? el('p', { class: 'muted small history-count', text: `已保留 ${records.length} 次练习，当前筛选显示 ${shown.length} 次；按完成时间从新到旧排列。` }) : null,
        filtered.length ? el('ol', { class: 'history-list' }, shown.map(r => recordCard(r, () => {
          if (window.confirm(`确定删除 ${formatDate(r.finishedAt, 'YYYY-MM-DD HH:mm')} 的练习记录吗？删除后无法恢复；由已保留历史计算的趋势或掌握度将相应变化，不会删除独立错题本条目。`)) {
            const ok = deleteHistoryRecord(r.id);
            if (!ok) window.alert('删除失败，请检查浏览器存储状态。');
            else paint();
          }
        }))) : el('div', { class: 'history-empty' }, [
          icon('book'),
          el('h2', { text: filters.from || filters.to || filters.kpId ? '没有符合条件的记录' : '第一份成绩，等你来创造' }),
          el('p', { class: 'muted', text: filters.from || filters.to || filters.kpId ? '试试调整筛选条件。' : '完成一份口算练习，成绩就会自动保存在这里。' }),
          filters.from || filters.to || filters.kpId
            ? el('button', { class: 'btn', text: '清除筛选', onclick: () => { filters.from = ''; filters.to = ''; filters.kpId = ''; paint(); } })
            : el('a', { class: 'btn btn-primary', href: '#/practice', text: '开始出题练习' })
        ]),
        limit === 0 && shown.length < filtered.length ? el('button', { class: 'btn load-history', text: '再看更早的记录', onclick: () => { const index = shown.length; visible += 20; paint(); root.querySelectorAll('.history-record')[index]?.focus(); } }) : null
      ]),
      el('p', { class: 'history-local-note' }, [icon('shield'), '这里显示当前浏览器保存的练习记录；更换设备或清理浏览器数据后无法自动找回。'])
    ]));
    if (focusId) (document.getElementById(focusId) ?? root.querySelector('h1'))?.focus({ preventScroll: true });
  }
  paint();
}

function filterBar(allKpIds, filters, onChange) {
  const kpSelect = el('select', {
    id: 'history-kp', class: 'input',
    onchange: (e) => { filters.kpId = e.target.value; onChange(); }
  }, [
    el('option', { value: '', text: '全部知识点' }),
    ...allKpIds.map(id => el('option', { value: id, text: getKnowledgePoint(id)?.name ?? id }))
  ]);
  kpSelect.value = filters.kpId ?? '';

  return el('div', { class: 'history-filter-bar' }, [
    el('label', { class: 'filter-field' }, [
      el('span', { class: 'field-label', text: '从' }),
      el('input', {
        id: 'history-from', type: 'date', class: 'input', value: filters.from,
        onchange: (e) => { filters.from = e.target.value; onChange(); }
      })
    ]),
    el('label', { class: 'filter-field' }, [
      el('span', { class: 'field-label', text: '到' }),
      el('input', {
        id: 'history-to', type: 'date', class: 'input', value: filters.to,
        onchange: (e) => { filters.to = e.target.value; onChange(); }
      })
    ]),
    el('label', { class: 'filter-field' }, [
      el('span', { class: 'field-label', text: '知识点' }),
      kpSelect
    ])
  ]);
}

function collectKpIds(records) {
  const ids = new Set();
  for (const r of records) {
    for (const kpId of Object.keys(r.kpCount ?? {})) ids.add(kpId);
    for (const q of r.paper?.questions ?? []) if (q.kpId) ids.add(q.kpId);
  }
  return [...ids];
}

function recordCard(r, onDelete) {
  const counts = r.compressed ? r.kpCount ?? {} : Object.fromEntries((r.paper?.questions ?? []).map(q => [q.kpId, 1]));
  const topics = Object.keys(counts).map(id => getKnowledgePoint(id)?.name ?? id);

  const card = el('article', {
    class: 'history-record', tabindex: -1,
  }, [
    el('div', { class: 'record-score' }, [
      el('strong', { text: formatAccuracy(r.accuracy) }),
      el('span', { class: `record-grade grade-${r.grade.key}`, text: r.grade.label })
    ]),
    el('div', { class: 'record-copy' }, [
      el('time', { dateTime: new Date(r.finishedAt).toISOString(), text: formatDate(r.finishedAt, 'YYYY-MM-DD HH:mm') }),
      el('p', { class: 'record-counts', text: `${r.total} 题 · 正确 ${r.correct} · 错误 ${r.wrong} · 未作答 ${r.skipped}` }),
      el('p', {
        class: 'record-topics', title: topics.join('、'),
        text: topics.length > 2 ? `${topics[0]} 等 ${topics.length} 个知识点` : topics.length ? topics.join('、') : '口算练习'
      }),
      r.compressed ? el('span', { class: 'summary-label', text: '摘要 · 无逐题明细' }) : null
    ]),
    el('span', { class: 'record-duration' }, [icon('clock'), humanDuration(r.elapsedMs)]),
    el('a', {
      class: 'btn record-detail', href: `#/result?id=${encodeURIComponent(r.id)}`,
      'aria-label': `查看详情：${formatDate(r.finishedAt, 'YYYY-MM-DD HH:mm')} 的练习`
    }, '查看详情')
  ]);

  const deleteBtn = el('button', {
    id: `delete-${r.id}`, class: 'record-delete',
    type: 'button',
    'aria-label': `删除 ${formatDate(r.finishedAt, 'YYYY-MM-DD HH:mm')} 的成绩`,
    title: '删除记录',
    onclick: onDelete
  }, '✕');

  const item = el('li', { class: 'history-record-item',  },
    [card, deleteBtn]);

  return item;
}
