import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { runAgentCheck } from './loop.js';

describe.skipIf(!process.env.AI_API_KEY)('runAgentCheck integration (real model)', () => {
  let seedInterestId = 0;
  let seedTaskId = 0;

  beforeEach(() => {
    db.exec('DELETE FROM source; DELETE FROM interest_event; DELETE FROM task_run; DELETE FROM notification_channel; DELETE FROM task; DELETE FROM interest;');

    const interest = db
      .prepare('INSERT INTO interest (user_id, name, tags, query_keywords, description) VALUES (1, ?, ?, ?, ?)')
      .run('黄金价格', '["commodity"]', '黄金价格走势 最新动态', '关注国际金价变化');
    seedInterestId = Number(interest.lastInsertRowid);

    const task = db
      .prepare('INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (1, ?, ?, ?, 1)')
      .run(seedInterestId, 'day', '09:00');
    seedTaskId = Number(task.lastInsertRowid);

    db.prepare(
      "UPDATE settings SET search_api_key = ?, ai_api_key = ?, ai_model = 'deepseek-chat', extra = ? WHERE user_id = 1",
    ).run(process.env.TAVILY_API_KEY, process.env.AI_API_KEY, JSON.stringify({ agent_trace_enabled: true }));

    db.prepare(
      `INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default)
       VALUES (1, 'feishu', '飞书', '{"webhook_url":"${process.env.FEISHU_TEST_WEBHOOK ?? ''}","secret":"${process.env.FEISHU_TEST_SECRET ?? ''}"}', 1, 1)`,
    ).run();
  });

  it('runs full agent loop with real model', async () => {
    const result = await runAgentCheck(seedTaskId, {
      fetchImpl: globalThis.fetch,
    });

    console.log('=== Agent Check Result ===');
    console.log(JSON.stringify(result, null, 2));

    const run = db.prepare('SELECT * FROM task_run WHERE id = ?').get(result.runId) as any;
    console.log('=== Task Run ===');
    console.log('status:', run.status);
    console.log('agent_steps:', run.agent_steps);
    console.log('duration_ms:', run.duration_ms);
    if (run.error_type) console.log('error_type:', run.error_type);
    if (run.error_message) console.log('error_message:', run.error_message);

    const sources = db.prepare('SELECT * FROM source WHERE interest_id = ?').all(seedInterestId) as any[];
    console.log('=== Sources ===');
    console.log('count:', sources.length);
    for (const s of sources) {
      console.log(`  ${s.title}`);
    }

    expect(result.runId).toBeDefined();
    expect(run.status).toBe('success');
    expect(run.agent_steps).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
