// @requirement SC-LANG-007 — A refusal code never encodes its own subject

// Guard: no code that reaches a client is assembled at run time.
//
// The promise has a history. Three blockers used to build their code out of
// what they were about — `VEHICLES_OVER_TARGET`, `ENTERPRISE_LOCKED`,
// `PRO_NOT_SELF_SERVICE` — and the cost is written into `error-codes.ts`: the
// set of codes then grows with every quota and plan an installation defines,
// so no shipped catalogue of translations can ever be complete against it, and
// no consumer can switch on the set exhaustively. #243 turned the subject into
// a parameter. Nothing kept it that way, and the entry that claimed to name a
// proof pointed at a file about error branding.
//
// What this measures is the mechanical half, and it is the half that matters:
// a code assembled from a value is a code the catalogue cannot hold. A code is
// a constant here — a literal, or a member of one of the catalogues — never a
// template and never a concatenation.
//
// What it does not measure, said out loud rather than implied: a code typed by
// hand that happens to name its subject. `VEHICLES_OVER_TARGET` written as a
// literal would pass. Telling that apart needs to know which words are an
// installation's vocabulary, and the platform does not have that vocabulary —
// it arrives from an app's `@DefinesQuota` at boot. That case stays a review
// question, and `RULES.md` §10.4 asks for it to be named instead of pretended.
//
// Read as text rather than parsed. The shape being refused is visible on one
// line, and the two markers — a backtick opening the value, a `+` inside it —
// are found by scanning. A pattern for "the value up to the comma" needs two
// quantifiers that can each claim the same spaces, which is what
// `regexp/no-super-linear-backtracking` refuses; the scanning is done in code,
// where it is decidable.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ASSIGNMENTS = ['code:', 'code ='];

/** The value assigned to `code` on a line, or null where the line assigns none. */
function assignedValue(line) {
    for (const marker of ASSIGNMENTS) {
        const at = line.indexOf(marker);
        if (at === -1) continue;
        // `promoCode:` and `statusCode:` are other properties, not this one.
        const before = at === 0 ? '' : line[at - 1];
        if (before && /[\w$]/.test(before)) continue;
        return line.slice(at + marker.length).trimStart();
    }
    return null;
}

/** Whether a `code` value is built rather than named. */
export function isAssembled(line) {
    const value = assignedValue(line);
    if (value === null) return false;
    if (value.startsWith('`')) return true;
    // Up to the end of this property: a `+` joining pieces into a code.
    const end = value.indexOf(',');
    const own = end === -1 ? value : value.slice(0, end);
    return own.includes(' + ');
}

const tracked = execFileSync('git', ['ls-files', 'packages'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((path) => path.includes('/src/'))
    .filter((path) => /\.[cm]?ts$/.test(path) && !/\.(test|spec)\.[cm]?ts$/.test(path));

describe('a refusal code is a constant, not something built', () => {
    test('there are shipped sources to look at', () => {
        assert.ok(tracked.length > 100, `expected the platform sources, found ${tracked.length}`);
    });

    test('no shipped source assembles a code', () => {
        const offenders = [];
        for (const path of tracked) {
            readFileSync(join(ROOT, path), 'utf8')
                .split('\n')
                .forEach((line, at) => {
                    if (isAssembled(line)) offenders.push(`${path}:${at + 1} — ${line.trim()}`);
                });
        }
        assert.deepEqual(
            offenders,
            [],
            `A code is built from a value:\n  ${offenders.join('\n  ')}\n` +
                'Put the subject in `params` beside the code and keep the code fixed.',
        );
    });

    test('the detector sees the shapes it was written for', () => {
        assert.equal(isAssembled('code: `QUOTA_OVER_TARGET_${dimension}`,'), true);
        assert.equal(isAssembled("            code: 'LIMIT_' + dimension.toUpperCase(),"), true);
        assert.equal(isAssembled('const code = `${plan}_LOCKED`;'), true);
    });

    test('and leaves alone the shapes that are not it', () => {
        assert.equal(isAssembled("code: 'QUOTA_OVER_TARGET',"), false);
        assert.equal(isAssembled('code: BILLING_ERROR_CODES.QUOTA_OVER_TARGET,'), false);
        // A promo code is a value somebody typed, not a refusal code.
        assert.equal(isAssembled('code: dto.promoCode,'), false);
        assert.equal(isAssembled('code: code.toUpperCase(),'), false);
        // A `+` after the property this line opens belongs to the next one.
        assert.equal(isAssembled("code: 'PLAN_LOCKED', message: 'a' + 'b',"), false);
        // Other properties that end in the same four letters.
        assert.equal(isAssembled('promoCode: `${prefix}-${suffix}`,'), false);
        assert.equal(isAssembled('statusCode: `${status}`,'), false);
    });
});
