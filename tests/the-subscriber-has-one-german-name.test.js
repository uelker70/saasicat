// @requirement SC-READ-008 — There is one way to do each thing, not two right answers

// The German interface calls the party a contract is concluded with the
// _Vertragspartner_ — the section titles, the record, the refusals. A second
// word for the same party leaves a reader guessing whether two parties are
// meant, and _Abonnent_ is the one that kept coming back into texts written
// later. The scope is every shipped source under `packages/*/src`, where the
// German catalogues live; _Abonnement_, the subscription, is another word and
// is not matched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const RETIRED = 'abonnent';

/** Every tracked source a package ships. */
function shippedSources() {
    return execFileSync('git', ['ls-files', '-z', ':(glob)packages/*/src/**'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\0')
        .filter(Boolean);
}

test('no shipped text calls the subscriber an Abonnent', () => {
    const sources = shippedSources();
    const found = sources.flatMap((path) =>
        readFileSync(join(REPO_ROOT, path), 'utf8')
            .split('\n')
            .flatMap((line, index) =>
                line.toLowerCase().includes(RETIRED) ? [`${path}:${index + 1}`] : [],
            ),
    );

    assert.ok(sources.length > 100, `only ${sources.length} shipped sources were read`);
    assert.deepEqual(found, []);
});
