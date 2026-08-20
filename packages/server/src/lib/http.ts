import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function jsonOk<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ code: status, message: 'ok', data }, status);
}

export function jsonError(
  c: Context,
  status: ContentfulStatusCode,
  message: string,
) {
  return c.json({ code: status, message }, status);
}

export type OptionalInt =
  | { ok: true; value?: number }
  | { ok: false };

export function parseOptionalInt(c: Context, key: string): OptionalInt {
  const raw = c.req.query(key);
  if (raw === undefined) return { ok: true };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}
