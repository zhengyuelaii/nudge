import { Hono } from 'hono';
import { tagService } from '../services/tag.service.js';
import { jsonOk } from '../lib/http.js';

export const tags = new Hono();

tags.get('/', (c) => {
  return jsonOk(c, tagService.list());
});
