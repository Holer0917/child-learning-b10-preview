import { el } from '../../utils/dom.js';
import { icon } from '../components/icon.js';
import { listHistory, summarizeHistory } from '../../domain/history.js';
import { getKnowledgePoint } from '../../domain/syllabus.js';
import { formatDate } from '../../utils/date.js';
import { formatAccuracy, humanDuration } from '../../utils/format.js';
import { focusElement } from '../../utils/accessibility.js';

export function renderHistory(root, ctx) {
  const records = listHistory();
  const requested = Number(ctx?.query.get('limit') ?? 10);
  const limit = [0, 5, 10, 30].includes(requested) ? requested : 10;
  let visible = 20;
  const summary = summarizeHistory(records);
  const stat = (label, value) => el('div', { class: 'history-stat' }, [el('strong', { text: value }), el('span', { text: label })]);
  function paint(revealIndex) {
    const shown = records.slice(0, limit || visible);
    root.replaceChildren(el('section', { class: 'page history-page' }, [
      el('header', { class: 'page-head' }, [
        el('span', { class: 'eyebrow' }, [icon('trophy'), '每一次认真，都留在这里']),
        el('h1', { text: '成绩历史' }),
        el('p', { class: 'muted', text: '查看当前孩子的近期练习，点开一条记录，看看当时的表现。' })
      ]),
      el('section', { class: 'card history-overview' }, [stat('累计练习', `${summary.count} 次`),
        stat('累计题量', `${summary.total} 道`), stat('整体正确率', summary.accuracy == null ? '—' : formatAccuracy(summary.accuracy))]),
      el('section', { class: 'card' }, [
        el('div', { class: 'history-toolbar' }, [el('h2', { class: 'card-title' }, [icon('clock'), '练习记录']),
          el('div', { class: 'chips history-filters', 'aria-label': '显示范围' }, [5, 10, 30, 0].map(n => el('a', {
            class: 'chip' + (n === limit ? ' is-active' : ''), href: `#/history?limit=${n}`,
            'aria-current': n === limit ? 'true' : null, text: n ? `最近 ${n} 次` : '全部记录'
          })))
        ]),
        records.length ? el('p', { class: 'muted small history-count', text: `已保留 ${records.length} 次练习，当前显示 ${shown.length} 次；按完成时间从新到旧排列。` }) : null,
        records.length ? el('ol', { class: 'history-list' }, shown.map(recordCard)) : el('div', { class: 'history-empty' }, [
          icon('book'), el('h2', { text: '第一份成绩，等你来创造' }),
          el('p', { class: 'muted', text: '完成一份口算练习，成绩就会自动保存在这里。' }),
          el('a', { class: 'btn btn-primary', href: '#/practice', text: '开始出题练习' })
        ]),
        limit === 0 && shown.length < records.length ? el('button', { class: 'btn load-history', text: '再看更早的记录', onclick: () => {
          const firstNew = shown.length;
          visible += 20;
          paint(firstNew);
        } }) : null
      ]),
      el('p', { class: 'history-local-note' }, [icon('shield'), '这里显示当前浏览器保存的练习记录；更换设备或清理浏览器数据后无法自动找回。'])
    ]));
    if (revealIndex !== undefined) {
      const record = root.querySelectorAll('.history-record')[revealIndex];
      focusElement(record ?? root.querySelector('h1'));
      record?.scrollIntoView({ block: 'nearest' });
    }
  }
  paint();
}

function recordCard(r) {
  const counts = r.compressed ? r.kpCount ?? {} : Object.fromEntries((r.paper?.questions ?? []).map(q => [q.kpId, 1]));
  const topics = Object.keys(counts).map(id => getKnowledgePoint(id)?.name ?? id);
  return el('li', {}, el('a', { class: 'history-record', href: `#/result?id=${encodeURIComponent(r.id)}`,
    'aria-label': `查看 ${formatDate(r.finishedAt, 'YYYY-MM-DD HH:mm')} 的练习详情` }, [
    el('div', { class: 'record-score' }, [el('strong', { text: formatAccuracy(r.accuracy) }),
      el('span', { class: `record-grade grade-${r.grade.key}`, text: r.grade.label })]),
    el('div', { class: 'record-copy' }, [
      el('time', { dateTime: new Date(r.finishedAt).toISOString(), text: formatDate(r.finishedAt, 'YYYY-MM-DD HH:mm') }),
      el('p', { class: 'record-counts', text: `${r.total} 题 · 正确 ${r.correct} · 错误 ${r.wrong} · 未作答 ${r.skipped}` }),
      el('p', { class: 'record-topics', title: topics.join('、'),
        text: topics.length > 2 ? `${topics[0]} 等 ${topics.length} 个知识点` : topics.length ? topics.join('、') : '口算练习' }),
      r.compressed ? el('span', { class: 'summary-label', text: '摘要 · 无逐题明细' }) : null
    ]),
    el('span', { class: 'record-duration' }, [icon('clock'), humanDuration(r.elapsedMs)]),
    icon('arrow', 'record-arrow')
  ]));
}
