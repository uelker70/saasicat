// A tenant whose subscription ended comes back before its deletion day with a
// new subscription on the same row, at the catalogue's current terms
// (`SC-CANC-034`). The new subscription, its contract, and the lift of the end
// and of the reason it put the tenant in are written in one transaction, which
// first locks that reason: a deletion that begins beside the return locks the
// same one, so exactly one of the two acts on it.
//
// Fahrschule Weber's subscription ended on 30 September, its data is deleted
// on 30 October, Berlin time. The subscription, its subscriber and its payment
// method are stood in for; the contract is composed and written by the
// platform's own services, over the in-memory stores a deletion runs on
// (`helpers/subscription-return.js`).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';

import { TenantDataExportService } from '../dist/billing/index.js';
import { TenantAccessService } from '../dist/index.js';
import {
    ADMIN,
    ADMIN_TAG,
    DELETES_ON,
    DELETION_DAY,
    ENDED,
    LAST_MOMENT,
    RETURN_AT,
    SUBSCRIPTION,
    TENANT,
    V2,
    V3,
    aBarrier,
    aTenantThatEnded,
    contractsOf,
    endsOf,
    reasonsOf,
    untilItWaitsOrEnds,
} from './helpers/subscription-return.js';
import { RUN, contracted } from './helpers/tenant-deletion.js';

const STANDARD_MONTHLY = { plan: 'STANDARD', billingCycle: 'MONTHLY' };

/** One month on from the return: the first period of the new subscription. */
const FIRST_PERIOD_ENDS = new Date('2026-11-20T08:00:00.000Z');

const refusedWith = (code) => (error) => error.response?.code === code;

/** What the stores hold of the tenant, to show a refused return wrote nothing. */
async function whatIsKept(tenant) {
    return {
        subscription: { ...tenant.subscription.row },
        reasons: structuredClone(reasonsOf(tenant)),
        ends: structuredClone(endsOf(tenant)),
        contracts: (await contractsOf(tenant)).length,
        bookings: structuredClone(await tenant.bookings.listBySubscription(SUBSCRIPTION)),
    };
}

/** Asserts that `attempt` is refused with `code`, and that the stores hold what they held before. */
async function refusedWritingNothing(tenant, attempt, code) {
    const before = await whatIsKept(tenant);
    await assert.rejects(attempt, refusedWith(code));
    assert.deepEqual(await whatIsKept(tenant), before);
    assert.deepEqual(tenant.calls.audited, []);
}

/** Holds `tenantId` back with an open reason of `kind`. */
const heldBy = (tenant, kind, since = ENDED) =>
    tenant.holds.record({
        tenantId: TENANT,
        kind,
        reference: kind === 'overdue' ? 'invoice-2026-09' : SUBSCRIPTION,
        note: null,
        since,
        recordedBy: kind === 'suspended' ? 'cli:ops' : RUN,
    });

const accessOver = (tenant) => new TenantAccessService(tenant.holds, new Reflector());

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('a tenant that comes back before its deletion day', () => {
    test('on 20 October: the end and its reason lifted, the subscription running on the version on sale, its contract in force from then', async () => {
        const tenant = await aTenantThatEnded();

        const returned = await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        assert.deepEqual(returned, {
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            planVersionId: V3.id,
            periodStart: RETURN_AT,
            periodEnd: FIRST_PERIOD_ENDS,
        });
        const row = tenant.subscription.row;
        assert.deepEqual(
            {
                status: row.status,
                plan: row.plan,
                billingCycle: row.billingCycle,
                planVersionId: row.planVersionId,
                currentPeriodStart: row.currentPeriodStart,
                currentPeriodEnd: row.currentPeriodEnd,
                canceledAt: row.canceledAt,
                canceledEffectiveAt: row.canceledEffectiveAt,
            },
            {
                status: 'ACTIVE',
                plan: 'STANDARD',
                billingCycle: 'MONTHLY',
                planVersionId: V3.id,
                currentPeriodStart: RETURN_AT,
                currentPeriodEnd: FIRST_PERIOD_ENDS,
                canceledAt: null,
                canceledEffectiveAt: null,
            },
        );
        const [reason] = reasonsOf(tenant);
        assert.equal(reason.kind, 'ended');
        assert.deepEqual([reason.liftedAt, reason.liftedBy], [RETURN_AT, ADMIN_TAG]);
        const [end] = endsOf(tenant);
        // The end is lifted, and names nobody it did not name before.
        assert.deepEqual(
            { liftedAt: end.liftedAt, recordedBy: end.recordedBy },
            { liftedAt: RETURN_AT, recordedBy: RUN },
        );
        assert.equal((await accessOver(tenant).accessOf(TENANT)).state, 'open');
    });

    test('its contract is the catalogue of today, priced and granting what the version on sale does', async () => {
        const tenant = await aTenantThatEnded();

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        const [contract] = await contractsOf(tenant);
        const planLine = contract.lineItems.find((line) => line.kind === 'plan');
        assert.deepEqual(
            {
                effectiveFrom: contract.effectiveFrom,
                effectiveUntil: contract.effectiveUntil,
                originalPlanVersionId: contract.originalPlanVersionId,
                planVersion: planLine.sourceVersionId,
                priceNet: planLine.priceNet,
                lines: contract.lineItems.map((line) => line.kind),
                granted: contract.entitlementSnapshot,
            },
            {
                effectiveFrom: RETURN_AT,
                effectiveUntil: null,
                originalPlanVersionId: V3.id,
                planVersion: V3.id,
                priceNet: 59,
                lines: ['plan'],
                granted: { plan: 'STANDARD', quotas: { users: 8 }, features: ['CORE', 'REPORTS'] },
            },
        );
        assert.deepEqual(tenant.calls.invalidated, [TENANT]);
        assert.deepEqual(tenant.calls.charged, [TENANT]);
    });

    test('is audited for the tenant, naming the end it lifted', async () => {
        const tenant = await aTenantThatEnded();

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        assert.deepEqual(tenant.calls.audited, [
            {
                actor: ADMIN,
                entity: 'Subscription',
                entityId: TENANT,
                tenantId: TENANT,
                action: 'SUBSCRIPTION_RETURNED',
                changes: {
                    plan: 'STANDARD',
                    billingCycle: 'MONTHLY',
                    planVersionId: V3.id,
                    endedAt: ENDED.toISOString(),
                    deletesOn: DELETES_ON,
                    endedSpecialTerms: [],
                },
            },
        ]);
    });

    test('a pilot that comes back is a pilot no more: its contract grants what it bought', async () => {
        const tenant = await aTenantThatEnded({ row: { isPilot: true } });

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        assert.equal(tenant.subscription.row.isPilot, false);
        const [contract] = await contractsOf(tenant);
        assert.deepEqual(contract.entitlementSnapshot, {
            plan: 'STANDARD',
            quotas: { users: 8 },
            features: ['CORE', 'REPORTS'],
        });
        assert.deepEqual(tenant.calls.audited[0].changes.endedSpecialTerms, ['isPilot']);
    });

    test('limits and a price of the operator’s own end with it: its contract is the catalogue’s, and the audit names what ended', async () => {
        const tenant = await aTenantThatEnded({
            row: {
                customLimits: { quotas: { users: 50 }, features: ['API'] },
                customMonthlyNet: 39,
                customNote: 'Framework agreement 2025',
            },
        });

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        const [contract] = await contractsOf(tenant);
        assert.deepEqual(contract.entitlementSnapshot, {
            plan: 'STANDARD',
            quotas: { users: 8 },
            features: ['CORE', 'REPORTS'],
        });
        assert.deepEqual(tenant.calls.audited[0].changes.endedSpecialTerms, [
            'customLimits',
            'customMonthlyNet',
        ]);
    });

    test('an add-on of the subscription that ended ends with it, and no contract of the return names it', async () => {
        const tenant = await aTenantThatEnded();
        const running = await tenant.bookings.add({
            subscriptionId: SUBSCRIPTION,
            bundleVersionId: 'bv-archive-1',
            startedAt: new Date('2026-03-01T00:00:00.000Z'),
        });
        const endedEarlier = await tenant.bookings.add({
            subscriptionId: SUBSCRIPTION,
            bundleVersionId: 'bv-archive-1',
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        const earlier = new Date('2026-02-28T23:00:00.000Z');
        await tenant.bookings.cancel(endedEarlier.id, {
            canceledAt: earlier,
            canceledEffectiveAt: earlier,
        });

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        const bookings = await tenant.bookings.listBySubscription(SUBSCRIPTION);
        const endOf = (id) => {
            const booking = bookings.find((one) => one.id === id);
            return [booking.canceledAt, booking.canceledEffectiveAt];
        };
        assert.deepEqual(endOf(running.id), [ENDED, ENDED]);
        assert.deepEqual(endOf(endedEarlier.id), [earlier, earlier]);
        const [contract] = await contractsOf(tenant);
        assert.deepEqual(
            contract.lineItems.map((line) => line.kind),
            ['plan'],
        );
        assert.deepEqual(contract.entitlementSnapshot.features, ['CORE', 'REPORTS']);
    });

    test('an add-on cancelled for a date after the end ends at the end as well', async () => {
        const tenant = await aTenantThatEnded();
        const later = new Date('2027-02-28T23:00:00.000Z');
        const booking = await tenant.bookings.add({
            subscriptionId: SUBSCRIPTION,
            bundleVersionId: 'bv-archive-1',
            startedAt: new Date('2026-03-01T00:00:00.000Z'),
        });
        await tenant.bookings.cancel(booking.id, {
            canceledAt: new Date('2026-08-01T00:00:00.000Z'),
            canceledEffectiveAt: later,
        });
        const endedNow = [];
        tenant.bookings.endNow = async (id, input) => {
            endedNow.push({ id, ...input });
            return tenant.bookings.findById(id);
        };

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        assert.deepEqual(endedNow, [
            { id: booking.id, at: ENDED, expectedCanceledEffectiveAt: later },
        ]);
    });

    test('an invoice still unpaid keeps it read-only for that invoice alone', async () => {
        const tenant = await aTenantThatEnded();
        await heldBy(tenant, 'overdue', new Date('2026-09-15T00:00:00.000Z'));

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        const access = await accessOver(tenant).accessOf(TENANT);
        assert.equal(access.state, 'read-only');
        assert.deepEqual(
            access.holds.map((hold) => hold.kind),
            ['overdue'],
        );
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('the deletion day, in the installation’s days, is where coming back stops', () => {
    test('the last moment of the day before is still in time', async () => {
        const tenant = await aTenantThatEnded();

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, LAST_MOMENT);

        assert.equal(endsOf(tenant)[0].liftedAt, LAST_MOMENT);
    });

    test('from midnight of the deletion day it is refused, naming the day, and nothing is written', async () => {
        const tenant = await aTenantThatEnded();

        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, DELETION_DAY),
            'TENANT_RETURN_DELETION_DAY_REACHED',
        );
        await assert.rejects(
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, DELETION_DAY),
            (error) => error.response.params.deletesOn === DELETES_ON,
        );
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('a return that is refused writes nothing', () => {
    test('once the deletion has begun, as the tenant is answered wherever it asks', async () => {
        const tenant = await aTenantThatEnded();
        await heldBy(tenant, 'deleting', RETURN_AT);

        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT),
            'TENANT_BEING_DELETED',
        );
    });

    test('while the operator suspends the tenant', async () => {
        const tenant = await aTenantThatEnded();
        await heldBy(tenant, 'suspended', RETURN_AT);

        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT),
            'TENANT_SUSPENDED',
        );
    });

    test('where no end is recorded to come back from', async () => {
        const tenant = await aTenantThatEnded({ ended: false });

        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT),
            'TENANT_RETURN_NOT_ENDED',
        );
    });

    test('a second time: the tenant came back already', async () => {
        const tenant = await aTenantThatEnded();
        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);
        tenant.calls.audited.length = 0;

        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, LAST_MOMENT),
            'TENANT_RETURN_NOT_ENDED',
        );
    });

    test('where the contract cannot be written: the subscription, the reason and the end stay as they were', async () => {
        const tenant = await aTenantThatEnded();
        tenant.contracts.failNext = true;
        const before = await whatIsKept(tenant);

        await assert.rejects(
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT),
            /connection reset/,
        );

        assert.deepEqual(await whatIsKept(tenant), before);
    });

    test('where the transaction fails as it ends: no contract stays either', async () => {
        const tenant = await aTenantThatEnded();
        tenant.transactions.failNext = true;
        const before = await whatIsKept(tenant);

        await assert.rejects(
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT),
            /the transaction failed/,
        );

        assert.deepEqual(await whatIsKept(tenant), before);
    });

    test('a tenant without a subscriber is refused before anything is written, an add-on included', async () => {
        const tenant = await aTenantThatEnded();
        await tenant.bookings.add({
            subscriptionId: SUBSCRIPTION,
            bundleVersionId: 'bv-archive-1',
            startedAt: new Date('2026-03-01T00:00:00.000Z'),
        });
        tenant.state.subscriberMissing = true;

        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT),
            'SUBSCRIBER_REQUIRED',
        );
    });

    test('where a gateway takes payment methods and the subscriber has none in use', async () => {
        const tenant = await aTenantThatEnded({ gateway: true });

        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT),
            'TENANT_RETURN_PAYMENT_METHOD_REQUIRED',
        );
    });

    test('a plan sold only by a contract of its own, or one the catalogue does not sell', async () => {
        const tenant = await aTenantThatEnded();

        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(
                TENANT,
                { plan: 'ENTERPRISE', billingCycle: 'MONTHLY' },
                ADMIN,
                RETURN_AT,
            ),
            'PLAN_NOT_SELF_SERVICE',
        );
        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(
                TENANT,
                { plan: 'PLATINUM', billingCycle: 'MONTHLY' },
                ADMIN,
                RETURN_AT,
            ),
            'PLAN_NOT_IN_CATALOG',
        );
    });

    test('where a contract of the tenant runs past its end already', async () => {
        const tenant = await aTenantThatEnded();
        await contracted(tenant, TENANT, new Date('2026-10-10T00:00:00.000Z'));

        await refusedWritingNothing(
            tenant,
            tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT),
            'SUBSCRIPTION_CONTRACT_CHANGED',
        );
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('with a payment method where a gateway takes them', () => {
    test('a tenant whose subscriber has one in use comes back', async () => {
        const tenant = await aTenantThatEnded({
            gateway: true,
            paymentMethod: { id: 'pm-1', subscriberId: 'subscriber-t1' },
        });

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        assert.equal(tenant.subscription.row.status, 'ACTIVE');
    });

    test('without a gateway none is asked for', async () => {
        const tenant = await aTenantThatEnded({ gateway: false, paymentMethod: null });

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        assert.equal(tenant.subscription.row.status, 'ACTIVE');
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('a return and a deletion beside it lock the same reason', { timeout: 5000 }, () => {
    test('the deletion first: the return waits for it, finds the tenant being deleted and is refused', async () => {
        const tenant = await aTenantThatEnded();
        const held = aBarrier();
        const begin = tenant.records.begin.bind(tenant.records);
        tenant.records.begin = async (record, tx) => {
            await held.pass();
            return begin(record, tx);
        };

        const deleting = tenant.run.service.deleteDue(DELETION_DAY);
        await held.arrived;
        const returning = tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, LAST_MOMENT);
        await untilItWaitsOrEnds(tenant.holds, returning);
        held.open();

        await assert.rejects(returning, refusedWith('TENANT_BEING_DELETED'));
        await deleting;
        assert.equal(endsOf(tenant)[0].liftedAt, null);
        assert.equal(tenant.subscription.row.canceledEffectiveAt, ENDED);
        assert.equal((await contractsOf(tenant)).length, 0);
    });

    test('the return first: the deletion waits for it, finds the reason lifted and begins nothing', async () => {
        const tenant = await aTenantThatEnded();
        const held = aBarrier();
        const startAgain = tenant.subscription.startAgain.bind(tenant.subscription);
        tenant.subscription.startAgain = async (tenantId, input, tx) => {
            await held.pass();
            return startAgain(tenantId, input, tx);
        };

        const returning = tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, LAST_MOMENT);
        await held.arrived;
        const deleting = tenant.run.service.deleteDue(DELETION_DAY);
        await untilItWaitsOrEnds(tenant.holds, deleting);
        held.open();

        await returning;
        assert.deepEqual(await deleting, { deleted: 0, halted: 0, failed: 0 });
        assert.deepEqual(tenant.records.deletions, []);
        assert.deepEqual(
            reasonsOf(tenant).filter((reason) => reason.liftedAt === null),
            [],
        );
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('after it came back', () => {
    test('a cancellation that lands again is recorded as an end of its own, with a day of its own', async () => {
        const tenant = await aTenantThatEnded();
        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);
        const secondEnd = new Date('2027-03-31T22:00:00.000Z');
        const declared = new Date('2027-02-10T09:00:00.000Z');

        const told = await tenant.subscriptionEnds.announce(
            { tenantId: TENANT, subscriptionId: SUBSCRIPTION, by: ADMIN_TAG },
            secondEnd,
            tenant.subscriptionEnds.deletionFor(SUBSCRIPTION, secondEnd, declared),
            declared,
        );
        Object.assign(tenant.subscription.row, {
            canceledAt: declared,
            canceledEffectiveAt: secondEnd,
        });
        const recorded = await tenant.subscriptionEnds.recordEnded(
            new Date('2027-03-31T22:15:00.000Z'),
        );

        assert.deepEqual(told, {
            days: { readOnlyDays: 30, readOnlyUntil: '2027-04-30', deletesOn: '2027-05-01' },
            onRecord: false,
        });
        assert.deepEqual(recorded, { ended: 1 });
        const standing = endsOf(tenant).filter((end) => end.liftedAt === null);
        assert.deepEqual(
            standing.map((end) => [end.endsAt, end.deletesOn]),
            [[secondEnd, '2027-05-01']],
        );
        const open = reasonsOf(tenant).filter((reason) => reason.liftedAt === null);
        assert.deepEqual(
            open.map((reason) => reason.kind),
            ['ended'],
        );
    });

    test('its export is no longer offered: no end stands', async () => {
        const tenant = await aTenantThatEnded();
        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);
        const exports = new TenantDataExportService(
            tenant.ends,
            {
                export: async () => ({
                    content: new Uint8Array([1]),
                    mediaType: 'application/zip',
                }),
            },
            accessOver(tenant),
        );

        await assert.rejects(
            exports.take(TENANT, ADMIN, RETURN_AT),
            refusedWith('TENANT_EXPORT_NOT_OFFERED'),
        );
    });

    test('once deleted after a later end, the reason it lifted names the tenant’s administrator, not the operator', async () => {
        const tenant = await aTenantThatEnded();
        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);
        const secondEnd = new Date('2027-03-31T22:00:00.000Z');
        Object.assign(tenant.subscription.row, {
            canceledAt: new Date('2027-02-10T09:00:00.000Z'),
            canceledEffectiveAt: secondEnd,
        });
        const [contract] = await contractsOf(tenant);
        await tenant.contracts.terminate(contract.id, {
            tenantId: TENANT,
            effectiveUntil: secondEnd,
            status: 'terminated',
        });
        await tenant.subscriptionEnds.recordEnded(secondEnd);

        const deleted = await tenant.run.service.deleteDue(new Date('2027-05-01T00:00:00.000Z'));

        assert.equal(deleted.deleted, 1);
        const lifted = reasonsOf(tenant).find(
            (reason) => reason.kind === 'ended' && reason.since.getTime() === ENDED.getTime(),
        );
        assert.equal(lifted.liftedBy, 'tenant-admin');
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('what the tenant is shown before it comes back', () => {
    test('the catalogue of today: the version on sale, its price, its first period and the notice it is owed', async () => {
        const tenant = await aTenantThatEnded({ gateway: true });

        const preview = await tenant.service.preview(TENANT, STANDARD_MONTHLY, RETURN_AT);

        assert.deepEqual(preview, {
            refusal: null,
            deletesOn: DELETES_ON,
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            planVersionId: V3.id,
            periodStart: RETURN_AT,
            periodEnd: FIRST_PERIOD_ENDS,
            blockers: [],
            price: {
                currency: 'EUR',
                billingCycle: 'monthly',
                subtotalNet: 59,
                discountNet: 0,
                totalNet: 59,
                vatRate: 19,
                totalGross: 70.21,
            },
            cancellationNoticeDays: 30,
            paymentMethodRequired: true,
        });
    });

    test('an add-on of the subscription that ended costs nothing in it', async () => {
        const tenant = await aTenantThatEnded();
        await tenant.bookings.add({
            subscriptionId: SUBSCRIPTION,
            bundleVersionId: 'bv-archive-1',
            startedAt: new Date('2026-03-01T00:00:00.000Z'),
        });

        const preview = await tenant.service.preview(TENANT, STANDARD_MONTHLY, RETURN_AT);

        assert.equal(preview.price.totalNet, 59);
        assert.equal(
            (await tenant.bookings.listActiveBySubscription(SUBSCRIPTION, RETURN_AT)).length,
            1,
        );
    });

    test('from the deletion day, why not — and nothing is written', async () => {
        const tenant = await aTenantThatEnded();
        const before = await whatIsKept(tenant);

        const preview = await tenant.service.preview(TENANT, STANDARD_MONTHLY, DELETION_DAY);

        assert.deepEqual(preview, { refusal: 'deletion-day-reached', deletesOn: DELETES_ON });
        assert.deepEqual(await whatIsKept(tenant), before);
    });

    test('the price of the version it paid until then is not the one shown', async () => {
        const tenant = await aTenantThatEnded();

        const preview = await tenant.service.preview(TENANT, STANDARD_MONTHLY, RETURN_AT);

        assert.notEqual(preview.planVersionId, V2.id);
        assert.notEqual(preview.price.totalNet, 49);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('the plan it comes back on is refused as a plan change to it would be', () => {
    const STARTER_MONTHLY = { plan: 'STARTER', billingCycle: 'MONTHLY' };

    test('one whose limits the tenant’s use today exceeds, naming the quota, and nothing is written', async () => {
        const tenant = await aTenantThatEnded({ usage: { users: 5 } });
        const before = await whatIsKept(tenant);

        await assert.rejects(
            tenant.service.takeOut(TENANT, STARTER_MONTHLY, ADMIN, RETURN_AT),
            (error) => {
                assert.equal(error.getStatus(), 400);
                assert.deepEqual(error.response, {
                    code: 'PLAN_CHANGE_BLOCKED',
                    message: 'Plan change is blocked.',
                    blockers: [
                        {
                            code: 'QUOTA_OVER_TARGET',
                            message:
                                'Current usage 5 exceeds the target limit 3 (users) in the ' +
                                'Starter plan. Please reduce usage first.',
                            params: {
                                used: '5',
                                targetMax: 3,
                                quotaKey: 'users',
                                planName: 'Starter',
                            },
                        },
                    ],
                });
                return true;
            },
        );
        assert.deepEqual(await whatIsKept(tenant), before);
        assert.deepEqual(tenant.calls.audited, []);
    });

    test('a rhythm the plan is not sold in', async () => {
        const tenant = await aTenantThatEnded();

        await assert.rejects(
            tenant.service.takeOut(
                TENANT,
                { plan: 'FLEX', billingCycle: 'YEARLY' },
                ADMIN,
                RETURN_AT,
            ),
            (error) => {
                assert.equal(error.response?.code, 'PLAN_CHANGE_BLOCKED');
                assert.deepEqual(
                    error.response.blockers.map((blocker) => blocker.code),
                    ['PLAN_NOT_SOLD_IN_CYCLE'],
                );
                return true;
            },
        );
    });

    test('measured against the version on sale, not the one it paid until then', async () => {
        // The version it ended on held five users, the one on sale holds eight.
        const tenant = await aTenantThatEnded({ usage: { users: 7 } });

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        assert.equal(tenant.subscription.row.planVersionId, V3.id);
    });

    test('a special contract it ended on is over, not left: it comes back on a plan of the catalogue', async () => {
        const tenant = await aTenantThatEnded({
            row: { plan: 'ENTERPRISE', planVersionId: 'pv-enterprise-1' },
        });

        await tenant.service.takeOut(TENANT, STANDARD_MONTHLY, ADMIN, RETURN_AT);

        assert.equal(tenant.subscription.row.plan, 'STANDARD');
    });

    test('shown before it comes back, as a plan change’s preview shows them, without a price', async () => {
        const tenant = await aTenantThatEnded({ usage: { users: 5 } });

        const preview = await tenant.service.preview(TENANT, STARTER_MONTHLY, RETURN_AT);

        assert.deepEqual(
            preview.blockers.map((blocker) => blocker.code),
            ['QUOTA_OVER_TARGET'],
        );
        assert.equal(preview.price, null);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('taking the tenant back inside a transaction of the caller', () => {
    test('lifts the end and its reason in it, and with it taken back, nothing is lifted', async () => {
        const tenant = await aTenantThatEnded();

        const lifted = await tenant.transactions.run((tx) =>
            tenant.service.takeBackWithin(TENANT, RETURN_AT, ADMIN_TAG, tx),
        );
        assert.equal(lifted, true);
        assert.equal(endsOf(tenant)[0].liftedAt, RETURN_AT);
        assert.equal(reasonsOf(tenant)[0].liftedBy, ADMIN_TAG);

        const again = await aTenantThatEnded();
        again.transactions.failNext = true;
        await assert.rejects(
            again.transactions.run((tx) =>
                again.service.takeBackWithin(TENANT, RETURN_AT, ADMIN_TAG, tx),
            ),
        );
        assert.equal(endsOf(again)[0].liftedAt, null);
        assert.equal(reasonsOf(again)[0].liftedAt, null);
    });

    test('answers false where no end stands, and refuses from the deletion day', async () => {
        const open = await aTenantThatEnded({ ended: false });
        assert.equal(
            await open.transactions.run((tx) =>
                open.service.takeBackWithin(TENANT, RETURN_AT, ADMIN_TAG, tx),
            ),
            false,
        );

        const late = await aTenantThatEnded();
        await assert.rejects(
            late.transactions.run((tx) =>
                late.service.takeBackWithin(TENANT, DELETION_DAY, ADMIN_TAG, tx),
            ),
            refusedWith('TENANT_RETURN_DELETION_DAY_REACHED'),
        );
        assert.equal(endsOf(late)[0].liftedAt, null);
    });
});
