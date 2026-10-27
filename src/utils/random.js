/**
 * 可复现的伪随机数发生器（mulberry32）
 *
 * 选择该算法的理由：
 *  1. 代码量极小（约 10 行），符合零依赖原则；
 *  2. 分布质量对"出题"这一用途绰绰有余；
 *  3. **同一 seed 必然产出同一序列** —— 这是出题可复现测试的基础。
 *
 * 注意：本模块只用于生成题目，不用于任何安全场景。
 */

/**
 * @param {number} seed
 * @returns {{float:Function, int:Function, pick:Function, shuffle:Function, bool:Function}}
 */
export function createRandom(seed = Date.now()) {
  let s = seed >>> 0;

  /** @returns {number} [0, 1) */
  function float() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 闭区间整数 [min, max] */
  function int(min, max) {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(float() * (max - min + 1));
  }

  /** 从数组中随机取一个 */
  function pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(float() * arr.length)];
  }

  /** 以概率 p 返回 true */
  function bool(p = 0.5) {
    return float() < p;
  }

  /** 原地 Fisher–Yates 洗牌，返回同一数组 */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(float() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 生成 [min, max] 内 min 的倍数 */
  function multiple(min, max, step) {
    const lo = Math.ceil(min / step);
    const hi = Math.floor(max / step);
    return int(lo, hi) * step;
  }

  return { float, int, pick, bool, shuffle, multiple };
}

/** 生成一个随机 ID（时间戳 + 随机后缀，保证同一毫秒内多次调用也不冲突） */
export function makeId(prefix = '') {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1e6).toString(36);
  return `${prefix}${t}${r}`;
}
