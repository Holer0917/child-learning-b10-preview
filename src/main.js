/**
 * 应用入口
 *
 * 启动顺序（对应设计说明书 §2.3）：
 *   1. 存储版本迁移
 *   2. 确保存在当前档案
 *   3. 注册路由并挂载
 */

import { migrate, isAvailable } from './core/storage.js';
import { ensureProfile, getActiveProfile } from './domain/profile.js';
import { start, register, registerFallback } from './core/router.js';
import { renderHome } from './ui/pages/home.js';
import { renderPractice } from './ui/pages/practice.js';
import { renderHistory } from './ui/pages/history.js';
import { renderMistakes } from './ui/pages/mistakes.js';
import { renderQuiz } from './ui/pages/quiz.js';
import { renderResult } from './ui/pages/result.js';
import { el } from './utils/dom.js';
import { installKeyboardSupport } from './utils/accessibility.js';
import { initPwa } from './app/pwa.js';

function boot() {
  installKeyboardSupport();
  const mount = document.getElementById('app');
  const header = document.getElementById('topbar');

  // 1. 迁移 + 建档
  migrate();
  ensureProfile();

  // 2. 顶栏：档案信息（切换功能后续补）
  const profile = getActiveProfile();
  header.replaceChildren(
    el('a', { class: 'brand', href: '#/home', 'aria-label': '口算小达人首页' }, [
      el('span', { class: 'brand-name', text: '口算小达人' })
    ]),
    el('nav', { class: 'header-nav', 'aria-label': '主导航' }, [
      el('a', { class: 'nav-link', href: '#/home', text: '开始' }),
      el('a', { class: 'nav-link', href: '#/practice', text: '出题练习' }),
      el('a', { class: 'nav-link', href: '#/history', text: '成绩历史' }),
      el('a', { class: 'nav-link', href: '#/mistakes', text: '错题本' })
    ]),
    el('div', { class: 'profile-chip' }, [
      el('span', { class: 'profile-copy' }, [
        el('span', { text: profile?.name ?? '小朋友' }),
        el('span', { class: 'grade-tag', text: `${profile?.grade ?? 1} 年级学习档案` })
      ])
    ])
  );

  const updateNavigation = () => {
    const path = window.location.hash.split('?')[0];
    header.querySelectorAll('.nav-link').forEach(link => {
      if (link.hash === path || (link.hash === '#/home' && !path)
          || (link.hash === '#/practice' && path === '#/quiz')
          || (link.hash === '#/history' && path === '#/result')) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };

  // 3. 存储不可用时给出提示（FM-01）
  if (!isAvailable()) {
    mount.before(el('div', { class: 'alert alert-banner', role: 'alert' },
      '当前浏览器不支持本地存储，本次数据关闭页面后会丢失。'));
  }

  // 4. 路由
  register('/home', renderHome, '开始');
  register('/practice', renderPractice, '出题');
  register('/history', renderHistory, '成绩历史');
  register('/mistakes', renderMistakes, '错题本');
  register('/quiz', renderQuiz, '答题');
  register('/result', renderResult, '成绩');
  registerFallback((root, ctx) => {
    root.replaceChildren(
      el('p', { class: 'empty', text: `页面不存在：${ctx.path}` }),
      el('a', { class: 'btn btn-primary', href: '#/home', text: '回到首页' })
    );
  });

  start(mount);
  // 路由先处理离开确认；若取消，导航高亮读取路由恢复后的地址。
  updateNavigation();
  window.addEventListener('hashchange', updateNavigation);
  initPwa();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
