import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import {
    FEATURE_GUARD_CONFIG_TOKEN,
    FeatureGuard,
    REQUIRE_FEATURE_KEY,
    UPSELL_OFFER_RESOLVER_TOKEN,
} from '../dist/billing/index.js';

// FeatureGuard: checks @RequireFeature(...) against the EntitlementSet provided
// by a stub `EntitlementService.computeLimits(tenantId)`. The tests cover the
// paths documented in feature.guard.ts — missing annotation, logical OR,
// SUPER_ADMIN bypass, tenant resolver, tenant context runner.

function buildContext({ user, tenantId, handlerFeatures, classFeatures }) {
    // Reflector reads via Reflect.getMetadata(REQUIRE_FEATURE_KEY, target).
    // We create a function target for handler + class each and store the
    // metadata exactly the way @RequireFeature(...) does.
    const handler = function handlerStub() {};
    const klass = function ClassStub() {};
    if (handlerFeatures) {
        Reflect.defineMetadata(REQUIRE_FEATURE_KEY, handlerFeatures, handler);
    }
    if (classFeatures) {
        Reflect.defineMetadata(REQUIRE_FEATURE_KEY, classFeatures, klass);
    }
    return {
        switchToHttp: () => ({
            getRequest: () => ({ user, tenantId }),
        }),
        getHandler: () => handler,
        getClass: () => klass,
    };
}

function buildEntitlementsStub(features = []) {
    const set = new Set(features);
    let calls = 0;
    return {
        async computeLimits() {
            calls += 1;
            return { plan: 'STANDARD', quotas: {}, features: set };
        },
        get callCount() {
            return calls;
        },
    };
}

describe('FeatureGuard — annotation evaluation', () => {
    test('lets routes without @RequireFeature pass unchecked', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub());
        const ctx = buildContext({});
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('@RequireFeature with an empty array passes unchecked', async () => {
        // Defensive design: empty list = no gate. Prevents an unfinished
        // annotation from accidentally blocking all tenants.
        const ents = buildEntitlementsStub();
        const guard = new FeatureGuard(new Reflector(), ents);
        const ctx = buildContext({ handlerFeatures: [] });
        assert.equal(await guard.canActivate(ctx), true);
        assert.equal(ents.callCount, 0, 'EntitlementService must not be called');
    });
});

describe('FeatureGuard — feature set matching', () => {
    test('lets the tenant through when the feature is active in the plan', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['WHATSAPP']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('blocks with ForbiddenException when the feature is missing', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['CORE_IDENTITY']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        await assert.rejects(() => guard.canActivate(ctx), /WHATSAPP nicht im aktuellen Paket/);
    });

    test('Logical OR: multiple features, one suffices (second matches)', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['ACCOUNTING']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['DATEV', 'ACCOUNTING'],
        });
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('Logical OR: none match → Forbidden with all keys in the message', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['CORE_IDENTITY']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['DATEV', 'ACCOUNTING'],
        });
        await assert.rejects(() => guard.canActivate(ctx), /DATEV \/ ACCOUNTING/);
    });

    test('Class-level annotation applies when the handler has none', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['WHATSAPP']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            classFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('Handler annotation overrides class annotation', async () => {
        // getAllAndOverride: handler metadata wins over class metadata.
        // Here the handler requires ['DATEV'], the class ['WHATSAPP'] — the
        // tenant only has WHATSAPP → must block.
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['WHATSAPP']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['DATEV'],
            classFeatures: ['WHATSAPP'],
        });
        await assert.rejects(() => guard.canActivate(ctx), /DATEV nicht im aktuellen Paket/);
    });
});

describe('FeatureGuard — auth paths', () => {
    test('SUPER_ADMIN bypasses the feature check', async () => {
        const ents = buildEntitlementsStub([]); // no features at all
        const guard = new FeatureGuard(new Reflector(), ents);
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'SUPER_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
        assert.equal(ents.callCount, 0, 'computeLimits must not be called');
    });

    test('SUPER_ADMIN via `platformRole` is detected', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub([]));
        const ctx = buildContext({
            user: { tenantId: 't1', platformRole: 'SUPER_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('missing user → Forbidden ("Nicht authentifiziert")', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub([]));
        const ctx = buildContext({ handlerFeatures: ['WHATSAPP'] });
        await assert.rejects(() => guard.canActivate(ctx), /Nicht authentifiziert/);
    });

    test('missing tenantId → Forbidden ("Kein Mandant zugeordnet")', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub([]));
        const ctx = buildContext({
            user: { role: 'TENANT_ADMIN' }, // no tenantId
            handlerFeatures: ['WHATSAPP'],
        });
        await assert.rejects(() => guard.canActivate(ctx), /Kein Mandant zugeordnet/);
    });

    test('tenantId from request.tenantId takes precedence over user.tenantId', async () => {
        const ents = {
            tenantSeen: null,
            async computeLimits(tenantId) {
                this.tenantSeen = tenantId;
                return { plan: 'STANDARD', quotas: {}, features: new Set(['WHATSAPP']) };
            },
        };
        const guard = new FeatureGuard(new Reflector(), ents);
        const ctx = buildContext({
            user: { tenantId: 'user-tenant', role: 'TENANT_ADMIN' },
            tenantId: 'request-tenant',
            handlerFeatures: ['WHATSAPP'],
        });
        await guard.canActivate(ctx);
        assert.equal(ents.tenantSeen, 'request-tenant');
    });
});

describe('FeatureGuard — config hooks', () => {
    test('tenantContextRunner wraps the computeLimits call (RLS consumers)', async () => {
        const calls = [];
        const config = {
            tenantContextRunner: async (tenantId, fn) => {
                calls.push({ tenantId, before: true });
                const result = await fn();
                calls.push({ tenantId, after: true });
                return result;
            },
        };
        const guard = new FeatureGuard(
            new Reflector(),
            buildEntitlementsStub(['WHATSAPP']),
            config,
        );
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
        assert.deepEqual(calls, [
            { tenantId: 't1', before: true },
            { tenantId: 't1', after: true },
        ]);
    });

    test('userRoleResolver allows a project-specific role source', async () => {
        const config = {
            userRoleResolver: (u) => u?.profile?.kind, // custom field
        };
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub([]), config);
        const ctx = buildContext({
            user: { tenantId: 't1', profile: { kind: 'SUPER_ADMIN' } },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(
            await guard.canActivate(ctx),
            true,
            'SUPER_ADMIN via custom resolver must trigger bypass',
        );
    });

    test('tenantIdResolver can fetch tenantId from an alternative field', async () => {
        const ents = {
            tenantSeen: null,
            async computeLimits(tenantId) {
                this.tenantSeen = tenantId;
                return { plan: 'STANDARD', quotas: {}, features: new Set(['WHATSAPP']) };
            },
        };
        const config = {
            tenantIdResolver: (req) => req.params?.tenantId,
        };
        const guard = new FeatureGuard(new Reflector(), ents, config);
        const ctx = {
            switchToHttp: () => ({
                getRequest: () => ({
                    user: { role: 'TENANT_ADMIN' },
                    params: { tenantId: 'param-tenant' },
                }),
            }),
            getHandler: () => {
                const fn = function () {};
                Reflect.defineMetadata(REQUIRE_FEATURE_KEY, ['WHATSAPP'], fn);
                return fn;
            },
            getClass: () => function () {},
        };
        await guard.canActivate(ctx);
        assert.equal(ents.tenantSeen, 'param-tenant');
    });
});

// FEATURE_GUARD_CONFIG_TOKEN is exported as a Symbol — a quick sanity check
// that the consumer module receives the right token (without this test a typo
// in the symbol name would only surface at bootstrap).
describe('FEATURE_GUARD_CONFIG_TOKEN', () => {
    test('is a Symbol with a descriptive name', () => {
        assert.equal(typeof FEATURE_GUARD_CONFIG_TOKEN, 'symbol');
        assert.equal(FEATURE_GUARD_CONFIG_TOKEN.toString(), 'Symbol(FEATURE_GUARD_CONFIG)');
    });
});

// Upsell response (#36): with a registered UpsellOfferResolver the 403 becomes
// machine-readable — code, featureKey(s), offers. Without a resolver the old
// plain-403 behavior remains (already tested above).
describe('FeatureGuard — upsell response (#36)', () => {
    function buildGuard({ features = [], resolver = null, config = null } = {}) {
        return new FeatureGuard(new Reflector(), buildEntitlementsStub(features), config, resolver);
    }

    async function rejectionOf(promise) {
        try {
            await promise;
        } catch (error) {
            return error;
        }
        assert.fail('canActivate must throw');
    }

    test('structured 403 body: code, featureKey, featureKeys, offers, message', async () => {
        const seen = [];
        const resolver = {
            async resolveOffers(featureKeys, tenantId) {
                seen.push({ featureKeys, tenantId });
                return [
                    {
                        bundleKey: 'TURNIERE',
                        bundleVersionId: 'bv-1',
                        priceMonthlyNet: 7.9,
                        currency: 'EUR',
                        label: 'Turniere',
                    },
                ];
            },
        };
        const guard = buildGuard({ features: ['CORE_IDENTITY'], resolver });
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['TOURNAMENT_MANAGEMENT'],
        });

        const error = await rejectionOf(guard.canActivate(ctx));
        assert.equal(error.getStatus(), 403, 'deliberately 403 + code field, NOT 402');
        assert.deepEqual(error.getResponse(), {
            code: 'FEATURE_NOT_LICENSED',
            featureKey: 'TOURNAMENT_MANAGEMENT',
            featureKeys: ['TOURNAMENT_MANAGEMENT'],
            offers: [
                {
                    bundleKey: 'TURNIERE',
                    bundleVersionId: 'bv-1',
                    priceMonthlyNet: 7.9,
                    currency: 'EUR',
                    label: 'Turniere',
                },
            ],
            message: 'Feature TOURNAMENT_MANAGEMENT nicht im aktuellen Paket enthalten.',
        });
        assert.deepEqual(seen, [{ featureKeys: ['TOURNAMENT_MANAGEMENT'], tenantId: 't1' }]);
    });

    test('Logical OR: featureKeys carries all required keys, featureKey the first', async () => {
        const resolver = { resolveOffers: async () => [] };
        const guard = buildGuard({ resolver });
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['DATEV', 'ACCOUNTING'],
        });
        const body = (await rejectionOf(guard.canActivate(ctx))).getResponse();
        assert.equal(body.featureKey, 'DATEV');
        assert.deepEqual(body.featureKeys, ['DATEV', 'ACCOUNTING']);
    });

    test('Resolver error degrades to offers: [] instead of 500', async () => {
        const resolver = {
            resolveOffers: async () => {
                throw new Error('Katalog-DB down');
            },
        };
        const guard = buildGuard({ resolver });
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        const error = await rejectionOf(guard.canActivate(ctx));
        assert.equal(error.getStatus(), 403);
        assert.deepEqual(error.getResponse().offers, []);
        assert.equal(error.getResponse().code, 'FEATURE_NOT_LICENSED');
    });

    test('Resolver is not called for a licensed feature', async () => {
        let calls = 0;
        const resolver = {
            resolveOffers: async () => {
                calls += 1;
                return [];
            },
        };
        const guard = buildGuard({ features: ['WHATSAPP'], resolver });
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
        assert.equal(calls, 0);
    });

    test('without a resolver the plain-403 remains (string message, no code field)', async () => {
        const guard = buildGuard();
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        const body = (await rejectionOf(guard.canActivate(ctx))).getResponse();
        assert.equal(body.message, 'Feature WHATSAPP nicht im aktuellen Paket enthalten.');
        assert.equal(body.code, undefined, 'no structured body without a resolver');
    });
});

// Symbol.for is mandatory (the CJS bundle duplicates shared modules per entry —
// a plain Symbol would be a different object per entry, cf. outage 2026-06-09).
describe('UPSELL_OFFER_RESOLVER_TOKEN', () => {
    test('is a Symbol.for token (process-wide registry)', () => {
        assert.equal(UPSELL_OFFER_RESOLVER_TOKEN, Symbol.for('saas-platform/UpsellOfferResolver'));
    });
});
