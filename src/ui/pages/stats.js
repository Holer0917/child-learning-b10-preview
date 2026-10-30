import { el, svg } from '../../utils/dom.js';
import { getActiveProfile } from '../../domain/profile.js';
import { accuracyTrend, masteryByKP, practiceSummary, badges, activityCalendar, updateAwards } from '../../domain/stats.js';
import { formatAccuracy } from '../../utils/format.js';
import { dateStr } from '../../utils/date.js';

const RANGES = [{ id: 7, name: '最近 7 次' }, { id: 30, name: '最近 30 次' }, { id: 'all', name: '全部' }];
const state = { range: 30, showTable: false };
export function renderStats(root) {
  state.range = 30; state.showTable = false;
  const pid = getActiveProfile()?.id;
  const saved = pid ? updateAwards(pid) : true;
  paint(root, saved);
  let day = dateStr();
  const timer = setInterval(() => { if (day !== dateStr()) { day = dateStr(); paint(root, saved); } }, 30000);
  return () => clearInterval(timer);
}
function paint(root, awardsSaved = true) {
  const previousId = root.contains(document.activeElement) ? document.activeElement.id : null;
  const pid = getActiveProfile()?.id;
  if (!pid) {
    root.replaceChildren(el('section', { class: 'card' }, [el('h1', { text: '学习统计' }),
      el('a', { class: 'btn', href: '#/home', text: '返回首页建立档案' })])); return;
  }
  const summary = practiceSummary(pid), mastery = masteryByKP(pid), trend = accuracyTrend(pid, state.range);
  const metric = (label, value) => el('div', { class: 'history-stat' }, [el('strong', { text: value }), el('span', { text: label })]);
  root.replaceChildren(el('section', { class: 'page stats-page' }, [
    el('h1', { text: '学习统计', tabindex: -1 }),
    el('p', { class: 'muted', text: '以下统计仅覆盖当前档案已保留的练习明细与摘要。跳过不计入练习量和打卡。' }),
    !awardsSaved ? el('p', { class: 'alert', role: 'alert', text: '徽章日期暂未保存，已有成绩仍保留，请释放空间后重试。' }) : null,
    el('section', { class: 'card' }, [el('h2', { class: 'card-title', text: '练习足迹' }),
      el('div', { class: 'stats-summary-grid' }, [metric('有效练习', `${summary.sessions} 次`),
        metric('有效作答', `${summary.totalQuestions} 道`), metric('练习天数', `${summary.days} 天`), metric('连续打卡', `${summary.streak} 天`)]),
      el('p', { class: 'muted small', text: `累计练习用时约 ${summary.totalHours} 小时。同一自然日有有效作答才计一天。` })]),
    trendCard(root, trend), masteryCard(mastery), calendarCard(activityCalendar(pid)), badgesCard(badges(pid)),
    el('a', { class: 'btn', href: '#/mistakes', text: '返回错题本' })
  ]));
  if (previousId) (document.getElementById(previousId) ?? root.querySelector('h1'))?.focus({ preventScroll: true });
}
function trendCard(root, trend) {
  return el('section', { class: 'card stats-trend' }, [
    el('h2', { class: 'card-title', text: '正确率趋势' }),
    el('div', { class: 'chips', 'aria-label': '统计范围' }, RANGES.map(r => el('button', {
      id: `range-${r.id}`, class: 'chip' + (state.range === r.id ? ' is-active' : ''),
      'aria-pressed': String(state.range === r.id), text: r.name,
      onclick: () => { state.range = r.id; state.showTable = false; paint(root); }
    }))),
    !trend.ok ? el('p', { class: 'muted', text: '练习记录不足，暂无法生成趋势图' })
      : el('div', {}, [el('div', { class: 'stats-chart-wrap' }, renderLineChart(trend.points)),
        el('p', { class: 'trend-change', role: 'status', text: `最近一次正确率 ${formatAccuracy(trend.points.at(-1).value)}，较上次${trend.direction}${trend.delta ? ` ${Math.abs(trend.delta).toFixed(1)} 个百分点` : ''}。` }),
        el('p', { class: 'muted small', text: `共 ${trend.points.length} 条记录，按完成时间从旧到新排列。` }),
        el('button', { id: 'toggle-stats-table', class: 'btn', 'aria-expanded': String(state.showTable),
          text: state.showTable ? '收起数据表' : '查看数据表', onclick: () => { state.showTable = !state.showTable; paint(root); } }),
        state.showTable ? dataTable(trend.points) : null])
  ]);
}
function dataTable(points) {
  return el('div', { class: 'stats-table-wrap' }, [
    el('table', { class: 'stats-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '时间' }),
        el('th', { text: '正确率' })
      ])),
      el('tbody', {}, points.map((p) => el('tr', {}, [
        el('td', { text: p.label }),
        el('td', { text: formatAccuracy(p.value) })
      ])))
    ])
  ]);
}

function renderLineChart(points) {
  const W = 560;
  const H = 200;
  const PAD = { top: 18, right: 16, bottom: 28, left: 42 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => PAD.top + ih - (v / 100) * ih;

  const chart = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'stats-chart',
    role: 'img',
    'aria-label': `正确率趋势图，共 ${points.length} 条记录，最近一次 ${points[points.length - 1].value}%`
  });

  for (const v of [0, 50, 100]) {
    chart.appendChild(svg('line', {
      x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: 'chart-grid'
    }));
    chart.appendChild(svg('text', {
      x: PAD.left - 6, y: y(v) + 4, class: 'chart-tick', 'text-anchor': 'end'
    }, `${v}%`));
  }

  if (points.length > 1) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
    chart.appendChild(svg('path', { d, class: 'chart-line' }));
  }

  points.forEach((p, i) => {
    chart.appendChild(svg('circle', { cx: x(i), cy: y(p.value), r: 3.5, class: 'chart-dot' }));
  });

  const last = points[points.length - 1];
  chart.appendChild(svg('text', {
    x: x(points.length - 1), y: y(last.value) - 10,
    class: 'chart-label', 'text-anchor': 'middle'
  }, `${last.value}%`));

  const step = Math.max(1, Math.ceil(points.length / 7));
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    chart.appendChild(svg('text', {
      x: x(i), y: H - 8, class: 'chart-tick', 'text-anchor': 'middle'
    }, p.label.slice(5, 10)));
  });

  return chart;
}


function masteryCard(items) {
  const levels = { good: ['✓', '良好'], warn: ['△', '待加强'], weak: ['!', '薄弱'], unpracticed: ['—', '未练习'] };
  const weakest = items.filter(i => i.mastery !== null).slice(0, 3);
  return el('section', { class: 'card mastery-card' }, [
    el('h2', { class: 'card-title', text: '知识点掌握度' }),
    el('p', { class: 'muted small', text: '首次有效提交正确数 ÷ 有效作答数，含重练与变式，排除跳过及同题订正。按掌握度由低到高排列。' }),
    !items.length ? el('p', { class: 'muted', text: '还没有练习过的知识点。' }) : null,
    weakest.length ? el('section', { class: 'priority-practice' }, [
      el('h3', { text: '建议优先练习' }),
      el('ul', {}, weakest.map(i => el('li', {}, el('a', { href: `#/practice?kp=${encodeURIComponent(i.kpId)}`,
        text: `${i.name}（${i.mastery}%）· 立即出题练习该知识点` }))))
    ]) : null,
    el('ul', { class: 'mastery-list' }, items.map(i => {
      const [symbol, label] = levels[i.level];
      return el('li', { class: `mastery-entry level-${i.level}` }, [
        el('div', { class: 'row-between' }, [el('strong', { text: i.name }),
          el('span', { class: 'mastery-status', text: `${symbol} ${label} · ${i.mastery === null ? '未练习' : `${i.mastery}%`}` })]),
        el('div', { class: 'mastery-track', role: 'meter', 'aria-label': `${i.name}掌握度`,
          'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': i.mastery ?? 0,
          'aria-valuetext': i.mastery === null ? '未练习' : `${i.mastery}%，${label}` },
          el('span', { class: 'mastery-fill', style: { width: `${i.mastery ?? 0}%` } })),
        el('p', { class: 'muted small', text: `${i.correct} / ${i.answered} 题有效作答正确` }),
        el('a', { class: 'btn', href: `#/practice?kp=${encodeURIComponent(i.kpId)}`, text: '立即练习' })
      ]);
    }))
  ]);
}
function calendarCard(days) {
  return el('section', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '最近 8 周的练习情况' }),
    el('p', { class: 'muted small', text: `${days[0].date} 至 ${days.at(-1).date}，格内为日期和有效作答题数。` }),
    el('div', { class: 'activity-calendar', role: 'list', 'aria-label': '最近56天练习日历' }, days.map(d =>
      el('div', { class: 'activity-day' + (d.count ? ' has-practice' : ''), role: 'listitem',
        title: `${d.date}，有效作答 ${d.count} 道`, 'aria-label': `${d.date}，有效作答 ${d.count} 道` }, [
          el('span', { text: d.date.slice(5) }), el('strong', { text: String(d.count) })])) )
  ]);
}
function badgesCard(items) {
  return el('section', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '连续练习徽章' }),
    el('p', { class: 'muted small', text: '连续 7 / 30 / 100 天获得徽章；获得日期保留，打卡中断不会撤回。' }),
    el('ul', { class: 'badge-list' }, items.map(b => el('li', { class: 'badge-item' + (b.earned ? ' is-earned' : '') }, [
      el('strong', { text: `${b.earned ? '✓' : '—'} ${b.name}` }),
      el('span', { text: b.earned ? `获得日期：${b.earnedAt}` : '尚未获得' })])))
  ]);
}
