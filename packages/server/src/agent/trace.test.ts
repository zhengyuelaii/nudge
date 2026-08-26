import { describe, it, expect } from 'vitest';
import { createTrace, renderTrace, type TraceEvent } from './trace.js';

describe('createTrace', () => {
  it('returns no-op trace when disabled', () => {
    const trace = createTrace({ enabled: false });
    trace.push({ kind: 'progress', stage: 'thinking', text: 'test', at: '' });
    expect(trace.toJSON()).toBe('[]');
    expect(trace.render()).toBe('');
  });

  it('records events when enabled', () => {
    const trace = createTrace({ enabled: true });
    trace.push({ kind: 'progress', stage: 'thinking', text: '正在思考', at: '2026-01-01 00:00:00' });
    trace.push({ kind: 'tool_call', tool: 'web_search', input: { query: 'test' }, at: '2026-01-01 00:00:01' });
    trace.push({ kind: 'tool_result', tool: 'web_search', summary: '查询结果 5 条', at: '2026-01-01 00:00:02' });

    const json = trace.toJSON();
    const events = JSON.parse(json) as TraceEvent[];
    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe('progress');
    expect(events[1].kind).toBe('tool_call');
    expect(events[2].kind).toBe('tool_result');
  });
});

describe('renderTrace', () => {
  it('renders progress events', () => {
    const events: TraceEvent[] = [
      { kind: 'progress', stage: 'thinking', text: '已明确需求', at: '' },
      { kind: 'progress', stage: 'searching', text: '正在搜索', at: '' },
      { kind: 'progress', stage: 'done', text: '完成', at: '' },
    ];
    const rendered = renderTrace(events);
    expect(rendered).toContain('* 深度思考 已明确需求');
    expect(rendered).toContain('结束任务');
  });

  it('renders tool_call web_search', () => {
    const events: TraceEvent[] = [
      { kind: 'tool_call', tool: 'web_search', input: { query: '黄金价格', timeRange: 'week' }, at: '' },
    ];
    const rendered = renderTrace(events);
    expect(rendered).toContain('> WebSearch: 黄金价格/week');
  });

  it('renders tool_result web_search', () => {
    const events: TraceEvent[] = [
      { kind: 'tool_result', tool: 'web_search', summary: '查询结果 10 条', at: '' },
    ];
    const rendered = renderTrace(events);
    expect(rendered).toContain('> 查询结果 查询结果 10 条');
  });

  it('renders tool_result save_source', () => {
    const events: TraceEvent[] = [
      { kind: 'tool_result', tool: 'save_source', summary: '保存1条新来源', at: '' },
    ];
    const rendered = renderTrace(events);
    expect(rendered).toContain('> Save_Sources: 保存1条新来源');
  });

  it('renders tool_result notify_user', () => {
    const events: TraceEvent[] = [
      { kind: 'tool_result', tool: 'notify_user', summary: '已通知2渠道', at: '' },
    ];
    const rendered = renderTrace(events);
    expect(rendered).toContain('> Notify: 已通知2渠道');
  });

  it('renders empty for no events', () => {
    expect(renderTrace([])).toBe('');
  });
});
