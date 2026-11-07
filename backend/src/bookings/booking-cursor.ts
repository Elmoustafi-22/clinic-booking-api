import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isISO8601 } from 'class-validator';

@Injectable()
export class BookingCursor {
  private readonly signingKey: Buffer;

  constructor() {
    const key = process.env.API_KEY;
    if (!key) throw new Error('API_KEY is required');
    this.signingKey = createHmac('sha256', key)
      .update('clinic-booking-history-v1')
      .digest();
  }

  encode(email: string, time: string, id: string): string {
    const payload = Buffer.from(JSON.stringify([1, email, time, id])).toString(
      'base64url',
    );
    return payload + '.' + this.sign(payload).toString('base64url');
  }

  decode(value: unknown, email: string): { time: string; id: string } {
    const invalid = () => new BadRequestException('invalid or foreign cursor');
    if (typeof value !== 'string') throw invalid();
    const parts = value.split('.');
    if (
      parts.length !== 2 ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
    )
      throw invalid();
    const [payload, signature] = parts;
    const bytes = Buffer.from(signature, 'base64url');
    if (
      bytes.length !== 32 ||
      bytes.toString('base64url') !== signature ||
      !timingSafeEqual(bytes, this.sign(payload))
    )
      throw invalid();
    const decoded = Buffer.from(payload, 'base64url');
    if (decoded.toString('base64url') !== payload) throw invalid();
    let position: unknown;
    try {
      position = JSON.parse(decoded.toString('utf8')) as unknown;
    } catch {
      throw invalid();
    }
    if (
      !Array.isArray(position) ||
      position.length !== 4 ||
      position[0] !== 1 ||
      position[1] !== email ||
      typeof position[2] !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(position[2]) ||
      !isISO8601(position[2], { strict: true, strictSeparator: true }) ||
      !Number.isFinite(Date.parse(position[2])) ||
      typeof position[3] !== 'string' ||
      position[3].includes('\0')
    )
      throw invalid();
    return { time: position[2], id: position[3] };
  }

  private sign(payload: string): Buffer {
    return createHmac('sha256', this.signingKey).update(payload).digest();
  }
}
