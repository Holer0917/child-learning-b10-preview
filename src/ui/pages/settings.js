import { el } from '../../utils/dom.js';
import { read, write, usedBytes, isAvailable, recoverTransaction } from '../../core/storage.js';
import { downloadBackup, parseBackupFile, prepareImport, applyBackup } from '../../domain/backup.js';
import { formatBytes } from '../../utils/format.js';
import { go } from '../../core/router.js';

const state = { file: null, payload: null, mode: 'merge', errors: [], message: '', ticket: 0, recovery: false };
export function renderSettings(root) {
  Object.assign(state, { file: null, payload: null, mode: 'merge', errors: [], message: '', recovery: false });
  state.ticket++; paint(root);
  return () => state.ticket++;
}
function paint(root, focusId = document.activeElement?.id) {
  const plan = state.payload ? prepareImport(state.payload, { mode: state.mode }) : null;
  const errors = [...state.errors, ...(!plan?.ok && plan ? plan.errors : [])];
  root.replaceChildren(el('section', { class: 'page settings-page' }, [
    el('h1', { text: '数据管理', tabindex: -1 }),
    el('p', { class: 'muted', text: '档案、成绩和错题保存在当前浏览器。备份文件可用于更换设备或恢复数据。' }),
    el('section', { class: 'card' }, [el('h2', { class: 'card-title', text: '存储与偏好' }),
      el('p', { text: `当前占用约 ${formatBytes(usedBytes())}（按本地字符串估算）。` }),
      !isAvailable() ? el('p', { class: 'alert', text: '本地存储不可用，当前数据仅临时保留，暂不能导入。' }) : null,
      el('label', { class: 'sound-setting' }, [el('input', { id: 'settings-sound', type: 'checkbox', checked: read('settings', {}).sound === true,
        onchange: e => {
          const ok = write('settings', { ...read('settings', {}), sound: e.target.checked });
          state.message = ok ? (isAvailable() ? '音效设置已保存。' : '音效设置仅本次打开有效。') : '';
          state.errors = ok ? [] : [{ path: '$.settings', message: '设置未保存，请检查存储空间或恢复状态。' }]; paint(root);
        } }), '播放答题提示音']),
      el('a', { class: 'btn', href: '#/profiles', text: '管理学习档案' })]),
    el('section', { class: 'card' }, [el('h2', { class: 'card-title', text: '导出备份' }),
      el('p', { class: 'muted', text: '导出全部档案、成绩、未完成练习、错题、徽章和音效设置。文件保存在你选择的位置。' }),
      el('button', { id: 'export-backup', class: 'btn', text: '导出备份', onclick: () => {
        try { const r = downloadBackup(); state.message = `已发起下载：${r.filename}（${formatBytes(r.bytes)}），请确认文件已保存。`; state.errors = []; }
        catch (e) { state.errors = [{ path: '$', message: e.message }]; state.message = ''; } paint(root);
      } })]),
    el('section', { class: 'card' }, [el('h2', { class: 'card-title', text: '从备份恢复' }),
      el('p', { class: 'muted', text: '选择不超过5MB的 JSON 文件。完整校验通过后显示预览，确认前不会替换本地数据。' }),
      el('label', { for: 'backup-file', class: 'field-label', text: '选择备份文件' }),
      el('input', { id: 'backup-file', class: 'file-input', type: 'file', accept: '.json,application/json', onchange: async e => {
        const file = e.target.files?.[0], ticket = ++state.ticket;
        Object.assign(state, { file: file ?? null, payload: null, errors: [], message: '' });
        if (!file) { paint(root); return; }
        const result = await parseBackupFile(file);
        if (ticket !== state.ticket) return;
        if (result.ok) { state.payload = result.payload; state.fileWarnings = result.warnings; }
        else state.errors = result.errors;
        paint(root, result.ok ? 'import-mode' : 'backup-file');
      } }),
      state.file ? el('p', { class: 'muted', text: `已选择：${state.file.name}` }) : null,
      state.payload ? el('div', { class: 'import-preview' }, [
        el('label', { for: 'import-mode', class: 'field-label', text: '恢复方式' }),
        el('select', { id: 'import-mode', class: 'input', onchange: e => { state.mode = e.target.value; state.errors = []; paint(root); } },
          [el('option', { value: 'merge', selected: state.mode === 'merge', text: '合并：保留现有档案，按编号去重' }),
            el('option', { value: 'overwrite', selected: state.mode === 'overwrite', text: '覆盖：用备份替换现有档案数据' })]),
        el('p', { class: 'muted', text: state.mode === 'merge'
          ? '同编号成绩保留结束时间较新的记录；进行中练习保留保存时间较新的那份。每档案仍最多保留500份明细和2000份摘要。'
          : '覆盖会移除备份之外的现有档案及其数据。请先导出当前备份。' }),
        plan?.ok ? el('div', {}, [el('h3', { text: '恢复后的数据预览' }),
          el('p', { text: `${plan.preview.profileCount} 个档案；${plan.conflicts} 个同编号档案。` }),
          el('ul', {}, plan.preview.perProfile.map(p => el('li', { text: `${p.avatar} ${p.name}（${p.grade}年级）· 历史${p.historyCount}条 · 错题${p.mistakeCount}道` }))),
          el('p', { class: 'muted', text: '备份中的音效设置一同恢复；早期文件未保存设置时保留当前设置。' })]) : null,
        ...(state.fileWarnings ?? []).map(text => el('p', { class: 'muted', text })),
        el('div', { class: 'actions' }, [el('button', { id: 'confirm-import', class: 'btn', text: '确认导入', disabled: !plan?.ok, onclick: () => {
          const current = prepareImport(state.payload, { mode: state.mode });
          if (!current.ok) { state.errors = current.errors; paint(root); return; }
          if (!window.confirm(state.mode === 'overwrite' ? `将用备份替换现有档案数据，恢复${current.preview.profileCount}个档案。确认覆盖？`
            : `将合并为${current.preview.profileCount}个档案，并按编号去重；备份中的设置会一同恢复。确认导入？`)) return;
          const r = applyBackup(state.payload, { mode: state.mode });
          if (r.ok) { go('/profiles'); return; }
          state.errors = r.errors; state.recovery = r.code === 'RECOVERY_REQUIRED'; paint(root);
        } }), el('button', { id: 'cancel-import', class: 'btn', text: '取消', onclick: () => {
          state.ticket++; Object.assign(state, { file: null, payload: null, errors: [], message: '' }); paint(root, 'backup-file');
        } })])]) : null,
      errors.length ? el('div', { class: 'import-errors', role: 'alert' }, [el('strong', { text: '本次导入未完成：' }),
        el('ul', {}, errors.map(e => el('li', { text: `${e.path}：${e.message}` })))]) : null,
      state.recovery ? el('button', { class: 'btn', text: '重试数据恢复', onclick: () => {
        const r = recoverTransaction(); state.recovery = !r.ok;
        state.errors = r.ok ? [] : [{ path: '$', message: '恢复尚未完成，原数据仍保留在恢复日志中。' }];
        state.message = r.ok ? '已恢复操作前的数据；本次导入未生效。' : ''; paint(root);
      } }) : null]),
    state.message ? el('p', { role: 'status', class: 'settings-message', text: state.message }) : null
  ]));
  if (focusId) (document.getElementById(focusId) ?? root.querySelector('h1'))?.focus({ preventScroll: true });
}
