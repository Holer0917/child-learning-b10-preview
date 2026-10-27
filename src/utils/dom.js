/**
 * DOM 操作助手
 * 全部为纯函数或轻量工厂，不引入任何依赖。
 */

/**
 * 创建元素
 * @param {string} tag
 * @param {Object} [attrs] - 属性；class / style / dataset / 事件(onXxx) 特殊处理
 * @param {(Node|string)[]|string} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;

    if (key === 'class') {
      node.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, v);
        else node.style[prop] = v;
      }
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(node, children);
  return node;
}

/** 创建 SVG 元素（SVG 需要命名空间） */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.setAttribute('class', value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

/** 追加子节点，自动处理字符串与数组 */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child
    );
  }
  return parent;
}

/** 清空并可选填充子节点 */
export function mount(parent, children) {
  parent.replaceChildren();
  append(parent, children);
  return parent;
}

/** 查询 */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 事件委托 */
export function delegate(root, eventName, selector, handler) {
  root.addEventListener(eventName, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

/** 简易元素池：用于避免重复创建同类节点 */
export function fragment(children) {
  const frag = document.createDocumentFragment();
  append(frag, children);
  return frag;
}
