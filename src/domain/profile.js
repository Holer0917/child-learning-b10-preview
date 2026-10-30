/** 学习档案：最多3个，跨键变更使用可恢复事务。 */
import { read, write, atomicChange } from '../core/storage.js';
import { bus, EVENTS } from '../core/bus.js';
import { makeId } from '../utils/random.js';

const KEY_PROFILES = 'profiles';
const KEY_ACTIVE = 'active';

export const AVATARS = ['🦊', '🐼', '🐯', '🐰', '🐨', '🐸', '🦁', '🐧', '🐢', '🦄'];

export const MAX_PROFILES = 3;

export const PARTITION_KEY_TEMPLATES = [
  (pid) => `sessions:${pid}`,
  (pid) => `quiz:active:${pid}`,
  (pid) => `quiz:result:${pid}`,
  (pid) => `mistakes:${pid}`,
  (pid) => `stats:${pid}`,
  (pid) => `badges:${pid}`,
  (pid) => `data:${pid}` // 旧键，保留清理兼容
];

export function isValidProfileName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 12;
}

export function validateProfileInput({ name, grade, avatar } = {}) {
  const errors = [];
  if (name != null && (typeof name !== 'string' || (name.trim() && !isValidProfileName(name)))) {
    errors.push({ field: 'name', message: '昵称需为 1~12 个字符，不能为空。' });
  }
  if (grade != null && ![1, 2, 3].includes(grade)) {
    errors.push({ field: 'grade', message: '年级只能是 1、2 或 3。' });
  }
  if (avatar != null && !AVATARS.includes(avatar)) {
    errors.push({ field: 'avatar', message: '请选择提供的头像。' });
  }
  return errors;
}

export function listProfiles() {
  const raw = read(KEY_PROFILES, []);
  return Array.isArray(raw) ? raw : [];
}

export function getActiveProfile() {
  const profiles = listProfiles();
  if (profiles.length === 0) return null;

  const id = read(KEY_ACTIVE, null);
  return profiles.find((p) => p.id === id) ?? profiles[0];
}

export function getProfile(id) {
  return listProfiles().find((p) => p.id === id) ?? null;
}

export function hasActiveSession(profileId) {
  return read(`quiz:active:${profileId}`, null) != null;
}

export function createProfile({ name, grade = 1, avatar } = {}) {
  const profiles = listProfiles();
  if (profiles.length >= MAX_PROFILES) {
    throw new Error('最多只能创建 3 个学习档案，请先删除一个再创建。');
  }

  const errors = validateProfileInput({ name, grade, avatar });
  if (errors.length > 0) throw new Error(errors[0].message);

  const profile = {
    id: makeId('u'),
    name: (name ?? '').trim() || '小朋友',
    grade: [1, 2, 3].includes(Number(grade)) ? Number(grade) : 1,
    avatar: avatar || AVATARS[profiles.length % AVATARS.length],
    createdAt: Date.now()
  };

  profiles.push(profile);
  const saved = atomicChange({ [KEY_PROFILES]: profiles, ...(profiles.length === 1 ? { [KEY_ACTIVE]: profile.id } : {}) });
  if (!saved.ok) throw new Error('档案未保存，请检查存储空间或先重试数据恢复。');

  bus.emit(EVENTS.PROFILE_CHANGED, { profileId: profile.id, created: true });
  return profile;
}

export function updateProfile(id, patch = {}) {
  const profiles = listProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx < 0) return null;

  const errors = validateProfileInput(patch);
  if (errors.length > 0) throw new Error(errors[0].message);

  const next = { ...profiles[idx] };
  if (patch.name != null) next.name = String(patch.name).trim() || '小朋友';
  if (patch.grade != null) next.grade = Number(patch.grade);
  if (patch.avatar != null) next.avatar = patch.avatar;

  profiles[idx] = next;
  const ok = write(KEY_PROFILES, profiles);
  if (!ok) throw new Error('保存失败，请检查浏览器存储空间。');

  bus.emit(EVENTS.PROFILE_CHANGED, { profileId: id, updated: true });
  return next;
}

export function switchProfile(id) {
  const profile = getProfile(id);
  if (!profile) return null;

  const ok = write(KEY_ACTIVE, id);
  if (!ok) throw new Error('切换失败，请检查浏览器存储状态。');

  bus.emit(EVENTS.PROFILE_CHANGED, { profileId: id });
  return profile;
}

export function removeProfile(id) {
  const profiles = listProfiles();
  const target = profiles.find((p) => p.id === id);
  if (!target) return { removed: false, next: getActiveProfile() };

  const rest = profiles.filter((p) => p.id !== id);
  const activeId = getActiveProfile()?.id;
  const next = activeId === id ? rest[0] ?? null : rest.find(p => p.id === activeId) ?? rest[0] ?? null;
  const changes = Object.fromEntries(PARTITION_KEY_TEMPLATES.map(fn => [fn(id), null]));
  Object.assign(changes, { [KEY_PROFILES]: rest, [KEY_ACTIVE]: next?.id ?? null });
  const saved = atomicChange(changes);
  if (!saved.ok) throw new Error(saved.recovered === false ? '删除未完成，原数据已保留在恢复日志中，请先重试数据恢复。' : '删除失败，原档案与数据已保留。');
  bus.emit(EVENTS.PROFILE_CHANGED, { profileId: id, removed: true, next: next?.id ?? null });
  return { removed: true, next };
}

export function removeProfileData(profileId) {
  return atomicChange(Object.fromEntries(PARTITION_KEY_TEMPLATES.map(fn => [fn(profileId), null])));
}

export function activeGrade() {
  return getActiveProfile()?.grade ?? 1;
}

export function hasProfile() {
  return listProfiles().length > 0;
}

export function ensureProfile() {
  const existing = getActiveProfile();
  if (existing) return existing;
  return createProfile({ name: '小朋友', grade: 1 });
}

export function canCreateProfile() {
  return listProfiles().length < MAX_PROFILES;
}