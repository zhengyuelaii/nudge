import { db } from '../db/client.js';

export interface TagRow {
  code: string;
  label: string;
  color: string;
  sort_order: number;
}

export const tagService = {
  list(): TagRow[] {
    return db
      .prepare(
        'SELECT code, label, color, sort_order FROM tag WHERE enabled = 1 ORDER BY sort_order, id',
      )
      .all() as TagRow[];
  },
};
