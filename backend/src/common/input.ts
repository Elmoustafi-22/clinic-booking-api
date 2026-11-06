import { BadRequestException } from '@nestjs/common';

export function objectInput(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('expected a JSON object');
  }
  return value as Record<string, unknown>;
}

export function stringInput(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new BadRequestException(`${field} must be a string`);
  }
  return value;
}
