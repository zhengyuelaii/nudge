import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createAiProviderSchema, probeModelsSchema, updateAiProviderSchema } from '../lib/zod.js';
import { aiProviderService } from '../services/ai-provider.service.js';
import { KNOWN_PROVIDERS } from '../ai/providers.js';
import { jsonOk } from '../lib/http.js';

export const aiProviders = new Hono();

/** 已知供应商目录：前端渲染「添加供应商」里的类型下拉 */
aiProviders.get('/catalog', (c) => jsonOk(c, KNOWN_PROVIDERS));

aiProviders.get('/', (c) => jsonOk(c, aiProviderService.list(1)));

aiProviders.post('/', zValidator('json', createAiProviderSchema), (c) => {
  const data = aiProviderService.create(1, c.req.valid('json'));
  return jsonOk(c, data, 201);
});

aiProviders.put('/:id', zValidator('json', updateAiProviderSchema), (c) => {
  const id = Number(c.req.param('id'));
  const data = aiProviderService.update(1, id, c.req.valid('json'));
  return jsonOk(c, data);
});

aiProviders.delete('/:id', (c) => {
  aiProviderService.remove(1, Number(c.req.param('id')));
  return jsonOk(c, { ok: true });
});

/** 实时拉取该供应商的模型列表（前端「刷新模型」按钮） */
aiProviders.post('/:id/models', async (c) => {
  const models = await aiProviderService.listModels(1, Number(c.req.param('id')));
  return jsonOk(c, { models });
});

/** 未保存的配置试拉模型列表：弹窗里填完地址与 Key 就能先看有哪些模型 */
aiProviders.post('/models', zValidator('json', probeModelsSchema), async (c) => {
  const models = await aiProviderService.probeModels(1, c.req.valid('json'));
  return jsonOk(c, { models });
});
