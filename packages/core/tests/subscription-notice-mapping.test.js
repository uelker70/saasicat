// Reading a subscriber notice back: the record is what a subscriber is later
// shown they were told, so a row nobody can read stops at the read and names
// itself rather than reaching the page as something it is not.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { toSubscriptionNoticeRecord } from '../dist/index.js';

const ROW = {
    id: 'n-1',
    tenantId: 't1',
    subscriptionId: 'sub-1',
    kind: 'version-offered',
    subject: 'pv-2',
    content: { kind: 'version-offered' },
    createdAt: new Date('2026-10-15T09:00:00.000Z'),
    claimedAt: null,
    deliveredAt: null,
    recipients: null,
    channel: null,
};
const DELIVERED = {
    ...ROW,
    deliveredAt: new Date('2026-10-15T09:00:01.000Z'),
    recipients: ['admin@example.com'],
    channel: 'email',
};

// @requirement SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went
describe('a notice read back', () => {
    test('not yet delivered carries no delivery', () => {
        assert.equal(toSubscriptionNoticeRecord(ROW).delivery, null);
    });

    test('delivered carries to whom and how, and nobody where nobody was told', () => {
        assert.deepEqual(toSubscriptionNoticeRecord(DELIVERED).delivery, {
            recipients: ['admin@example.com'],
            channel: 'email',
        });
        assert.deepEqual(toSubscriptionNoticeRecord({ ...DELIVERED, recipients: [] }).delivery, {
            recipients: [],
            channel: 'email',
        });
    });

    test('of every kind the platform sends is read back as that kind', () => {
        for (const kind of ['version-offered', 'version-retired', 'version-retirement-reminder']) {
            assert.equal(toSubscriptionNoticeRecord({ ...ROW, kind }).kind, kind);
        }
    });

    test('of a kind the platform does not know is refused, naming the row', () => {
        assert.throws(
            () => toSubscriptionNoticeRecord({ ...ROW, kind: 'price-raised' }),
            /subscription_notices row 'n-1' holds kind 'price-raised'/,
        );
    });

    test('delivered without a readable delivery is refused, naming the row', () => {
        for (const broken of [
            { recipients: 'admin@example.com' },
            { recipients: [42] },
            { channel: null },
        ]) {
            assert.throws(
                () => toSubscriptionNoticeRecord({ ...DELIVERED, ...broken }),
                /subscription_notices row 'n-1' is delivered/,
            );
        }
    });
});
