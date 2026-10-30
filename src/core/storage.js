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
const JOURNAL = '__transaction__';
let recoveryView = null;

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
    const view = isAvailable() ? journalView() : null;
    raw = isAvailable()
      ? (view?.has(key) ? view.get(key) : localStorage.getItem(PREFIX + key))
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
    if (isAvailable() && localStorage.getItem(PREFIX + JOURNAL) !== null) return false;
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
    if (isAvailable() && localStorage.getItem(PREFIX + JOURNAL) !== null) return false;
    if (isAvailable()) localStorage.removeItem(PREFIX + key);
    else memory.delete(key);
    return true;
  } catch {
    bus.emit(EVENTS.STORAGE_ERROR, { reason: 'remove', key });
    return false;
  }
}

/** 导入/级联删除的撤销日志。只有删除日志成功才算提交；异常保留原值供恢复。 */
function decodeJournal(raw) {
  const j = JSON.parse(raw);
  if (j?.version !== 1 || !Array.isArray(j.before) || j.before.length > 100
      || j.before.some(x => !Array.isArray(x) || x.length !== 2 || typeof x[0] !== 'string'
        || !x[0] || x[0].length > 200 || x[0] === JOURNAL || !(x[1] === null || typeof x[1] === 'string'))
      || new Set(j.before.map(x => x[0])).size !== j.before.length) throw new Error('invalid-journal');
  return new Map(j.before);
}
function journalView() {
  const raw = localStorage.getItem(PREFIX + JOURNAL);
  if (raw === null) { recoveryView = null; return null; }
  try { return recoveryView = decodeJournal(raw); } catch { return recoveryView; }
}
function restore(view) {
  // 日志已完整保存原值；先释放本次变动的空间，确保旧值恢复不被新值挤占。
  for (const key of view.keys()) localStorage.removeItem(PREFIX + key);
  for (const [key, raw] of view) {
    if (raw === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, raw);
  }
  for (const [key, raw] of view) if (localStorage.getItem(PREFIX + key) !== raw) throw new Error('restore-failed');
  localStorage.removeItem(PREFIX + JOURNAL);
  if (localStorage.getItem(PREFIX + JOURNAL) !== null) throw new Error('journal-remove-failed');
  recoveryView = null;
}
export function recoverTransaction() {
  if (!isAvailable()) return { ok: true, durable: false };
  try {
    const raw = localStorage.getItem(PREFIX + JOURNAL);
    if (raw === null) { recoveryView = null; return { ok: true }; }
    recoveryView = decodeJournal(raw);
    restore(recoveryView);
    return { ok: true, recovered: true };
  } catch {
    return { ok: false, code: 'RECOVERY_REQUIRED' };
  }
}
/** changes 的 null 表示删除；其余值序列化后一次性准备。不会先清空现有数据。 */
export function atomicChange(changes) {
  const entries = Object.entries(changes);
  if (entries.length > 100 || entries.some(([k]) => !k || k.length > 200 || k === JOURNAL)) return { ok: false, code: 'INVALID_CHANGES' };
  let encoded;
  try { encoded = entries.map(([k, v]) => [k, v === null ? null : JSON.stringify(v)]);
    if (encoded.some(([, v]) => v === undefined)) throw new Error('invalid-value');
  } catch { return { ok: false, code: 'INVALID_CHANGES' }; }
  if (!isAvailable()) {
    for (const [key, raw] of encoded) if (raw === null) memory.delete(key); else memory.set(key, raw);
    bus.emit(EVENTS.DATA_CHANGED, { keys: entries.map(([k]) => k) });
    return { ok: true, durable: false };
  }
  let before;
  try {
    if (localStorage.getItem(PREFIX + JOURNAL) !== null) return { ok: false, code: 'RECOVERY_REQUIRED' };
    before = new Map(encoded.map(([key]) => [key, localStorage.getItem(PREFIX + key)]));
    localStorage.setItem(PREFIX + JOURNAL, JSON.stringify({ version: 1, before: [...before] }));
  } catch { return { ok: false, code: 'STAGING_FAILED', recovered: true }; }
  recoveryView = before;
  try {
    for (const [key, raw] of encoded) {
      if (raw === null) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, raw);
    }
    for (const [key, raw] of encoded) if (localStorage.getItem(PREFIX + key) !== raw) throw new Error('write-failed');
    localStorage.removeItem(PREFIX + JOURNAL);
    if (localStorage.getItem(PREFIX + JOURNAL) !== null) throw new Error('commit-failed');
    recoveryView = null;
  } catch {
    try { restore(before); return { ok: false, code: 'WRITE_FAILED', recovered: true }; }
    catch { return { ok: false, code: 'RECOVERY_REQUIRED', recovered: false }; }
  }
  bus.emit(EVENTS.DATA_CHANGED, { keys: entries.map(([k]) => k) });
  return { ok: true, durable: true };
}

/** 清空本应用的全部键（不触碰同域下其它应用的数据） */
export function clearAll() {
  if (isAvailable() && localStorage.getItem(PREFIX + JOURNAL) !== null) return false;
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
    if (k && k.startsWith(PREFIX) && k !== PREFIX + JOURNAL) out.push(k.slice(PREFIX.length));
  }
  const view = journalView(), result = new Set(out);
  for (const [key, raw] of view ?? []) if (raw === null) result.delete(key); else result.add(key);
  return [...result];
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
    if (isAvailable() && localStorage.getItem(PREFIX + JOURNAL) !== null) return;
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
  recoveryView = null;
}
