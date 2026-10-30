import { el } from '../../utils/dom.js';
import { listHistory } from '../../domain/history.js';
import { resumeSession } from '../../app/quizSession.js';
import { formatDate } from '../../utils/date.js';
import { formatAccuracy } from '../../utils/format.js';

/** 学习开始页，只展示真实数据与入口。 */
export function renderHome(root) {
  const records = listHistory();
  const latest = records[0];
  const active = resumeSession();
  const entry = (href, name, desc, className, note) => el('a', {
    href, class: `start-entry ${className}`, 'aria-label': name
  }, [el('h2', { text: name }), el('p', { text: desc }),
    el('span', { class: 'entry-bottom', text: note })]);
  root.replaceChildren(el('section', { class: 'page start-page' }, [
    el('header', { class: 'page-head' }, [
      el('h1', { text: '开始' }),
      el('p', { class: 'muted', text: '选择出题练习、查看成绩历史或打开错题本。' })
    ]),
    active ? el('section', { class: 'card resume-card' }, [
      el('div', {}, [el('h2', { class: 'card-title', text: '有一份未完成的练习' }),
        el('p', { class: 'card-description', text: `第 ${active.cursor + 1} / 共 ${active.paper.questions.length} 题，进度已暂存。` })]),
      el('a', { class: 'btn btn-primary', href: '#/quiz', text: '继续练习' })
    ]) : null,
    el('div', { class: 'start-grid' }, [
      entry('#/practice', '出题练习', '选择年级、知识点和题量，开始口算练习。', 'entry-practice', '进入出题台'),
      entry('#/history', '成绩历史', '查看近期练习的正确率、用时和错题。', 'entry-history', records.length ? `已保留 ${records.length} 次练习` : '还没有练习记录'),
      entry('#/mistakes', '错题本', '自动整理错题，支持错题重练、举一反三和学习统计。', 'entry-mistakes', '打开错题本')
    ]),
    el('section', { class: 'card latest-practice' }, [
      el('div', {}, [el('h2', { class: 'card-title', text: '最近一次练习' }),
        el('p', { class: 'card-description', text: latest ? `${formatDate(latest.finishedAt, 'YYYY-MM-DD HH:mm')} · ${latest.total} 道题 · 正确率 ${formatAccuracy(latest.accuracy)}`
          : '还没有练习记录。完成一份练习后，就能在这里回看成绩。' })]),
      el('a', { class: 'btn', href: latest ? `#/result?id=${encodeURIComponent(latest.id)}` : '#/practice', text: latest ? '查看详情' : '去出题' })
    ])
  ]));
}
