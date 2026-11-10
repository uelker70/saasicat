// The day a tenant's data is deleted on after its subscription ended: the
// first day after the read-only period, in the installation's days, counted
// from the day it ended — or from the day its end is recorded, where that is
// later. Pure, so every boundary is asked here rather than through a store.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deletionDayOf, toSubscriptionEnd } from '../dist/index.js';

const BERLIN = 'Europe/Berlin';

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('the deletion day', () => {
    test('is the first day after the period, counted from the day the subscription ended', () => {
        // Midnight into 1 January in Berlin is 23:00 UTC on 31 December: the
        // subscription's last day is 31 December, its first day without it 1 January.
        const endsAt = new Date('2026-12-31T23:00:00.000Z');
        assert.equal(deletionDayOf(endsAt, endsAt, 30, BERLIN), '2027-01-31');
    });

    test("is counted in the installation's days, not in UTC's", () => {
        // 23:30 UTC on 5 January is already the 6th in Berlin. Recorded weeks
        // before, as a confirmed cancellation is, so only the day it ends counts.
        const endsAt = new Date('2027-01-05T23:30:00.000Z');
        const recordedAt = new Date('2026-11-10T09:15:00.000Z');
        assert.equal(deletionDayOf(endsAt, recordedAt, 30, BERLIN), '2027-02-05');
        assert.equal(deletionDayOf(endsAt, recordedAt, 30, 'UTC'), '2027-02-04');
    });

    for (const [days, expected] of [
        [1, '2027-01-02'],
        [2, '2027-01-03'],
        [365, '2028-01-01'],
    ]) {
        test(`${days} read-only day(s) delete on ${expected}`, () => {
            const endsAt = new Date('2026-12-31T23:00:00.000Z');
            assert.equal(deletionDayOf(endsAt, endsAt, days, BERLIN), expected);
        });
    }

    test('an end recorded on a later day counts from that day, so nobody gets less notice', () => {
        const endsAt = new Date('2025-06-30T22:00:00.000Z');
        const recordedAt = new Date('2026-11-10T09:15:00.000Z');
        assert.equal(deletionDayOf(endsAt, recordedAt, 30, BERLIN), '2026-12-10');
    });

    test('an end recorded on the next day by a minute counts from the next day', () => {
        // Ends 23:59 on 5 January in Berlin, recorded 00:01 on the 6th.
        const endsAt = new Date('2027-01-05T22:59:00.000Z');
        const recordedAt = new Date('2027-01-05T23:01:00.000Z');
        assert.equal(deletionDayOf(endsAt, recordedAt, 30, BERLIN), '2027-02-05');
    });

    test('an end recorded before it lands counts from the day it lands', () => {
        const endsAt = new Date('2026-12-31T23:00:00.000Z');
        const recordedAt = new Date('2026-11-10T09:15:00.000Z');
        assert.equal(deletionDayOf(endsAt, recordedAt, 30, BERLIN), '2027-01-31');
    });
});

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('an end read back from a store', () => {
    const row = {
        id: 'end-1',
        tenantId: 't-1',
        subscriptionId: 'sub-1',
        endsAt: new Date('2026-12-31T23:00:00.000Z'),
        recordedAt: new Date('2027-01-01T00:05:00.000Z'),
        recordedBy: 'job:platform:subscription-ends',
    };

    test("takes its day from Prisma's date at midnight UTC and from Drizzle's text alike", () => {
        const fromPrisma = toSubscriptionEnd({
            ...row,
            deletesOn: new Date('2027-01-31T00:00:00.000Z'),
        });
        const fromDrizzle = toSubscriptionEnd({ ...row, deletesOn: '2027-01-31' });
        assert.equal(fromPrisma.deletesOn, '2027-01-31');
        assert.deepEqual(fromPrisma, fromDrizzle);
    });

    test('refuses a column that holds no day, naming it', () => {
        assert.throws(
            () => toSubscriptionEnd({ ...row, deletesOn: 'soon' }),
            /subscription_ends\.deletesOn of end-1 is not a day/,
        );
    });
});
