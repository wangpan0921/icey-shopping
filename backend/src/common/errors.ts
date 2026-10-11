// 业务错误 + 统一错误中间件
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'ERR') {
    super(message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(404, message, 'NOT_FOUND');
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(400, message, code);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(409, message, code);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: 'Invalid request', issues: err.issues },
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  logger.error({ err }, 'unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
