// A request carries the app's auth because the app's HttpClient does.
//
// There used to be a second way: every composable also took `getAuthToken`, and
// built `Authorization: Bearer …` itself when it was given one. Two answers to
// one question, and the failure mode was silent — an app that passed a client
// AND a token reader got the header twice, an app that passed only a client to
// a composable that ignored `http` got no header at all, and nothing said so.
//
// `HttpClient` is now the only seam. `createResourceRegistry` refuses to be
// built without one (§0.5), so there is no path on which a platform request
// leaves without whatever the app put in that client.
//
// This is a source scan on purpose: the property is the ABSENCE of an option,
// and absence cannot be observed by calling something.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function filesUnder(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) filesUnder(full, out);
        else if (/\.(ts|vue)$/.test(entry)) out.push(full);
    }
    return out;
}

describe('the HttpClient is the only way a request gets its auth', () => {
    const files = filesUnder(SRC);

    test('there is a corpus to scan', () => {
        // Without this the two checks below pass by having nothing to look at,
        // which is the shape of a guard that quietly stopped working.
        assert.ok(files.length >= 150, `only ${files.length} source files found`);
    });

    test('no option named `getAuthToken` survives', () => {
        // A declaration or a read, not the word. The first version of this
        // check scanned the raw text and flagged the two comments that explain
        // why the option is gone — a rule that forbids saying what it enforces
        // is a rule nobody can document around.
        const DECLARED_OR_READ = /getAuthToken\s*[?:(]|\.getAuthToken\b/;
        const offenders = files
            .filter((file) => DECLARED_OR_READ.test(readFileSync(file, 'utf8')))
            .map((file) => relative(SRC, file));
        assert.deepEqual(
            offenders,
            [],
            'a second way to authenticate is back. Pass an HttpClient that carries the ' +
                'header instead — see `createFetchHttpClient({ headers })`.',
        );
    });

    test('nothing builds a Bearer header by hand', () => {
        // The option could come back under another name. What the rule is
        // really about is the package deciding how a request is authorised,
        // and that shows up as this string wherever it happens.
        const offenders = files
            .filter((file) => /Authorization.{0,20}Bearer/s.test(readFileSync(file, 'utf8')))
            .map((file) => relative(SRC, file));
        assert.deepEqual(
            offenders,
            [],
            'the package is composing an Authorization header. That belongs to the app, ' +
                'in the client it passes.',
        );
    });
});
