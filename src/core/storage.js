/**
 * 本地持久化
 *
 * 设计要点：
 *  1. 全部数据存于 localStorage，键统一加 'km-preview-b10:' 前缀，便于整体清理与迁移；
 *  2. localStorage 不可用（隐私模式 / 被禁用）时自动退化为内存存储，
 *     功能仍可用，只是刷新后丢失 —— 界面会给出提示；
 *  3. 数据损坏时先备份到 '__corrupt__' 键再重置，不丢证据，也不白屏；
 *  4. 提供版本迁移机制，为后续数据结构演进留出口。
 */

import { bus, EVENTS } from './bus.js';

const PREFIX = 'km-preview-b10:';
const CURRENT_VERSION = 1;

/* ------------------------------------------------------------------ *
 * 可用性探测
 * ------------------------------------------------------------------ */

let available = null;

/** localStorage 是否可用（结果缓存，避免每次读写都探测） */
export function isAvailable() {
  if (available !== null) return available;
  try {
    const probe = '__km_preview_b10_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
    console.warn('[storage] localStorage 不可用，已切换为内存存储');
  }
  return available;
}

/** 内存兜底存储（会话级） */
const memory = new Map();

/* ------------------------------------------------------------------ *
 * 读写
 * ------------------------------------------------------------------ */

/**
 * 读取并反序列化
 * @param {string} key      不含前缀的键名
 * @param {*}      fallback 不存在或解析失败时的返回值
 */
export function read(key, fallback = null) {
  let raw = null;
  try {
    raw = isAvailable()
      ? localStorage.getItem(PREFIX + key)
      : (memory.get(key) ?? null);
  } catch {
    return fallback;
  }

  if (raw == null) return fallback;

  try {
    return JSON.parse(raw);
  } catch (err) {
    handleCorruption(key, raw, err);
    return fallback;
  }
}

/**
 * 序列化并写入
 * @returns {boolean} 是否写入成功（容量超限时返回 false）
 */
export function write(key, value) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch (err) {
    console.error('[storage] 序列化失败：', err);
    return false;
  }

  try {
    if (isAvailable()) localStorage.setItem(PREFIX + key, raw);
    else memory.set(key, raw);

    bus.emit(EVENTS.DATA_CHANGED, { keys: [key] });
    return true;
  } catch (err) {
    // QuotaExceededError（或 Safari 的私密模式写入失败）
    const quota = err && (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22
    );
    bus.emit(EVENTS.STORAGE_ERROR, { reason: quota ? 'quota' : 'unknown', key });
    return false;
  }
}

/** 删除单个键 */
export function remove(key) {
  try {
    if (isAvailable()) localStorage.removeItem(PREFIX + key);
    else memory.delete(key);
  } catch { /* 忽略 */ }
}

/** 清空本应用的全部键（不触碰同域下其它应用的数据） */
export function clearAll() {
  if (isAvailable()) {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  }
  memory.clear();
}

/** 列出本应用占用的全部键 */
export function keys() {
  if (!isAvailable()) return [...memory.keys()];
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
  }
  return out;
}

/** 估算已用字节数 */
export function usedBytes() {
  if (!isAvailable()) {
    let n = 0;
    for (const [k, v] of memory) n += k.length + v.length;
    return n * 2;                                  // UTF-16
  }
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    n += k.length + (localStorage.getItem(k)?.length ?? 0);
  }
  return n * 2;
}

/* ------------------------------------------------------------------ *
 * 损坏处理
 * ------------------------------------------------------------------ */

/**
 * 数据损坏：把原始内容备份到 '__corrupt__<key>'，删除损坏键，
 * 并广播事件让界面提示用户。对应需求 NFR-03 第 2 条。
 */
function handleCorruption(key, raw, err) {
  console.error(`[storage] 键 "${key}" 数据损坏：`, err);
  try {
    if (isAvailable()) {
      localStorage.setItem(`${PREFIX}__corrupt__${key}`,
        JSON.stringify({ at: Date.now(), raw: String(raw).slice(0, 10000) }));
      localStorage.removeItem(PREFIX + key);
    } else {
      memory.delete(key);
    }
  } catch { /* 备份失败也不影响重置 */ }

  bus.emit(EVENTS.STORAGE_CORRUPT, { key });
}

/* ------------------------------------------------------------------ *
 * 版本迁移
 * ------------------------------------------------------------------ */

/**
 * 迁移函数表：键为"目标版本号"，值为 (data) => data。
 * 例：从 v1 升到 v2，会调用 MIGRATIONS[2]。
 * 当前为初始版本，表为空，仅保留机制。
 */
const MIGRATIONS = {
  // 2: (data) => { /* 未来版本的数据结构调整 */ return data; }
};

/** 应用启动时调用：把旧版本数据升级到 CURRENT_VERSION */
export function migrate() {
  const meta = read('meta', null);

  if (!meta) {
    // 首次运行：写入元信息
    write('meta', {
      version: CURRENT_VERSION,
      createdAt: Date.now(),
      lastVisitAt: Date.now()
    });
    return;
  }

  let v = meta.version ?? 1;
  if (v >= CURRENT_VERSION) {
    write('meta', { ...meta, lastVisitAt: Date.now() });
    return;
  }

  console.info(`[storage] 数据结构迁移：v${v} → v${CURRENT_VERSION}`);
  try {
    while (v < CURRENT_VERSION) {
      const fn = MIGRATIONS[v + 1];
      if (fn) {
        for (const key of keys()) {
          if (key.startsWith('__corrupt__') || key === 'meta') continue;
          const data = read(key, null);
          if (data != null) write(key, fn(data));
        }
      }
      v++;
    }
    write('meta', { ...meta, version: CURRENT_VERSION, lastVisitAt: Date.now() });
  } catch (err) {
    console.error('[storage] 迁移失败，保持原数据：', err);
  }
}

/** 仅用于测试：重置可用性探测缓存与内存存储 */
export function __resetForTest() {
  available = null;
  memory.clear();
}
