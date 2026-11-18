// An audit entry names the tenant it concerns, so that the application's data
// eraser finds the entries of a tenant it deletes (`SC-PRIV-022`): an entry
// names the tenant where somebody acts in it, or where what it runs on
// changes, and none where the operator or a run acts on the subscriber's
// commercial record, which outlives the tenant.
//
// One representative case per kind of act. The audit log is recorded where
// the platform hands an entry over, so a case reads what the platform wrote
// rather than what an adapter made of it; that each shipped adapter keeps the
// tenant it is handed is the persistence contract's to prove.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';

import { AdminAuditService } from '../dist/admin/index.js';
import { TenantExportDeliveryService } from '../dist/billing/index.js';
import { TenantAccessService } from '../dist/index.js';
import { buildPromoCodeAdminController } from '../dist/promo/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';
import {
    FIRST_RUN,
    ISSUED,
    aCollectingInstallation,
    clockAt,
    clockFrom,
    paymentMethodOf,
    quietLog,
} from './helpers/invoice-collection.js';

const ACTOR = { userId: 'u-1', email: 'admin@t1.example', source: 'web', context: 's-1' };

/** Records what the platform hands the audit log, as an `AdminAuditService` would. */
function auditLog() {
    const entries = [];
    return { entries, log: async (entry) => entries.push(entry) };
}

const COLLECTION_ACTION = 'SUBSCRIPTION_INVOICE_COLLECTION_';

// @requirement SC-AUD-021 — An audit entry names the tenant it concerns, so the tenant's deletion takes it along
describe('an audit entry names the tenant it concerns', () => {
    test('the audit service hands the tenant to the log, and names none where it was given none', async () => {
        const written = [];
        const service = new AdminAuditService({ write: async (entry) => written.push(entry) });

        await service.log({
            actor: ACTOR,
            entity: 'Subscription',
            entityId: 't1',
            action: 'CHANGE_PLAN',
            tenantId: 't1',
        });
        await service.log({
            actor: ACTOR,
            entity: 'PromoCode',
            entityId: 'promo-1',
            action: 'PROMO_CODE_CREATE',
        });

        assert.equal(written[0].tenantId, 't1');
        assert.equal(written[1].tenantId, undefined);
    });

    test('a download the application delivered names its tenant, although it is recorded across tenants', async () => {
        const holds = new FakeTenantAccessHoldRepository();
        const ends = new FakeSubscriptionEndRepository();
        const endsAt = new Date('2026-11-30T23:00:00.000Z');
        await holds.record({
            tenantId: 't1',
            kind: 'ended',
            reference: 'sub-t1',
            note: null,
            since: endsAt,
            recordedBy: 'job:platform:subscription-ends',
        });
        await ends.record({
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            endsAt,
            deletesOn: '2026-12-31',
            recordedAt: endsAt,
            recordedBy: 'job:platform:subscription-ends',
        });
        // A frame across tenants carries no tenant of its own: what names the
        // tenant is what the platform hands over, not the frame it writes in.
        let across = 0;
        const rlsBypass = {
            runWithBypass: async (work) => {
                across += 1;
                return work();
            },
        };
        const audit = auditLog();
        const delivery = new TenantExportDeliveryService(
            ends,
            new TenantAccessService(holds, new Reflector()),
            rlsBypass,
            audit,
        );
        delivery.onModuleInit();

        await delivery.recordDelivered(
            {
                method: 'GET',
                user: {
                    tenantId: 't1',
                    sub: 'u-1',
                    email: 'admin@t1.example',
                    role: 'TENANT_ADMIN',
                },
                headers: { 'x-session-id': 's-1' },
            },
            { size: 1024, mediaType: 'application/zip' },
            new Date('2026-12-05T10:00:00.000Z'),
        );

        assert.ok(across > 0, 'the premise: the download is recorded across tenants');
        assert.deepEqual(
            audit.entries.map((entry) => [entry.action, entry.tenantId]),
            [['TENANT_EXPORT_DOWNLOAD', 't1']],
        );
    });

    test("an operator's act on a promotional code names no tenant", async () => {
        const audit = auditLog();
        const Controller = buildPromoCodeAdminController([]);
        const operator = { userId: 'admin-1', email: 'admin@example.com', source: 'web' };
        const controller = new Controller(
            { create: async (data) => ({ id: 'promo-1', code: data.code }) },
            audit,
            { actorFromRequest: () => ({ ...operator, context: 'session-1' }) },
        );

        await controller.create(
            { user: { id: 'admin-1', email: 'admin@example.com' } },
            {
                code: 'WELCOME',
                valueType: 'PERCENT',
                value: 10,
                durationType: 'ONCE',
                validUntil: '2026-12-31T00:00:00.000Z',
            },
        );

        assert.equal(audit.entries.length, 1, 'the premise: the act is audited');
        assert.equal(audit.entries[0].tenantId, undefined);
    });

    describe('collecting what a subscriber owes', () => {
        clockFrom(FIRST_RUN);

        /** `t1` owing its February invoice, after a first run whose card had no funds. */
        async function aTenantOwing() {
            quietLog();
            const installation = aCollectingInstallation();
            const { subscriber } = await installation.aPayingSubscriber('t1', 'card');
            await installation.anInvoiceMailed(subscriber.id, ISSUED);
            installation.gateway.answers.push({
                status: 'failed',
                paymentRef: 'pi_short',
                reason: 'insufficient-funds',
                gatewayCode: 'insufficient_funds',
            });
            await installation.collect(FIRST_RUN);
            return { ...installation, subscriber };
        }

        test('the run names no tenant on what it plans and tries', async () => {
            const { audits } = await aTenantOwing();

            const collecting = audits.filter((entry) => entry.action.startsWith(COLLECTION_ACTION));
            assert.ok(collecting.length > 0, 'the premise: the run audits its collection');
            assert.deepEqual(
                collecting.filter((entry) => entry.tenantId !== undefined),
                [],
            );
        });

        test("a tenant's user paying now names the tenant on each step of the collection it starts", async () => {
            const { audits, collection } = await aTenantOwing();
            const before = audits.length;

            const started = await collection.payNow(
                't1',
                clockAt(new Date('2026-02-01T23:00:00.000Z')),
            );

            assert.equal(started.collected, 1, 'the premise: the payment went through');
            const collecting = audits
                .slice(before)
                .filter((entry) => entry.action.startsWith(COLLECTION_ACTION));
            assert.deepEqual(
                collecting.map((entry) => [entry.action, entry.tenantId]),
                [
                    ['SUBSCRIPTION_INVOICE_COLLECTION_WITHDRAWN', 't1'],
                    ['SUBSCRIPTION_INVOICE_COLLECTION_PLANNED', 't1'],
                ],
            );
        });

        test("a tenant's user paying now by direct debit names the tenant on its announcement", async () => {
            const { audits, collection, paymentMethods, subscriber } = await aTenantOwing();
            const now = new Date('2026-02-01T23:00:00.000Z');
            await paymentMethods.recordConfirmed(
                paymentMethodOf(subscriber.id, 'sepa_debit', {
                    paymentMethodRef: 'pm_sepa_new',
                    confirmedAt: now,
                }),
            );
            const before = audits.length;

            const started = await collection.payNow('t1', clockAt(now));

            assert.equal(started.announced, 1, 'the premise: the direct debit is announced');
            assert.deepEqual(
                audits
                    .slice(before)
                    .filter((entry) => entry.action.startsWith(COLLECTION_ACTION))
                    .map((entry) => [entry.action, entry.tenantId]),
                [
                    ['SUBSCRIPTION_INVOICE_COLLECTION_WITHDRAWN', 't1'],
                    ['SUBSCRIPTION_INVOICE_COLLECTION_PLANNED', 't1'],
                    ['SUBSCRIPTION_INVOICE_COLLECTION_ANNOUNCED', 't1'],
                ],
            );
        });

        test('the payment it brings is recorded with the subscriber, and names no tenant', async () => {
            const { audits, collection } = await aTenantOwing();
            const before = audits.length;

            await collection.payNow('t1', clockAt(new Date('2026-02-01T23:00:00.000Z')));

            const recorded = audits
                .slice(before)
                .filter((entry) => entry.action === 'SUBSCRIPTION_INVOICE_PAYMENT_RECORDED');
            assert.equal(recorded.length, 1, 'the premise: the payment is audited');
            assert.equal(recorded[0].tenantId, undefined);
        });
    });
});
