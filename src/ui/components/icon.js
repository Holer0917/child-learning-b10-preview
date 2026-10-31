import { svg } from '../../utils/dom.js';

const paths = {
  volume: ['M11 4 6 8H3v8h3l5 4Z', 'M15 8a6 6 0 0 1 0 8', 'M18 5a10 10 0 0 1 0 14'],
  muted: ['M11 4 6 8H3v8h3l5 4Z', 'm16 9 6 6', 'm22 9-6 6'],
  book: ['M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z', 'M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3z'],
  pencil: ['m15 4 5 5-11 11-6 1 1-6Z', 'm12 7 5 5'],
  leaf: ['M20 4C8 2 2 10 7 16s15 2 13-12Z', 'M4 21 16 9'],
  spark: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z'],
  check: ['m5 12 4 4L19 6'],
  arrow: ['M4 12h15', 'm13 5 7 7-7 7'],
  clock: ['M12 7v5l3 2', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
  shield: ['m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z', 'm8 12 3 3 5-6'],
  trophy: ['M7 3h10v7a5 5 0 0 1-10 0Z', 'M7 5H3v3a4 4 0 0 0 4 4', 'M17 5h4v3a4 4 0 0 1-4 4', 'M12 15v6', 'M8 21h8'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  close: ['m6 6 12 12', 'M6 18 18 6']
};

/** 本地图标，统一线宽；装饰性图标不重复朗读按钮名称。 */
export function icon(name, className = '') {
  return svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    class: `icon ${className}`, 'aria-hidden': 'true', focusable: 'false' },
  (paths[name] ?? paths.spark).map(d => svg('path', { d })));
}
