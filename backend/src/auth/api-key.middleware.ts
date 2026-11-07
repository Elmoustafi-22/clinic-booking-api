import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ApiKeyGuard } from './api-key.guard';

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
  constructor(private readonly guard: ApiKeyGuard) {}

  use(request: Request, _response: Response, next: NextFunction) {
    const path = request.path.replace(/\/+$/, '');
    // Authenticate all official method/path combinations before body parsing.
    const required =
      (request.method === 'POST' && /^\/(reset|bookings)$/i.test(path)) ||
      (request.method === 'GET' &&
        /^\/(slots|bookings(?:\/[^/]+)?)$/i.test(path)) ||
      (request.method === 'DELETE' && /^\/bookings\/[^/]+$/i.test(path));
    if (required) this.guard.assertAuthenticated(request);
    next();
  }
}
