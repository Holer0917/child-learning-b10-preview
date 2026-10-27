/**
 * 日期工具
 */

const DAY_MS = 86400000;

/** 补零 */
const pad = (n) => String(n).padStart(2, '0');

/** Date | number → 'YYYY-MM-DD' */
export function dateStr(input = Date.now()) {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 格式化：'M/D'、'YYYY-MM-DD HH:mm' 等简易模板 */
export function formatDate(input, pattern = 'YYYY-MM-DD') {
  const d = input instanceof Date ? input : new Date(input);
  const map = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    M: d.getMonth() + 1,
    DD: pad(d.getDate()),
    D: d.getDate(),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes())
  };
  return pattern.replace(/YYYY|MM|DD|HH|mm|M|D/g, (k) => map[k]);
}

/** 今天 0 点的字符串 */
export const todayStr = () => dateStr(Date.now());

/** 昨天 0 点的字符串 */
export const yesterdayStr = () => dateStr(Date.now() - DAY_MS);

/** 两个 'YYYY-MM-DD' 相差的天数 */
export function daysBetween(a, b) {
  const ta = new Date(`${a}T00:00:00`).getTime();
  const tb = new Date(`${b}T00:00:00`).getTime();
  return Math.round((tb - ta) / DAY_MS);
}

/** 相对时间："刚刚"、"3 分钟前"、"昨天"、"9月22日" */
export function relativeTime(input) {
  const t = input instanceof Date ? input.getTime() : input;
  const diff = Date.now() - t;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3600000)} 小时前`;
  if (dateStr(t) === yesterdayStr()) return '昨天';
  if (diff < DAY_MS * 7) return `${Math.floor(diff / DAY_MS)} 天前`;
  return formatDate(t, 'M月D日');
}

/** 最近 n 天的日期字符串数组（含今天），升序 */
export function recentDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dateStr(Date.now() - i * DAY_MS));
  return out;
}

/** 本周一 0 点的时间戳 */
export function weekStart(input = Date.now()) {
  const d = new Date(input);
  const day = (d.getDay() + 6) % 7;              // 周一 = 0
  d.setHours(0, 0, 0, 0);
  return d.getTime() - day * DAY_MS;
}

export { DAY_MS };
