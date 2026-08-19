import { describe, it, expect } from 'vitest';
import { computeNextRun, nowUtc } from './time.js';

describe('computeNextRun with timezone', () => {
  it('converts local Asia/Shanghai 09:00 to the correct UTC instant', () => {
    expect(
      computeNextRun('day', '09:00', {
        from: '2026-08-19 00:30:00',
        timezone: 'Asia/Shanghai',
      }),
    ).toBe('2026-08-19 01:00:00');
  });

  it('rolls to the next day when the local time has already passed', () => {
    expect(
      computeNextRun('day', '09:00', {
        from: '2026-08-19 02:00:00',
        timezone: 'Asia/Shanghai',
      }),
    ).toBe('2026-08-20 01:00:00');
  });

  it('rolls weekly schedules forward by 7 days', () => {
    expect(
      computeNextRun('week', '09:00', {
        from: '2026-08-19 02:00:00',
        timezone: 'Asia/Shanghai',
      }),
    ).toBe('2026-08-26 01:00:00');
  });

  it('defaults to Asia/Shanghai when no timezone is given', () => {
    expect(
      computeNextRun('day', '09:00', { from: '2026-08-19 00:30:00' }),
    ).toBe('2026-08-19 01:00:00');
  });

  it('falls back to UTC behaviour for an invalid timezone', () => {
    expect(
      computeNextRun('day', '09:00', {
        from: '2026-08-19 08:00:00',
        timezone: 'Invalid/Zone',
      }),
    ).toBe('2026-08-19 09:00:00');
  });

  it('uses the current time when no from is given', () => {
    const result = computeNextRun('day', '09:00');
    expect(result > nowUtc()).toBe(true);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
