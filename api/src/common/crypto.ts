import * as crypto from 'crypto';

// Same scrypt scheme as the legacy auth.js so existing password hashes stay valid.
export function hashPassword(password: string, salt?: string) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export const normEmail = (e: unknown): string => String(e || '').trim().toLowerCase();
export const bearer = (auth?: string): string => (auth || '').replace(/^Bearer\s+/i, '').trim();
