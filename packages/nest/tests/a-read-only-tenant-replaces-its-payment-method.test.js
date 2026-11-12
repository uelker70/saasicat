// Read-only lets a payment be started: while one of the subscriber's invoices
// is open, a user of the tenant can still replace the payment method
// (`SC-ADM-055`, `SC-PRIC-098`). A suspension and a deletion under way have no
// such exception, and whether the user may change the payment method at all
// is still the billing permission's.
//
// The exception is decided where every tenant request is checked —
// `TenantAccessService` —, so the application's own guard, which checks first
// on the same handler, lets the request through as the platform's does. The
// handler is the platform's own route, with the mark it carries.

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
    BillingPermissionGuard,
    TenantInvoicesController,
    ComposedTenantAuthGuard,
    TENANT_ACCESS_HOLDS_TOKEN,
    TenantAccessService,
    TenantInvoiceService,
} from '../dist/index.js';
import { TenantPaymentMethodController } from '../dist/payments/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';
import {
    FIRST_RUN,
    ISSUED,
    aCollectingInstallation,
    clockFrom,
    quietLog,
} from './helpers/invoice-collection.js';
import { invoicingPlatform, started } from './helpers/invoicing-platform.js';
import { succeeded } from './helpers/money-events.js';

const SINCE = new Date('2026-03-02T00:00:00.000Z');

/** Holds `tenantId` back for `kind`. */
const held = (store, tenantId, kind) =>
    store.record({
        tenantId,
        kind,
        reference: kind === 'suspended' ? null : `${kind}-1`,
        note: null,
        since: SINCE,
        recordedBy: 'job:platform:overdue-invoices',
    });

/** A source that answers `open` and counts how often it is asked. */
function invoicesThatAre(open) {
    const source = {
        asked: 0,
        async hasOpenInvoice() {
            source.asked += 1;
            return open;
        },
    };
    return source;
}

/** The access check over `store`, answered by `source` where there is one. */
function accessWith(store, source) {
    const access = new TenantAccessService(store, new Reflector());
    if (source) access.answerOpenInvoicesFrom(source);
    return access;
}

/** A request of `tenantId`'s user to `handler` of `controller`. */
function contextFor(controller, handler, method) {
    const request = { method, user: { tenantId: 't1' }, headers: {} };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => controller.prototype[handler],
        getClass: () => controller,
    };
}

const replacing = () => contextFor(TenantPaymentMethodController, 'startSetup', 'POST');
const payingNow = () => contextFor(TenantInvoicesController, 'pay', 'POST');
const reading = () => contextFor(TenantPaymentMethodController, 'current', 'GET');

/** Another write of the tenant's, without a mark. */
class Notes {
    create() {}
}
const writing = () => contextFor(Notes, 'create', 'POST');

const refusedWith = (code) => (error) =>
    error instanceof ForbiddenException && error.getResponse().code === code;

describe('a read-only tenant replacing its payment method', () => {
    test('is let through while one of its invoices is open', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'overdue');
        const source = invoicesThatAre(true);

        await accessWith(store, source).enforce(replacing(), 't1');

        assert.equal(source.asked, 1);
    });

    test('pays now as it replaces the payment method: let through while an invoice is open', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'overdue');
        await accessWith(store, invoicesThatAre(true)).enforce(payingNow(), 't1');
        await assert.rejects(
            accessWith(store, invoicesThatAre(false)).enforce(payingNow(), 't1'),
            refusedWith('TENANT_READ_ONLY'),
        );
    });

    test('is refused once none is open', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'ended');
        await assert.rejects(
            accessWith(store, invoicesThatAre(false)).enforce(replacing(), 't1'),
            refusedWith('TENANT_READ_ONLY'),
        );
    });

    test('is refused where nothing can say whether an invoice is open: no invoices are issued', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'ended');
        await assert.rejects(
            accessWith(store, null).enforce(replacing(), 't1'),
            refusedWith('TENANT_READ_ONLY'),
        );
    });

    test('writes nothing else: another write is refused, invoice open or not', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'overdue');
        const source = invoicesThatAre(true);
        await assert.rejects(
            accessWith(store, source).enforce(writing(), 't1'),
            refusedWith('TENANT_READ_ONLY'),
        );
        assert.equal(source.asked, 0, 'the invoices are asked only for the payment method');
    });

    test('reads its payment method as any read, without asking about invoices', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'overdue');
        const source = invoicesThatAre(false);
        await accessWith(store, source).enforce(reading(), 't1');
        assert.equal(source.asked, 0);
    });

    test('asked without a request, as a scheduled job asks, follows the same rule', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'overdue');
        const access = accessWith(store, invoicesThatAre(true));
        await access.assertAllowed('t1', { writes: true, startsPayment: true });
        await assert.rejects(
            access.assertAllowed('t1', { writes: true }),
            refusedWith('TENANT_READ_ONLY'),
        );
    });
});

describe('the exception is read-only’s alone', () => {
    for (const [kind, code] of [
        ['suspended', 'TENANT_SUSPENDED'],
        ['deleting', 'TENANT_BEING_DELETED'],
    ]) {
        test(`a tenant ${kind === 'suspended' ? 'suspended' : 'being deleted'} is refused, an invoice open or not`, async () => {
            const store = new FakeTenantAccessHoldRepository();
            await held(store, 't1', kind);
            await held(store, 't1', 'overdue');
            await assert.rejects(
                accessWith(store, invoicesThatAre(true)).enforce(replacing(), 't1'),
                refusedWith(code),
            );
        });
    }

    test('an open tenant replaces it without the invoices being asked', async () => {
        const source = invoicesThatAre(false);
        await accessWith(new FakeTenantAccessHoldRepository(), source).enforce(replacing(), 't1');
        assert.equal(source.asked, 0);
    });
});

describe('where the request is checked', () => {
    test('the platform’s route carries the mark, and stays behind the billing permission', () => {
        const guards = Reflect.getMetadata('__guards__', TenantPaymentMethodController) ?? [];
        assert.deepEqual(guards, [ComposedTenantAuthGuard, BillingPermissionGuard]);
    });

    test('the application’s guard, checking first on the same handler, lets it through as the platform does', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'overdue');
        const access = accessWith(store, invoicesThatAre(true));
        const application = {
            canActivate: async (context) => {
                await access.enforce(context, 't1');
                return true;
            },
        };
        const guard = new ComposedTenantAuthGuard([application], access, null);

        assert.equal(await guard.canActivate(replacing()), true);
        await assert.rejects(guard.canActivate(writing()), refusedWith('TENANT_READ_ONLY'));
    });
});

describe('the platform as it starts', () => {
    /** The platform with invoices, its reasons kept in memory, `t1` held back by an overdue invoice. */
    async function startedReadOnly() {
        const options = invoicingPlatform();
        const store = new FakeTenantAccessHoldRepository();
        options.persistence.core.tenantAccessHolds = store;
        const moduleRef = await started(options);
        await moduleRef.get(TENANT_ACCESS_HOLDS_TOKEN, { strict: false }).record({
            tenantId: 't1',
            kind: 'overdue',
            reference: 'inv-1',
            note: null,
            since: SINCE,
            recordedBy: 'job:platform:overdue-invoices',
        });
        return { moduleRef, access: moduleRef.get(TenantAccessService, { strict: false }) };
    }

    for (const open of [true, false]) {
        test(`asks the tenant’s invoices, which ${open ? 'let it through while one is open' : 'refuse it where none is'}`, async (t) => {
            const asked = [];
            t.mock.method(TenantInvoiceService.prototype, 'hasOpenInvoice', async (tenantId) => {
                asked.push(tenantId);
                return open;
            });
            const { moduleRef, access } = await startedReadOnly();
            try {
                const attempt = access.assertAllowed('t1', {
                    writes: true,
                    startsPayment: true,
                });
                if (open) await attempt;
                else await assert.rejects(attempt, refusedWith('TENANT_READ_ONLY'));
                assert.deepEqual(asked, ['t1']);
            } finally {
                await moduleRef.close();
            }
        });
    }

    // @requirement SC-ADM-053 — The operator sees every reason a tenant is held back for
    test('asks the tenant’s invoices what an invoice a reason names is called', async (t) => {
        t.mock.method(TenantInvoiceService.prototype, 'invoicesNamed', async (ids) =>
            ids.map((id) => ({ id, number: `N-${id}`, subscriberId: 's1' })),
        );
        const { moduleRef, access } = await startedReadOnly();
        try {
            assert.deepEqual(await access.invoicesNamed(['invoice-1']), [
                { id: 'invoice-1', number: 'N-invoice-1', subscriberId: 's1' },
            ]);
        } finally {
            await moduleRef.close();
        }
    });
});

describe('an invoice is open for the exception', () => {
    clockFrom(FIRST_RUN);

    /** The tenant's list of invoices over a collecting installation, as the platform reads it. */
    const invoicesOf = (installation) =>
        new TenantInvoiceService(
            installation.subscribers,
            installation.store,
            installation.documents,
            installation.payments,
            null,
            null,
            installation.settings,
        );

    /** `t1`'s February invoice, collected with what the gateway answers. */
    async function collectedWith(answer) {
        const installation = aCollectingInstallation();
        const { subscriber } = await installation.aPayingSubscriber('t1', 'card');
        const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
        installation.gateway.answers.push(answer(invoice));
        await installation.collect(FIRST_RUN);
        return { installation, invoice };
    }

    test('where it was refused, and where it was paid in part', async () => {
        quietLog();
        const refused = await collectedWith(() => ({
            status: 'failed',
            paymentRef: 'pi_stolen',
            reason: 'payment-method-unusable',
            gatewayCode: 'stolen_card',
        }));
        const inPart = await collectedWith((invoice) =>
            succeeded(invoice, 'pi_part', invoice.totalGross / 2),
        );
        assert.equal(await invoicesOf(refused.installation).hasOpenInvoice('t1'), true);
        assert.equal(await invoicesOf(inPart.installation).hasOpenInvoice('t1'), true);
    });

    test('not where it was paid, nor for a tenant without a subscriber', async () => {
        quietLog();
        const { installation } = await collectedWith((invoice) =>
            succeeded(invoice, 'pi_1', invoice.totalGross),
        );
        assert.equal(await invoicesOf(installation).hasOpenInvoice('t1'), false);
        assert.equal(await invoicesOf(installation).hasOpenInvoice('t-unknown'), false);
    });
});
