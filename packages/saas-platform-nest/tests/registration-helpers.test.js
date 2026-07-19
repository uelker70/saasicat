// Tests fuer @saasicat/nest/registration — Pure Helpers.
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

test('generateOtpCode liefert 6-stellige Ziffernfolge', () => {
    for (let i = 0; i < 100; i++) {
        const code = generateOtpCode();
        assert.match(code, /^\d{6}$/);
    }
});

test('generateOtpCode ist zufaellig (zwei unterschiedliche Codes in 1000 Versuchen)', () => {
    const codes = new Set();
    for (let i = 0; i < 1000; i++) {
        codes.add(generateOtpCode());
    }
    // Selbst bei sehr ungluecklichen Geburtstagsproblem-Kollisionen sollten
    // 1000 Versuche signifikant mehr als 1 unique Code liefern.
    assert.ok(codes.size > 100, `Erwartet >100 unique Codes, erhielt ${codes.size}`);
});

test('hashOtpCode liefert deterministischen 64-Zeichen-Hex-Hash', () => {
    const hash = hashOtpCode('123456');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hashOtpCode('123456'), hash);
});

test('hashOtpCode unterscheidet verschiedene Codes', () => {
    assert.notEqual(hashOtpCode('123456'), hashOtpCode('123457'));
    assert.notEqual(hashOtpCode('000000'), hashOtpCode('999999'));
});

test('verifyOtpCode true bei passendem Hash, false sonst', () => {
    const hash = hashOtpCode('123456');
    assert.equal(verifyOtpCode(hash, '123456'), true);
    assert.equal(verifyOtpCode(hash, '654321'), false);
    assert.equal(verifyOtpCode(hash, ''), false);
    assert.equal(verifyOtpCode(hash, '12345'), false);
});

test('verifyOtpCode false bei kaputtem Hash (kein Throw)', () => {
    assert.equal(verifyOtpCode('not-hex', '123456'), false);
    assert.equal(verifyOtpCode('', '123456'), false);
});

test('slugify: Standardfall', () => {
    assert.equal(slugify('Mein Verein'), 'mein-verein');
});

test('slugify: deutsche Umlaute und ß', () => {
    assert.equal(slugify('Schützenverein Süßwald'), 'schuetzenverein-suesswald');
    assert.equal(slugify('Über die Möhren'), 'ueber-die-moehren');
});

test('slugify: Sonderzeichen werden zu Bindestrich kollabiert', () => {
    assert.equal(slugify('FC Bayern e.V. (1880)'), 'fc-bayern-e-v-1880');
});

test('slugify: fuehrende/trailing Bindestriche werden entfernt', () => {
    assert.equal(slugify('  - Verein -  '), 'verein');
});

test('slugify: leerer Input liefert Fallback', () => {
    assert.equal(slugify(''), 'verein');
    assert.equal(slugify('   '), 'verein');
    assert.equal(slugify('!!!'), 'verein');
});

test('slugify: bereits clean bleibt clean', () => {
    assert.equal(slugify('demo-verein-123'), 'demo-verein-123');
});

test('slugify: lateinische Diakritika werden entfernt', () => {
    assert.equal(slugify('Niño'), 'nino');
    assert.equal(slugify('Café'), 'cafe');
});
