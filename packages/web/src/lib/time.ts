// 前端时间展示工具（展示层专用）。
//
// 约定：一周以内用相对时间（刚刚 / N分钟前 / N小时前 / N天前），
// 超过一周回落到绝对时间（YYYY-MM-DD HH:mm），避免「N周前」这类无法定位到具体时刻的模糊表述。

/**
 * 后端写库的是无时区 UTC 字符串（`YYYY-MM-DD HH:MM:SS`），补 `Z` 后按本地时区解析。
 */
function parseUtc(dateStr: string): Date {
  return new Date(`${dateStr}Z`);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * 绝对时间：本地时区的 `YYYY-MM-DD HH:mm`。
 * 入参传字符串时按 UTC 解析（见 {@link parseUtc}），传 Date 则原样格式化。
 */
export function formatDateTime(input: Date | string): string {
  const date = typeof input === 'string' ? parseUtc(input) : input;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * 绝对日期：本地时区的 `YYYY-MM-DD`。
 * 入参传字符串时按 UTC 解析（见 {@link parseUtc}），传 Date 则原样格式化。
 * 用于按「天」分组这类只需要日期的场景 —— 直接用 UTC 字符串切片会得到落后一天的分组。
 */
export function formatDate(input: Date | string): string {
  const date = typeof input === 'string' ? parseUtc(input) : input;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 相对时间；超过一周（≥7 天）回落为 {@link formatDateTime}。
 */
export function timeAgo(dateStr: string): string {
  const date = parseUtc(dateStr);
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}小时前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}天前`;
  return formatDateTime(date);
}
