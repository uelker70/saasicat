import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SA_MESSAGES, describeVersionSale, formatDay, versionSale } from '../dist/client/index.js';

// The words the admin says a version's state in. The state itself is the
// platform's (`versionSale` in `@saasicat/core`, tested there); the admin reads
// it through this entry, so the entry must hand on that same function.

// @requirement SC-PLAN-028 — The admin says whether a version is on sale by the rule a booking follows
describe('the state the admin reads', () => {
    it("is the platform's, handed on", () => {
        assert.deepEqual(
            versionSale(
                { publishedAt: '2026-01-01', validUntil: '2026-06-30' },
                new Date('2026-06-15T12:00:00Z'),
            ),
            { kind: 'on-sale', until: '2026-06-30' },
        );
    });
});

// @requirement SC-PLAN-028 — The admin says whether a version is on sale by the rule a booking follows
describe('the words for it', () => {
    const texts = SA_MESSAGES.en.common.versionSale;
    const say = (sale) => describeVersionSale(sale, texts, 'en-GB');

    it('names the day where the state has one', () => {
        assert.equal(say({ kind: 'on-sale', until: '2026-06-30' }), 'On sale until 30/06/2026');
        assert.equal(say({ kind: 'scheduled', from: '2026-07-01' }), 'On sale from 01/07/2026');
        assert.equal(say({ kind: 'off-sale', since: '2026-07-01' }), 'Off sale since 01/07/2026');
    });

    it('says it without a day where there is none', () => {
        assert.equal(say({ kind: 'on-sale', until: null }), 'On sale');
        assert.equal(say({ kind: 'off-sale', since: null }), 'Off sale');
        assert.equal(say({ kind: 'draft' }), 'Draft');
    });

    it('formats the UTC day, so a day stored at midnight does not slip back', () => {
        assert.equal(formatDay('2026-07-01T00:00:00.000Z', 'en-US'), '07/01/2026');
        assert.equal(formatDay('2026-07-01', 'de-DE'), '01.07.2026');
    });
});
