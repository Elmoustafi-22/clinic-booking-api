import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expectedDigest: Buffer;

  constructor() {
    const key = process.env.API_KEY;
    if (
      !key ||
      !key.trim() ||
      key.trim() !== key ||
      Buffer.from(key).some((byte) => byte < 32 || byte === 127)
    ) {
      throw new Error(
        'API_KEY must be nonblank, without surrounding whitespace or control characters',
      );
    }
    this.expectedDigest = createHash('sha256').update(key).digest();
  }

  assertAuthenticated(request: Request): void {
    const key = request.headers['x-api-key'];
    const headerCount = request.rawHeaders.filter(
      (_value, index) =>
        index % 2 === 0 &&
        request.rawHeaders[index].toLowerCase() === 'x-api-key',
    ).length;
    if (
      typeof key !== 'string' ||
      !key.trim() ||
      headerCount !== 1 ||
      !timingSafeEqual(
        createHash('sha256').update(key).digest(),
        this.expectedDigest,
      )
    ) {
      throw new UnauthorizedException('missing or invalid API key');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    this.assertAuthenticated(context.switchToHttp().getRequest<Request>());
    return true;
  }
}
