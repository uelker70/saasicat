// What a tenant's users are told of an ended subscription: the last day the
// tenant can still read and the day its data is deleted on, every one of them;
// and whether they can take the export, its administrator alone and only where
// the route serves it — read-only, its end recorded, the export wired.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tenantAccessOf, tenantAccessViewOf } from '../dist/index.js';

const UTC = 'UTC';

let ids = 0;
const hold = (kind, reference = null) => ({
    id: `hold-${++ids}`,
    tenantId: 't-1',
    kind,
    reference,
    note: null,
    since: new Date('2026-11-01T09:00:00.000Z'),
    recordedBy: 'job:platform:subscription-ends',
    liftedAt: null,
    liftedBy: null,
});

const ENDED = () => hold('ended', 'sub-1');
const DAYS = new Map([['sub-1', '2026-12-31']]);

/** Asked by the tenant's administrator, the export wired and the end's day read. */
const ADMINISTRATOR = {
    timeZone: UTC,
    holdsBillingPermission: false,
    mayPay: false,
    isTenantAdministrator: true,
    exportWired: true,
    deletionDays: DAYS,
};

// @requirement SC-CANC-033 — An ended subscription's deletion day is shown to the tenant and to the operator
describe('an ended subscription names its days to every user', () => {
    test('the last day the tenant can read, and the day its data is deleted on', () => {
        const view = tenantAccessViewOf(tenantAccessOf([ENDED()]), {
            ...ADMINISTRATOR,
            isTenantAdministrator: false,
        });
        assert.deepEqual(
            view.reasons.map(({ kind, readOnlyUntil, deletesOn }) => [
                kind,
                readOnlyUntil,
                deletesOn,
            ]),
            [['ended', '2026-12-30', '2026-12-31']],
        );
    });

    test('the last day before a deletion on the first of a year is the last of the year before', () => {
        const view = tenantAccessViewOf(tenantAccessOf([ENDED()]), {
            ...ADMINISTRATOR,
            deletionDays: new Map([['sub-1', '2027-01-01']]),
        });
        assert.equal(view.reasons[0].readOnlyUntil, '2026-12-31');
    });

    test('every other reason names no days, even where a day is read under its reference', () => {
        const view = tenantAccessViewOf(
            tenantAccessOf([hold('overdue', 'sub-1'), hold('suspended'), hold('deleting')]),
            ADMINISTRATOR,
        );
        assert.deepEqual(
            view.reasons.map(({ readOnlyUntil, deletesOn }) => [readOnlyUntil, deletesOn]),
            [
                [null, null],
                [null, null],
                [null, null],
            ],
        );
    });

    test('an ended subscription whose end is not recorded yet names no days', () => {
        const view = tenantAccessViewOf(tenantAccessOf([ENDED()]), {
            ...ADMINISTRATOR,
            deletionDays: new Map(),
        });
        assert.deepEqual([view.reasons[0].readOnlyUntil, view.reasons[0].deletesOn], [null, null]);
    });
});

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe('the export is offered to the administrator only where the route serves it', () => {
    test('read-only for an ended subscription whose end is recorded, the export wired: offered', () => {
        assert.equal(tenantAccessViewOf(tenantAccessOf([ENDED()]), ADMINISTRATOR).mayExport, true);
    });

    test('to a user who is not the administrator: not offered', () => {
        const view = tenantAccessViewOf(tenantAccessOf([ENDED()]), {
            ...ADMINISTRATOR,
            isTenantAdministrator: false,
        });
        assert.equal(view.mayExport, false);
    });

    test('where the application wired no export: not offered', () => {
        const view = tenantAccessViewOf(tenantAccessOf([ENDED()]), {
            ...ADMINISTRATOR,
            exportWired: false,
        });
        assert.equal(view.mayExport, false);
    });

    test('while the end is not recorded yet: not offered', () => {
        const view = tenantAccessViewOf(tenantAccessOf([ENDED()]), {
            ...ADMINISTRATOR,
            deletionDays: new Map(),
        });
        assert.equal(view.mayExport, false);
    });

    test('a suspended tenant whose subscription ended: not offered', () => {
        const view = tenantAccessViewOf(
            tenantAccessOf([ENDED(), hold('suspended')]),
            ADMINISTRATOR,
        );
        assert.equal(view.state, 'suspended');
        assert.equal(view.mayExport, false);
    });

    test('a tenant being deleted whose subscription ended: not offered', () => {
        const view = tenantAccessViewOf(tenantAccessOf([ENDED(), hold('deleting')]), ADMINISTRATOR);
        assert.equal(view.mayExport, false);
    });

    test('read-only for an unpaid invoice alone: not offered', () => {
        const view = tenantAccessViewOf(tenantAccessOf([hold('overdue', 'inv-1')]), ADMINISTRATOR);
        assert.equal(view.state, 'read-only');
        assert.equal(view.mayExport, false);
    });

    test('an open tenant: not offered', () => {
        assert.equal(tenantAccessViewOf(tenantAccessOf([]), ADMINISTRATOR).mayExport, false);
    });

    test('asked without saying who asks, as an untyped caller may: not offered', () => {
        const { isTenantAdministrator: _unsaid, ...asked } = ADMINISTRATOR;
        assert.equal(tenantAccessViewOf(tenantAccessOf([ENDED()]), asked).mayExport, false);
    });
});
