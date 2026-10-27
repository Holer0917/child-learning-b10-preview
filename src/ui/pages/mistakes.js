import { el } from '../../utils/dom.js';
import { icon } from '../components/icon.js';

/** 分步开发：保留明确入口，不假装错题归档已经完成。 */
export function renderMistakes(root) {
  root.replaceChildren(el('section', { class: 'page coming-soon-page' }, [
    el('header', { class: 'page-head' }, [el('span', { class: 'eyebrow' }, [icon('book'), '把不会的，变成会的']), el('h1', { text: '错题本' })]),
    el('section', { class: 'card history-empty' }, [
      icon('book'), el('span', { class: 'coming-badge', text: '下一步开放' }),
      el('h2', { text: '错题本正在准备中' }),
      el('p', { class: 'muted', text: '之后可以自动收集错题、按知识点查看，再练一次。现在可以先打开成绩历史，在每次练习详情里回顾答错的题。' }),
      el('div', { class: 'actions' }, [
        el('a', { class: 'btn btn-primary', href: '#/history', text: '先看成绩历史' }),
        el('a', { class: 'btn', href: '#/home', text: '返回开始页' })
      ])
    ])
  ]));
}
