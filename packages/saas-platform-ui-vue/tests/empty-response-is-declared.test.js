// Guard: the empty-body sentinel is declared where it is thrown.
//
// `AdminError.emptyResponse` decides between two sentences that must not be
// swapped: "the server returned nothing, check whether the change was applied"
// and "the request could not be completed, check your connection". The flag
// used to be inferred inside `toAdminError` from `status === 0 &&
// isPlatformError(err)`, which is a fact about the CLASS. Whether the server
// answered is a fact about the THROW SITE, and one class hosts both kinds:
// `PlansApiError` is raised for `HTTP 403` and for `Create returned no body`,
// and `BootLoadError` is raised with whatever status the consumer's client
// reported — `0` included, for a GET that never left the machine.
//
// So the site says so, with `markEmptyResponse`. This test keeps it that way:
// a status-0 construction of one of the package's own error classes that
// forgets the marker would silently fall back to "check whether the change was
// applied", and nothing else in the suite would notice.
//
// The list of classes is derived, not written down: a class counts as the
// package's own exactly when its constructor calls `markPlatformError(this)`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(__dirname, '..', 'src');

const MARKER = 'markEmptyResponse(';
/** How far past `export class X extends Error` the constructor body reaches. */
const CLASS_BODY_WINDOW = 800;

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (entry.endsWith('.ts')) yield full;
    }
}

const sources = [...walk(SRC)].map((file) => ({
    path: relative(SRC, file),
    text: readFileSync(file, 'utf8'),
}));

/** Classes this package brands as its own, read off their constructors. */
function brandedClassNames() {
    const names = new Set();
    for (const { text } of sources) {
        const declarations = text.matchAll(/export class (\w+) extends Error\b/g);
        for (const match of declarations) {
            const body = text.slice(match.index, match.index + CLASS_BODY_WINDOW);
            if (body.includes('markPlatformError(this)')) names.add(match[1]);
        }
    }
    return names;
}

/** 1-based line the offset falls on. */
function lineAt(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

/** Every `markEmptyResponse(` call in a file, as offsets. */
function markerCalls(text) {
    return [...text.matchAll(/(?<![\w$])markEmptyResponse\(/g)];
}

describe('the empty-body sentinel is declared at its throw site', () => {
    // Whitespace is Prettier's business, so neither direction may depend on
    // it: `markEmptyResponse(new X(0, …))` and the same call wrapped across
    // three lines are the same declaration. The first version of this guard
    // compared fixed-width slices and went red the moment Prettier broke a
    // line, which is a guard measuring the formatter rather than the rule.
    const classes = brandedClassNames();
    const CLASS_ALTERNATION = [...classes].join('|');
    /** A construction of one of ours with a literal zero status. */
    const zeroStatus = new RegExp(`new (?:${CLASS_ALTERNATION})\\(\\s*0\\s*,`, 'g');

    test('the branded classes are discoverable — otherwise nothing below looks at anything', () => {
        assert.ok(
            classes.size >= 5,
            `expected the package's own error classes to be discoverable, found ${classes.size}`,
        );
    });

    test('every status-0 platform error is marked as one', () => {
        const unmarked = [];
        let found = 0;

        for (const { path, text } of sources) {
            for (const match of text.matchAll(zeroStatus)) {
                found += 1;
                const before = text.slice(0, match.index).trimEnd();
                if (!/(?<![\w$])markEmptyResponse\($/.test(before)) {
                    unmarked.push(`${path}:${lineAt(text, match.index)} — ${match[0]}`);
                }
            }
        }

        assert.ok(found > 0, 'no status-0 platform error found — the pattern stopped matching');
        assert.deepEqual(
            unmarked,
            [],
            'A platform error thrown with status 0 is the empty-body sentinel and has to say ' +
                `so. Wrap it in ${MARKER}…):\n  ${unmarked.join('\n  ')}`,
        );
    });

    test('nothing else claims to be one', () => {
        // The reverse direction: the marker stays attached to the case it
        // describes, so it cannot be sprinkled on a failure that did reach a
        // status.
        const wrapped = new RegExp(`^\\s*new (?:${CLASS_ALTERNATION})\\(\\s*0\\s*,`);
        const wrong = [];
        let calls = 0;

        for (const { path, text } of sources) {
            if (path === join('client', 'admin-error.ts')) continue;
            for (const match of markerCalls(text)) {
                calls += 1;
                const argument = text.slice(match.index + match[0].length);
                if (!wrapped.test(argument)) wrong.push(`${path}:${lineAt(text, match.index)}`);
            }
        }

        assert.ok(calls > 0, 'no markEmptyResponse call found — the scan matched nothing');
        assert.deepEqual(
            wrong,
            [],
            `${MARKER}…) belongs on a status-0 construction of one of the package's own ` +
                `error classes:\n  ${wrong.join('\n  ')}`,
        );
    });
});
