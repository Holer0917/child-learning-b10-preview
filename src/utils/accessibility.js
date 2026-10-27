/** 只管理焦点与键盘语义，不接触业务数据。 */
export function focusElement(node) {
  if (!node?.isConnected || node.matches(':disabled') || !node.getClientRects().length) return;
  if (!node.matches('a[href],button,input,select,textarea,[tabindex]')) node.tabIndex = -1;
  node.focus({ preventScroll: true });
}

/** 页面可以主动聚焦输入；否则新页面以标题作为键盘起点。 */
export function focusPage(root) {
  const active = document.activeElement;
  if (root.contains(active) && active !== root && active.getClientRects().length && !active.matches(':disabled')) return;
  focusElement(root.querySelector('h1') ?? root.querySelector('a[href],button:not(:disabled),input:not(:disabled),select') ?? root);
}

export function installKeyboardSupport() {
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest('#app, #topbar, #pwa-panel') || event.isComposing) return;
    const checkbox = target.matches('input[type="checkbox"]');
    const activation = event.key === 'Enter' || (event.key === ' ' && (checkbox || target.matches('button')));
    // 按住激活键时，新渲染控件也不能继续接收重复激活；数字/文字长按不受影响。
    if (activation && event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // 保留原生 Space，同时满足课程 AC-KB.2 对复选框 Enter 的约定。
    if (checkbox && event.key === 'Enter' && !target.disabled) {
      event.preventDefault();
      target.click();
    }
  }, true);
}
