import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Every date the wire carries has to arrive as a `Date`.
//
// The record types promise `Date`, the transport delivers JSON, and one
// function in the middle converts them. Miss a field there and the type says
// `Date` while the value is a string: `getTime()` throws in a consumer's app,
// and nothing here fails. It happened — `currentPeriodStart` and
// `currentPeriodEnd` were added to the record and not to the conversion, and
// the test that claimed to map "every wire date" was checking four of seven
// fields from a hand-written list.
//
// So this one takes its list from the type instead. A new `Date` field on a
// record is covered the moment it is declared, which is the whole point: a
// hand-written list is the same defect one level up.

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const SUBJECTS = [
    {
        record: 'SubscriptionBundleRecord',
        types: at('../../core/src/subscription.types.ts'),
        converter: at('../src/vue/use-tenant-subscription-bundles.ts'),
        converterName: 'rehydrateDates',
    },
];

/**
 * The body of `interface <name> { … }`, by brace depth.
 *
 * Hand-scanned rather than matched: a pattern with two quantifiers over the
 * same characters backtracks, and this reads a whole source file.
 */
function interfaceBody(source, name) {
    const header = `export interface ${name} {`;
    const start = source.indexOf(header);
    assert.notEqual(start, -1, `${name} not found — has it been renamed?`);
    let depth = 1;
    let i = start + header.length;
    while (depth > 0 && i < source.length) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        i += 1;
    }
    return source.slice(start + header.length, i - 1);
}

/** Property names whose declared type mentions `Date`, comments skipped. */
function dateFields(body) {
    const found = [];
    for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue;
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const declared = line.slice(colon + 1);
        if (!declared.includes('Date')) continue;
        const name = line.slice(0, colon).replace('?', '').trim();
        if (name) found.push(name);
    }
    return found;
}

/** The body of `function <name>(…) { … }`, by the same scan. */
function functionBody(source, name) {
    const header = `function ${name}(`;
    const start = source.indexOf(header);
    assert.notEqual(start, -1, `${name} not found — has it been renamed?`);
    const open = source.indexOf('{', source.indexOf(')', start));
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < source.length) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        i += 1;
    }
    return source.slice(open + 1, i - 1);
}

describe('every date a record declares is converted at the HTTP boundary', () => {
    for (const subject of SUBJECTS) {
        test(`${subject.record} → ${subject.converterName}`, () => {
            const declared = dateFields(
                interfaceBody(readFileSync(subject.types, 'utf8'), subject.record),
            );
            assert.ok(
                declared.length > 0,
                `no Date fields found on ${subject.record} — the scan has stopped working`,
            );

            const body = functionBody(
                readFileSync(subject.converter, 'utf8'),
                subject.converterName,
            );
            const missing = declared.filter((field) => !body.includes(`${field}:`));
            assert.deepEqual(
                missing,
                [],
                `${subject.converterName} leaves these as wire strings: ${missing.join(', ')}`,
            );
        });
    }
});
