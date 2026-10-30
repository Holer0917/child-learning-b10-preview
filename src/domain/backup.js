import { read, keys, isAvailable, atomicChange, recoverTransaction } from '../core/storage.js';
import { inspectBackupPayload } from '../core/backupSchema.js';
import { listProfiles, PARTITION_KEY_TEMPLATES } from './profile.js';
import { retainHistory } from './history.js';
import { readStore } from './mistakes.js';
import { dateStr } from '../utils/date.js';
import { bus, EVENTS } from '../core/bus.js';

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024, BACKUP_VERSION = '1.0';
const clone = v => JSON.parse(JSON.stringify(v));
const fields = { sessions: 'sessions', quizActive: 'quiz:active', quizResult: 'quiz:result', mistakes: 'mistakes', badges: 'badges', stats: 'stats', legacyData: 'data' };
let receipt = null;
export function takeImportReceipt() { const result = receipt; receipt = null; return result; }
const issue = (message, path = '$') => ({ ok: false, errors: [{ path, message }], warnings: [] });
const check = payload => { const r = inspectBackupPayload(payload); if (!r.ok) throw new Error(`${r.errors[0].path}：${r.errors[0].message}`); return r; };

/** 输出标准1.0格式；附加mistakeState保留V2归档防重，不丢失清理历史。 */
export function buildBackup() {
  const profiles = listProfiles(), data = {};
  for (const p of profiles) {
    const m = readStore(p.id);
    if (m.error) throw new Error(`档案「${p.name}」错题数据异常，暂不能导出。`);
    const awards = read(`badges:${p.id}`, { version: 1, items: [] });
    data[p.id] = {
      sessions: read(`sessions:${p.id}`, []), quizActive: read(`quiz:active:${p.id}`, null), quizResult: read(`quiz:result:${p.id}`, null),
      mistakes: m.items, mistakeState: { version: 2, archivedSessions: m.archivedSessions },
      badges: awards?.version === 1 && Array.isArray(awards.items) ? awards.items.map(b => ({ id: b.id.replace(/^d/, 'streak'),
        name: `连续 ${b.id.slice(1)} 天`, earnedAt: new Date(`${b.earnedAt}T00:00:00`).getTime() })) : awards,
      stats: read(`stats:${p.id}`, null), legacyData: read(`data:${p.id}`, null)
    };
  }
  const payload = { format: 'kidsmath-backup', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), profiles,
    active: read('active', profiles[0]?.id ?? null), data, settings: { sound: false, theme: 'auto', ...read('settings', {}) } };
  check(payload);
  return payload;
}
export function downloadBackup() {
  const payload = buildBackup(), json = JSON.stringify(payload, null, 2), blob = new Blob([json], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new Error('备份超过5MB，请先整理较早记录后重试。');
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  const filename = `kidsmath-backup-${dateStr().replaceAll('-', '')}.json`;
  try { a.href = url; a.download = filename; document.body.appendChild(a); a.click(); }
  finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return { filename, bytes: blob.size };
}
export async function parseBackupFile(file) {
  if (!file) return issue('未选择文件。');
  if (file.size > MAX_BACKUP_BYTES) return issue('文件超过5MB，请选择由本软件导出的备份。');
  let text;
  try { text = await file.text(); } catch { return issue('读取文件失败，请重试。'); }
  try { return inspectBackupPayload(JSON.parse(text.replace(/^\uFEFF/, ''))); }
  catch { return issue('不是有效的 JSON 文件。'); }
}
export function previewBackup(payload) {
  const profiles = Array.isArray(payload?.profiles) ? payload.profiles.filter(p => p && typeof p.id === 'string') : [];
  return { profileCount: profiles.length, perProfile: profiles.map(p => ({ ...p,
    historyCount: payload.data?.[p.id]?.sessions?.length ?? 0,
    mistakeCount: (payload.data?.[p.id]?.mistakes?.items ?? payload.data?.[p.id]?.mistakes ?? []).length ?? 0 })) };
}
const union = (a = [], b = [], max) => [...new Set([...a, ...b])].slice(-max);
function mergePartition(a, b) {
  const remap = new Map(), rows = new Map(a.mistakes.items.map(m => [m.key, m]));
  for (const m of b.mistakes.items) {
    const old = rows.get(m.key);
    if (!old) { rows.set(m.key, m); continue; }
    remap.set(m.id, old.id);
    const recent = m.lastWrongAt > old.lastWrongAt ? m : old, first = m.firstWrongAt < old.firstWrongAt ? m : old;
    rows.set(m.key, { ...recent, id: old.id, firstWrongAt: first.firstWrongAt, firstUserAnswer: first.firstUserAnswer,
      sourcePaperKeys: first.sourcePaperKeys, wrongCount: Math.max(old.wrongCount, m.wrongCount), sourceSessions: union(old.sourceSessions, m.sourceSessions, 10) });
  }
  const rewrite = value => {
    if (!value) return value;
    const v = clone(value), p = v.paper;
    if (p) for (const field of ['sourceMistakeIds', 'variantRemainingIds']) if (p[field]) p[field] = [...new Set(p[field].map(id => remap.get(id) ?? id))];
    return v;
  };
  const sessions = new Map(a.sessions.map(r => [r.id, r]));
  for (const r of b.sessions) if (!sessions.has(r.id) || r.finishedAt > sessions.get(r.id).finishedAt) sessions.set(r.id, rewrite(r));
  const awards = new Map(a.badges.items.map(b => [b.id, b]));
  for (const badge of b.badges.items) if (!awards.has(badge.id) || badge.earnedAt < awards.get(badge.id).earnedAt) awards.set(badge.id, badge);
  const choose = (old, incoming, field) => !old || (incoming?.[field] ?? -1) > old[field] ? rewrite(incoming) : old;
  return { ...a, ...b, sessions: retainHistory([...sessions.values()]),
    quizActive: choose(a.quizActive, b.quizActive, 'savedAt'), quizResult: choose(a.quizResult, b.quizResult, 'finishedAt'),
    mistakes: { version: 2, items: [...rows.values()], archivedSessions: union(a.mistakes.archivedSessions, b.mistakes.archivedSessions, 2500) },
    badges: { version: 1, items: [...awards.values()] } };
}
/** 每次预览/应用均重新校验；全量覆盖与合并均明确列出目标档案。 */
export function prepareImport(input, { mode = 'merge' } = {}) {
  const result = inspectBackupPayload(input);
  if (!result.ok) return result;
  if (!['merge', 'overwrite'].includes(mode)) return issue('请选择合并或覆盖。');
  let payload = result.payload;
  const existing = listProfiles(), existingIds = new Set(existing.map(p => p.id));
  const conflicts = payload.profiles.filter(p => existingIds.has(p.id)).length;
  if (mode === 'merge' && existing.length) {
    let current;
    try { current = check(buildBackup()).payload; } catch (e) { return issue('现有数据无法安全合并：' + e.message); }
    const profiles = new Map(current.profiles.map(p => [p.id, p]));
    const data = { ...current.data };
    for (const p of payload.profiles) { profiles.set(p.id, p); data[p.id] = data[p.id] ? mergePartition(data[p.id], payload.data[p.id]) : payload.data[p.id]; }
    payload = { ...payload, profiles: [...profiles.values()], data, active: current.active,
      settings: { ...current.settings, ...payload.settings } };
    const merged = inspectBackupPayload(payload);
    if (!merged.ok) return merged;
    payload = merged.payload;
  }
  return { ...result, payload, mode, conflicts, preview: previewBackup(payload), replacedProfiles: mode === 'overwrite' ? existing.length : 0 };
}
export function applyBackup(input, options) {
  if (!isAvailable()) return issue('浏览器本地存储不可用，暂不能持久化恢复。');
  const recovery = recoverTransaction();
  if (!recovery.ok) return issue('上次恢复尚未完成，原数据仍保留在恢复日志中，请重试数据恢复。');
  const plan = prepareImport(input, options);
  if (!plan.ok) return plan;
  const { payload } = plan, changes = {};
  if (plan.mode === 'overwrite') for (const key of keys()) {
    if (/^(sessions|quiz:active|quiz:result|mistakes|stats|badges|data):[A-Za-z0-9_-]+$/.test(key)) changes[key] = null;
  }
  changes.profiles = payload.profiles; changes.active = payload.active;
  if (payload.settings !== undefined) changes.settings = { ...read('settings', {}), ...payload.settings };
  for (const p of payload.profiles) {
    const d = payload.data[p.id];
    for (const [field, key] of Object.entries(fields)) changes[`${key}:${p.id}`] = d[field] ?? null;
  }
  const saved = atomicChange(changes);
  if (!saved.ok) return { ...issue(saved.code === 'RECOVERY_REQUIRED'
    ? '写入未完成，原数据已保留在恢复日志中，请释放存储空间后重试数据恢复。'
    : '导入未完成，原数据保持不变。可用空间需足够暂存恢复日志，请整理存储后重试。'), code: saved.code, recovered: saved.recovered };
  bus.emit(EVENTS.PROFILE_CHANGED, { profileId: payload.active, imported: true });
  receipt = { profiles: payload.profiles.length, records: Object.values(payload.data).reduce((n, d) => n + d.sessions.length, 0),
    mistakes: Object.values(payload.data).reduce((n, d) => n + d.mistakes.items.length, 0) };
  return { ok: true, profileCount: payload.profiles.length, warnings: plan.warnings, mode: plan.mode };
}
