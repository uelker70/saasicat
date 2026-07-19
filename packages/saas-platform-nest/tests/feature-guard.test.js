import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import {
    FEATURE_GUARD_CONFIG_TOKEN,
    FeatureGuard,
    REQUIRE_FEATURE_KEY,
    UPSELL_OFFER_RESOLVER_TOKEN,
} from '../dist/billing/index.js';

// FeatureGuard: prüft @RequireFeature(...) gegen das EntitlementSet, das ein
// stub `EntitlementService.computeLimits(tenantId)` liefert. Die Tests decken
// die in feature.guard.ts dokumentierten Pfade ab — Annotation-Fehlend,
// Logical-OR, SUPER_ADMIN-Bypass, Tenant-Resolver, Tenant-Context-Runner.

function buildContext({ user, tenantId, handlerFeatures, classFeatures }) {
    // Reflector liest mit Reflect.getMetadata(REQUIRE_FEATURE_KEY, target).
    // Wir erzeugen für Handler + Class je ein Funktions-Target und legen die
    // Metadata exakt so ab, wie es @RequireFeature(...) tut.
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

describe('FeatureGuard — Annotation-Auswertung', () => {
    test('lässt Routen ohne @RequireFeature ungeprüft passieren', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub());
        const ctx = buildContext({});
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('@RequireFeature mit leerem Array passiert ungeprüft', async () => {
        // Defensive Auslegung: leere Liste = kein Gate. Verhindert, dass eine
        // unfertige Annotation versehentlich alle Tenants blockiert.
        const ents = buildEntitlementsStub();
        const guard = new FeatureGuard(new Reflector(), ents);
        const ctx = buildContext({ handlerFeatures: [] });
        assert.equal(await guard.canActivate(ctx), true);
        assert.equal(ents.callCount, 0, 'EntitlementService darf nicht gerufen werden');
    });
});

describe('FeatureGuard — Feature-Set-Abgleich', () => {
    test('lässt Tenant durch, wenn Feature im Plan aktiv ist', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['WHATSAPP']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('blockt mit ForbiddenException, wenn Feature fehlt', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['CORE_IDENTITY']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        await assert.rejects(() => guard.canActivate(ctx), /WHATSAPP nicht im aktuellen Paket/);
    });

    test('Logical-OR: mehrere Features, eines reicht (zweites matched)', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['ACCOUNTING']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['DATEV', 'ACCOUNTING'],
        });
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('Logical-OR: keines matched → Forbidden mit allen Keys in der Message', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['CORE_IDENTITY']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['DATEV', 'ACCOUNTING'],
        });
        await assert.rejects(() => guard.canActivate(ctx), /DATEV \/ ACCOUNTING/);
    });

    test('Class-Level-Annotation greift, wenn Handler keine hat', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['WHATSAPP']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            classFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('Handler-Annotation überschreibt Class-Annotation', async () => {
        // getAllAndOverride: Handler-Metadata gewinnt vor Class-Metadata.
        // Hier verlangt Handler ['DATEV'], Class ['WHATSAPP'] — Tenant hat
        // nur WHATSAPP → muss blocken.
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub(['WHATSAPP']));
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['DATEV'],
            classFeatures: ['WHATSAPP'],
        });
        await assert.rejects(() => guard.canActivate(ctx), /DATEV nicht im aktuellen Paket/);
    });
});

describe('FeatureGuard — Auth-Pfade', () => {
    test('SUPER_ADMIN umgeht den Feature-Check', async () => {
        const ents = buildEntitlementsStub([]); // gar keine Features
        const guard = new FeatureGuard(new Reflector(), ents);
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'SUPER_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
        assert.equal(ents.callCount, 0, 'computeLimits darf nicht gerufen werden');
    });

    test('SUPER_ADMIN über `platformRole` (Vereinsfux-Variante) wird erkannt', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub([]));
        const ctx = buildContext({
            user: { tenantId: 't1', platformRole: 'SUPER_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(await guard.canActivate(ctx), true);
    });

    test('fehlender User → Forbidden ("Nicht authentifiziert")', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub([]));
        const ctx = buildContext({ handlerFeatures: ['WHATSAPP'] });
        await assert.rejects(() => guard.canActivate(ctx), /Nicht authentifiziert/);
    });

    test('fehlende tenantId → Forbidden ("Kein Mandant zugeordnet")', async () => {
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub([]));
        const ctx = buildContext({
            user: { role: 'TENANT_ADMIN' }, // kein tenantId
            handlerFeatures: ['WHATSAPP'],
        });
        await assert.rejects(() => guard.canActivate(ctx), /Kein Mandant zugeordnet/);
    });

    test('tenantId aus request.tenantId hat Vorrang vor user.tenantId', async () => {
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

describe('FeatureGuard — Konfig-Hooks', () => {
    test('tenantContextRunner wickelt computeLimits-Aufruf ein (RLS-Konsumenten)', async () => {
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

    test('userRoleResolver erlaubt projekt-spezifische Rollen-Quelle', async () => {
        const config = {
            userRoleResolver: (u) => u?.profile?.kind, // benutzerdefiniertes Feld
        };
        const guard = new FeatureGuard(new Reflector(), buildEntitlementsStub([]), config);
        const ctx = buildContext({
            user: { tenantId: 't1', profile: { kind: 'SUPER_ADMIN' } },
            handlerFeatures: ['WHATSAPP'],
        });
        assert.equal(
            await guard.canActivate(ctx),
            true,
            'SUPER_ADMIN über custom resolver muss bypass auslösen',
        );
    });

    test('tenantIdResolver kann tenantId aus alternativem Feld holen', async () => {
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

// FEATURE_GUARD_CONFIG_TOKEN ist als Symbol exportiert — kurzer Sanity-Check,
// dass das Konsumenten-Modul den richtigen Token bekommt (ohne diesen Test
// würde ein Tippfehler im Symbol-Namen erst beim Bootstrap auffallen).
describe('FEATURE_GUARD_CONFIG_TOKEN', () => {
    test('ist ein Symbol mit beschreibendem Namen', () => {
        assert.equal(typeof FEATURE_GUARD_CONFIG_TOKEN, 'symbol');
        assert.equal(FEATURE_GUARD_CONFIG_TOKEN.toString(), 'Symbol(FEATURE_GUARD_CONFIG)');
    });
});

// Upsell-Response (#36): mit registriertem UpsellOfferResolver wird der 403
// maschinenlesbar — code, featureKey(s), offers. Ohne Resolver bleibt das
// alte plain-403-Verhalten (oben bereits getestet).
describe('FeatureGuard — Upsell-Response (#36)', () => {
    function buildGuard({ features = [], resolver = null, config = null } = {}) {
        return new FeatureGuard(new Reflector(), buildEntitlementsStub(features), config, resolver);
    }

    async function rejectionOf(promise) {
        try {
            await promise;
        } catch (error) {
            return error;
        }
        assert.fail('canActivate muss werfen');
    }

    test('strukturierter 403-Body: code, featureKey, featureKeys, offers, message', async () => {
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
        assert.equal(error.getStatus(), 403, 'bewusst 403 + code-Feld, NICHT 402');
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

    test('Logical-OR: featureKeys trägt alle geforderten Keys, featureKey den ersten', async () => {
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

    test('Resolver-Fehler degradiert auf offers: [] statt 500', async () => {
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

    test('Resolver wird bei lizenziertem Feature nicht gerufen', async () => {
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

    test('ohne Resolver bleibt der plain-403 (string message, kein code-Feld)', async () => {
        const guard = buildGuard();
        const ctx = buildContext({
            user: { tenantId: 't1', role: 'TENANT_ADMIN' },
            handlerFeatures: ['WHATSAPP'],
        });
        const body = (await rejectionOf(guard.canActivate(ctx))).getResponse();
        assert.equal(body.message, 'Feature WHATSAPP nicht im aktuellen Paket enthalten.');
        assert.equal(body.code, undefined, 'kein strukturierter Body ohne Resolver');
    });
});

// Symbol.for-Pflicht (CJS-Bundle dupliziert geteilte Module je Entry —
// plain Symbol wäre pro Entry ein anderes Objekt, vgl. Outage 2026-06-09).
describe('UPSELL_OFFER_RESOLVER_TOKEN', () => {
    test('ist ein Symbol.for-Token (prozessweite Registry)', () => {
        assert.equal(UPSELL_OFFER_RESOLVER_TOKEN, Symbol.for('saas-platform/UpsellOfferResolver'));
    });
});
