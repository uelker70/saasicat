// `GET billing/access` is the one route a tenant's page asks its state from
// (`SC-ADM-056`): it answers every user of the tenant, in every state, and
// where the installation issues invoices it tells a user holding the billing
// permission what `GET billing/account/access` tells them — the invoices by
// number and whether they can be paid here. Nobody else is told either.
//
// Asked over real HTTP, on both platforms an installation runs Nest on, because
// whether the user holds the permission is the application's guards' answer,
// and those read the request's own execution context. Each answer of the route
// every user reads is held against what the permission's route answers the same
// user, so "exactly where that route would answer" is measured, not restated.
//
// The modules here mount what `TenantBillingModule` mounts with invoices issued
// and without; that the module itself puts the permission beside
// `GET billing/access` exactly where it mounts the invoices is asked of the
// composed module at the end.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { ForbiddenException, Injectable, Module } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import {
    BillingPermissionGuard,
    InvoiceCollectionService,
    TenantAccessStateController,
    TenantInvoiceService,
    TenantInvoicesController,
} from '../dist/billing/index.js';
import { TenantAccessModule, TenantAccessService } from '../dist/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';
import { bootable, everythingOnOptions, withoutInvoicing } from './helpers/operator-routes.js';

const TENANT_AUTH_GUARDS = Symbol.for('saasicat/nest/TenantAuthGuards');
const BILLING_PERMISSION_GUARDS = Symbol.for('saasicat/nest/BillingPermissionGuards');

const SINCE = new Date('2026-11-16T09:00:00.000Z');
const NUMBERS = { 'invoice-ro': 'RE-2026-0042', 'invoice-su': 'RE-2026-0043' };

/** A tenant read-only for an unpaid invoice, and one suspended beside an unpaid invoice. */
const TENANTS = {
    'read-only': { id: 't-read-only', invoice: 'invoice-ro' },
    suspended: { id: 't-suspended', invoice: 'invoice-su' },
};

/** Applies decorators the way the TypeScript compiler would; plain JavaScript has no syntax for them. */
function decorate(target, classDecorators) {
    return Reflect.decorate(classDecorators, target);
}

/** The application's own guard: the session names the user, their role and the tenant. */
class AppAuthGuard {
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        request.user = {
            sub: 'u-1',
            tenantId: request.headers['x-tenant'],
            role: request.headers['x-role'],
        };
        return true;
    }
}
decorate(AppAuthGuard, [Injectable()]);

/** An application's own billing permission: the accounting role holds it, and nobody else. */
class AccountingGuard {
    canActivate(context) {
        return context.switchToHttp().getRequest().user.role === 'ACCOUNTING';
    }
}
decorate(AccountingGuard, [Injectable()]);

/** A billing permission that refuses by throwing, as a roles guard of Nest's own often does. */
class ThrowingRefusalGuard {
    canActivate() {
        throw new ForbiddenException('Accounting only');
    }
}
decorate(ThrowingRefusalGuard, [Injectable()]);

/** A billing permission whose own lookup fails: no answer about the user at all. */
class BrokenGuard {
    canActivate() {
        throw new Error('role directory unreachable');
    }
}
decorate(BrokenGuard, [Injectable()]);

const COLLECTING = { payNow: async () => ({ paymentMethod: true, collected: 1 }) };

/**
 * What tenant billing mounts: the route every user reads always, and with
 * invoices issued the tenant's invoice routes, the permission they sit behind
 * and, where invoices are collected, the collection.
 */
function tenantBilling(holds, { invoices, permissionGuards = null }) {
    class TenantStateModule {}
    const providers = [
        AppAuthGuard,
        { provide: TENANT_AUTH_GUARDS, useFactory: (guard) => [guard], inject: [AppAuthGuard] },
    ];
    if (invoices) {
        providers.push(
            BillingPermissionGuard,
            { provide: TenantInvoiceService, useValue: {} },
            { provide: InvoiceCollectionService, useValue: COLLECTING },
        );
    }
    if (permissionGuards) {
        providers.push(...permissionGuards, {
            provide: BILLING_PERMISSION_GUARDS,
            useFactory: (...guards) => guards,
            inject: permissionGuards,
        });
    }
    return decorate(TenantStateModule, [
        Module({
            imports: [TenantAccessModule.forRoot({ holds })],
            providers,
            controllers: invoices
                ? [TenantAccessStateController, TenantInvoicesController]
                : [TenantAccessStateController],
        }),
    ]);
}

async function heldBackTenants() {
    const holds = new FakeTenantAccessHoldRepository();
    for (const [state, tenant] of Object.entries(TENANTS)) {
        await holds.record({
            tenantId: tenant.id,
            kind: 'overdue',
            reference: tenant.invoice,
            note: null,
            since: SINCE,
            recordedBy: 'run:overdue',
        });
        if (state === 'suspended') {
            await holds.record({
                tenantId: tenant.id,
                kind: 'suspended',
                reference: null,
                note: 'Chargeback under review',
                since: SINCE,
                recordedBy: 'web:ops@example.com:s1',
            });
        }
    }
    return holds;
}

const namingTheInvoices = {
    invoicesNamed: async (ids) =>
        ids
            .filter((id) => id in NUMBERS)
            .map((id) => ({ id, number: NUMBERS[id], subscriberId: 'subscriber-1' })),
};

const PLATFORMS = [
    { name: 'Express', adapter: () => undefined },
    { name: 'Fastify', adapter: () => new FastifyAdapter() },
];

/** An installation served over HTTP on `platform`, mounted as `wiring` says. */
function served(platform, wiring) {
    const installation = { ask: null };
    let app;
    before(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [tenantBilling(await heldBackTenants(), wiring)],
        }).compile();
        app = moduleRef.createNestApplication(platform.adapter(), { logger: false });
        await app.listen(0, '127.0.0.1');
        moduleRef.get(TenantAccessService, { strict: false }).nameInvoicesFrom(namingTheInvoices);
        const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
        installation.ask = async (path, { state, role }) => {
            const response = await fetch(`${base}/billing/${path}`, {
                headers: { 'x-tenant': TENANTS[state].id, 'x-role': role },
            });
            return { status: response.status, body: await response.json() };
        };
    });
    after(async () => {
        await app?.close();
    });
    return installation;
}

/** What a reader is told of the invoice, and whether they may pay: what differs by who holds the permission. */
const extraOf = (view) => ({
    invoiceNumber: view.reasons.find((reason) => reason.kind === 'overdue')?.invoiceNumber ?? null,
    holdsBillingPermission: view.holdsBillingPermission,
    mayPay: view.mayPay,
});
const NONE = { invoiceNumber: null, holdsBillingPermission: false, mayPay: false };
const named = (state) => ({
    invoiceNumber: NUMBERS[TENANTS[state].invoice],
    holdsBillingPermission: true,
    mayPay: true,
});

/**
 * Asks both reads of the state for `reader` and checks what `GET billing/access`
 * answers against the permission's route: the same answer where that one
 * answers, and no number and no paying where it does not. Returns both, for the
 * case to say which of the two it expected.
 */
async function bothReads(installation, reader) {
    const everyone = await installation.ask('access', reader);
    const permission = await installation.ask('account/access', reader);
    assert.equal(everyone.status, 200, `GET billing/access answers ${JSON.stringify(reader)}`);
    if (permission.status === 200) {
        assert.deepEqual(everyone.body, permission.body, 'the same answer as the permission route');
    } else {
        assert.deepEqual(extraOf(everyone.body), NONE, 'nothing the permission route refused');
    }
    return { everyone, permission };
}

for (const platform of PLATFORMS) {
    // @requirement SC-ADM-056 — A tenant's page asks its state from one route, which refuses none of its users
    describe(`one route answers every user's read of the state, on ${platform.name}`, () => {
        describe('where the installation issues invoices', () => {
            const installation = served(platform, { invoices: true });

            for (const state of Object.keys(TENANTS)) {
                test(`${state}: a user holding the billing permission reads the invoice by number and paying, as the permission's route answers them`, async () => {
                    const { everyone, permission } = await bothReads(installation, {
                        state,
                        role: 'TENANT_ADMIN',
                    });
                    assert.equal(permission.status, 200);
                    assert.deepEqual(extraOf(everyone.body), named(state));
                    assert.equal(everyone.body.state, state);
                });

                test(`${state}: a user without the permission reads no number and cannot pay, and is not refused`, async () => {
                    const { everyone, permission } = await bothReads(installation, {
                        state,
                        role: 'MEMBER',
                    });
                    assert.equal(permission.status, 403);
                    assert.deepEqual(extraOf(everyone.body), NONE);
                    assert.equal(everyone.body.state, state);
                });

                test(`${state}: the operator reads what the permission's route answers them`, async () => {
                    const { permission } = await bothReads(installation, {
                        state,
                        role: 'SUPER_ADMIN',
                    });
                    assert.equal(permission.status, 200, 'the default rule lets the operator in');
                });
            }
        });

        describe('where the installation issues no invoices', () => {
            const installation = served(platform, { invoices: false });

            for (const state of Object.keys(TENANTS)) {
                for (const role of ['TENANT_ADMIN', 'MEMBER']) {
                    test(`${state}: ${role} reads the reasons, no number and no paying, and is not refused`, async () => {
                        const { everyone, permission } = await bothReads(installation, {
                            state,
                            role,
                        });
                        assert.equal(permission.status, 404);
                        assert.deepEqual(extraOf(everyone.body), NONE);
                        assert.deepEqual(
                            everyone.body.reasons.map((reason) => reason.kind),
                            state === 'suspended' ? ['overdue', 'suspended'] : ['overdue'],
                        );
                    });
                }
            }
        });

        describe('where the application decides who holds the permission', () => {
            const installation = served(platform, {
                invoices: true,
                permissionGuards: [AccountingGuard],
            });

            test("the application's role reads the number from the route every user reads", async () => {
                const { everyone } = await bothReads(installation, {
                    state: 'read-only',
                    role: 'ACCOUNTING',
                });
                assert.deepEqual(extraOf(everyone.body), named('read-only'));
            });

            test("the tenant's administrator, whom the application's rule leaves out, reads no number", async () => {
                const { everyone, permission } = await bothReads(installation, {
                    state: 'read-only',
                    role: 'TENANT_ADMIN',
                });
                assert.equal(permission.status, 403);
                assert.deepEqual(extraOf(everyone.body), NONE);
            });
        });

        describe('where the permission refuses by throwing', () => {
            const installation = served(platform, {
                invoices: true,
                permissionGuards: [ThrowingRefusalGuard],
            });

            test('the refusal reads as not holding it: no number, and the state is answered', async () => {
                const { everyone, permission } = await bothReads(installation, {
                    state: 'suspended',
                    role: 'TENANT_ADMIN',
                });
                assert.equal(permission.status, 403);
                assert.deepEqual(extraOf(everyone.body), NONE);
            });
        });

        describe("where the permission's own check fails", () => {
            const installation = served(platform, {
                invoices: true,
                permissionGuards: [BrokenGuard],
            });

            test('the read fails rather than taking the failure for an answer about the user', async () => {
                const everyone = await installation.ask('access', {
                    state: 'read-only',
                    role: 'TENANT_ADMIN',
                });
                assert.equal(everyone.status, 500);
            });
        });
    });
}

/** An execution context for one request, as Nest hands one to a route's guards. */
function contextFor(request) {
    class Route {
        handle() {}
    }
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => Route.prototype.handle,
        getClass: () => Route,
        getType: () => 'http',
    };
}

/** `GET billing/access` of the composed module, `options` as given, read by the tenant's administrator. */
async function composedRead(options) {
    const holds = await heldBackTenants();
    const composed = bootable(options);
    composed.persistence.core.tenantAccessHolds = holds;
    composed.persistence.core.rlsBypass = { runWithBypass: (work) => work() };
    const moduleRef = await Test.createTestingModule({
        imports: [SaaSiCatModule.forRoot(composed)],
    }).compile();
    moduleRef.get(TenantAccessService, { strict: false }).nameInvoicesFrom(namingTheInvoices);
    const request = {
        user: { sub: 'u-1', tenantId: TENANTS['read-only'].id, role: 'TENANT_ADMIN' },
    };
    const controller = moduleRef.get(TenantAccessStateController, { strict: false });
    const view = await controller.state(request, contextFor(request));
    let invoicesMounted = true;
    try {
        moduleRef.get(TenantInvoicesController, { strict: false });
    } catch (error) {
        if (error?.constructor?.name !== 'UnknownElementException') throw error;
        invoicesMounted = false;
    }
    return { view, invoicesMounted };
}

// @requirement SC-ADM-056 — A tenant's page asks its state from one route, which refuses none of its users
describe('the composed module tells the invoices by number exactly where it mounts them', () => {
    test('with invoices issued and collected: the number and paying, to whoever holds the permission', async () => {
        const { view, invoicesMounted } = await composedRead(everythingOnOptions());
        assert.equal(invoicesMounted, true);
        assert.deepEqual(extraOf(view), named('read-only'));
    });

    test('without invoices: no number and no paying, to the tenant administrator too', async () => {
        const { view, invoicesMounted } = await composedRead(
            withoutInvoicing(everythingOnOptions()),
        );
        assert.equal(invoicesMounted, false);
        assert.deepEqual(extraOf(view), NONE);
    });
});
