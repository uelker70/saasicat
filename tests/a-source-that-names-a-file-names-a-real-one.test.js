// Guard: a `_Source:_` line that names a path names a file that is in the tree.
//
// Every requirement says where its decision came from, and a source is the one
// part of an entry a reader follows out of the document. Three of the forms it
// takes cannot go stale on their own — an issue number, a release, an ADR —
// but a path can: files are renamed, folders are consolidated, and a source
// pointing at a document that no longer exists sends the reader looking for
// something to read instead of telling them there is nothing.
//
// The dangerous version is the one nobody notices. A path into `handoff/`
// resolves for whoever wrote it and does not exist in a fresh clone at all,
// because that folder is gitignored — so the source would be a promise about
// evidence a contributor cannot reach, and the person who could see it is the
// last person who would report it.
//
// The expectation comes from `git ls-files`, not from a list here. A file
// added, moved or removed is covered on the day it moves, and a source into an
// untracked folder fails for the same reason it should.
//
// What is a path and what is prose: a source line's backticked tokens are
// paths, and everything else on it — `#212`, `release 1.0.0-rc.6`, `ADR 0007`,
// `current practice` — is not. That is the catalogue's own convention, held to
// by all 400 entries, and it is what makes the rule decidable without guessing
// at slashes and extensions.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCatalogue } from '../scripts/requirements/parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The backticked tokens of a source line — the catalogue's way of naming a file. */
export function pathsIn(source) {
    return [...source.matchAll(/`([^`]+)`/g)].map(([, path]) => path);
}

const tracked = new Set(
    execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean),
);
const catalogue = readCatalogue(ROOT);

describe('a source that names a file names a real one', () => {
    test('there are sources to look at — otherwise nothing below looks at anything', () => {
        const named = catalogue.entries.flatMap((entry) => entry.sources.flatMap(pathsIn));
        assert.ok(named.length > 100, `expected sources naming files, found ${named.length}`);
    });

    test('every path a source names is a tracked file', () => {
        const offenders = [];
        for (const entry of catalogue.entries) {
            for (const path of entry.sources.flatMap(pathsIn)) {
                if (!tracked.has(path)) offenders.push(`${entry.id} (${entry.where}) → ${path}`);
            }
        }
        assert.deepEqual(
            offenders,
            [],
            `A source names a file that is not in the tree:\n  ${offenders.join('\n  ')}\n` +
                'Name a file a contributor can open, or cite the decision another way ' +
                '(an issue, a release, an ADR).',
        );
    });

    test('the reader of a source line tells a path from the rest of it', () => {
        assert.deepEqual(pathsIn('`docs/reference/error-codes.md`'), [
            'docs/reference/error-codes.md',
        ]);
        assert.deepEqual(pathsIn('#212 · `SECURITY.md`'), ['SECURITY.md']);
        assert.deepEqual(pathsIn('release 1.0.0-rc.6'), []);
        assert.deepEqual(pathsIn('internal engineering guidelines'), []);
        assert.deepEqual(pathsIn('`a.md` · `b.md`'), ['a.md', 'b.md']);
    });
});
