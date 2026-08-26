import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { PasswordSecret } from '../../contracts/admin-domain';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<PasswordSecret> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64, SCRYPT);
  return {
    algo: 'scrypt',
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  };
}

export async function verifyPassword(password: string, secret: PasswordSecret): Promise<boolean> {
  if (!secret || secret.algo !== 'scrypt' || !secret.hash || !secret.salt) return false;
  const salt = Buffer.from(secret.salt, 'hex');
  const expected = Buffer.from(secret.hash, 'hex');
  const actual = await scryptAsync(password, salt, expected.length, {
    N: secret.N,
    r: secret.r,
    p: secret.p,
    maxmem: SCRYPT.maxmem,
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
