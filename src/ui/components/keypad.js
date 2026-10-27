import { el } from '../../utils/dom.js';

/** 按答案格式提供常用键；旧两参数调用保留全键盘，实体输入仍使用原生 input。 */
export function mountKeypad(input, onChange, { mode = 'all', focusInput = true } = {}) {
  const special = { integer: '-', decimal: '.', fraction: '/', remainder: '余' };
  const keys = mode === 'compare' ? ['<', '=', '>', '⌫']
    : special[mode] ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', special[mode], '0', '⌫']
      : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫', '/', '余', '-', '<', '=', '>'];
  const names = { '⌫': '删除一位', '.': '小数点', '/': '分数线' };
  return el('div', { class: 'keypad' + (mode === 'compare' ? ' keypad-compare' : ''),
    role: 'group', 'aria-label': '答题键盘', dataset: { mode } }, keys.map(key =>
    el('button', { type: 'button', class: 'btn key', text: key, disabled: input.disabled,
      'aria-label': names[key] ?? key, dataset: { key },
      onpointerdown: e => e.preventDefault(),
      onclick: event => {
        if (input.disabled) return;
        // 比较题只接受一个比较符号，改选时替换整项。
        const replace = mode === 'compare' && key !== '⌫';
        const a = replace ? 0 : (input.selectionStart ?? input.value.length);
        const b = replace ? input.value.length : (input.selectionEnd ?? a);
        const start = key === '⌫' && a === b ? Math.max(0, a - 1) : a;
        const insert = key === '⌫' ? '' : key;
        const next = input.value.slice(0, start) + insert + input.value.slice(b);
        if (next.length > 40) return;
        input.value = next;
        // 触屏只更新值与光标，不主动唤起系统键盘或滚动输入框。
        // 键盘激活按钮时保留按钮焦点，让 Tab 能继续按视觉顺序向前。
        if (focusInput && event.detail !== 0) input.focus({ preventScroll: true });
        input.setSelectionRange(start + insert.length, start + insert.length);
        onChange(input.value);
      }
    })
  ));
}
