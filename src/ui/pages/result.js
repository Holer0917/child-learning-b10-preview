import { el } from '../../utils/dom.js';
import { humanDuration, formatAccuracy } from '../../utils/format.js';
import { getKnowledgePoint } from '../../domain/syllabus.js';
import { getLastResult } from '../../app/quizSession.js';
import { icon } from '../components/icon.js';
import { getHistoryRecord } from '../../domain/history.js';
import { formatDate } from '../../utils/date.js';

export function renderResult(root, ctx) {
  const id = ctx?.query.get('id');
  const r = id ? getHistoryRecord(id) : getLastResult();
  if (!r) {
    root.replaceChildren(el('section', { class: 'card' }, [
      el('h1', { text: id ? '找不到这条练习记录' : '还没有练习成绩' }),
      el('a', { class: 'btn btn-primary', href: id ? '#/history' : '#/practice', text: id ? '返回成绩历史' : '去出题' })
    ]));
    return;
  }
  const counts = {};
  if (r.compressed) Object.assign(counts, r.kpCount ?? {});
  else for (const q of r.paper?.questions ?? []) counts[q.kpId] = (counts[q.kpId] ?? 0) + 1;
  const wrongList = Array.isArray(r.wrongList) ? r.wrongList : [];
  const perfect = r.total > 0 && r.correct === r.total && r.wrong === 0 && r.skipped === 0;
  const metric = (label, value) => el('div', { class: 'metric' }, [
    el('strong', { text: String(value) }), el('span', { text: label })
  ]);
  root.replaceChildren(el('section', { class: 'page result-page' }, [
    el('a', { class: 'detail-back', href: '#/history', 'aria-label': '返回成绩历史' }, ['←', '返回成绩历史']),
    el('header', { class: 'page-head' }, [
      el('h1', { text: id ? '练习详情' : r.reason === 'timeout' ? '时间到，来看看成绩' : '本次练习完成' }),
      el('p', { class: 'detail-date', text: formatDate(r.finishedAt, 'YYYY-MM-DD HH:mm') }),
      el('p', { class: 'muted', text: '成绩按每题首次作答计算，订正不会覆盖首次结果。' })
    ]),
    r.saved === false ? el('p', { class: 'alert', role: 'alert', text: '成绩未能完整保存到浏览器，请先保留本页。' }) : null,
    r.compressed ? el('p', { class: 'summary-notice', role: 'status', text: '明细已压缩：本次仅保留成绩摘要和知识点统计，无逐题明细。' }) : null,
    perfect ? el('p', { id: 'perfect-feedback', class: 'perfect-feedback' + (id ? '' : ' feedback-pulse'),
      role: 'status', text: '✓ 全对！每一道题都答对了，真棒！' }) : null,
    el('section', { class: 'card score-card' }, [
      el('div', { class: 'score-summary' }, [
        el('span', { text: '正确率' }),
        el('strong', { class: 'score', text: formatAccuracy(r.accuracy) })
      ]),
      el('div', { class: 'score-details' }, [
      el('h2', { class: 'grade-badge', text: `评价：${r.grade.label}` }),
      el('div', { class: 'metrics' }, [metric('正确', r.correct), metric('错误', r.wrong), metric('未作答', r.skipped)]),
      el('p', { class: 'score-time muted' }, [icon('clock'), `共 ${r.total} 题 · 总用时 ${humanDuration(r.elapsedMs)} · 平均每题 ${r.avgMs == null ? '—' : humanDuration(r.avgMs)}`])
      ])
    ]),
    el('div', { class: 'result-detail-grid' }, [
    el('section', { class: 'card topic-card' }, [el('h2', { class: 'card-title' }, [icon('book'), '本次练习内容']),
      el('p', { class: 'card-description', text: '本次练习涉及的知识点。' }),
      el('ul', { class: 'topic-list' }, Object.entries(counts).map(([id, n]) => el('li', {}, [
        el('span', { text: getKnowledgePoint(id)?.name ?? id }), el('strong', { text: `${n} 题` })
      ])))
    ]),
    el('section', { class: 'card review-card' }, [el('h2', { class: 'card-title' }, [icon('pencil'), `答错的题 · ${r.wrong} 道`]),
      r.compressed ? el('p', { class: 'muted summary-explanation', text: '本次记录已转为摘要，无法查看具体错题。' })
      : wrongList.length ? el('ol', { class: 'review-list' }, wrongList.map(w => el('li', {}, [
        el('p', { class: 'review-question', text: w.question.text }),
        el('div', { class: 'review-answers' }, [
          el('span', { class: 'wrong-answer', text: `你的答案：${w.userAnswer}` }),
          el('span', { class: 'right-answer', text: `正确答案：${w.expected}` })
        ])
      ]))) : el('div', { class: 'all-correct' }, [icon('check'), el('p', { text: r.skipped ? '已作答的题目全部答对，记得留意未作答的题。' : '全部答对，真棒！' })])
    ])]),
    el('div', { class: 'result-actions' }, [
      el('a', { class: 'btn btn-primary', href: '#/practice' }, ['再出一份题', icon('arrow')]),
      el('span', { class: 'muted small', text: '也可以休息一下，明天继续。' })
    ])
  ]));
}
