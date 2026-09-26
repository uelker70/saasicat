// Every `$ref` in the OpenAPI document leads somewhere.
//
// A reference to another file is resolved from the document's own directory,
// the way a bundler or a client generator resolves it; a reference into the
// document names a node that is there. Nothing else here dereferences them —
// `openapi-covers-the-implementation` compares paths, not what a response
// points at — and a generator that cannot follow one fails on the whole
// document, not on the one response.

// @requirement SC-READ-006 — A reference a reader cannot follow is not made

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = join(ROOT, 'packages/spec/admin-api.openapi.yaml');

/** Every `$ref` value in the document, wherever it sits. */
function referencesIn(node, found = []) {
    if (Array.isArray(node)) {
        for (const item of node) referencesIn(item, found);
    } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
            if (key === '$ref' && typeof value === 'string') found.push(value);
            else referencesIn(value, found);
        }
    }
    return found;
}

/** The node a JSON pointer (`/components/schemas/X`) names, or undefined. */
function nodeAt(document, pointer) {
    return pointer
        .split('/')
        .slice(1)
        .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
        .reduce((node, segment) => (node === undefined ? undefined : node[segment]), document);
}

describe('the OpenAPI document', () => {
    const document = parse(readFileSync(SPEC, 'utf8'));
    const references = referencesIn(document);

    test('carries references at all, so the checks below have something to check', () => {
        assert.ok(references.some((ref) => ref.startsWith('#/')));
        assert.ok(references.some((ref) => !ref.startsWith('#')));
    });

    test('names only files that exist beside it', () => {
        const missing = references
            .filter((ref) => !ref.startsWith('#'))
            .map((ref) => ref.split('#')[0])
            .filter((file) => !existsSync(join(dirname(SPEC), file)));
        assert.deepEqual(missing, []);
    });

    test('points only at nodes it contains', () => {
        const dangling = references
            .filter((ref) => ref.startsWith('#/'))
            .filter((ref) => nodeAt(document, ref.slice(1)) === undefined);
        assert.deepEqual(dangling, []);
    });
});
