/**
 * 极简事件总线（发布 / 订阅）
 *
 * 设计目的：解耦 UI 层与 Domain 层。
 * 例如"错题被攻克"这件事，错题本页面与统计页面都要知道，
 * 但它们彼此不应相互引用，于是通过事件广播。
 */

/**
 * @typedef {Object} Bus
 * @property {Function} on    订阅，返回取消订阅函数
 * @property {Function} off   取消订阅
 * @property {Function} once  只订阅一次
 * @property {Function} emit  发布
 * @property {Function} clear 清空全部订阅（用于测试）
 */

/** @returns {Bus} */
export function createBus() {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();

  function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => off(type, fn);          // 返回取消订阅的闭包，便于组件卸载时清理
  }

  function off(type, fn) {
    handlers.get(type)?.delete(fn);
  }

  function once(type, fn) {
    const wrap = (payload) => {
      off(type, wrap);
      fn(payload);
    };
    return on(type, wrap);
  }

  function emit(type, payload) {
    const set = handlers.get(type);
    if (!set || set.size === 0) return;

    // 遍历副本：避免 handler 内部取消订阅导致迭代器失效
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        // 单个 handler 出错不应影响其它 handler
        console.error(`[bus] "${type}" 的订阅者执行出错：`, err);
      }
    }
  }

  function clear(type) {
    if (type) handlers.delete(type);
    else handlers.clear();
  }

  return { on, off, once, emit, clear };
}

/** 应用全局单例 */
export const bus = createBus();

/**
 * 事件名常量 —— 集中定义，避免各处硬编码字符串导致拼写不一致。
 * @readonly
 */
export const EVENTS = {
  PROFILE_CHANGED:  'profile:changed',
  PAPER_GENERATED:  'paper:generated',
  QUIZ_STARTED:     'quiz:started',
  QUIZ_ANSWERED:    'quiz:answered',
  QUIZ_FINISHED:    'quiz:finished',
  MISTAKE_MASTERED: 'mistake:mastered',
  DATA_CHANGED:     'data:changed',
  STORAGE_ERROR:    'storage:error',
  STORAGE_CORRUPT:  'storage:corrupt',
  ROUTE_CHANGED:    'route:changed',
  TOAST:            'ui:toast'
};
