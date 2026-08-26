import { nowUtc } from '../lib/time.js';

export interface TraceEvent {
  kind: 'progress' | 'tool_call' | 'tool_result';
  stage?: string;
  tool?: string;
  text?: string;
  input?: unknown;
  summary?: string;
  at: string;
}

export interface Trace {
  push: (event: TraceEvent) => void;
  mergeSteps: (steps: Array<{ toolCalls?: Array<{ toolName: string; args: unknown }>; toolResults?: Array<{ toolName: string; result: unknown }>; text?: string }>) => void;
  toJSON: () => string;
  render: () => string;
}

export function createTrace(opts: { enabled?: boolean } = {}): Trace {
  if (!opts.enabled) {
    return {
      push: () => {},
      mergeSteps: () => {},
      toJSON: () => '[]',
      render: () => '',
    };
  }

  const events: TraceEvent[] = [];

  return {
    push(event: TraceEvent) {
      events.push(event);
    },

    mergeSteps(steps) {
      for (const step of steps) {
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            events.push({
              kind: 'tool_call',
              tool: tc.toolName,
              input: tc.args,
              at: nowUtc(),
            });
          }
        }
        if (step.toolResults) {
          for (const tr of step.toolResults) {
            const resultStr = tr.result == null ? '' : typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
            const summary = resultStr.slice(0, 100);
            events.push({
              kind: 'tool_result',
              tool: tr.toolName,
              summary,
              at: nowUtc(),
            });
          }
        }
      }
    },

    toJSON() {
      return JSON.stringify(events);
    },

    render() {
      return renderTrace(events);
    },
  };
}

export function renderTrace(events: TraceEvent[]): string {
  const lines: string[] = [];
  let pendingText = '';

  for (const event of events) {
    if (event.kind === 'progress') {
      if (event.stage === 'thinking') {
        lines.push(`* 深度思考 ${event.text ?? ''}`);
      } else if (event.stage === 'done') {
        pendingText += ' 结束任务';
        lines.push(pendingText.trim());
        pendingText = '';
      } else {
        pendingText += ` ${event.text ?? ''}`;
      }
    } else if (event.kind === 'tool_call') {
      if (event.tool === 'web_search') {
        const input = event.input as { query?: string; timeRange?: string } | undefined;
        lines.push(`> WebSearch: ${input?.query ?? ''}/${input?.timeRange ?? ''}`);
      } else if (event.tool === 'save_source') {
        // handled in tool_result
      }
    } else if (event.kind === 'tool_result') {
      if (event.tool === 'web_search') {
        lines.push(`> 查询结果 ${event.summary ?? ''}`);
      } else if (event.tool === 'save_source') {
        lines.push(`> Save_Sources: ${event.summary ?? ''}`);
      } else if (event.tool === 'notify_user') {
        lines.push(`> Notify: ${event.summary ?? ''}`);
      }
    }
  }

  if (pendingText.trim()) {
    lines.push(pendingText.trim());
  }

  return lines.join('\n');
}
