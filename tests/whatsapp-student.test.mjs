/** Node tests for admin WhatsApp-student helpers (assets/dfa-admin.js). Never embeds DFA Business WA digits as a literal. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'assets/dfa-admin.js'), 'utf8');
const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');

// Business WA digits as char codes only (keeps the literal out of the repo text).
const leak = String.fromCharCode(57, 50, 51, 49, 56, 50, 49, 54, 54, 52, 52, 51);
assert.equal(src.includes(leak), false, 'dfa-admin.js must not contain blocked WA digits');
assert.equal(self.includes(leak), false, 'test file must not contain blocked WA digits as a literal');

const start = src.indexOf('function sha256hex');
const end = src.indexOf('function table');
assert.ok(start >= 0 && end > start);
const ctx = { TextEncoder, Uint8Array, DataView, Uint32Array };
vm.runInNewContext(src.slice(start, end), ctx);
const { sha256hex, WA_BLOCK_SHA256, waDigits, waMsg, waUrl } = ctx;

assert.equal(typeof WA_BLOCK_SHA256, 'string');
assert.match(WA_BLOCK_SHA256, /^[a-f0-9]{64}$/);
assert.equal(sha256hex('abc'), createHash('sha256').update('abc').digest('hex'));
assert.equal(sha256hex(leak), WA_BLOCK_SHA256, 'block hash must match SHA-256 of blocked digits');
assert.equal(waDigits(leak), '', 'blocked digits must normalize to empty');

assert.equal(waDigits('0318-1234567'), '923181234567');
assert.equal(waDigits('3181234567'), '923181234567');
assert.equal(waDigits('+92 318 1234567'), '923181234567');
assert.equal(waDigits('0092 318 1234567'), '923181234567');
assert.equal(waDigits(''), '');
assert.equal(waDigits('123'), '');

// Block-compare path with a temporary local override (unrelated sample digits).
const sample = '11111111111';
assert.equal(waDigits(sample), '11111111111');
const saved = ctx.WA_BLOCK_SHA256;
ctx.WA_BLOCK_SHA256 = sha256hex(sample);
assert.equal(ctx.waDigits(sample), '');
ctx.WA_BLOCK_SHA256 = saved;

const msg = waMsg('Ayesha Khan', 'DFA-2026-0001', 'A1-NOV26', 'ayesha@example.com');
assert.equal(
  msg,
  'Dear Ayesha,\n\nWelcome to Deutsch Für Alle! Your admission is confirmed (Student ID: DFA-2026-0001, Batch: A1-NOV26).\n\nWe\'ve emailed your fee receipt and course documents to ayesha@example.com. If you can\'t find the email in your inbox, please check your Spam or Promotions folder and mark it as "Not spam."\n\nIf you have any questions, feel free to reach out.\n\nBest regards,\nDeutsch Für Alle',
);

const u = waUrl('03181234567', 'Ayesha Khan', 'DFA-2026-0001', 'A1-NOV26', 'ayesha@example.com');
assert.ok(u.startsWith('https://wa.me/923181234567?text='));
assert.ok(!u.includes('/whatsapp'));
assert.equal(decodeURIComponent(u.split('text=')[1]), msg);

assert.ok(src.includes('data-a="wa"'));
assert.ok(src.includes('data-a="wacopy"'));
assert.ok(src.includes('Copy message'));
assert.ok(src.includes('x.last_docs_sent_at'));
assert.ok(src.includes('function copyWaMsg'));
assert.ok(src.includes('function toast'));
assert.ok(src.includes('WA_BLOCK_SHA256'));

console.log('whatsapp-student.test.mjs: OK');
