import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { interestService } from './interest.service.js';

let seedInterestId = 0;
let seedTaskId = 0;

function seed(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)')
    .run('华友钴业', '["company"]');
  seedInterestId = Number(interest.lastInsertRowid);
  const task = db
    .prepare(
      'INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (1, ?, ?, ?, 1)',
    )
    .run(seedInterestId, 'day', '09:00');
  seedTaskId = Number(task.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');
  seed();
});

describe('interestService.markTaskRun', () => {
  it('updates last_run_at without touching next_run_at when advanceNext is false', () => {
    const before = db.prepare('SELECT last_run_at, next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;

    interestService.markTaskRun(1, seedTaskId, { advanceNext: false });

    const after = db.prepare('SELECT last_run_at, next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;
    expect(after.last_run_at).toBeTruthy();
    expect(after.last_run_at).not.toBe(before.last_run_at);
    expect(after.next_run_at).toBe(before.next_run_at);
  });

  it('rolls next_run_at forward when advanceNext is true', () => {
    const before = db.prepare('SELECT next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;

    interestService.markTaskRun(1, seedTaskId, { advanceNext: true });

    const after = db.prepare('SELECT next_run_at, last_run_at FROM task WHERE id = ?').get(seedTaskId) as any;
    expect(after.last_run_at).toBeTruthy();
    expect(after.next_run_at).not.toBe(before.next_run_at);
    expect(after.next_run_at).toBeTruthy();
  });

  it('throws when the task does not exist', () => {
    expect(() => interestService.markTaskRun(1, 999, { advanceNext: false })).toThrow('任务不存在');
  });
});

describe('interestService channel_ids', () => {
  let chFeishuId = 0;
  let chEmailId = 0;

  beforeEach(() => {
    db.exec('DELETE FROM notification_channel;');
    const feishu = db
      .prepare(
        "INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default) VALUES (1, 'feishu', '飞书A', '{}', 1, 1)",
      )
      .run();
    const email = db
      .prepare(
        "INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default) VALUES (1, 'email', '邮件B', '{}', 1, 0)",
      )
      .run();
    chFeishuId = Number(feishu.lastInsertRowid);
    chEmailId = Number(email.lastInsertRowid);
  });

  it('persists channelIds on create and reads them back', () => {
    const created = interestService.create(1, {
      name: '渠道测试兴趣',
      tags: ['t1'],
      frequency: 'day',
      time: '09:00',
      channelIds: [chFeishuId],
    });
    expect(created.channelIds).toEqual([chFeishuId]);
  });

  it('updates channelIds via update', () => {
    interestService.update(1, seedInterestId, { channelIds: [chFeishuId, chEmailId] });
    const got = interestService.get(1, seedInterestId);
    expect(got.channelIds).toEqual([chFeishuId, chEmailId]);
  });

  it('getNotifyChannels returns picked enabled channels', () => {
    interestService.update(1, seedInterestId, { channelIds: [chFeishuId, chEmailId] });
    const chs = interestService.getNotifyChannels(1, seedInterestId);
    expect(chs.map((c) => c.id).sort((a, b) => a - b)).toEqual([chFeishuId, chEmailId]);
  });

  it('getNotifyChannels falls back to default when channel_ids is empty', () => {
    const chs = interestService.getNotifyChannels(1, seedInterestId);
    expect(chs.map((c) => c.id)).toEqual([chFeishuId]);
  });

  it('getNotifyChannels falls back to default when picked channels are all disabled', () => {
    db.prepare('UPDATE notification_channel SET enabled = 0, is_default = 0 WHERE id = ?').run(chFeishuId);
    db.prepare('UPDATE notification_channel SET enabled = 1, is_default = 1 WHERE id = ?').run(chEmailId);
    interestService.update(1, seedInterestId, { channelIds: [chFeishuId] });
    const chs = interestService.getNotifyChannels(1, seedInterestId);
    expect(chs.map((c) => c.id)).toEqual([chEmailId]);
  });
});
