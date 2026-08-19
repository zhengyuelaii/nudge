import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class AppError extends Error {
  constructor(
    public code: string,
    public status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
  }
}

export const Errors = {
  notFound: (msg = '资源不存在') => new AppError('NOT_FOUND', 404, msg),
  validation: (msg = '参数校验失败') => new AppError('VALIDATION', 400, msg),
  conflict: (msg = '资源冲突') => new AppError('CONFLICT', 409, msg),
  internal: (msg = '服务器内部错误') => new AppError('INTERNAL', 500, msg),
};
