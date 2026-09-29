import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { customLimitsReader, readCustomLimits } from '../dist/index.js';

// A tenant's negotiated limits, read from the JSON they are stored as. One
// shape is applied — `quotas` replacing the plan's value per key, `features`
// adding to the plan's — and anything else is named rather than dropped
// without a word, which is what happened to `{ maxUsers: 20 }`.

// @requirement SC-ENTL-024 — Negotiated limits are applied, and a stored shape that cannot be read is reported
describe('a stored customLimits value', () => {
    test('none stored is none', () => {
        assert.deepEqual(readCustomLimits(null), { limits: null, unread: [] });
        assert.deepEqual(readCustomLimits(undefined), { limits: null, unread: [] });
    });

    test('the platform shape is read whole', () => {
        assert.deepEqual(
            readCustomLimits({ quotas: { users: 50, storage: -1 }, features: ['EXPORT'] }),
            { limits: { quotas: { users: 50, storage: -1 }, features: ['EXPORT'] }, unread: [] },
        );
    });

    test('a quota nothing can count reads as unlimited, as a plan quota does', () => {
        // The one reading of a quota in JSON (`SC-ENTL-010`): an unreadable
        // value blocks nobody rather than turning into an absent limit.
        assert.deepEqual(readCustomLimits({ quotas: { users: 'fifty' } }).limits, {
            quotas: { users: -1 },
        });
    });

    test('a key the platform does not read is named, and the rest is still read', () => {
        assert.deepEqual(readCustomLimits({ maxUsers: 20, quotas: { users: 7 } }), {
            limits: { quotas: { users: 7 } },
            unread: ['maxUsers'],
        });
    });

    test('quotas or features of the wrong kind are named rather than guessed at', () => {
        assert.deepEqual(readCustomLimits({ quotas: [5], features: ['A', 1] }), {
            limits: {},
            unread: ['quotas', 'features'],
        });
    });

    test('a value that is not an object is not read at all, and says so', () => {
        const { limits, unread } = readCustomLimits('users=5');
        assert.equal(limits, null);
        assert.equal(unread.length, 1);
    });
});

// @requirement SC-ENTL-024 — Negotiated limits are applied, and a stored shape that cannot be read is reported
describe('reading limits for an adapter', () => {
    test('reports what went unread once per subscription, naming it', () => {
        const lines = [];
        const read = customLimitsReader((line) => lines.push(line));

        read('sub-1', { maxUsers: 20 });
        read('sub-1', { maxUsers: 20 });
        read('sub-2', { maxVehicles: 3 });
        read('sub-3', { quotas: { users: 5 } });

        assert.equal(lines.length, 2, 'once each, and nothing for a readable value');
        assert.match(lines[0], /sub-1.*maxUsers.*not applied/);
        assert.match(lines[1], /sub-2.*maxVehicles/);
    });

    test('hands back what it could read', () => {
        const read = customLimitsReader(() => {});

        assert.deepEqual(read('sub-1', { maxUsers: 20, features: ['A'] }), { features: ['A'] });
    });
});
