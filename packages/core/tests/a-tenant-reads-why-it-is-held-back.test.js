// What a tenant's own users are told of its state: what holds it back and from
// which day in the installation, the invoice by its number only to a user who
// holds the billing permission, and nothing of the operator's.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tenantAccessOf, tenantAccessViewOf } from '../dist/index.js';

const BERLIN = 'Europe/Berlin';
const EVERY_USER = { timeZone: BERLIN, holdsBillingPermission: false, mayPay: false };
const BILLING = { timeZone: BERLIN, holdsBillingPermission: true, mayPay: true };

let ids = 0;
const hold = (kind, since, overrides = {}) => ({
    id: `hold-${++ids}`,
    tenantId: 't-1',
    kind,
    reference: kind === 'suspended' ? null : `ref-${ids}`,
    note: kind === 'suspended' ? 'Chargeback under review' : null,
    since,
    recordedBy: 'web:ops@example.com:s1',
    liftedAt: null,
    liftedBy: null,
    ...overrides,
});

// @requirement SC-ADM-054 — A tenant's users read why it is held back
describe("a tenant's users read why it is held back", () => {
    test('nothing where the tenant is open', () => {
        assert.deepEqual(tenantAccessViewOf(tenantAccessOf([]), EVERY_USER), {
            state: 'open',
            reasons: [],
            holdsBillingPermission: false,
            mayPay: false,
            mayExport: false,
        });
    });

    test('every reason, the oldest first, each from its day in the installation and nothing more', () => {
        const suspended = hold('suspended', new Date('2026-11-04T10:00:00.000Z'));
        // 23:00 UTC on 15 November is already the 16th in Berlin.
        const overdue = hold('overdue', new Date('2026-11-15T23:00:00.000Z'), {
            reference: 'inv-1',
        });
        const ended = hold('ended', new Date('2026-11-01T09:00:00.000Z'));
        const view = tenantAccessViewOf(tenantAccessOf([suspended, overdue, ended]), EVERY_USER);
        assert.equal(view.state, 'suspended');
        const NO_DAYS = { readOnlyUntil: null, deletesOn: null };
        assert.deepEqual(view.reasons, [
            { kind: 'ended', since: '2026-11-01', invoiceNumber: null, ...NO_DAYS },
            { kind: 'suspended', since: '2026-11-04', invoiceNumber: null, ...NO_DAYS },
            { kind: 'overdue', since: '2026-11-16', invoiceNumber: null, ...NO_DAYS },
        ]);
    });

    test('the invoice by its number where the numbers are handed over, and only an overdue one', () => {
        const overdue = hold('overdue', new Date('2026-11-16T08:00:00.000Z'), {
            reference: 'inv-1',
        });
        // An ended subscription's reference is the subscription: a number
        // under the same id is never read as its invoice.
        const ended = hold('ended', new Date('2026-11-17T08:00:00.000Z'), {
            reference: 'sub-1',
        });
        const view = tenantAccessViewOf(tenantAccessOf([overdue, ended]), {
            ...BILLING,
            invoiceNumbers: new Map([
                ['inv-1', 'RE-2026-0042'],
                ['sub-1', 'RE-2026-0043'],
            ]),
        });
        assert.deepEqual(
            view.reasons.map((reason) => reason.invoiceNumber),
            ['RE-2026-0042', null],
        );
        assert.equal(view.mayPay, true);
    });

    test('a user without the billing permission is told no number, and cannot pay, whatever is handed over', () => {
        const overdue = hold('overdue', new Date('2026-11-16T08:00:00.000Z'), {
            reference: 'inv-1',
        });
        const view = tenantAccessViewOf(tenantAccessOf([overdue]), {
            ...EVERY_USER,
            mayPay: true,
            invoiceNumbers: new Map([['inv-1', 'RE-2026-0042']]),
        });
        assert.equal(view.reasons[0].invoiceNumber, null);
        assert.equal(view.mayPay, false);
    });

    test('an invoice the numbers do not name is named as none, and the reason stays', () => {
        const overdue = hold('overdue', new Date('2026-11-16T08:00:00.000Z'));
        const view = tenantAccessViewOf(tenantAccessOf([overdue]), {
            ...BILLING,
            invoiceNumbers: new Map(),
        });
        assert.deepEqual(view.reasons, [
            {
                kind: 'overdue',
                since: '2026-11-16',
                invoiceNumber: null,
                readOnlyUntil: null,
                deletesOn: null,
            },
        ]);
    });
});
