/**
 * 应用入口
 *
 * 启动顺序（对应设计说明书 §2.3）：
 *   1. 存储版本迁移
 *   2. 确保存在当前档案
 *   3. 注册路由并挂载
 */

import { migrate, isAvailable, read, recoverTransaction } from './core/storage.js';
import { ensureProfile, getActiveProfile } from './domain/profile.js';
import { start, register, registerFallback } from './core/router.js';
import { renderHome } from './ui/pages/home.js';
import { renderPractice } from './ui/pages/practice.js';
import { renderHistory } from './ui/pages/history.js';
import { renderMistakes } from './ui/pages/mistakes.js';
import { renderQuiz } from './ui/pages/quiz.js';
import { renderResult } from './ui/pages/result.js';
import { renderStats } from './ui/pages/stats.js';
import { el } from './utils/dom.js';
import { installKeyboardSupport } from './utils/accessibility.js';
import { initPwa } from './app/pwa.js';
import { renderProfiles } from './ui/pages/profiles.js';
import { renderSettings } from './ui/pages/settings.js';
import { bus, EVENTS } from './core/bus.js';

function boot() {
  installKeyboardSupport();
  const mount = document.getElementById('app');
  const header = document.getElementById('topbar');

  // 1. 迁移 + 建档
  const recovery = recoverTransaction();
  if (!recovery.ok) {
    mount.replaceChildren(el('section', { class: 'card' }, [el('h1', { text: '需要恢复本地数据', tabindex: -1 }),
      el('p', { role: 'alert', text: '上次操作未完成，原数据仍保留在恢复日志中。请释放存储空间或恢复浏览器存储权限后重试。' }),
      el('button', { class: 'btn', text: '重试数据恢复', onclick: () => location.reload() })]));
    mount.querySelector('h1').focus(); return;
  }
  migrate();
  if (read('profiles', null) === null) ensureProfile();

  // 2. 顶栏保留现有导航，新增档案与数据管理入口。
  const profile = getActiveProfile();
  header.replaceChildren(
    el('a', { class: 'brand', href: '#/home', 'aria-label': '口算小达人首页' }, [
      el('span', { class: 'brand-name', text: '口算小达人' })
    ]),
    el('nav', { class: 'header-nav', 'aria-label': '主导航' }, [
      el('a', { class: 'nav-link', href: '#/home', text: '开始' }),
      el('a', { class: 'nav-link', href: '#/practice', text: '出题练习' }),
      el('a', { class: 'nav-link', href: '#/history', text: '成绩历史' }),
      el('a', { class: 'nav-link', href: '#/mistakes', text: '错题本' }),
      el('a', { class: 'nav-link', href: '#/profiles', text: '档案' }),
      el('a', { class: 'nav-link', href: '#/settings', text: '数据管理' })
    ]),
    el('a', { class: 'profile-chip', href: '#/profiles', 'aria-label': '打开学习档案' }, [
      el('span', { class: 'profile-avatar-small', 'aria-hidden': 'true', text: profile?.avatar ?? '👤' }),
      el('span', { class: 'profile-copy' }, [
        el('span', { text: profile?.name ?? '新建档案' }),
        el('span', { class: 'grade-tag', text: profile ? `${profile.grade} 年级学习档案` : '尚未创建学习档案' })
      ])
    ])
  );
  bus.on(EVENTS.PROFILE_CHANGED, () => {
    const p = getActiveProfile();
    header.querySelector('.profile-copy span').textContent = p?.name ?? '新建档案';
    header.querySelector('.grade-tag').textContent = p ? `${p.grade} 年级学习档案` : '尚未创建学习档案';
    header.querySelector('.profile-avatar-small').textContent = p?.avatar ?? '👤';
  });

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
  const withProfile = render => (root, ctx) => {
    if (!getActiveProfile()) {
      root.replaceChildren(el('section', { class: 'card' }, [el('h1', { text: '先创建学习档案' }),
        el('a', { class: 'btn', href: '#/profiles', text: '创建学习档案' })])); return;
    }
    return render(root, ctx);
  };
  register('/practice', withProfile(renderPractice), '出题');
  register('/history', renderHistory, '成绩历史');
  register('/mistakes', renderMistakes, '错题本');
  register('/stats', renderStats, '学习统计');
  register('/quiz', withProfile(renderQuiz), '答题');
  register('/result', renderResult, '成绩');
  register('/profiles', renderProfiles, '学习档案');
  register('/settings', renderSettings, '数据管理');
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
