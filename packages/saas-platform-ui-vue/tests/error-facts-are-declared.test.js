// Guard: the facts `adminErrorMessage` branches on are declared where they are
// known, not inferred downstream.
//
// Three sentences describe a request with no HTTP status and must not be
// swapped: "the server returned nothing, check whether the change was applied",
// "the request could not be completed, check your connection", and "something
// went wrong". Nothing about an error's shape tells them apart — `status: 0`
// is what all three look like, and one error class hosts all three kinds of
// throw site. So each seam says which one it is, with `markEmptyResponse` or
// `markTransportFailure`, and this file keeps it that way.
//
// Every expectation below is read off the sources. The set of error classes
// comes from the class declarations, the set of branded classes from their
// constructors, and the set of seams from the `fetchJson` implementations —
// none of them is a list somebody has to remember to extend.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(__dirname, '..', 'src');

const EMPTY_MARKER = 'markEmptyResponse(';
const PLATFORM_MARKER = 'markPlatformError(this)';
const ANSWER_GUARD = 'requireServerAnswer(';

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

/** 1-based line the offset falls on. */
function lineAt(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

/**
 * Every error class the package declares, with the slice of source that holds
 * its body.
 *
 * The slice runs to the next class declaration rather than to a fixed number of
 * characters. A window that is too small stops seeing a marker and the guard
 * below then reports a missing brand, which is a false alarm and gets fixed; a
 * window measured in characters would instead have to be widened by whoever
 * lengthened a constructor, and nobody would hear about it until something
 * unrelated broke.
 */
function declaredErrorClasses() {
    const found = [];
    for (const { path, text } of sources) {
        const declarations = [...text.matchAll(/(?:export )?class (\w+) extends Error\b/g)];
        for (const [index, match] of declarations.entries()) {
            const next = declarations[index + 1];
            found.push({
                name: match[1],
                path,
                line: lineAt(text, match.index),
                body: text.slice(match.index, next ? next.index : text.length),
            });
        }
    }
    return found;
}

const errorClasses = declaredErrorClasses();

/**
 * The classes the platform brand decides for.
 *
 * `toAdminError` consults `isPlatformError` in exactly one branch: the one an
 * error reaches by carrying a numeric `status`. There it chooses between "this
 * `message` is a diagnostic, drop it" and "this is what the failing side said,
 * show it". A status-carrying class without the brand therefore has its
 * diagnostic shown to the operator — `Create returned no body` in place of the
 * sentence about the change possibly having landed.
 *
 * Derived from the class bodies, so a new status-carrying class joins the rule
 * by being written rather than by being added to a list. The classes without a
 * status (`MissingHandlerError`, `BatchColumnDriftError`, …) are outside it:
 * the brand would decide nothing for them.
 */
const statusCarrying = errorClasses.filter(({ body }) =>
    /(?:readonly\s+)?status\s*:\s*number|this\.status\s*=/.test(body),
);

describe('the platform brand is on every class it decides for', () => {
    // The set every scan in this file works from is the DECLARED classes, not
    // the branded ones. Deriving it from the brand is what let a deleted
    // `markPlatformError(this)` take a class out of reach of every check at
    // once, silently: four of nine could disappear and the suite stayed green,
    // because a class that lost the brand also left the set that checks for it.
    // A class declaration cannot be dropped the same way — dropping it deletes
    // the class.
    test('there are error classes to look at — otherwise nothing below looks at anything', () => {
        assert.ok(
            errorClasses.length > 0,
            'no `class X extends Error` found in src — the scan stopped matching',
        );
        assert.ok(
            statusCarrying.length > 0,
            'no error class carries a status — the derivation stopped matching',
        );
    });

    test('each status-carrying class calls markPlatformError(this)', () => {
        const unbranded = statusCarrying
            .filter(({ body }) => !body.includes(PLATFORM_MARKER))
            .map(({ name, path, line }) => `${path}:${line} — ${name}`);
        assert.deepEqual(
            unbranded,
            [],
            'A status-carrying error class of this package holds a diagnostic in `message`, ' +
                `and ${PLATFORM_MARKER} is what tells \`toAdminError\` so. Without it the ` +
                'diagnostic is shown to the operator as if the failing side had said it:\n  ' +
                unbranded.join('\n  '),
        );
    });

    test('the brands are counted independently, against a floor that moves with the sources', () => {
        // A second regex over the same files. The floor is derived, not
        // written down: adding a class raises it, and removing a brand drops
        // the count below it — which is the case the test above names, caught
        // here again should that scan ever be narrowed by a slice that stops
        // short. Branding a class that carries no status is allowed to exceed
        // it; that direction adds a true statement, it does not lose one.
        const brands = sources.reduce(
            (total, { text }) => total + text.split(PLATFORM_MARKER).length - 1,
            0,
        );
        assert.ok(
            brands >= statusCarrying.length,
            `${statusCarrying.length} status-carrying error classes but only ${brands} ` +
                `${PLATFORM_MARKER} calls in src`,
        );
    });
});

describe('the empty-body sentinel is declared at its throw site', () => {
    // Whitespace is Prettier's business, so neither direction may depend on
    // it: `markEmptyResponse(new X(0, …))` and the same call wrapped across
    // three lines are the same declaration. The first version of this guard
    // compared fixed-width slices and went red the moment Prettier broke a
    // line, which is a guard measuring the formatter rather than the rule.
    const names = errorClasses.map(({ name }) => name);
    const CLASS_ALTERNATION = names.join('|');
    /** A construction of one of ours with a literal zero status. */
    const zeroStatus = new RegExp(`new (?:${CLASS_ALTERNATION})\\(\\s*0\\s*,`, 'g');

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
            'A platform error thrown with a literal status 0 is the empty-body sentinel and ' +
                `has to say so. Wrap it in ${EMPTY_MARKER}…):\n  ${unmarked.join('\n  ')}`,
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
            for (const match of text.matchAll(/(?<![\w$])markEmptyResponse\(/g)) {
                calls += 1;
                const argument = text.slice(match.index + match[0].length);
                if (!wrapped.test(argument)) wrong.push(`${path}:${lineAt(text, match.index)}`);
            }
        }

        assert.ok(calls > 0, 'no markEmptyResponse call found — the scan matched nothing');
        assert.deepEqual(
            wrong,
            [],
            `${EMPTY_MARKER}…) belongs on a status-0 construction of one of the package's own ` +
                `error classes:\n  ${wrong.join('\n  ')}`,
        );
    });
});

describe('a seam whose answer can be "no body" first asks whether one arrived', () => {
    /**
     * The composables' own JSON helpers, narrowed to the ones that can answer
     * `null`. That `null` is what every empty-response sentinel stands on: the
     * caller reads it as "the server answered without a body". It only means
     * that once the helper has ruled out the other reading — a client that
     * reports a transport failure by RESOLVING with `status: 0`, which
     * `HttpClient` permits and axios and XHR really do.
     *
     * A helper that cannot answer `null` (`use-tenant-billing-catalog`'s, which
     * throws on every non-200) has no such ambiguity and is not in the rule.
     */
    const helpers = sources.flatMap(({ path, text }) => {
        const declarations = [...text.matchAll(/async function fetchJson</g)];
        return declarations
            .map((match, index) => {
                const next = declarations[index + 1];
                return {
                    where: `${path}:${lineAt(text, match.index)}`,
                    body: text.slice(match.index, next ? next.index : text.length),
                };
            })
            .filter(({ body }) => /return null;/.test(body));
    });

    test('the helpers are discoverable', () => {
        assert.ok(helpers.length > 0, 'no fetchJson helper found — the scan stopped matching');
    });

    test('each one calls requireServerAnswer before it reads a body', () => {
        const missing = helpers
            .filter(({ body }) => {
                const guard = body.indexOf(ANSWER_GUARD);
                const read = body.indexOf('res.json()');
                return guard < 0 || (read >= 0 && guard > read);
            })
            .map(({ where }) => where);
        assert.deepEqual(
            missing,
            [],
            `${ANSWER_GUARD}…) has to run before the body is read — otherwise an absent body ` +
                'means two things at once, and the mutation sentinels tell the operator a ' +
                'request that never left the machine may have applied their change:\n  ' +
                missing.join('\n  '),
        );
    });

    test('every file that raises the sentinel also runs the guard', () => {
        // Keyed on the sentinel rather than on a helper name, so a seam that
        // spells its helper differently is covered too.
        const unguarded = sources
            .filter(({ path, text }) => {
                if (path === join('client', 'admin-error.ts')) return false;
                return text.includes(EMPTY_MARKER) && !text.includes(ANSWER_GUARD);
            })
            .map(({ path }) => path);
        assert.deepEqual(
            unguarded,
            [],
            `A file that claims "the server answered without a body" has to have ruled out ` +
                `"the request never reached the server" first:\n  ${unguarded.join('\n  ')}`,
        );
    });
});
