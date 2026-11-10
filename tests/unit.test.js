import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, hashToken } from '../src/security.js';
import { createRouter, parseCookies } from '../src/http.js';
import { buildSpawn, SHELLS } from '../src/exec.js';
import { validateUsername, validatePassword } from '../src/accounts.js';

test('hash password dan verifikasi', async () => {
  const h = await hashPassword('rahasia123');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await verifyPassword('rahasia123', h), true);
  assert.equal(await verifyPassword('salah', h), false);
  assert.equal(await verifyPassword('x', 'bukan-hash'), false);
});

test('hash token deterministik dan tidak sama dengan token', () => {
  assert.equal(hashToken('abc'), hashToken('abc'));
  assert.notEqual(hashToken('abc'), 'abc');
});

test('router mencocokkan parameter', () => {
  const r = createRouter();
  r.add('POST', '/api/jobs/:id/stop', () => {});
  const m = r.match('POST', '/api/jobs/abc-123/stop');
  assert.ok(m);
  assert.equal(m.params.id, 'abc-123');
  assert.equal(r.match('GET', '/api/jobs/abc/stop'), null);
});

test('parse cookie', () => {
  assert.deepEqual(parseCookies('a=1; sid=xyz%20q'), { a: '1', sid: 'xyz q' });
});

test('buildSpawn sesuai platform', () => {
  const { file, args } = buildSpawn(SHELLS[0], 'echo hi');
  assert.ok(file && Array.isArray(args));
  assert.ok(args.join(' ').includes('echo hi'));
});

test('validasi username dan sandi', () => {
  assert.doesNotThrow(() => validateUsername('budi_01'));
  assert.throws(() => validateUsername('a b'));
  assert.throws(() => validatePassword('pendek'));
});
