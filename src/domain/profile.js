/**
 * 档案服务
 *
 * 一个"档案"就是一个孩子的独立数据空间。
 * 所有业务数据（练习记录、错题、徽章）都挂在某个档案下，
 * 切换档案 = 切换数据空间，互不干扰。
 */

import { read, write, remove } from '../core/storage.js';
import { bus, EVENTS } from '../core/bus.js';
import { makeId } from '../utils/random.js';

const KEY_PROFILES = 'profiles';
const KEY_ACTIVE = 'active';

/** 可选头像（用 emoji，零资源开销） */
export const AVATARS = ['🦊', '🐼', '🐯', '🐰', '🐨', '🐸', '🦁', '🐧', '🐢', '🦄'];

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} name
 * @property {1|2|3}  grade
 * @property {string} avatar
 * @property {number} createdAt
 */

/* ------------------------------------------------------------------ *
 * 查询
 * ------------------------------------------------------------------ */

/** @returns {Profile[]} */
export function listProfiles() {
  return read(KEY_PROFILES, []);
}

/** @returns {Profile|null} */
export function getActiveProfile() {
  const profiles = listProfiles();
  if (profiles.length === 0) return null;

  const id = read(KEY_ACTIVE, null);
  return profiles.find((p) => p.id === id) ?? profiles[0];
}

/** @returns {Profile|null} */
export function getProfile(id) {
  return listProfiles().find((p) => p.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * 写操作
 * ------------------------------------------------------------------ */

/**
 * 创建档案
 * @param {{name?:string, grade?:1|2|3, avatar?:string}} opts
 * @returns {Profile}
 */
export function createProfile({ name, grade = 1, avatar } = {}) {
  const profiles = listProfiles();

  const profile = {
    id: makeId('u'),
    name: (name ?? '').trim() || '小朋友',
    grade: [1, 2, 3].includes(Number(grade)) ? Number(grade) : 1,
    avatar: avatar || AVATARS[profiles.length % AVATARS.length],
    createdAt: Date.now()
  };

  profiles.push(profile);
  write(KEY_PROFILES, profiles);

  // 首个档案自动设为当前档案
  if (profiles.length === 1) write(KEY_ACTIVE, profile.id);

  bus.emit(EVENTS.PROFILE_CHANGED, { profileId: profile.id, created: true });
  return profile;
}

/**
 * 局部更新档案
 * @param {string} id
 * @param {Partial<Profile>} patch
 */
export function updateProfile(id, patch = {}) {
  const profiles = listProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx < 0) return null;

  const next = { ...profiles[idx] };
  if (patch.name != null) next.name = String(patch.name).trim() || next.name;
  if (patch.grade != null && [1, 2, 3].includes(Number(patch.grade))) {
    next.grade = Number(patch.grade);
  }
  if (patch.avatar != null) next.avatar = patch.avatar;

  profiles[idx] = next;
  write(KEY_PROFILES, profiles);
  bus.emit(EVENTS.PROFILE_CHANGED, { profileId: id, updated: true });
  return next;
}

/**
 * 切换当前档案
 */
export function switchProfile(id) {
  const profile = getProfile(id);
  if (!profile) return null;

  write(KEY_ACTIVE, id);
  bus.emit(EVENTS.PROFILE_CHANGED, { profileId: id });
  return profile;
}

/**
 * 删除档案及其全部关联数据（级联删除）
 * @returns {{removed:boolean, next:Profile|null}}
 */
export function removeProfile(id) {
  const profiles = listProfiles();
  const target = profiles.find((p) => p.id === id);
  if (!target) return { removed: false, next: getActiveProfile() };

  const rest = profiles.filter((p) => p.id !== id);
  write(KEY_PROFILES, rest);

  // 级联删除该档案的业务数据
  removeProfileData(id);

  // 若删除的是当前档案，自动切到剩余档案中的第一个
  const activeId = read(KEY_ACTIVE, null);
  if (activeId === id) {
    const next = rest[0] ?? null;
    if (next) write(KEY_ACTIVE, next.id);
    else write(KEY_ACTIVE, null);
  }

  bus.emit(EVENTS.PROFILE_CHANGED, { profileId: id, removed: true });
  return { removed: true, next: getActiveProfile() };
}

/** 删除该档案的业务数据键 */
function removeProfileData(profileId) {
  remove(`data:${profileId}`);
}

/* ------------------------------------------------------------------ *
 * 便捷方法
 * ------------------------------------------------------------------ */

/** 当前档案的年级（无档案时返回 1） */
export function activeGrade() {
  return getActiveProfile()?.grade ?? 1;
}

/** 是否已有档案 */
export function hasProfile() {
  return listProfiles().length > 0;
}

/** 确保存在至少一个档案；没有则自动创建一个默认档案 */
export function ensureProfile() {
  const existing = getActiveProfile();
  if (existing) return existing;
  return createProfile({ name: '小朋友', grade: 1 });
}

/** 档案数量上限（对应 NFR-09 第 1 条） */
export const MAX_PROFILES = 3;

/** 是否还能新建档案 */
export function canCreateProfile() {
  return listProfiles().length < MAX_PROFILES;
}
