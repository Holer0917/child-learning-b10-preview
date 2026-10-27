/** 安装/更新状态独立于练习路由；不读取、上传或清除学习数据。 */
export function initPwa() {
  const panel = document.querySelector('#pwa-panel');
  if (!panel) return;
  const status = panel.querySelector('#pwa-status'), action = panel.querySelector('#pwa-check');
  const install = panel.querySelector('#pwa-install'), detail = panel.querySelector('#pwa-detail');
  const base = new URL('../../', import.meta.url), workerUrl = new URL('sw.js', base).href;
  let registration, promptEvent, busy = false, ready = false, notice = '', installBusy = false;
  const say = message => { status.textContent = message; };
  const explain = message => { detail.hidden = false; detail.textContent = message; };
  const paint = () => {
    panel.dataset.ready = String(ready);
    if (notice) say(notice);
    else if (ready) say(navigator.onLine ? '离线已就绪，可断网练习。' : '当前离线，可继续练习和查看成绩。');
    else say(navigator.onLine ? '首次打开需要联网，正在准备离线资源…' : '当前离线，尚未完成缓存；请联网后重试。');
  };
  const queryCache = (worker, repair = false) => new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('状态查询超时')); }, repair ? 30000 : 3000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close(); resolve(event.data);
    };
    worker.postMessage({ type: repair ? 'KM_CACHE_REPAIR' : 'KM_CACHE_STATUS' }, [channel.port2]);
  });
  const refreshStatus = async () => {
    // 同源根目录与子目录可能各有 SW，不把其它作用域的缓存误报成本应用已就绪。
    const controller = navigator.serviceWorker.controller;
    const worker = registration?.active ?? (controller?.scriptURL === workerUrl ? controller : null);
    if (!worker) return;
    try {
      const report = await queryCache(worker);
      ready = report.type === 'KM_CACHE_STATUS' && report.ready === true;
      if (!ready) notice = '离线资源尚未准备完整，请联网后重试。';
      panel.dataset.version = report.version ?? '';
      paint();
    } catch { notice = '暂时无法确认离线状态，请联网后重试。'; paint(); }
  };
  const observeWorker = worker => {
    if (!worker) return;
    const changed = async () => {
      if (worker.state === 'installed' && registration.waiting) {
        notice = '新版已准备好。关闭所有本应用页面后重新打开，即可更新；本次练习可继续。'; paint();
      } else if (worker.state === 'activated') { notice = ''; await refreshStatus(); }
      else if (worker.state === 'redundant') {
        notice = ready ? '新版准备失败，仍可使用当前版本；联网后可重试。' : '离线准备失败，当前可继续在线使用；联网后请重试。'; paint();
      }
    };
    worker.addEventListener('statechange', changed);
    changed();
  };
  const prepare = async () => {
    if (busy) return;
    busy = true; action.setAttribute('aria-busy', 'true'); notice = '';
    try {
      // 首次安装失败后浏览器可能移除 registration；不能只对失效对象调用 update。
      if (!registration?.active) {
        registration = await navigator.serviceWorker.register(workerUrl, { scope: base.href, updateViaCache: 'none' });
        registration.addEventListener('updatefound', () => observeWorker(registration.installing));
      } else await registration.update();
      if (registration.active) {
        await refreshStatus();
        // 缓存被浏览器回收后可联网修复；有新版安装/等待时不把新版文件写进旧缓存。
        if (!ready && !registration.installing && !registration.waiting && navigator.onLine) {
          const repaired = await queryCache(registration.active, true);
          ready = repaired.ready === true;
          notice = ready ? '' : '离线资源修复失败，仍可在线使用；联网后请重试。';
        }
      }
      observeWorker(registration.installing);
      if (registration.waiting) {
        notice = '新版已准备好。关闭所有本应用页面后重新打开，即可更新；本次练习可继续。';
      }
      paint();
    } catch {
      notice = ready ? '更新检查失败，当前版本仍可使用；联网后可重试。'
        : '离线准备失败，当前可继续在线使用；联网后请重试。';
      paint();
    } finally { busy = false; action.removeAttribute('aria-busy'); }
  };
  action.addEventListener('click', prepare);
  install.addEventListener('click', async () => {
    if (installBusy) return;
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) {
      explain('已在独立应用窗口中打开。'); return;
    }
    if (!promptEvent) {
      explain('iPhone/iPad：在 Safari 中打开，使用“分享”→“添加到主屏幕”。其它浏览器：在菜单中查找“安装应用”或“添加到主屏幕”；若没有此选项，仍可在网页中练习。'); return;
    }
    const event = promptEvent; promptEvent = null; installBusy = true;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      explain(choice.outcome === 'accepted' ? '已提交安装请求，请按浏览器提示完成。' : '已取消安装，仍可继续使用网页。');
    } catch { explain('浏览器暂未提供安装入口，可使用浏览器菜单添加，或继续使用网页。'); }
    finally { installBusy = false; }
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); promptEvent = event; });
  window.addEventListener('appinstalled', () => { promptEvent = null; explain('应用已安装，可从设备上的图标打开。'); });

  if (document.querySelector('meta[name="kidsmath-development"]')) {
    say('本地编辑预览，离线缓存未启用。'); action.hidden = true; return;
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    say('此浏览器或地址暂不支持离线缓存，可继续在线使用。'); action.hidden = true; return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => { refreshStatus(); }); // 不自动刷新页面。
  window.addEventListener('offline', paint);
  window.addEventListener('online', () => { notice = ''; paint(); prepare(); });
  paint(); prepare();
}
