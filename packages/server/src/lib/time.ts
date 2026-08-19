export function nowUtc(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function tzOffsetMs(epochMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(epochMs));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const localEpoch = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return localEpoch - epochMs;
}

function wallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month, day, hour, minute, 0, 0);
  let utc = wall;
  for (let i = 0; i < 2; i++) {
    utc = wall - tzOffsetMs(utc, timeZone);
  }
  return new Date(utc);
}

function tzDayOf(base: Date, timeZone: string): [number, number, number] {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(base);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return [get('year'), get('month'), get('day')];
}

function occurrenceOn(
  base: Date,
  time: string,
  timeZone: string,
): Date {
  const [hour, minute] = time.split(':').map(Number);
  try {
    const [year, month, day] = tzDayOf(base, timeZone);
    return wallToUtc(year, month - 1, day, hour, minute, timeZone);
  } catch {
    const next = new Date(base);
    next.setUTCHours(hour, minute, 0, 0);
    return next;
  }
}

export interface ComputeNextRunOptions {
  from?: string;
  timezone?: string;
}

export function computeNextRun(
  frequency: string,
  time: string,
  opts: ComputeNextRunOptions = {},
): string {
  const timezone = opts.timezone ?? 'Asia/Shanghai';
  const base = opts.from ? new Date(opts.from + 'Z') : new Date();

  let next = occurrenceOn(base, time, timezone);
  if (next <= base) {
    const shifted = new Date(base.getTime());
    shifted.setUTCDate(shifted.getUTCDate() + (frequency === 'week' ? 7 : 1));
    next = occurrenceOn(shifted, time, timezone);
  }
  return next.toISOString().replace('T', ' ').slice(0, 19);
}
