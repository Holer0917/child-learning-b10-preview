/* 每次发布修改缓存资源时必须递增 VERSION；此脚本不缓存用户数据。 */
const VERSION = 'abc-preview-12';
const BASE = new URL('./', self.location.href);
const PREFIX = `kidsmath-shell:${BASE.pathname}:`;
const CACHE_NAME = PREFIX + VERSION;
const ASSETS = [
  'index.html', 'manifest.webmanifest',
  'assets/css/base.css', 'assets/icons/app-192.png', 'assets/icons/app-512.png', 'assets/icons/apple-touch-icon.png',
  'src/main.js', 'src/app/pwa.js', 'src/app/quizSession.js', 'src/app/mistakePractice.js',
  'src/core/bus.js', 'src/core/router.js', 'src/core/schema.js', 'src/core/backupSchema.js', 'src/core/storage.js',
  'src/domain/generator.js', 'src/domain/grader.js', 'src/domain/history.js', 'src/domain/paper.js',
  'src/domain/profile.js', 'src/domain/syllabus.js', 'src/domain/backup.js',
  'src/domain/mistakes.js', 'src/domain/variants.js', 'src/domain/stats.js',
  'src/ui/components/icon.js', 'src/ui/components/keypad.js', 'src/ui/components/feedback.js',
  'src/ui/pages/home.js', 'src/ui/pages/practice.js', 'src/ui/pages/quiz.js',
  'src/ui/pages/result.js', 'src/ui/pages/history.js', 'src/ui/pages/mistakes.js', 'src/ui/pages/stats.js', 'src/ui/pages/profiles.js', 'src/ui/pages/settings.js',
  'src/utils/accessibility.js', 'src/utils/date.js', 'src/utils/dom.js', 'src/utils/format.js', 'src/utils/random.js'
].map(path => new URL(path, BASE).href);
const ASSET_SET = new Set(ASSETS);
let repairing = null;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // 防止漏递增版本的新脚本覆盖仍被旧页面使用的同名缓存。
    if ((await caches.keys()).includes(CACHE_NAME)) throw new Error('缓存版本已存在，请递增 VERSION 后重试。');
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE_NAME); // 只移除本次失败候选，保留旧版本与其它站点缓存。
      throw error;
    }
    // 不调用 skipWaiting：已有页面关闭后再激活，避免答题中切换版本。
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function offlineResponse() {
  const retry = new URL(BASE); retry.searchParams.set('offline-retry', Date.now());
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>需要联网准备 · 口算小达人</title><style>body{background:#fff;color:#111;font:18px/1.7 system-ui;margin:32px auto;padding:16px;max-width:600px}a{display:inline-block;min-height:44px;color:inherit}</style><h1>暂时无法离线打开</h1><p>本机离线资源不完整。请联网后重新打开，看到“离线已就绪”后再断网使用。</p><p>本次离线失败不会清除学习数据。</p><a href="${retry.href}">重新打开</a></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  const canonical = new URL(url.pathname, BASE.origin).href;
  const entry = request.mode === 'navigate' && (url.pathname === BASE.pathname || canonical === new URL('index.html', BASE).href);
  if (!entry && !ASSET_SET.has(canonical)) return; // 不缓存任意 URL、查询或外部请求。
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(entry ? new URL('index.html', BASE).href : canonical);
    if (cached) return cached;
    try { return await fetch(request); }
    catch { return entry ? offlineResponse() : new Response('离线资源未准备好，请联网重试。', { status: 503 }); }
  })());
});

self.addEventListener('message', event => {
  if (!['KM_CACHE_STATUS', 'KM_CACHE_REPAIR'].includes(event.data?.type) || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      if (event.data.type === 'KM_CACHE_REPAIR') {
        // 仅在页面已确认没有待安装新版时请求；addAll 批量失败不覆盖已有资源。
        repairing ??= cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))
          .finally(() => { repairing = null; });
        await repairing;
      }
      const present = await Promise.all(ASSETS.map(url => cache.match(url)));
      event.ports[0].postMessage({ type: 'KM_CACHE_STATUS', version: VERSION,
        ready: present.every(Boolean), cached: present.filter(Boolean).length, total: ASSETS.length });
    } catch { event.ports[0].postMessage({ type: 'KM_CACHE_STATUS', ready: false }); }
  })());
});
