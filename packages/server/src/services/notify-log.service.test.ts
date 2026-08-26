import { describe, it, expect, beforeEach } from 'vitest';
import { notifyLogService } from './notify-log.service.js';
import { db } from '../db/client.js';

// init.sql 预置的飞书默认渠道 id（存在父行，便于校验 channel_id 外键关联）
const DEFAULT_CHANNEL_ID = 1;

function clearNotifyLog(): void {
  db.exec('DELETE FROM notify_log');
}

// 建最小 interest → task → task_run → interest_event 层级，供带关联日志测试使用
function seedHierarchy(): { interestId: number; eventId: number } {
  const interestId = Number(
    db.prepare("INSERT INTO interest (user_id, name, tags, status) VALUES (1, 'Test', '[]', 'active')")
      .run().lastInsertRowid,
  );
  const taskId = Number(
    db.prepare(
      "INSERT INTO task (user_id, interest_id, frequency, time, enabled, next_run_at) VALUES (1, ?, 'day', '09:00', 1, '2026-01-01 09:00')",
    )
      .run(interestId).lastInsertRowid,
  );
  const runId = Number(
    db.prepare(
      "INSERT INTO task_run (user_id, task_id, interest_id, run_mode, status, started_at) VALUES (1, ?, ?, 'default', 'running', '2026-01-01 00:00')",
    )
      .run(taskId, interestId).lastInsertRowid,
  );
  const eventId = Number(
    db.prepare(
      "INSERT INTO interest_event (user_id, interest_id, task_run_id, title, run_at, source_count) VALUES (1, ?, ?, 'ev', '2026-01-01 00:00', 0)",
    )
      .run(interestId, runId).lastInsertRowid,
  );
  return { interestId, eventId };
}

describe('notifyLogService', () => {
  beforeEach(() => clearNotifyLog());

  it('inserts a success log and returns the new id', () => {
    const id = notifyLogService.insert({
      channelId: DEFAULT_CHANNEL_ID,
      content: 'hello',
      status: 'success',
    });
    expect(id).toBeGreaterThan(0);

    const row = notifyLogService.get(1, id);
    expect(row.channel_id).toBe(DEFAULT_CHANNEL_ID);
    expect(row.content).toBe('hello');
    expect(row.status).toBe('success');
    expect(row.error_message).toBeNull();
    expect(row.sent_at).toBeTruthy();
    expect(row.created_at).toBeTruthy();
  });

  it('records error_message on failed logs', () => {
    const id = notifyLogService.insert({
      content: 'boom',
      status: 'failed',
      errorMessage: '飞书发送失败: HTTP 500',
    });
    const row = notifyLogService.get(1, id);
    expect(row.status).toBe('failed');
    expect(row.error_message).toBe('飞书发送失败: HTTP 500');
    expect(row.channel_id).toBeNull();
  });

  it('lists logs ordered by sent_at desc with limit/offset and status filter', () => {
    notifyLogService.insert({ content: 'a', status: 'success' });
    notifyLogService.insert({ content: 'b', status: 'success' });
    notifyLogService.insert({ content: 'c', status: 'failed' });

    const all = notifyLogService.list(1);
    expect(all).toHaveLength(3);
    // 同 sent_at 时按 id desc，最新插入排最前
    expect(all[0].content).toBe('c');

    expect(notifyLogService.list(1, { limit: 1 })).toHaveLength(1);
    expect(notifyLogService.list(1, { status: 'failed' })).toHaveLength(1);
    expect(notifyLogService.count(1, { status: 'failed' })).toBe(1);
  });

  it('filters by interest_id and event_id', () => {
    const { interestId, eventId } = seedHierarchy();
    notifyLogService.insert({
      interestId,
      eventId,
      channelId: DEFAULT_CHANNEL_ID,
      content: 'x',
      status: 'success',
    });

    expect(notifyLogService.list(1, { interestId })).toHaveLength(1);
    expect(notifyLogService.list(1, { eventId })).toHaveLength(1);
    expect(notifyLogService.count(1, { interestId })).toBe(1);
  });
});
