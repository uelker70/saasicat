// @requirement SC-CHG-025 — A plan change made at once and its contract are one
// @requirement SC-CHG-026 — A scheduled plan change takes effect with its contract, or stays due
// @requirement SC-BUN-067 — An add-on ended at once and the contract without it are one

// A change whose contract could not be written either goes back and is refused,
// or is one the charge journal answers for on its own. Which one is read from
// the source: every call of `freezeOnPlanChange` in the billing sources that
// sits in a `try` whose `catch` neither throws nor returns — an answer its
// caller reads, such as `false` for "put it back" — has to be the call inside
// `freezeHealedByTheJournal`. A new call that only logs fails here until it
// either takes its change back or goes through that helper, which says why
// the journal heals it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BILLING = join(HERE, '..', 'src', 'billing');
const CALL = '.freezeOnPlanChange(';
const HELPER = 'freezeHealedByTheJournal';

function sourcesUnder(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourcesUnder(path);
        return entry.name.endsWith('.ts') ? [path] : [];
    });
}

/**
 * For each `{` and `}` of the code in `text` — not in a comment, a string or
 * the literal part of a template — its index and its partner's. A template's
 * `${ … }` is code.
 */
function bracePairs(text) {
    const pairs = new Map();
    const open = [];
    // What encloses the position: 'code', or a template whose `${` is open.
    const modes = ['code'];
    let i = 0;
    const skipQuoted = (quote) => {
        for (i += 1; i < text.length && text[i] !== quote; i += 1) {
            if (text[i] === '\\') i += 1;
        }
    };
    while (i < text.length) {
        const mode = modes.at(-1);
        const char = text[i];
        if (mode === 'template') {
            if (char === '\\') i += 1;
            else if (char === '`') modes.pop();
            else if (char === '$' && text[i + 1] === '{') {
                open.push({ at: i + 1, template: true });
                modes.push('code');
                i += 1;
            }
        } else if (char === '/' && text[i + 1] === '/') {
            i = text.indexOf('\n', i);
            if (i === -1) break;
        } else if (char === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i) + 1;
        } else if (char === "'" || char === '"') {
            skipQuoted(char);
        } else if (char === '`') {
            modes.push('template');
        } else if (char === '{') {
            open.push({ at: i, template: false });
        } else if (char === '}') {
            const opened = open.pop();
            pairs.set(opened.at, i);
            pairs.set(i, opened.at);
            if (opened.template) modes.pop();
        }
        i += 1;
    }
    return pairs;
}

/** The `{` of every block that encloses `index`, innermost first. */
function enclosingBlocks(pairs, index) {
    return [...pairs.entries()]
        .filter(([at, partner]) => at < index && partner > index)
        .map(([at]) => at)
        .sort((a, b) => b - a);
}

/** The body of the `catch` after the `try` block opened at `tryOpen`, or null. */
function catchBodyAfter(text, pairs, tryOpen) {
    const tryClose = pairs.get(tryOpen);
    const after = text.slice(tryClose + 1).trimStart();
    if (!after.startsWith('catch')) return null;
    const catchOpen = text.indexOf('{', tryClose + 1 + text.slice(tryClose + 1).indexOf('catch'));
    return text.slice(catchOpen + 1, pairs.get(catchOpen));
}

const isTryBlock = (text, open) => text.slice(0, open).trimEnd().endsWith('try');
const onlyLogs = (body) => !/\bthrow\b/.test(body) && !/\breturn\b/.test(body);

/** Every call of the freeze in the billing sources, and what its `catch` does. */
function freezeCalls() {
    return sourcesUnder(BILLING).flatMap((path) => {
        const text = readFileSync(path, 'utf8');
        const pairs = bracePairs(text);
        const helperAt = text.indexOf(`function ${HELPER}(`);
        const helperBody = helperAt === -1 ? null : text.indexOf('{', text.indexOf(')', helperAt));
        const calls = [];
        for (let at = text.indexOf(CALL); at !== -1; at = text.indexOf(CALL, at + 1)) {
            const blocks = enclosingBlocks(pairs, at);
            const tryOpen = blocks.find((open) => isTryBlock(text, open));
            const caught = tryOpen === undefined ? null : catchBodyAfter(text, pairs, tryOpen);
            calls.push({
                where: `${relative(join(HERE, '..'), path)}:${text.slice(0, at).split('\n').length}`,
                swallows: caught !== null && onlyLogs(caught),
                inHelper: helperBody !== null && blocks.includes(helperBody),
            });
        }
        return calls;
    });
}

describe('a freeze whose failure is only logged', () => {
    test('is found where it is', () => {
        const calls = freezeCalls();
        assert.ok(calls.length >= 5, `found ${calls.length} calls of the freeze`);
        assert.ok(
            calls.some((call) => call.inHelper && call.swallows),
            `${HELPER} logs a failed freeze, and the scan has to see it do so`,
        );
    });

    test('is the one inside the helper that names the journal as what heals it', () => {
        const swallowing = freezeCalls()
            .filter((call) => call.swallows && !call.inHelper)
            .map((call) => call.where);
        assert.deepEqual(swallowing, []);
    });
});
