// One request names one user, whichever of the platform's routes reads it.
//
// The application wires its authentication once; every route that records or
// checks who acted — the second factor, an operator's audit record, the
// publisher of a version, a promotion code's author, a suspension, the
// promotion preview and its rate limit, a tenant's own write — reads the user
// from the request through the resolver at the root of `SaaSiCatModule`, or,
// without one, from `sub` and then `id`. Each way is run through the module
// `SaaSiCatModule.forRoot` composes, so a way that read the user by a rule of
// its own, or that the resolver did not reach, names somebody else here.
//
// The tenant's way is its data export: it reads the user through the helper
// every tenant route that records who acted reads it through.

// @requirement SC-AUD-022 — One request names one user, on every route that records or checks who acted

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { AUTH_ERROR_CODES } from '@saasicat/core';

import {
    AdminAuditService,
    AdminResourcesService,
    MfaGuard,
    MfaService,
    RequireMfa,
} from '../dist/admin/index.js';
import { TenantDataExportService } from '../dist/billing/index.js';
import { PlanVersionsService } from '../dist/catalog/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import {
    PromoCodePublicController,
    PromoCodeRateLimitGuard,
    PromoCodesService,
} from '../dist/promo/index.js';

import {
    bootable,
    controllersIn,
    everythingOnOptions,
    handlersOf,
} from './helpers/operator-routes.js';

const VERSION_ID = '00000000-0000-0000-0000-000000000001';
const OPERATOR = { role: 'SUPER_ADMIN' };
const TENANT_ADMIN = { role: 'TENANT_ADMIN', tenantId: 't-1' };

/** What a way reports for a request that names nobody. */
const NOBODY = null;
/** The actor an audit record names when the request names nobody. */
const UNKNOWN = 'unknown';
const asNamed = (userId) => (userId === UNKNOWN ? NOBODY : userId);

/** Thrown by the fake export service once it has recorded who took the export. */
class ExportTaken extends Error {}

/** The services behind the routes, each recording what the route handed it. */
function recorders() {
    const seen = {};
    return {
        seen,
        mfa: {
            async isEnabled(userId) {
                seen.mfa = userId;
                return true;
            },
            async verify() {
                return true;
            },
        },
        audit: {
            async log(entry) {
                seen.audited = entry.actor;
            },
        },
        planVersions: {
            async publishPlanVersion(_id, input) {
                seen.publishedBy = input.publishedByUserId;
                return {
                    planVersion: { id: VERSION_ID, planId: 'STARTER', version: 1 },
                    warnings: [],
                };
            },
        },
        promoCodes: {
            async create(data) {
                seen.createdBy = data.createdById;
                return { id: 'pc-1', code: 'WELCOME' };
            },
            async preview(input) {
                seen.previewSession = input.sessionId;
                return { valid: false };
            },
        },
        resources: {
            async suspendTenant(_slug, _reason, actor) {
                seen.suspendedBy = actor;
                return {};
            },
        },
        exports: {
            async take(_tenantId, actor) {
                seen.exportedBy = actor;
                throw new ExportTaken();
            },
        },
    };
}

/** Every route that reads a user mounted, the promotion preview among them. */
function optionsWith(options) {
    return {
        ...everythingOnOptions(),
        promoCodes: {
            includePublicController: true,
            firstTimeCustomerCheck: { hasExistingCustomerForEmail: async () => false },
        },
        ...options,
    };
}

async function platform(options) {
    const root = SaaSiCatModule.forRoot(bootable(optionsWith(options)));
    const fakes = recorders();
    const moduleRef = await Test.createTestingModule({ imports: [root] })
        .overrideProvider(MfaService)
        .useValue(fakes.mfa)
        .overrideProvider(AdminAuditService)
        .useValue(fakes.audit)
        .overrideProvider(PlanVersionsService)
        .useValue(fakes.planVersions)
        .overrideProvider(PromoCodesService)
        .useValue(fakes.promoCodes)
        .overrideProvider(AdminResourcesService)
        .useValue(fakes.resources)
        .overrideProvider(TenantDataExportService)
        .useValue(fakes.exports)
        .compile();
    return { root, moduleRef, seen: fakes.seen };
}

/** The controller instance that serves `route`, e.g. `POST admin/promo-codes`. */
function controllerFor({ root, moduleRef }, route) {
    const found = controllersIn(root)
        .flatMap(handlersOf)
        .filter((h) => h.route === route);
    assert.equal(found.length, 1, `${route} is mounted once`);
    return moduleRef.get(found[0].controller, { strict: false });
}

/** Every `WebAuditLogger` the platform composed, one per module that records operator actions. */
function webAuditLoggers({ moduleRef }) {
    const found = [];
    for (const [, module] of moduleRef.container.getModules()) {
        for (const [, wrapper] of module.providers) {
            if (wrapper.metatype?.name === 'WebAuditLogger') found.push(wrapper.instance);
        }
    }
    return found;
}

const request = (user, headers = {}) => ({ user, headers });

/** An `ExecutionContext` for a guard, on a handler marked as needing the second factor. */
function mfaContext(req) {
    const handler = () => undefined;
    RequireMfa()(handler);
    return {
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
        getHandler: () => handler,
        getClass: () => class {},
    };
}

function rateLimitContext(req) {
    return {
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
        getHandler: () => () => undefined,
        getClass: () => class {},
    };
}

/**
 * Each way the user is read, as `(app, user) => the user it names`, or
 * `NOBODY` where it names nobody. A refusal is how a check names nobody.
 */
const WAYS = {
    async 'the audit record of every operator module'(app, user) {
        const loggers = webAuditLoggers(app);
        assert.ok(loggers.length >= 5, `only ${loggers.length} audit loggers composed`);
        const named = new Set(
            loggers.map((logger) => asNamed(logger.actorFromRequest(request(user)).userId)),
        );
        assert.equal(named.size, 1, `the modules disagree: ${[...named].join(', ')}`);
        return [...named][0];
    },
    async 'the publisher of a plan version, and its audit record'(app, user) {
        const controller = controllerFor(app, 'POST admin/catalog/plan-versions/:id/publish');
        await controller.publish(VERSION_ID, {}, request({ ...OPERATOR, ...user }));
        assert.equal(asNamed(app.seen.audited.userId), app.seen.publishedBy);
        return app.seen.publishedBy;
    },
    async 'the second factor'(app, user) {
        const guard = app.moduleRef.get(MfaGuard, { strict: false });
        try {
            await guard.canActivate(
                mfaContext(request({ ...OPERATOR, ...user }, { 'x-mfa-code': '123456' })),
            );
        } catch (error) {
            assert.equal(error.getResponse().code, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
            return NOBODY;
        }
        return app.seen.mfa;
    },
    async "a promotion code's author, and its audit record"(app, user) {
        const controller = controllerFor(app, 'POST admin/promo-codes');
        await controller.create(request({ ...OPERATOR, ...user }), {
            code: 'WELCOME',
            discountType: 'PERCENT',
            discountValue: 10,
        });
        assert.equal(app.seen.audited.userId, app.seen.createdBy);
        return asNamed(app.seen.createdBy);
    },
    async "a tenant's suspension"(app, user) {
        const controller = controllerFor(app, 'POST admin/tenants/:slug/suspend');
        await controller.suspendTenant(request({ ...OPERATOR, ...user }), 'acme', {});
        return asNamed(app.seen.suspendedBy.userId);
    },
    async 'the session of a promotion preview'(app, user) {
        const controller = app.moduleRef.get(PromoCodePublicController, { strict: false });
        await controller.preview(
            { code: 'WELCOME', plan: 'STARTER', billingCycle: 'MONTHLY' },
            request(user),
        );
        return app.seen.previewSession ?? NOBODY;
    },
    async "a tenant's own write"(app, user) {
        const controller = controllerFor(app, 'GET billing/export');
        try {
            await controller.export(request({ ...TENANT_ADMIN, ...user }));
        } catch (error) {
            if (error instanceof ExportTaken) return app.seen.exportedBy.userId;
            assert.equal(error.getResponse().code, AUTH_ERROR_CODES.TENANT_CONTEXT_MISSING);
            return NOBODY;
        }
        assert.fail('the export neither ran nor was refused');
    },
};

/**
 * The promotion preview's rate limit keys its hourly window by the user the
 * request names: fifty previews from fifty addresses by one user leave the
 * fifty-first refused, and a request that names nobody is never counted.
 */
async function rateLimitedAfterFifty(app, user) {
    const guard = app.moduleRef.get(PromoCodeRateLimitGuard, { strict: false });
    const fromAddress = (i) => ({
        user,
        headers: { 'x-forwarded-for': `10.0.${Math.floor(i / 250)}.${i % 250}` },
    });
    for (let i = 0; i < 50; i++) guard.canActivate(rateLimitContext(fromAddress(i)));
    try {
        guard.canActivate(rateLimitContext(fromAddress(50)));
        return false;
    } catch (error) {
        assert.equal(error.getResponse().retryAfterSeconds, 3600);
        return true;
    }
}

let skipMfa;
before(() => {
    // The CI bypass would let every request past the second factor unnamed.
    skipMfa = process.env.SAAS_PLATFORM_SKIP_MFA;
    delete process.env.SAAS_PLATFORM_SKIP_MFA;
});
after(() => {
    if (skipMfa !== undefined) process.env.SAAS_PLATFORM_SKIP_MFA = skipMfa;
});

/**
 * What each way names for `user` on a platform composed with `options`, beside
 * `expected`, for the ways that name someone else. What a fake recorded is
 * cleared before each way, so a way that never reaches its service cannot pass
 * on what the one before left.
 */
async function waysNamingOtherThan(options, user, expected) {
    const app = await platform(options);
    try {
        const others = [];
        for (const [way, read] of Object.entries(WAYS)) {
            for (const key of Object.keys(app.seen)) delete app.seen[key];
            const named = await read(app, user);
            if (named !== expected) others.push(`${way}: ${named}`);
        }
        const counted = await rateLimitedAfterFifty(app, user);
        if (counted !== (expected !== NOBODY)) others.push(`the rate limit: counted ${counted}`);
        return others;
    } finally {
        await app.moduleRef.close();
    }
}

const WITH_A_RESOLVER = { userIdResolver: (req) => req.user?.userId ?? null };

describe('without a resolver, every way reads `sub`, then `id`', () => {
    test('`sub` names the user', async () => {
        assert.deepEqual(await waysNamingOtherThan({}, { sub: 'u-sub' }, 'u-sub'), []);
    });

    test('`id` names the user', async () => {
        assert.deepEqual(await waysNamingOtherThan({}, { id: 'u-id' }, 'u-id'), []);
    });

    test('`sub` wins over a different `id`', async () => {
        assert.deepEqual(await waysNamingOtherThan({}, { sub: 'u-sub', id: 'u-id' }, 'u-sub'), []);
    });

    test('an empty `sub` names nobody, so the `id` beside it does', async () => {
        assert.deepEqual(await waysNamingOtherThan({}, { sub: '', id: 'u-id' }, 'u-id'), []);
    });

    test('`userId` alone names nobody', async () => {
        assert.deepEqual(await waysNamingOtherThan({}, { userId: 'u-user' }, NOBODY), []);
    });

    test('an empty `id` names nobody', async () => {
        assert.deepEqual(await waysNamingOtherThan({}, { id: '' }, NOBODY), []);
    });

    test('a user with none of the fields names nobody', async () => {
        assert.deepEqual(await waysNamingOtherThan({}, {}, NOBODY), []);
    });
});

describe("with a resolver at the module's root, every way reads it", () => {
    test('a `userId` the resolver reads names the user', async () => {
        assert.deepEqual(await waysNamingOtherThan(WITH_A_RESOLVER, { userId: 'u-7' }, 'u-7'), []);
    });

    test('a `sub` the resolver does not read names nobody', async () => {
        assert.deepEqual(await waysNamingOtherThan(WITH_A_RESOLVER, { sub: 'u-sub' }, NOBODY), []);
    });

    test('an empty value the resolver returns names nobody', async () => {
        assert.deepEqual(await waysNamingOtherThan(WITH_A_RESOLVER, { userId: '' }, NOBODY), []);
    });
});

describe('the rate limit keys its window by the same rule', () => {
    test('a request naming the same user by another shape shares the window', async () => {
        const app = await platform({});
        try {
            const guard = app.moduleRef.get(PromoCodeRateLimitGuard, { strict: false });
            for (let i = 0; i < 50; i++) {
                guard.canActivate(
                    rateLimitContext({
                        user: { sub: 'u-1' },
                        headers: { 'x-forwarded-for': `10.1.0.${i}` },
                    }),
                );
            }
            assert.doesNotThrow(() =>
                guard.canActivate(
                    rateLimitContext({
                        user: { sub: 'u-2', id: 'u-1' },
                        headers: { 'x-forwarded-for': '10.1.1.1' },
                    }),
                ),
            );
            assert.throws(() =>
                guard.canActivate(
                    rateLimitContext({
                        user: { sub: 'u-1', id: 'u-2' },
                        headers: { 'x-forwarded-for': '10.1.1.2' },
                    }),
                ),
            );
        } finally {
            await app.moduleRef.close();
        }
    });
});

describe('the actor beside the user', () => {
    test('an operator record and a tenant record take the e-mail and the session from the same place', async () => {
        const app = await platform({
            userEmailResolver: (req) => req.user?.mail ?? null,
            auditContextResolver: (req) => req.headers?.['x-trace'] ?? null,
        });
        try {
            const headers = { 'x-trace': 'trace-1', 'x-session-id': 'not-this' };
            const user = { sub: 'u-1', mail: 'u1@example.test', email: 'not-this@example.test' };
            const suspend = controllerFor(app, 'POST admin/tenants/:slug/suspend');
            await suspend.suspendTenant(request({ ...OPERATOR, ...user }, headers), 'acme', {});
            const exporter = controllerFor(app, 'GET billing/export');
            await assert.rejects(
                exporter.export(request({ ...TENANT_ADMIN, ...user }, headers)),
                ExportTaken,
            );
            for (const actor of [app.seen.suspendedBy, app.seen.exportedBy]) {
                assert.equal(actor.email, 'u1@example.test');
                assert.equal(actor.context, 'trace-1');
            }
        } finally {
            await app.moduleRef.close();
        }
    });

    test('without an e-mail the record says it does not know one, rather than inventing an address', async () => {
        const app = await platform({});
        try {
            const promo = controllerFor(app, 'POST admin/promo-codes');
            await promo.create(request({ ...OPERATOR, id: 'u-1' }), {
                code: 'WELCOME',
                discountType: 'PERCENT',
                discountValue: 10,
            });
            assert.equal(app.seen.audited.email, UNKNOWN);
            const suspend = controllerFor(app, 'POST admin/tenants/:slug/suspend');
            await suspend.suspendTenant(request({ ...OPERATOR, id: 'u-1' }), 'acme', {});
            assert.equal(app.seen.suspendedBy.email, UNKNOWN);
        } finally {
            await app.moduleRef.close();
        }
    });

    test('without a session, an operator record says it came from the administration', async () => {
        const app = await platform({});
        try {
            const suspend = controllerFor(app, 'POST admin/tenants/:slug/suspend');
            await suspend.suspendTenant(
                request({ ...OPERATOR, id: 'u-1', sessionId: 'from-the-token' }),
                'acme',
                {},
            );
            assert.equal(app.seen.suspendedBy.context, 'admin');
        } finally {
            await app.moduleRef.close();
        }
    });
});

/** Whether starting with `resolver` under `tenantBilling` is refused, naming the root. */
function refusedUnderTenantBilling(resolver) {
    const options = everythingOnOptions();
    assert.throws(
        () =>
            SaaSiCatModule.forRoot({
                ...options,
                tenantBilling: { ...options.tenantBilling, [resolver]: () => 'u-1' },
            }),
        (error) =>
            error.message.includes(`\`tenantBilling.${resolver}\``) &&
            error.message.includes(`\`SaaSiCatModule.forRoot({ ${resolver} })\``),
    );
}

describe('the resolvers live at the root, and nowhere else', () => {
    test('`tenantBilling.userIdResolver` refuses the start and names the root', () => {
        refusedUnderTenantBilling('userIdResolver');
    });

    test('`tenantBilling.userEmailResolver` refuses the start and names the root', () => {
        refusedUnderTenantBilling('userEmailResolver');
    });

    test('`tenantBilling.auditContextResolver` refuses the start and names the root', () => {
        refusedUnderTenantBilling('auditContextResolver');
    });
});
