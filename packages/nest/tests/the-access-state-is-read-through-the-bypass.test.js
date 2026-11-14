// A tenant's access state reads the same whatever row-level frame its caller
// runs in.
//
// The access check runs in guards — the application's own and the platform's —
// so it asks before the application's interceptor opens the tenant's frame,
// where a policy on the platform's tables does not see the request's tenant.
// The stores here answer as such a policy does (`helpers/row-level-policy.js`).
//
// Each check is asked in three frames — before the tenant frame is opened,
// inside the tenant's own, inside an operator's bypass — for a suspended
// tenant, a read-only one and an open one, and has to answer the same in all
// three.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import {
    ComposedTenantAuthGuard,
    RLS_BYPASS_PORT_TOKEN,
    TENANT_ACCESS_MARK_KEY,
    TenantAccessModule,
    TenantAccessService,
} from '../dist/index.js';
import { TenantAccessStateController, TenantBillingController } from '../dist/billing/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';
import {
    BYPASS,
    FRAMES,
    codeOf,
    frame,
    inEveryFrame,
    outcomes as outcomesFor,
    visibleTo,
} from './helpers/row-level-policy.js';

const SINCE = new Date('2026-11-02T08:30:00.000Z');
const OPERATOR = 'web:ops@example.com:s1';
const BERLIN = 'Europe/Berlin';
const DELETES_ON = '2027-01-31';

/** One tenant in each state, by the state it is in. */
const TENANTS = { suspended: 't-suspended', 'read-only': 't-read-only', open: 't-open' };

/** The holds as the policy shows them: a store and a port that answers through the policy. */
function holdsBehindThePolicy() {
    const store = new FakeTenantAccessHoldRepository();
    const port = {
        readIn: [],
        async listOpen(tenantId) {
            port.readIn.push(frame.getStore());
            return visibleTo(tenantId) ? store.listOpen(tenantId) : [];
        },
        async listOpenFor(tenantIds) {
            port.readIn.push(frame.getStore());
            return (await store.listOpenFor(tenantIds)).filter((hold) => visibleTo(hold.tenantId));
        },
        async listTenantIdsHeldBy(kinds) {
            port.readIn.push(frame.getStore());
            return (await store.listTenantIdsHeldBy(kinds)).filter(visibleTo);
        },
        // An insert the policy's check refuses fails; an update of a row the
        // policy hides changes nothing and says nothing.
        async record(hold) {
            if (!visibleTo(hold.tenantId)) {
                throw new Error(
                    'new row violates row-level security policy for table "tenant_access_holds"',
                );
            }
            return store.record(hold);
        },
        async lift(id, liftedAt, liftedBy) {
            const hold = store.holds.find((candidate) => candidate.id === id);
            if (!hold || !visibleTo(hold.tenantId)) return null;
            return store.lift(id, liftedAt, liftedBy);
        },
    };
    return { store, port };
}

const held = (store, tenantId, kind, reference = null) =>
    store.record({
        tenantId,
        kind,
        reference,
        note: kind === 'suspended' ? 'Contract under review' : null,
        since: SINCE,
        recordedBy: OPERATOR,
    });

/** The ends of subscriptions as the policy shows them: the read-only tenant's one. */
const ENDS = [
    {
        id: 'end-1',
        tenantId: TENANTS['read-only'],
        subscriptionId: 'sub-read-only',
        endsAt: new Date('2026-12-31T22:59:00.000Z'),
        deletesOn: DELETES_ON,
        recordedAt: new Date('2027-01-01T00:15:00.000Z'),
        recordedBy: 'job:platform:subscription-ends',
    },
];
const endedSubscriptions = {
    endsOf: async (tenantId, subscriptionIds) =>
        ENDS.filter(
            (end) =>
                visibleTo(end.tenantId) &&
                end.tenantId === tenantId &&
                subscriptionIds.includes(end.subscriptionId),
        ),
    endsWithDownloadsOf: async (tenantId, subscriptionIds) =>
        (await endedSubscriptions.endsOf(tenantId, subscriptionIds)).map((end) => ({
            subscriptionId: end.subscriptionId,
            deletesOn: end.deletesOn,
            downloads: [],
        })),
};

/** The invoices as the policy shows them: one, unpaid, of the read-only tenant. */
const invoices = {
    hasOpenInvoice: async (tenantId) =>
        tenantId === TENANTS['read-only'] && visibleTo(TENANTS['read-only']),
    invoicesNamed: async (invoiceIds) =>
        visibleTo(TENANTS['read-only'])
            ? invoiceIds
                  .filter((id) => id === 'invoice-1')
                  .map((id) => ({ id, number: 'RE-2026-0042', subscriberId: 'subscriber-1' }))
            : [],
};

/**
 * The service over stores behind the policy, with `bypass` as the installation
 * binds it: suspended, read-only for an unpaid invoice and an ended
 * subscription, and open.
 */
async function accessOver({ bypass = BYPASS } = {}) {
    const holds = holdsBehindThePolicy();
    await held(holds.store, TENANTS.suspended, 'suspended');
    await held(holds.store, TENANTS['read-only'], 'overdue', 'invoice-1');
    await held(holds.store, TENANTS['read-only'], 'ended', 'sub-read-only');
    const service = new TenantAccessService(holds.port, new Reflector(), bypass);
    service.answerOpenInvoicesFrom(invoices);
    service.nameInvoicesFrom(invoices);
    service.answerEndsFrom(endedSubscriptions);
    return { service, holds };
}

/** An execution context for one request to a handler carrying `mark`, or none. */
function contextFor(request, mark = null) {
    class Route {
        handle() {}
    }
    if (mark) Reflect.defineMetadata(TENANT_ACCESS_MARK_KEY, mark, Route.prototype.handle);
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => Route.prototype.handle,
        getClass: () => Route,
    };
}

const asTenant = (tenantId, method) => ({ method, user: { tenantId }, headers: {} });

/** What `check` answers for each of the three tenants in each frame. */
const outcomes = (check) => outcomesFor(TENANTS, check);

/** The state and the kinds of reason, oldest first, of an access state. */
const stateOf = (access) => ({
    state: access.state,
    reasons: access.holds.map((hold) => hold.kind),
});

// @requirement SC-SEC-020 — What crosses the tenant policy is named; a tenant's reach only its subscriber and itself
// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe('the access state is read through the bypass, whatever frame the caller is in', () => {
    test('enforce on a reading request refuses a suspended tenant and lets a read-only and an open one through', async () => {
        const { service } = await accessOver();
        assert.deepEqual(
            await outcomes((tenantId) =>
                service.enforce(contextFor(asTenant(tenantId, 'GET')), tenantId),
            ),
            inEveryFrame({ suspended: 'TENANT_SUSPENDED', 'read-only': 'passed', open: 'passed' }),
        );
    });

    test('enforce on a writing request refuses a suspended and a read-only tenant and lets an open one through', async () => {
        const { service } = await accessOver();
        assert.deepEqual(
            await outcomes((tenantId) =>
                service.enforce(contextFor(asTenant(tenantId, 'POST')), tenantId),
            ),
            inEveryFrame({
                suspended: 'TENANT_SUSPENDED',
                'read-only': 'TENANT_READ_ONLY',
                open: 'passed',
            }),
        );
    });

    test('enforceUnlessChecked on a writing request the application did not check refuses a suspended and a read-only tenant and lets an open one through', async () => {
        const { service } = await accessOver();
        assert.deepEqual(
            await outcomes((tenantId) =>
                service.enforceUnlessChecked(contextFor(asTenant(tenantId, 'POST')), tenantId),
            ),
            inEveryFrame({
                suspended: 'TENANT_SUSPENDED',
                'read-only': 'TENANT_READ_ONLY',
                open: 'passed',
            }),
        );
    });

    test('assertAllowed at sign-in, writing nothing, refuses a suspended tenant and lets a read-only and an open one in', async () => {
        const { service } = await accessOver();
        assert.deepEqual(
            await outcomes((tenantId) => service.assertAllowed(tenantId, { writes: false })),
            inEveryFrame({ suspended: 'TENANT_SUSPENDED', 'read-only': 'passed', open: 'passed' }),
        );
    });

    test('assertAllowed for a job that writes refuses a suspended and a read-only tenant and lets an open one through', async () => {
        const { service } = await accessOver();
        assert.deepEqual(
            await outcomes((tenantId) => service.assertAllowed(tenantId, { writes: true })),
            inEveryFrame({
                suspended: 'TENANT_SUSPENDED',
                'read-only': 'TENANT_READ_ONLY',
                open: 'passed',
            }),
        );
    });

    test('a read-only tenant starts a payment while its invoice is open, the invoice read through the bypass as well', async () => {
        const { service } = await accessOver();
        assert.deepEqual(
            await outcomes((tenantId) =>
                service.enforce(contextFor(asTenant(tenantId, 'POST'), 'starts-payment'), tenantId),
            ),
            inEveryFrame({ suspended: 'TENANT_SUSPENDED', 'read-only': 'passed', open: 'passed' }),
        );
    });

    test('accessOf answers the state of each tenant with its reasons', async () => {
        const { service } = await accessOver();
        assert.deepEqual(
            await outcomes(async (tenantId) => stateOf(await service.accessOf(tenantId))),
            inEveryFrame({
                suspended: { state: 'suspended', reasons: ['suspended'] },
                'read-only': { state: 'read-only', reasons: ['overdue', 'ended'] },
                open: { state: 'open', reasons: [] },
            }),
        );
    });

    test("viewOf answers each tenant's state with the invoice by its number and the deletion day", async () => {
        const { service } = await accessOver();
        const asked = {
            timeZone: BERLIN,
            now: new Date('2027-01-10T09:00:00.000Z'),
            holdsBillingPermission: true,
            mayPay: true,
            isTenantAdministrator: true,
        };
        assert.deepEqual(
            await outcomes(async (tenantId) => {
                const view = await service.viewOf(tenantId, asked);
                return {
                    state: view.state,
                    reasons: view.reasons.map(({ kind, invoiceNumber, deletesOn }) => ({
                        kind,
                        invoiceNumber,
                        deletesOn,
                    })),
                    mayExport: view.mayExport,
                };
            }),
            inEveryFrame({
                suspended: {
                    state: 'suspended',
                    reasons: [{ kind: 'suspended', invoiceNumber: null, deletesOn: null }],
                    mayExport: false,
                },
                'read-only': {
                    state: 'read-only',
                    reasons: [
                        { kind: 'overdue', invoiceNumber: 'RE-2026-0042', deletesOn: null },
                        { kind: 'ended', invoiceNumber: null, deletesOn: DELETES_ON },
                    ],
                    mayExport: true,
                },
                open: { state: 'open', reasons: [], mayExport: false },
            }),
        );
    });

    test('accessOfEach answers the state of every tenant from one read', async () => {
        const { service, holds } = await accessOver();
        const tenantIds = Object.values(TENANTS);
        for (const [name, within] of Object.entries(FRAMES)) {
            holds.port.readIn.length = 0;
            const each = await within(null, () => service.accessOfEach(tenantIds));
            assert.deepEqual(
                Object.fromEntries([...each].map(([tenantId, access]) => [tenantId, access.state])),
                { 't-suspended': 'suspended', 't-read-only': 'read-only', 't-open': 'open' },
                name,
            );
            assert.equal(holds.port.readIn.length, 1, `${name}: one read`);
        }
    });

    test('tenantsHeldBack names the suspended tenant and neither the read-only nor the open one', async () => {
        const { service } = await accessOver();
        for (const [name, within] of Object.entries(FRAMES)) {
            assert.deepEqual(
                await within(null, () => service.tenantsHeldBack()),
                ['t-suspended'],
                name,
            );
        }
    });

    test("endsNamed answers the read-only tenant's ended subscription with its deletion day", async () => {
        const { service } = await accessOver();
        assert.deepEqual(
            await outcomes((tenantId) => service.endsNamed(tenantId, ['sub-read-only'])),
            inEveryFrame({
                suspended: [],
                'read-only': [
                    { subscriptionId: 'sub-read-only', deletesOn: DELETES_ON, downloads: [] },
                ],
                open: [],
            }),
        );
    });

    test('invoicesNamed answers the invoice an overdue reason names by its number', async () => {
        const { service } = await accessOver();
        for (const [name, within] of Object.entries(FRAMES)) {
            assert.deepEqual(
                await within(null, () => service.invoicesNamed(['invoice-1'])),
                [{ id: 'invoice-1', number: 'RE-2026-0042', subscriberId: 'subscriber-1' }],
                name,
            );
        }
    });
});

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe("the operator's suspension is written through the bypass, whatever frame the caller is in", () => {
    test('a suspension is recorded, and a second one answers null', async () => {
        for (const [name, within] of Object.entries(FRAMES)) {
            const { service, holds } = await accessOver();
            const recorded = await within(TENANTS.open, () =>
                service.suspend(TENANTS.open, 'Fraud check', OPERATOR, SINCE),
            );
            assert.equal(recorded?.kind, 'suspended', name);
            assert.equal(
                await within(TENANTS.open, () =>
                    service.suspend(TENANTS.open, 'Again', OPERATOR, SINCE),
                ),
                null,
                name,
            );
            assert.deepEqual(
                (await holds.store.listOpen(TENANTS.open)).map((hold) => hold.note),
                ['Fraud check'],
                name,
            );
        }
    });

    test('reactivating finds the suspension and lifts it in one frame, and leaves the other reasons', async () => {
        for (const [name, within] of Object.entries(FRAMES)) {
            const { service, holds } = await accessOver();
            await held(holds.store, TENANTS.suspended, 'overdue', 'invoice-2');
            const lifted = await within(TENANTS.suspended, () =>
                service.reactivate(TENANTS.suspended, OPERATOR, SINCE),
            );
            assert.equal(lifted?.kind, 'suspended', name);
            assert.equal(lifted?.liftedBy, OPERATOR, name);
            assert.deepEqual(
                (await holds.store.listOpen(TENANTS.suspended)).map((hold) => hold.kind),
                ['overdue'],
                name,
            );
        }
    });

    test('reactivating a tenant that is not suspended answers null', async () => {
        const { service } = await accessOver();
        assert.deepEqual(
            await outcomes((tenantId) =>
                tenantId === TENANTS.suspended
                    ? 'not asked'
                    : service.reactivate(tenantId, OPERATOR, SINCE).then((hold) => hold ?? 'null'),
            ),
            inEveryFrame({ suspended: 'not asked', 'read-only': 'null', open: 'null' }),
        );
    });
});

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe('without a bypass bound', () => {
    test('the reasons are read in the frame the caller runs in', async () => {
        const { service, holds } = await accessOver({ bypass: null });
        for (const [name, within] of Object.entries(FRAMES)) {
            holds.port.readIn.length = 0;
            await within(TENANTS.open, () => service.accessOf(TENANTS.open));
            assert.deepEqual(
                holds.port.readIn,
                [await within(TENANTS.open, async () => frame.getStore())],
                name,
            );
        }
    });

    test("inside the tenant's frame a suspended tenant is refused as before", async () => {
        const { service } = await accessOver({ bypass: null });
        await assert.rejects(
            FRAMES["in the tenant's frame"](TENANTS.suspended, () =>
                service.assertAllowed(TENANTS.suspended, { writes: false }),
            ),
            (error) => codeOf(error) === 'TENANT_SUSPENDED',
        );
    });
});

/** A module of the application's that provides the bypass, as `AdminModule` does when not global. */
function bypassModule() {
    class ApplicationBypassModule {}
    return {
        module: ApplicationBypassModule,
        providers: [{ provide: RLS_BYPASS_PORT_TOKEN, useValue: BYPASS }],
        exports: [RLS_BYPASS_PORT_TOKEN],
    };
}

/** The suspended tenant at sign-in, asked before any frame is opened. */
const signInOfTheSuspendedTenant = (service) =>
    FRAMES['before the tenant frame'](TENANTS.suspended, () =>
        service.assertAllowed(TENANTS.suspended, { writes: false }),
    );

describe('the bypass the access module reaches', () => {
    // @requirement SC-SEC-020 — What crosses the tenant policy is named; a tenant's reach only its subscriber and itself
    test('a module wired by hand reads through the bypass of a module it imports', async () => {
        const { holds } = await accessOver();
        const moduleRef = await Test.createTestingModule({
            imports: [TenantAccessModule.forRoot({ holds: holds.port, imports: [bypassModule()] })],
        }).compile();
        try {
            await assert.rejects(
                signInOfTheSuspendedTenant(moduleRef.get(TenantAccessService)),
                (error) => codeOf(error) === 'TENANT_SUSPENDED',
            );
        } finally {
            await moduleRef.close();
        }
    });

    test('a module wired by hand with no bypass in scope reads in the caller’s frame', async () => {
        const { holds } = await accessOver();
        const moduleRef = await Test.createTestingModule({
            imports: [TenantAccessModule.forRoot({ holds: holds.port })],
        }).compile();
        try {
            await moduleRef.get(TenantAccessService).accessOf(TENANTS.open);
            assert.deepEqual(holds.port.readIn, [undefined]);
        } finally {
            await moduleRef.close();
        }
    });
});

/** The application's session guard: it establishes the caller and lets the platform decide. */
class SignedIn {
    canActivate() {
        return true;
    }
}
Reflect.decorate([Injectable()], SignedIn);

/** An execution context for one request to `handler` of `controller`, as Nest builds it. */
const contextOfRoute = (controller, handler, request) => ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
});

// Compiled as `SaaSiCatModule` composes it, so the bypass the service reads
// through is the one the composition provides, not one a test hands it. The
// guard and the controller are the instances Nest built for the routes.
// @requirement SC-SEC-020 — What crosses the tenant policy is named; a tenant's reach only its subscriber and itself
// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe("the platform's own tenant routes, as SaaSiCatModule composes them", () => {
    let moduleRef;

    before(async () => {
        const holds = holdsBehindThePolicy();
        await held(holds.store, TENANTS.suspended, 'suspended');
        const composed = bootable(everythingOnOptions([SignedIn]));
        composed.persistence.core.rlsBypass = BYPASS;
        composed.persistence.core.tenantAccessHolds = holds.port;
        moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(composed)],
        }).compile();
    });

    after(async () => {
        await moduleRef?.close();
    });

    test('their guard refuses a suspended tenant whose reasons a policy shows only inside the bypass', async () => {
        const guard = moduleRef.get(ComposedTenantAuthGuard, { strict: false });
        const request = asTenant(TENANTS.suspended, 'GET');
        await assert.rejects(
            FRAMES['before the tenant frame'](TENANTS.suspended, () =>
                guard.canActivate(
                    contextOfRoute(TenantBillingController, 'getEntitlement', request),
                ),
            ),
            (error) => codeOf(error) === 'TENANT_SUSPENDED',
        );
    });

    test('the route that answers the state tells the suspended tenant it is suspended', async () => {
        const controller = moduleRef.get(TenantAccessStateController, { strict: false });
        const view = await FRAMES['before the tenant frame'](TENANTS.suspended, () =>
            controller.state(asTenant(TENANTS.suspended, 'GET')),
        );
        assert.equal(view.state, 'suspended');
        assert.deepEqual(
            view.reasons.map((reason) => reason.kind),
            ['suspended'],
        );
    });
});
