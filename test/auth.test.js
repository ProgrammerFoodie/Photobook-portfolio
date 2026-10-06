import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'photolib-auth-'));
const { hashPassword, verifyPassword, signSession, verifySession } = await import('../src/auth.js');

test('password hashing round-trips and rejects wrong passwords', () => {
  const stored = hashPassword('correct horse battery');
  assert.match(stored, /^scrypt\$/);
  assert.equal(verifyPassword('correct horse battery', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
  assert.equal(verifyPassword('x', ''), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.notEqual(hashPassword('same'), hashPassword('same'), 'salted');
});

test('sessions verify, expire and resist tampering', () => {
  const now = Date.now();
  const key = Buffer.alloc(32, 7);
  const token = signSession(now, key);
  assert.equal(verifySession(token, now + 1000, key), true);
  assert.equal(verifySession(token, now + 31 * 24 * 3600 * 1000, key), false, 'expired after 30 days');
  assert.equal(verifySession(token, now, Buffer.alloc(32, 8)), false, 'wrong key');
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ exp: now + 9e12 })).toString('base64url');
  assert.equal(verifySession(`${forged}.${sig}`, now, key), false, 'payload swapped');
  assert.equal(verifySession(`${payload}.${sig.slice(0, -2)}AA`, now, key), false, 'signature altered');
  for (const junk of ['', 'a', 'a.b', undefined, null, 42]) assert.equal(verifySession(junk, now, key), false);
});
