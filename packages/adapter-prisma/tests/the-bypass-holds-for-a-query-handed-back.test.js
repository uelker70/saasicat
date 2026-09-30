// @requirement SC-COMP-019 — Under row-level security, the Prisma bundle lifts it for cross-tenant work

// A query builder hands back a promise that runs when it is awaited, not when
// it is built — Prisma's and Drizzle's both. `runWithBypass(() => query)`
// returns such a promise unawaited, and the bypass has to hold where it
// finally runs, or the read that was meant to cross tenants sees one.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AsyncLocalRlsBypassAdapter } from '../dist/index.js';

/** A query as a builder hands it back: nothing runs until it is awaited. */
function lazyQuery(port) {
    return {
        then(resolve, reject) {
            return Promise.resolve(port.isBypassActive()).then(resolve, reject);
        },
    };
}

test('a query handed back unawaited runs inside the bypass', async () => {
    const port = new AsyncLocalRlsBypassAdapter();

    assert.equal(await port.runWithBypass(() => lazyQuery(port)), true);
});

test('the bypass has ended once its work has', async () => {
    const port = new AsyncLocalRlsBypassAdapter();
    await port.runWithBypass(async () => {});

    assert.equal(port.isBypassActive(), false);
});
