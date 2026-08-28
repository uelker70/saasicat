import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ERROR_MESSAGES_DE, ERROR_MESSAGES_EN } from '@saasicat/core';

// Every blocker and warning the plan-change preview can emit has to be
// translatable, and that means two things a build can check: its code is in
// both shipped catalogues, and the template names no value the issue does not
// carry.
//
// This was not true until 1.0.0-rc.8. The sentences were built server-side with
// the numbers inside them, so a tenant read them in English whatever language
// they had chosen — and three of the codes were constructed from their subject
// (`VEHICLES_OVER_TARGET`, `ENTERPRISE_LOCKED`), which made the set grow with
// every quota and plan an installation defines. No catalogue could be complete
// against that, and no guard could check one. Collapsing them is what makes
// this test possible at all.
//
// The expectation is derived from the service source rather than listed here: a
// list would be the same defect one level up, and the code that is forgotten is
// the one nobody added to it.

const SERVICE = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'src',
    'billing',
    'plan-change-preview.service.ts',
);

/**
 * The `blockers.push({…})` and `warnings.push({…})` object literals, as text.
 *
 * Scanned by hand rather than matched: `/push\(\{([\s\S]*?)\}\);/` puts two
 * quantifiers that can exchange characters next to each other, which is
 * polynomial backtracking on a long file and what `regexp/no-super-linear-
 * backtracking` refuses. A forward scan over braces has none of that and reads
 * more plainly besides.
 *
 * Only pushed issues: an exception thrown by the same service travels the
 * ordinary error path, where `resolveErrorMessage` already applies. Issues do
 * not — they ride inside a 200 response, which is why they needed a guard of
 * their own.
 */
function issueBlocks(source) {
    const blocks = [];
    for (const opener of ['blockers.push({', 'warnings.push({']) {
        let at = source.indexOf(opener);
        while (at !== -1) {
            const bodyStart = at + opener.length;
            let depth = 1;
            let i = bodyStart;
            while (i < source.length && depth > 0) {
                const ch = source[i];
                if (ch === '{') depth += 1;
                else if (ch === '}') depth -= 1;
                i += 1;
            }
            blocks.push(source.slice(bodyStart, i - 1));
            at = source.indexOf(opener, i);
        }
    }
    return blocks;
}

/** The code an issue block carries, whether named or written out. */
function codeOf(block) {
    const named = block.indexOf('BILLING_ERROR_CODES.');
    if (named !== -1) {
        const rest = block.slice(named + 'BILLING_ERROR_CODES.'.length);
        const end = rest.search(/[^A-Z_]/);
        return end === -1 ? rest : rest.slice(0, end);
    }
    // A raw `code: 'X'` slipped past an earlier version of this scan, and that
    // is exactly the kind of code a catalogue never hears about.
    const raw = block.indexOf("code: '");
    if (raw === -1) return null;
    const rest = block.slice(raw + "code: '".length);
    const close = rest.indexOf("'");
    return close === -1 ? null : rest.slice(0, close);
}

/** The `params:` keys a block passes, on one line or on many. */
function paramsOf(block) {
    const at = block.indexOf('params: {');
    if (at === -1) return new Set();
    const bodyStart = at + 'params: {'.length;
    let depth = 1;
    let i = bodyStart;
    while (i < block.length && depth > 0) {
        const ch = block[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        i += 1;
    }
    const names = new Set();
    for (const part of block.slice(bodyStart, i - 1).split(',')) {
        const colon = part.indexOf(':');
        const name = (colon === -1 ? part : part.slice(0, colon)).trim();
        if (name) names.add(name);
    }
    return names;
}

/** The `{placeholder}` names a template asks for. One quantifier, no overlap. */
function placeholdersOf(text) {
    return new Set(Array.from(text.matchAll(/\{(\w+)\}/g), (m) => m[1]));
}

const BLOCKS = issueBlocks(readFileSync(SERVICE, 'utf8'));

function emittedCodes() {
    return [...new Set(BLOCKS.map(codeOf).filter(Boolean))].sort();
}

function paramsPerCode() {
    const byCode = {};
    for (const block of BLOCKS) {
        const code = codeOf(block);
        if (code) byCode[code] = paramsOf(block);
    }
    return byCode;
}

describe('a preview issue can be read in the reader’s language', () => {
    const codes = emittedCodes();

    test('the scan finds the codes at all', () => {
        // Every assertion below is vacuously true on an empty list, and the
        // whole value of this file is that it reads the service.
        assert.ok(codes.length >= 7, `only found ${codes.length}: ${codes.join(', ')}`);
        assert.ok(
            codes.includes('QUOTA_OVER_TARGET'),
            'the collapsed quota code is not in the scan',
        );
    });

    for (const locale of ['en', 'de']) {
        const catalogue = locale === 'de' ? ERROR_MESSAGES_DE : ERROR_MESSAGES_EN;
        test(`${locale} has a text for every code the preview emits`, () => {
            const missing = codes.filter((code) => !catalogue[code]);
            assert.deepEqual(
                missing,
                [],
                `no ${locale} text for: ${missing.join(', ')} — a tenant would read English`,
            );
        });
    }

    test('every template names only values the issue carries', () => {
        const params = paramsPerCode();
        const problems = [];
        for (const code of codes) {
            for (const [locale, catalogue] of [
                ['en', ERROR_MESSAGES_EN],
                ['de', ERROR_MESSAGES_DE],
            ]) {
                const template = catalogue[code];
                if (!template) continue;
                for (const name of placeholdersOf(template)) {
                    if (!params[code]?.has(name)) {
                        problems.push(`${locale} ${code} asks for {${name}}`);
                    }
                }
            }
        }
        assert.deepEqual(
            problems,
            [],
            'a placeholder with no value renders verbatim — the reader sees the brace',
        );
    });
});
