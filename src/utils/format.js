/**
 * 数值与文本格式化工具
 *
 * 重点：本模块承担"答案规范化"与"小数整数化"两项关键职责，
 * 它们是保证"答案 100% 正确"（NFR-03）的基础设施。
 */

/** 最大公约数（辗转相除法，O(log min(a,b))） */
export function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** 约分，返回 [分子, 分母] */
export function simplify(n, d) {
  if (d === 0) return [NaN, NaN];
  const g = gcd(n, d);
  let nn = n / g;
  let dd = d / g;
  if (dd < 0) { nn = -nn; dd = -dd; }   // 分母恒正
  return [nn, dd];
}

/**
 * 把"放大后的整数"还原为小数字符串，并去掉无意义的尾随零。
 *   formatScaled(35, 10)   → '3.5'
 *   formatScaled(30, 10)   → '3'
 *   formatScaled(305, 100) → '3.05'
 *   formatScaled(-35, 10)  → '-3.5'
 *
 * 这是"小数运算全部转为整数运算"策略的收尾环节，
 * 从根本上规避 IEEE 754 浮点误差。
 */
export function formatScaled(v, scale) {
  const neg = v < 0;
  const abs = Math.abs(v);
  const digits = String(scale).length - 1;      // 10 → 1 位，100 → 2 位

  if (digits <= 0) return String(v);

  const s = String(abs).padStart(digits + 1, '0');
  const intPart = s.slice(0, s.length - digits);
  const fracPart = s.slice(s.length - digits).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return neg ? `-${out}` : out;
}

/** 去掉小数尾随零："3.50" → "3.5"，"3.0" → "3"，"3." → "3" */
export function trimTrailingZeros(s) {
  const str = String(s).trim();
  if (!str.includes('.')) return str;
  return str.replace(/0+$/, '').replace(/\.$/, '');
}

/** 解析分数 "3/4" → [3,4]；"5" → [5,1]；非法 → null */
export function parseFraction(s) {
  const str = String(s).trim();
  if (/^-?\d+$/.test(str)) return [parseInt(str, 10), 1];
  const m = str.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const d = parseInt(m[2], 10);
  if (d === 0) return null;
  return [n, d];
}

/**
 * 答案规范化 —— 判分的核心前置步骤。
 * 让 "624" / "624.0" / "0624" / " 624 " 判为相同答案。
 */
export function normalizeAnswer(raw, kind = 'int') {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (s === '') return '';

  switch (kind) {
    case 'int': {
      if (/^\d+\s*余\s*\d+$/.test(s)) return s.replace(/\s+/g, '');
      // 接受 "624" / "0624" / "624.0"（等价写法），但不接受 "624.5"
      if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
      const n = Number(s);
      if (!Number.isInteger(n)) return s;          // 非整数形态 → 原样返回，由判分器判错
      return String(n);
    }
    case 'decimal': {
      if (!/^-?\d*\.?\d+$/.test(s)) return s;
      return trimTrailingZeros(String(parseFloat(s)));
    }
    case 'fraction': {
      const parsed = parseFraction(s);
      if (!parsed) return s;
      const [n, d] = simplify(parsed[0], parsed[1]);
      return d === 1 ? String(n) : `${n}/${d}`;
    }
    case 'sign': {
      // 接受中文与全角写法，方便孩子在中文输入法下作答
      const normalized = s.replace(/[＞﹥]/g, '>').replace(/[＜﹤]/g, '<')
                          .replace(/[＝]/g, '=');
      return ['<', '>', '='].includes(normalized) ? normalized : '';
    }
    default:
      return s;
  }
}

/** 数字转中文可读的用时："4:32" */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 用时的人类可读描述："9.1 秒" / "1 分 20 秒" */
export function humanDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${(ms / 1000).toFixed(1)} 秒`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`;
}

/** 正确率格式化："86.7%" */
export function formatAccuracy(accuracy) {
  return `${Number(accuracy).toFixed(1)}%`;
}

/** 千分位："1,420" */
export function thousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 文件大小 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** HTML 转义（用于把用户输入渲染进 HTML 时防注入） */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
