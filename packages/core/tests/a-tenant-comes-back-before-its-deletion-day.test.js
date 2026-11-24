// A tenant whose subscription ended comes back by taking out a new one, until
// the day its end names for its deletion. Whether it may is decided once, by a
// pure rule the access check, the tenant's view and the service that writes
// the return all read: a deletion that has begun refuses it before anything
// else, a suspension next, then a tenant with no recorded end to come back
// from, and last the day in the installation's zone. An invoice still overdue
// does not refuse it — it keeps the tenant read-only after it came back.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    downloadBelongsToEnd,
    openEndedHoldOf,
    subscriptionReturnRefusal,
    tenantAccessOf,
    tenantAccessViewOf,
} from '../dist/index.js';

const ZONE = 'Europe/Berlin';
const DELETES_ON = '2026-10-30';
/** The last moment of 29 October in Berlin, and the first of the deletion day. */
const LAST_MOMENT_BEFORE = new Date('2026-10-29T22:59:59.999Z');
const FIRST_MOMENT_OF_THE_DAY = new Date('2026-10-29T23:00:00.000Z');
const IN_THE_PERIOD = new Date('2026-10-20T08:00:00.000Z');

let ids = 0;
const hold = (kind, overrides = {}) => ({
    id: `hold-${++ids}`,
    tenantId: 't-1',
    kind,
    reference: kind === 'ended' ? 'sub-1' : kind === 'suspended' ? null : `ref-${ids}`,
    note: null,
    since: new Date('2026-09-30T22:00:00.000Z'),
    recordedBy: 'job:platform:subscription-ends',
    liftedAt: null,
    liftedBy: null,
    ...overrides,
});
const END = { deletesOn: DELETES_ON };

const refusal = (holds, { end = END, now = IN_THE_PERIOD } = {}) =>
    subscriptionReturnRefusal({ holds, end, now, timeZone: ZONE });

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('whether a tenant whose subscription ended can come back', () => {
    test('in its read-only period it can', () => {
        assert.equal(refusal([hold('ended')]), null);
    });

    test("until the last moment before its deletion day, in the installation's zone", () => {
        assert.equal(refusal([hold('ended')], { now: LAST_MOMENT_BEFORE }), null);
    });

    test('from the first moment of its deletion day on, it cannot', () => {
        assert.equal(
            refusal([hold('ended')], { now: FIRST_MOMENT_OF_THE_DAY }),
            'deletion-day-reached',
        );
        assert.equal(
            refusal([hold('ended')], { now: new Date('2026-12-01T12:00:00.000Z') }),
            'deletion-day-reached',
        );
    });

    test('once its deletion has begun it cannot, even before the day', () => {
        assert.equal(refusal([hold('ended'), hold('deleting')]), 'deletion-begun');
        assert.equal(
            refusal([hold('ended'), hold('deleting'), hold('suspended')], {
                now: FIRST_MOMENT_OF_THE_DAY,
            }),
            'deletion-begun',
        );
    });

    test('a suspended tenant cannot, whatever else holds: the operator lifts a suspension', () => {
        assert.equal(refusal([hold('ended'), hold('suspended')]), 'suspended');
        assert.equal(
            refusal([hold('ended'), hold('suspended')], { now: FIRST_MOMENT_OF_THE_DAY }),
            'suspended',
        );
        assert.equal(refusal([hold('suspended')], { end: null }), 'suspended');
    });

    test('a tenant whose subscription did not end has nothing to come back from', () => {
        assert.equal(refusal([], { end: null }), 'not-ended');
        assert.equal(refusal([hold('overdue')], { end: null }), 'not-ended');
    });

    test('nor has one whose end was lifted already — it came back before', () => {
        const lifted = hold('ended', {
            liftedAt: new Date('2026-10-20T08:00:00.000Z'),
            liftedBy: 'web:admin@weber.example:app',
        });
        assert.equal(refusal([lifted]), 'not-ended');
    });

    test('nor one whose end is not recorded yet', () => {
        assert.equal(refusal([hold('ended')], { end: null }), 'not-ended');
    });

    test('an invoice still overdue does not keep it from coming back', () => {
        assert.equal(refusal([hold('ended'), hold('overdue')]), null);
    });

    test('a suspension the operator lifted holds it back no longer', () => {
        const reactivated = hold('suspended', {
            liftedAt: new Date('2026-10-15T09:00:00.000Z'),
            liftedBy: 'web:ops@provider.example:admin',
        });
        assert.equal(refusal([hold('ended'), reactivated]), null);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('the reason a return lifts', () => {
    test('of a tenant that came back once and ended again, is the open one', () => {
        const first = hold('ended', {
            liftedAt: new Date('2026-10-20T08:00:00.000Z'),
            liftedBy: 'web:admin@weber.example:app',
        });
        const second = hold('ended');
        assert.equal(openEndedHoldOf([first, second]), second);
        assert.equal(openEndedHoldOf([first]), null);
    });
});

/** Asked by the tenant's administrator, who may take out a subscription. */
const ADMINISTRATOR = {
    timeZone: ZONE,
    now: IN_THE_PERIOD,
    holdsBillingPermission: true,
    mayPay: true,
    isTenantAdministrator: true,
    mayTakeOutSubscription: true,
    exportWired: true,
    deletionDays: new Map([['sub-1', DELETES_ON]]),
};
const mayReturn = (holds, asked = {}) =>
    tenantAccessViewOf(tenantAccessOf(holds), { ...ADMINISTRATOR, ...asked }).mayReturn;

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('whether its view offers the tenant to come back', () => {
    test('to whoever may take out a subscription, while the rule lets it', () => {
        assert.equal(mayReturn([hold('ended')]), true);
        assert.equal(mayReturn([hold('ended'), hold('overdue')]), true);
    });

    test('to nobody else of the tenant', () => {
        assert.equal(mayReturn([hold('ended')], { mayTakeOutSubscription: false }), false);
        assert.equal(mayReturn([hold('ended')], { mayTakeOutSubscription: undefined }), false);
    });

    test('nowhere the rule refuses it', () => {
        assert.equal(mayReturn([hold('ended')], { now: FIRST_MOMENT_OF_THE_DAY }), false);
        assert.equal(mayReturn([hold('ended'), hold('suspended')]), false);
        assert.equal(mayReturn([hold('ended'), hold('deleting')]), false);
        assert.equal(mayReturn([]), false);
        assert.equal(mayReturn([hold('ended')], { deletionDays: new Map() }), false);
    });
});

const RECORDED_AT = new Date('2027-03-31T22:05:00.000Z');

// @requirement SC-PRIV-024 — A tenant is deleted only after its full export was offered in the read-only period
describe('a download of the export belongs to the end it was offered for', () => {
    const download = (downloadedAt) => ({ downloadedAt });

    test('taken the moment the end was recorded, it is that end’s', () => {
        assert.equal(
            downloadBelongsToEnd(download(RECORDED_AT), { recordedAt: RECORDED_AT }),
            true,
        );
    });

    test('taken a moment before, it is not: an earlier end of the subscription offered it', () => {
        const before = new Date(RECORDED_AT.getTime() - 1);
        assert.equal(downloadBelongsToEnd(download(before), { recordedAt: RECORDED_AT }), false);
    });
});
