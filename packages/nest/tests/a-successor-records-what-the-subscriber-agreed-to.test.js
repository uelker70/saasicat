// What a successor records as agreed — the version of the operator's terms and
// the days of notice, and when the subscriber agreed to them — for each way it
// can be written: a change the subscriber makes now, one the operator or the
// platform writes without them, and one the subscriber scheduled earlier. A
// scheduled change gives way to an agreement the subscriber made after it,
// which they made for the whole contract.

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was
// @requirement SC-CANC-026 — A cancellation is judged by the notice period the subscriber agreed to

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { successorAgreement } from '../dist/subscription-contract/index.js';

const SCHEDULED_ON = new Date('2026-10-05T09:00:00.000Z');
const BOOKED_ON = new Date('2026-12-10T09:00:00.000Z');

/** What the file names now: the newest terms and their notice. */
const NAMED = {
    termsVersion: '2027-01',
    cancellationNoticeDays: 30,
    agreedAt: new Date('2027-01-01T00:00:00.000Z'),
};

/** What the subscriber agreed to when they scheduled the change. */
const SCHEDULED = { termsVersion: '2026-10', cancellationNoticeDays: 14, agreedAt: SCHEDULED_ON };

/** The contract in force, agreed at `agreedAt`, in `rhythm`. */
const inForce = ({ agreedAt, rhythm = 'monthly', termsVersion = '2026-07', days = 21 }) => ({
    id: 'c-1',
    termsVersion,
    cancellationNoticeDays: days,
    agreedAt,
    priceSnapshot: { billingCycle: rhythm },
});

/** The successor, in `rhythm`. */
const successor = (rhythm = 'monthly') => ({ priceSnapshot: { billingCycle: rhythm } });

describe('a change the subscriber makes now', () => {
    test('records what the file names now, whatever the contract it replaces recorded', () => {
        assert.deepEqual(
            successorAgreement(inForce({ agreedAt: BOOKED_ON }), successor(), undefined, NAMED),
            NAMED,
        );
    });
});

describe('a successor the operator or the platform writes', () => {
    test('keeps what the contract it replaces records, the moment it was agreed included', () => {
        assert.deepEqual(
            successorAgreement(inForce({ agreedAt: SCHEDULED_ON }), successor(), 'kept', NAMED),
            { termsVersion: '2026-07', cancellationNoticeDays: 21, agreedAt: SCHEDULED_ON },
        );
    });

    test('in either spelling of the same rhythm', () => {
        const kept = successorAgreement(
            inForce({ agreedAt: SCHEDULED_ON, rhythm: 'YEARLY' }),
            successor('yearly'),
            'kept',
            NAMED,
        );

        assert.equal(kept.cancellationNoticeDays, 21);
    });

    test('is refused in another rhythm, whose days of notice the contract does not hold', () => {
        assert.throws(
            () =>
                successorAgreement(
                    inForce({ agreedAt: SCHEDULED_ON }),
                    successor('yearly'),
                    'kept',
                    NAMED,
                ),
            /keeps what contract 'c-1' agreed stays in its rhythm, monthly, and this one is yearly/,
        );
    });

    test('with no contract to keep from, records what the file names', () => {
        assert.deepEqual(successorAgreement(null, successor(), 'kept', NAMED), NAMED);
    });
});

describe('a change the subscriber scheduled, written when it takes effect', () => {
    test('records what they agreed to then, though the file names newer since', () => {
        assert.deepEqual(
            successorAgreement(
                inForce({ agreedAt: new Date('2026-07-01T00:00:00.000Z') }),
                successor(),
                SCHEDULED,
                NAMED,
            ),
            SCHEDULED,
        );
    });

    test('and so where the contract in force was agreed at the same moment', () => {
        assert.deepEqual(
            successorAgreement(inForce({ agreedAt: SCHEDULED_ON }), successor(), SCHEDULED, NAMED),
            SCHEDULED,
        );
    });

    test('gives way to newer terms the subscriber agreed to since, with their notice', () => {
        assert.deepEqual(
            successorAgreement(
                inForce({ agreedAt: BOOKED_ON, termsVersion: '2027-01', days: 30 }),
                successor(),
                SCHEDULED,
                NAMED,
            ),
            { termsVersion: '2027-01', cancellationNoticeDays: 30, agreedAt: BOOKED_ON },
        );
    });

    test('and, where the change moves the rhythm, to the newer terms with the notice of the rhythm it was scheduled in', () => {
        assert.deepEqual(
            successorAgreement(
                inForce({ agreedAt: BOOKED_ON, termsVersion: '2027-01', days: 30 }),
                successor('yearly'),
                { ...SCHEDULED, cancellationNoticeDays: 90 },
                NAMED,
            ),
            { termsVersion: '2027-01', cancellationNoticeDays: 90, agreedAt: BOOKED_ON },
        );
    });

    test('with no contract in force, records what they agreed to then', () => {
        assert.deepEqual(successorAgreement(null, successor(), SCHEDULED, NAMED), SCHEDULED);
    });
});
