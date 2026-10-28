// Every day the administration shows comes from `client/installation-day.ts`
// or is a calendar day the platform handed out (`SC-ADM-048`). The ways a
// moment used to become a day without saying which day — the UTC day an ISO
// moment begins with, or the browser's — are refused anywhere in the package's
// source, so a page cannot slide back to one of them.
//
// A structural check, as such a rule is: it reads the source for the three
// spellings and names each place. What the helpers compute is tested beside
// them, in `installation-day.test.js`.

// @requirement SC-ADM-048 — Every day the administration shows is a day of the installation

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

/** Every `.ts` and `.vue` file under `directory`, recursively. */
function sourcesUnder(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourcesUnder(path);
        return /\.(ts|vue)$/.test(entry.name) ? [path] : [];
    });
}

/** Every index of `needle` in `text`. */
function indicesOf(text, needle) {
    const found = [];
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) found.push(at);
    return found;
}

/** The text of the call whose `(` stands at `open`, up to its balancing `)`. */
function argumentsAt(text, open) {
    let depth = 0;
    for (let at = open; at < text.length; at += 1) {
        if (text[at] === '(') depth += 1;
        else if (text[at] === ')') {
            depth -= 1;
            if (depth === 0) return text.slice(open, at + 1);
        }
    }
    return text.slice(open);
}

const lineOf = (text, at) => text.slice(0, at).split('\n').length;

/** The places in `text` that turn a moment into a day without naming which day. */
function unnamedDays(text) {
    const places = [];
    for (const needle of ['.slice(0, 10)', '.substring(0, 10)', 'toISOString().slice(']) {
        for (const at of indicesOf(text, needle)) places.push({ at, what: needle });
    }
    for (const at of indicesOf(text, 'toLocaleDateString(')) {
        const call = argumentsAt(text, at + 'toLocaleDateString'.length);
        if (!call.includes('timeZone'))
            places.push({ at, what: 'toLocaleDateString without timeZone' });
    }
    return places.map(({ at, what }) => `${what} at line ${lineOf(text, at)}`);
}

test('no source of the package turns a moment into a day without saying which day', () => {
    const found = sourcesUnder(SRC).flatMap((path) =>
        unnamedDays(readFileSync(path, 'utf8')).map((place) => `${relative(ROOT, path)}: ${place}`),
    );

    assert.deepEqual(found, []);
});

test('and finds each spelling it refuses', () => {
    // The check's own counter-check: each spelling, written once, is found.
    assert.deepEqual(
        unnamedDays(
            [
                'const a = iso.slice(0, 10);',
                'const b = iso.substring(0, 10);',
                'const c = new Date().toISOString().slice(0, 7);',
                "const d = new Date(iso).toLocaleDateString('de', { day: '2-digit' });",
                "const e = new Date(iso).toLocaleDateString('de', { day: '2-digit', timeZone: 'UTC' });",
            ].join('\n'),
        ),
        [
            '.slice(0, 10) at line 1',
            '.substring(0, 10) at line 2',
            'toISOString().slice( at line 3',
            'toLocaleDateString without timeZone at line 4',
        ],
    );
});
