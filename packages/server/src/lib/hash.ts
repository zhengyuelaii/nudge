import { createHash } from 'node:crypto';

export function hashContent(sourceUrl: string, title: string): string {
  const normalized = normalizeUrl(sourceUrl) + '|' + title.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}
