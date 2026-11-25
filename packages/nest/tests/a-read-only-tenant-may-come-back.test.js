// A read-only tenant whose subscription ended may come back until its deletion
// day (`SC-CANC-034`, `SC-ADM-060`): its administrator enters a payment method
// and takes out a new subscription, though no invoice is open. The exception
// is decided where every tenant request is checked — `TenantAccessService` —,
// which asks the return whether the tenant can come back, so on the day it
// cannot the route says why rather than only that the tenant is read-only. A
// suspension and a deletion under way have no such exception.
//
// Fahrschule Weber's subscription ended on 30 September, its data is deleted
// on 30 October, Berlin time (`helpers/subscription-return.js`). Each request
// is the platform's own route, with the mark and guards it carries.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
    SubscriptionReturnDto,
    TenantAccessStateController,
    TenantAdminGuard,
    TenantBillingController,
    TenantSubscriptionReturnController,
} from '../dist/billing/index.js';
import { TENANT_ACCESS_MARK_KEY } from '../dist/index.js';
import { TenantPaymentMethodController } from '../dist/payments/index.js';
import {
    DELETES_ON,
    DELETION_DAY,
    ENDED,
    LAST_MOMENT,
    RETURN_AT,
    TENANT,
    V3,
    aTenantThatEnded,
    endsOf,
} from './helpers/subscription-return.js';
import { RUN, ZONE } from './helpers/tenant-deletion.js';

/** STANDARD, monthly, at the version its preview showed. */
const STANDARD_MONTHLY = { plan: 'STANDARD', billingCycle: 'MONTHLY', planVersionId: V3.id };

/** The subscription as it runs: never cancelled. */
const RUNNING = { row: { canceledAt: null, canceledEffectiveAt: null }, ended: false };

/** A request of the tenant's user in `role`, as the session names them. */
const requestOf = (role = 'TENANT_ADMIN', method = 'POST') => ({
    method,
    headers: {},
    user: { id: 'user-weber', email: 'anna@fahrschule-weber.example', tenantId: TENANT, role },
});

/** `request` to `handler` of `controller`, as a guard sees it. */
const contextFor = (controller, handler, request = requestOf()) => ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
});

const takingOut = (request) => contextFor(TenantSubscriptionReturnController, 'takeOut', request);
const enteringAPaymentMethod = () => contextFor(TenantPaymentMethodController, 'startSetup');
const cancelling = () => contextFor(TenantBillingController, 'cancelSubscription');

const refusedWith = (type, code) => (error) =>
    error instanceof type && error.getResponse().code === code;

/** Holds the tenant back with an open reason of `kind`. */
const heldBy = (tenant, kind) =>
    tenant.holds.record({
        tenantId: TENANT,
        kind,
        reference: kind === 'overdue' ? 'invoice-2026-09' : null,
        note: null,
        since: ENDED,
        recordedBy: kind === 'suspended' ? 'cli:ops' : RUN,
    });

/** The route, over the tenant's stores, with the installation's zone. */
const routeOf = (tenant) =>
    new TenantSubscriptionReturnController(
        tenant.service,
        ZONE,
        null,
        null,
        null,
        null,
        tenant.access,
    );

/** What `GET billing/access` tells the user `request` carries. */
async function accessStateFor(tenant, request) {
    tenant.access.answerEndsFrom({
        exportDeliveredBy: 'platform',
        endsOf: async (tenantId, ids) =>
            (await tenant.ends.listFor(ids)).filter((end) => end.tenantId === tenantId),
        endsWithDownloadsOf: async () => [],
    });
    return new TenantAccessStateController(ZONE, null, tenant.access).state(request, null);
}

/** Runs the rest of the test at `now`, as the clock reads. */
const at = (t, now) => t.mock.timers.enable({ apis: ['Date'], now: now.getTime() });

/** The properties `validate` finds fault with in `body`, sent to the route, and what it keeps of it. */
async function validated(body) {
    const dto = plainToInstance(SubscriptionReturnDto, body);
    const errors = await validate(dto, { whitelist: true });
    return { faults: errors.map((error) => error.property), dto };
}

// @requirement SC-ADM-060 — A suspended tenant cannot act; a read-only one writes only to pay, leave or return
// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('a read-only tenant entering the payment method it comes back with', () => {
    test('is let through until its deletion day, though no invoice is open', async (t) => {
        at(t, LAST_MOMENT);
        const tenant = await aTenantThatEnded();

        await tenant.access.enforce(enteringAPaymentMethod(), TENANT);
    });

    test('is refused from its deletion day on', async (t) => {
        at(t, DELETION_DAY);
        const tenant = await aTenantThatEnded();

        await assert.rejects(
            tenant.access.enforce(enteringAPaymentMethod(), TENANT),
            refusedWith(ForbiddenException, 'TENANT_READ_ONLY'),
        );
    });

    test('is refused where it cannot come back, though read-only: its subscription runs', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded(RUNNING);
        await heldBy(tenant, 'overdue');

        await assert.rejects(
            tenant.access.enforce(enteringAPaymentMethod(), TENANT),
            refusedWith(ForbiddenException, 'TENANT_READ_ONLY'),
        );
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('coming back through the route', () => {
    test('its administrator comes back, and the check lets the request through', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded();
        await tenant.access.enforce(takingOut(), TENANT);

        const returned = await routeOf(tenant).takeOut(requestOf(), {
            ...STANDARD_MONTHLY,
            expectedDeletesOn: DELETES_ON,
        });

        assert.equal(returned.planVersionId, V3.id);
        assert.equal(returned.periodStartDays.from, '2026-10-20');
        assert.equal(tenant.subscription.row.status, 'ACTIVE');
        assert.deepEqual(
            endsOf(tenant).map((end) => end.liftedAt),
            [RETURN_AT],
        );
    });

    test('for the tenant the session names: a tenant in the body is no field of it', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded();

        await routeOf(tenant).takeOut(requestOf(), {
            ...STANDARD_MONTHLY,
            tenantId: 'tenant-2',
        });

        assert.equal(tenant.calls.audited[0].tenantId, TENANT);
    });

    test('a user who is not its administrator is refused by the route’s guard', () => {
        const route = TenantSubscriptionReturnController.prototype.takeOut;
        assert.ok((Reflect.getMetadata('__guards__', route) ?? []).includes(TenantAdminGuard));
        assert.throws(
            () => new TenantAdminGuard().canActivate(takingOut(requestOf('USER'))),
            refusedWith(ForbiddenException, 'TENANT_ADMIN_REQUIRED'),
        );
    });

    test('the operator acting as the tenant is refused, and nothing is written', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded();
        const asOperator = requestOf();
        await tenant.access.enforce(takingOut(asOperator), TENANT, { actingAsOperator: true });

        await assert.rejects(
            routeOf(tenant).takeOut(asOperator, STANDARD_MONTHLY),
            refusedWith(ForbiddenException, 'TENANT_RETURN_NOT_FOR_OPERATOR'),
        );
        await assert.rejects(
            routeOf(tenant).takeOut(requestOf('SUPER_ADMIN'), STANDARD_MONTHLY),
            refusedWith(ForbiddenException, 'TENANT_RETURN_NOT_FOR_OPERATOR'),
        );
        assert.equal(tenant.subscription.row.canceledEffectiveAt, ENDED);
    });

    test('a suspended tenant is refused by the check', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded();
        await heldBy(tenant, 'suspended');

        await assert.rejects(
            tenant.access.enforce(takingOut(), TENANT),
            refusedWith(ForbiddenException, 'TENANT_SUSPENDED'),
        );
    });

    test('a tenant being deleted is refused by the check', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded();
        await heldBy(tenant, 'deleting');

        await assert.rejects(
            tenant.access.enforce(takingOut(), TENANT),
            refusedWith(ForbiddenException, 'TENANT_BEING_DELETED'),
        );
    });

    test('from its deletion day the check says why, naming the day', async (t) => {
        at(t, DELETION_DAY);
        const tenant = await aTenantThatEnded();

        await assert.rejects(tenant.access.enforce(takingOut(), TENANT), (error) => {
            assert.ok(error instanceof ConflictException);
            assert.equal(error.getResponse().code, 'TENANT_RETURN_DELETION_DAY_REACHED');
            assert.deepEqual(error.getResponse().params, { deletesOn: DELETES_ON });
            return true;
        });
    });

    test('a tenant whose subscription runs has nothing to come back from', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded(RUNNING);
        await tenant.access.enforce(takingOut(), TENANT);

        await assert.rejects(
            routeOf(tenant).takeOut(requestOf(), STANDARD_MONTHLY),
            refusedWith(ConflictException, 'TENANT_RETURN_NOT_ENDED'),
        );
    });

    test('a page that showed another deletion day is refused with the day that applies, and nothing is written', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded();

        await assert.rejects(
            routeOf(tenant).takeOut(requestOf(), {
                ...STANDARD_MONTHLY,
                expectedDeletesOn: '2026-10-31',
            }),
            (error) => {
                assert.ok(error instanceof ConflictException);
                assert.equal(error.getResponse().code, 'TENANT_RETURN_DELETION_DAY_CHANGED');
                assert.deepEqual(error.getResponse().params, { deletesOn: DELETES_ON });
                return true;
            },
        );
        assert.equal(tenant.subscription.row.canceledEffectiveAt, ENDED);
        assert.deepEqual(
            endsOf(tenant).map((end) => end.liftedAt),
            [null],
        );
    });

    test('a plan the catalogue does not sell is refused as the plan route refuses it', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded();

        await assert.rejects(
            routeOf(tenant).takeOut(requestOf(), { plan: 'PLATINUM', billingCycle: 'MONTHLY' }),
            refusedWith(NotFoundException, 'PLAN_NOT_IN_CATALOG'),
        );
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('what the route shows before the tenant comes back', () => {
    test('the terms with the days of the first period, and what stands in the way of the plan', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded({ usage: { users: 5 } });

        const standard = await routeOf(tenant).preview(requestOf('USER'), STANDARD_MONTHLY);
        const starter = await routeOf(tenant).preview(requestOf('USER'), {
            plan: 'STARTER',
            billingCycle: 'MONTHLY',
        });

        assert.equal(standard.refusal, null);
        assert.equal(standard.periodEndDays.from, '2026-11-20');
        assert.deepEqual(standard.blockers, []);
        assert.deepEqual(
            starter.blockers.map((blocker) => blocker.code),
            ['QUOTA_OVER_TARGET'],
        );
    });

    test('from the deletion day, why not', async (t) => {
        at(t, DELETION_DAY);
        const tenant = await aTenantThatEnded();

        assert.deepEqual(await routeOf(tenant).preview(requestOf(), STANDARD_MONTHLY), {
            refusal: 'deletion-day-reached',
            deletesOn: DELETES_ON,
        });
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('whom the tenant’s state offers to come back', () => {
    test('its administrator, until the deletion day', async (t) => {
        at(t, LAST_MOMENT);
        const tenant = await aTenantThatEnded();

        assert.equal((await accessStateFor(tenant, requestOf())).mayReturn, true);
    });

    test('nobody else of the tenant, and not the operator', async (t) => {
        at(t, RETURN_AT);
        const tenant = await aTenantThatEnded();

        assert.equal((await accessStateFor(tenant, requestOf('USER'))).mayReturn, false);
        assert.equal((await accessStateFor(tenant, requestOf('SUPER_ADMIN'))).mayReturn, false);
    });

    test('nobody from the deletion day, or while the tenant is suspended', async (t) => {
        at(t, DELETION_DAY);
        const late = await aTenantThatEnded();
        assert.equal((await accessStateFor(late, requestOf())).mayReturn, false);

        t.mock.timers.setTime(RETURN_AT.getTime());
        const suspended = await aTenantThatEnded();
        await heldBy(suspended, 'suspended');
        assert.equal((await accessStateFor(suspended, requestOf())).mayReturn, false);
    });
});

// @requirement SC-ADM-060 — A suspended tenant cannot act; a read-only one writes only to pay, leave or return
describe('the other exceptions stay as they were', () => {
    test('a route through which the tenant leaves is let through on its deletion day as well', async (t) => {
        at(t, DELETION_DAY);
        const tenant = await aTenantThatEnded();

        await tenant.access.enforce(cancelling(), TENANT);
    });

    test('the route carries the mark of coming back, its preview the mark of writing nothing', () => {
        const route = TenantSubscriptionReturnController.prototype;
        assert.equal(Reflect.getMetadata(TENANT_ACCESS_MARK_KEY, route.takeOut), 'returns');
        assert.equal(Reflect.getMetadata(TENANT_ACCESS_MARK_KEY, route.preview), 'writes-nothing');
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('the version the route reads from the body', () => {
    test('the version the preview showed is kept, as a plan change keeps it', async () => {
        const { faults, dto } = await validated(STANDARD_MONTHLY);

        assert.deepEqual(faults, []);
        assert.equal(dto.planVersionId, V3.id);
    });

    test('none at all passes, for the return to say whether it binds one', async () => {
        const { plan, billingCycle } = STANDARD_MONTHLY;

        assert.deepEqual((await validated({ plan, billingCycle })).faults, []);
    });

    for (const [what, planVersionId] of [
        ['an empty one', ''],
        ['a number', 3],
    ]) {
        test(`${what} is refused`, async () => {
            assert.deepEqual((await validated({ ...STANDARD_MONTHLY, planVersionId })).faults, [
                'planVersionId',
            ]);
        });
    }
});
