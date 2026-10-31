import { el } from '../../utils/dom.js';
import {
  listProfiles, getActiveProfile, createProfile, updateProfile, removeProfile,
  switchProfile, AVATARS, MAX_PROFILES, hasActiveSession
} from '../../domain/profile.js';
import { read } from '../../core/storage.js';
import { refresh } from '../../core/router.js';
import { formatDate } from '../../utils/date.js';
import { takeImportReceipt } from '../../domain/backup.js';

const state = {
  creating: false,
  editingId: null,
  form: { name: '', grade: 1, avatar: AVATARS[0] },
  error: ''
};

export function renderProfiles(root) {
  state.creating = false;
  const receipt = takeImportReceipt();
  state.message = receipt ? `恢复完成：${receipt.profiles}个档案、${receipt.records}条练习记录、${receipt.mistakes}道错题。` : '';
  state.editingId = null;
  state.error = '';
  state.form = { name: '', grade: 1, avatar: AVATARS[0] };
  paint(root);
}

function paint(root, focusId = document.activeElement?.id) {
  const profiles = listProfiles();
  const active = getActiveProfile();

  root.replaceChildren(el('section', { class: 'page profiles-page' }, [
    el('header', { class: 'page-head' }, [
      el('h1', { tabindex: -1, text: state.editingId ? '编辑档案' : state.creating ? '创建档案' : '学习档案' }),
      el('p', { class: 'muted', text: '最多创建 3 个档案。切换档案后，出题、历史和错题都会按孩子分开记录。' })
    ]),

    el('section', { class: 'card profiles-list-card', hidden: state.creating || !!state.editingId }, [
      el('div', { class: 'row-between' }, [
        el('h2', { class: 'card-title', text: '全部档案' }),
        el('span', { class: 'muted small', text: `${profiles.length} / ${MAX_PROFILES}` })
      ]),
      profiles.length
        ? el('ul', { class: 'profiles-list' }, profiles.map(p => profileCard(p, active, root)))
        : el('div', { class: 'history-empty' }, [
          el('h3', { text: '还没有学习档案' }),
          el('p', { class: 'muted', text: '创建一个档案，开始记录孩子的练习。' })
        ])
    ]),

    state.creating || state.editingId ? el('section', { class: 'card profile-form-card' }, [
      el('h2', { class: 'card-title', text: state.editingId ? '编辑档案' : '创建档案' }),
      profileForm(root, profiles)
    ]) : el('button', { class: 'btn btn-primary', text: '创建档案', disabled: profiles.length >= MAX_PROFILES,
      onclick: () => { state.creating = true; state.error = ''; paint(root, 'profile-name'); } }),
    state.error ? el('p', { class: 'alert', role: 'alert', text: state.error }) : null,
    state.message ? el('p', { role: 'status', text: state.message }) : null
  ]));
  if (focusId) (document.getElementById(focusId) ?? root.querySelector('#profile-name') ?? root.querySelector('h1'))?.focus({ preventScroll: true });
}

function profileCard(p, active, root) {
  const isActive = active?.id === p.id;
  const records = read(`sessions:${p.id}`, []);
  const historyCount = Array.isArray(records) ? records.length : 0;

  return el('li', { class: 'profile-card' + (isActive ? ' is-active' : '') }, [
    el('span', { class: 'profile-avatar', 'aria-hidden': 'true', text: p.avatar }),
    el('div', { class: 'profile-card-copy' }, [
      el('div', { class: 'row-between' }, [
        el('h3', { text: p.name }),
        isActive ? el('span', { class: 'current-badge', text: '当前档案' }) : null
      ]),
      el('p', { class: 'muted small', text: `${p.grade} 年级 · ${historyCount} 次练习 · 创建于 ${formatDate(p.createdAt, 'YYYY-MM-DD')}` })
    ]),
    el('div', { class: 'profile-actions' }, [
      isActive
        ? el('span', { class: 'btn btn-disabled', 'aria-disabled': 'true', text: '使用中' })
        : el('button', {
          class: 'btn', text: '切换',
          onclick: () => {
            if (hasActiveSession(active?.id)) {
              const ok = window.confirm('当前档案有一份进行中的练习，进度会保留在该档案下，随时可切回继续。确认切换吗？');
              if (!ok) return;
            }
            try { switchProfile(p.id); state.error = ''; refresh(); }
            catch (e) { state.error = e.message; paint(root); }
          }
        }),
      el('button', {
        class: 'btn', text: '编辑',
        onclick: () => {
          state.editingId = p.id;
          state.form = { name: p.name, grade: p.grade, avatar: p.avatar };
          state.error = '';
          paint(root, 'profile-name');
        }
      }),
      el('button', {
        class: 'btn btn-danger-light', text: '删除',
        onclick: () => {
          const ok = window.confirm(`确定删除「${p.name}」的学习档案吗？该档案的练习历史、进行中练习、错题和统计都会被永久删除，且不可恢复。`);
          if (!ok) return;
          try { removeProfile(p.id); } catch (e) { state.error = e.message; paint(root); return; }
          state.editingId = null;
          state.form = { name: '', grade: 1, avatar: AVATARS[0] };
          state.error = '';
          paint(root, 'profile-name');
          refresh();
        }
      })
    ])
  ]);
}

function profileForm(root, profiles) {
  const can = profiles.length < MAX_PROFILES || state.editingId != null;
  const editing = state.editingId != null;

  return el('div', { class: 'profile-form' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'profile-name', text: '昵称' }),
      el('input', {
        id: 'profile-name', class: 'input', type: 'text', maxlength: 12,
        value: state.form.name,
        placeholder: '例如：小明',
        oninput: (e) => { state.form.name = e.target.value; }
      })
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: '年级' }),
      el('div', { class: 'chips' }, [1, 2, 3].map(g => el('button', {
        id: `profile-grade-${g}`, type: 'button', class: 'chip' + (state.form.grade === g ? ' is-active' : ''),
        'aria-pressed': state.form.grade === g ? 'true' : 'false',
        text: `${g} 年级`,
        onclick: () => { state.form.grade = g; paint(root); }
      })))
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: '头像' }),
      el('div', { class: 'avatar-options' }, AVATARS.map((a, i) => el('button', {
        id: `profile-avatar-${i}`, type: 'button', class: 'avatar-option' + (state.form.avatar === a ? ' is-active' : ''),
        text: a,
        'aria-label': `头像 ${a}`,
        'aria-pressed': state.form.avatar === a ? 'true' : 'false',
        onclick: () => { state.form.avatar = a; paint(root); }
      })))
    ]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: editing ? '保存修改' : '创建档案',
        disabled: !can,
        onclick: () => {
          state.error = '';
          try {
            if (editing) {
              updateProfile(state.editingId, state.form);
            } else {
              createProfile(state.form);
            }
            state.editingId = null;
            state.form = { name: '', grade: 1, avatar: AVATARS[0] };
            paint(root);
            refresh();
          } catch (err) {
            state.error = err.message;
            paint(root);
          }
        }
      }),
      el('button', {
        class: 'btn', type: 'button', text: '返回档案列表',
        onclick: () => {
          state.creating = false;
          state.editingId = null;
          state.form = { name: '', grade: 1, avatar: AVATARS[0] };
          state.error = '';
          paint(root, 'profile-name');
        }
      }),
      !can ? el('p', { class: 'muted small', text: `已达到 ${MAX_PROFILES} 个档案上限，请先删除一个档案。` }) : null
    ])
  ]);
}
