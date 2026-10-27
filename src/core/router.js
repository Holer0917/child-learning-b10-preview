/**
 * 哈希路由
 *
 * 采用 `#/path` 而非 History API：静态托管（Gitee Pages）无需服务端重写规则，
 * 刷新任意页面都不会 404。详见设计说明书 D-3。
 */

import { focusPage } from '../utils/accessibility.js';

/** @type {Map<string, {render: Function, title?: string}>} */
const routes = new Map();

let container = null;
let notFound = null;
let current = '';
let dispose = null;
let beforeLeave = null;

/** 当前页面路径，形如 `/home` */
export function currentPath() {
  const hash = window.location.hash.replace(/^#/, '');
  return normalize(hash || '/home');
}

/** 统一成 `/xxx` 形式，去掉尾部斜杠 */
function normalize(path) {
  const p = '/' + path.replace(/^\/+/, '').replace(/\/+$/, '');
  return p === '/' ? '/' : p;
}

/**
 * 注册路由
 * @param {string} path
 * @param {(el: HTMLElement, ctx: {path: string, query: URLSearchParams}) => void} render
 */
export function register(path, render, title) {
  routes.set(normalize(path), { render, title });
}

/** 注册兜底页面 */
export function registerFallback(render) {
  notFound = render;
}

/** 跳转 */
export function go(path) {
  const target = '#' + normalize(path);
  if (window.location.hash === target) render();
  else window.location.hash = target;
}

/** 解析 `?a=1` 查询串 */
function parseQuery(path) {
  const i = path.indexOf('?');
  return i < 0 ? new URLSearchParams() : new URLSearchParams(path.slice(i + 1));
}

/** 渲染当前路由 */
function render() {
  if (!container) return;

  const path = currentPath();
  const routePath = path.split('?')[0];
  if (current && path !== current && beforeLeave && !beforeLeave()) {
    window.history.replaceState(null, '', '#' + current);
    return;
  }
  dispose?.();
  dispose = null;
  beforeLeave = null;
  current = path;

  container.replaceChildren();
  container.scrollTop = 0;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  const route = routes.get(routePath);
  const ctx = { path: routePath, query: parseQuery(path) };

  if (!route) {
    document.title = '页面不存在 · 口算小达人';
    if (notFound) notFound(container, ctx);
    else container.textContent = '页面不存在：' + path;
    focusPage(container);
    return;
  }

  if (route.title) document.title = route.title + ' · 口算小达人';

  try {
    const lifecycle = route.render(container, ctx);
    if (typeof lifecycle === 'function') dispose = lifecycle;
    else if (lifecycle) {
      dispose = lifecycle.dispose;
      beforeLeave = lifecycle.beforeLeave;
    }
    // 页面可能用 replaceState 消费一次性 start 参数；取消离开时恢复当前实际 URL。
    const actual = currentPath();
    if (actual.split('?')[0] === routePath) current = actual;
  } catch (err) {
    // 页面级异常不应导致整站白屏（FM-11）
    console.error('[router] 页面渲染失败：', err);
    container.textContent = '出了点小问题，请刷新重试。';
  }
  focusPage(container);
}

/**
 * 启动路由
 * @param {HTMLElement} el 挂载点
 */
export function start(el) {
  container = el;
  window.addEventListener('hashchange', render);
  if (!window.location.hash) {
    // 首次进入补一个默认 hash，保证地址栏可见、可分享
    window.history.replaceState(null, '', '#/home');
  }
  render();
}

/** 重新渲染当前页（档案切换后使用） */
export function refresh() {
  render();
}

export { current };
