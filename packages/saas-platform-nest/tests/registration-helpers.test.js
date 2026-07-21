// Tests for @saasicat/nest/registration — pure helpers.
//
// generateOtpCode / hashOtpCode / verifyOtpCode / slugify.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    generateOtpCode,
    hashOtpCode,
    slugify,
    verifyOtpCode,
} from '../dist/registration/index.js';

test('generateOtpCode returns a 6-digit numeric sequence', () => {
    for (let i = 0; i < 100; i++) {
        const code = generateOtpCode();
        assert.match(code, /^\d{6}$/);
    }
});

test('generateOtpCode is random (two distinct codes across 1000 attempts)', () => {
    const codes = new Set();
    for (let i = 0; i < 1000; i++) {
        codes.add(generateOtpCode());
    }
    // Even with very unlucky birthday-problem collisions, 1000 attempts should
    // yield significantly more than 1 unique code.
    assert.ok(codes.size > 100, `Expected >100 unique codes, got ${codes.size}`);
});

test('hashOtpCode returns a deterministic 64-character hex hash', () => {
    const hash = hashOtpCode('123456');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hashOtpCode('123456'), hash);
});

test('hashOtpCode distinguishes different codes', () => {
    assert.notEqual(hashOtpCode('123456'), hashOtpCode('123457'));
    assert.notEqual(hashOtpCode('000000'), hashOtpCode('999999'));
});

test('verifyOtpCode returns true on a matching hash, false otherwise', () => {
    const hash = hashOtpCode('123456');
    assert.equal(verifyOtpCode(hash, '123456'), true);
    assert.equal(verifyOtpCode(hash, '654321'), false);
    assert.equal(verifyOtpCode(hash, ''), false);
    assert.equal(verifyOtpCode(hash, '12345'), false);
});

test('verifyOtpCode returns false on a broken hash (no throw)', () => {
    assert.equal(verifyOtpCode('not-hex', '123456'), false);
    assert.equal(verifyOtpCode('', '123456'), false);
});

test('slugify: standard case', () => {
    assert.equal(slugify('Mein Verein'), 'mein-verein');
});

test('slugify: German umlauts and ß', () => {
    assert.equal(slugify('Schützenverein Süßwald'), 'schuetzenverein-suesswald');
    assert.equal(slugify('Über die Möhren'), 'ueber-die-moehren');
});

test('slugify: special characters collapse into a hyphen', () => {
    assert.equal(slugify('FC Bayern e.V. (1880)'), 'fc-bayern-e-v-1880');
});

test('slugify: leading/trailing hyphens are removed', () => {
    assert.equal(slugify('  - Verein -  '), 'verein');
});

test('slugify: empty input returns the fallback', () => {
    assert.equal(slugify(''), 'verein');
    assert.equal(slugify('   '), 'verein');
    assert.equal(slugify('!!!'), 'verein');
});

test('slugify: already-clean stays clean', () => {
    assert.equal(slugify('demo-verein-123'), 'demo-verein-123');
});

test('slugify: Latin diacritics are removed', () => {
    assert.equal(slugify('Niño'), 'nino');
    assert.equal(slugify('Café'), 'cafe');
});
