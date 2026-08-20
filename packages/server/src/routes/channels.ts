import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createChannelSchema, updateChannelSchema } from '../lib/zod.js';
import { channelService } from '../services/channel.service.js';
import { jsonOk, jsonError } from '../lib/http.js';
import { AppError } from '../lib/errors.js';
import { notify } from '../notify/index.js';

export const channels = new Hono();

channels.get('/', (c) => {
  const data = channelService.list(1);
  return jsonOk(c, data);
});

channels.post('/', zValidator('json', createChannelSchema), (c) => {
  const input = c.req.valid('json');
  const data = channelService.create(1, input);
  return jsonOk(c, data, 201);
});

channels.put('/:id', zValidator('json', updateChannelSchema), (c) => {
  const id = Number(c.req.param('id'));
  const input = c.req.valid('json');
  const data = channelService.update(1, id, input);
  return jsonOk(c, data);
});

channels.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  channelService.remove(1, id);
  return jsonOk(c, { ok: true });
});

channels.post('/:id/test', async (c) => {
  const id = Number(c.req.param('id'));
  const channel = channelService.get(1, id);

  try {
    await notify(channel, '🔔 Nudge 测试通知\n如果收到这条消息，说明推送配置正常');
    return jsonOk(c, { ok: true, message: '测试消息已发送' });
  } catch (e) {
    if (e instanceof AppError) {
      return jsonError(c, e.status, e.message);
    }
    return jsonError(c, 500, '发送失败');
  }
});
