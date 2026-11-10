// What the routes a tenant's users read its state from answer
// (`SC-ADM-054`): `GET billing/access` for every user, `GET
// billing/account/access` for whoever holds the billing permission. That both
// are let through in every state is the guard's, asked in
// `the-platforms-tenant-routes-check-the-access-state`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';

import { TenantAccessStateController, TenantInvoicesController } from '../dist/billing/index.js';
import { TenantAccessService } from '../dist/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';

const BERLIN = { timeZone: 'Europe/Berlin' };
const fromSession = () => 't-session';
/** A request naming another tenant than its session, which no route may follow. */
const REQUEST = { user: { tenantId: 't-elsewhere' } };
const COLLECTING = { payNow: async () => ({ paymentMethod: true, collected: 1 }) };

/** The session's tenant, overdue since 23:00 UTC on 15 November and suspended since the 17th. */
async function heldBack() {
    const store = new FakeTenantAccessHoldRepository();
    await store.record({
        tenantId: 't-session',
        kind: 'overdue',
        reference: 'invoice-1',
        note: null,
        since: new Date('2026-11-15T23:00:00.000Z'),
        recordedBy: 'run:overdue',
    });
    await store.record({
        tenantId: 't-session',
        kind: 'suspended',
        reference: null,
        note: 'Chargeback under review',
        since: new Date('2026-11-17T09:00:00.000Z'),
        recordedBy: 'web:ops@example.com:s1',
    });
    const access = new TenantAccessService(store, new Reflector());
    access.nameInvoicesFrom({
        invoicesNamed: async (ids) =>
            ids
                .filter((id) => id === 'invoice-1')
                .map((id) => ({ id, number: 'RE-2026-0042', subscriberId: 'subscriber-1' })),
    });
    return access;
}

// @requirement SC-ADM-054 — A tenant's users read why it is held back
describe("a tenant's users read why it is held back", () => {
    test("every user: the session's tenant, each reason from its day in the installation, no invoice by number", async () => {
        const controller = new TenantAccessStateController(BERLIN, fromSession, await heldBack());
        assert.deepEqual(await controller.state(REQUEST), {
            state: 'suspended',
            reasons: [
                { kind: 'overdue', since: '2026-11-16', invoiceNumber: null },
                { kind: 'suspended', since: '2026-11-17', invoiceNumber: null },
            ],
            holdsBillingPermission: false,
            mayPay: false,
        });
    });

    test('whoever holds the billing permission: the invoice by its number, and paying where it is collected', async () => {
        const controller = new TenantInvoicesController(
            {},
            fromSession,
            COLLECTING,
            BERLIN,
            await heldBack(),
        );
        const view = await controller.accessState(REQUEST);
        assert.deepEqual(
            view.reasons.map((reason) => [reason.kind, reason.invoiceNumber]),
            [
                ['overdue', 'RE-2026-0042'],
                ['suspended', null],
            ],
        );
        assert.equal(view.holdsBillingPermission, true);
        assert.equal(view.mayPay, true);
    });

    test('where nothing is collected through a gateway, the invoice is named and nothing can be paid', async () => {
        const controller = new TenantInvoicesController(
            {},
            fromSession,
            null,
            BERLIN,
            await heldBack(),
        );
        const view = await controller.accessState(REQUEST);
        assert.equal(view.reasons[0].invoiceNumber, 'RE-2026-0042');
        assert.equal(view.mayPay, false);
    });

    test("the day is UTC's where the installation names no zone", async () => {
        const controller = new TenantAccessStateController(null, fromSession, await heldBack());
        assert.equal((await controller.state(REQUEST)).reasons[0].since, '2026-11-15');
    });

    test('without the access service, as in a module wired by hand, the tenant is open', async () => {
        assert.deepEqual(
            await new TenantAccessStateController(BERLIN, fromSession, null).state(REQUEST),
            {
                state: 'open',
                reasons: [],
                holdsBillingPermission: false,
                mayPay: false,
            },
        );
        const view = await new TenantInvoicesController(
            {},
            fromSession,
            COLLECTING,
            BERLIN,
            null,
        ).accessState(REQUEST);
        assert.deepEqual(view, {
            state: 'open',
            reasons: [],
            holdsBillingPermission: true,
            mayPay: true,
        });
    });
});
