import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashToken(token: string): string {
  return `sha256:${sha256Hex(token)}`;
}

export function newInstallationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newAnonymousCode(): string {
  return `P-${randomBytes(6).toString('hex').toUpperCase()}`;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
