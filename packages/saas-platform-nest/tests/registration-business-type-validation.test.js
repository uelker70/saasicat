// SPEC_V2 §11.1 M5.3 — saveConfiguration validiert eine optional gesetzte
// `RegistrationConfigSelection.businessTypeVersionId` gegen den App-Adapter
// `RegistrationBusinessTypeLookup`. Drei Pfade:
//   1. Lookup nicht konfiguriert + ID gesetzt → ID wird ungeprüft akzeptiert
//   2. Lookup konfiguriert + ID liefert View → success
//   3. Lookup konfiguriert + ID liefert null → BadRequest BUSINESS_TYPE_NOT_AVAILABLE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingRegistrationService } from '../dist/registration/index.js';

class FakeRepository {
    constructor() {
        this.rows = new Map();
    }
    async findById(id) {
        return this.rows.get(id) ?? null;
    }
    async findByEmail() {
        return null;
    }
    async findByCheckoutSession() {
        return null;
    }
    async findExpired() {
        return [];
    }
    async create(input) {
        const id = `pending_test`;
        const row = {
            id,
            tenantName: input.tenantName,
            tenantSlug: input.tenantSlug,
            salutation: input.salutation,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            passwordHash: input.passwordHash,
            locale: input.locale,
            status: 'EMAIL_VERIFIED',
            currentStep: 3,
            emailVerifiedAt: new Date(),
            otpHash: null,
            otpExpiresAt: null,
            otpSendCount: 0,
            lastOtpSentAt: null,
            otpAttemptCount: 0,
            selectedPlanId: null,
            configJson: null,
            billingCycle: null,
            appliedPromoCode: null,
            checkoutSessionId: null,
            checkoutStartedAt: null,
            expiresAt: input.expiresAt,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.rows.set(id, row);
        return row;
    }
    async update(id, input) {
        const existing = this.rows.get(id);
        if (!existing) throw new Error(`pending ${id} not found`);
        const updated = { ...existing, ...input, updatedAt: new Date() };
        this.rows.set(id, updated);
        return updated;
    }
    async incrementOtpAttemptCount(id) {
        const existing = this.rows.get(id);
        if (!existing) throw new Error(`pending ${id} not found`);
        const updated = {
            ...existing,
            otpAttemptCount: existing.otpAttemptCount + 1,
            updatedAt: new Date(),
        };
        this.rows.set(id, updated);
        return updated.otpAttemptCount;
    }
    async delete(id) {
        this.rows.delete(id);
    }
}

const noop = async () => undefined;

const fakeAudit = { log: noop };
const fakeOtpDelivery = { sendVerificationOtp: noop };
const fakeUserLookup = { hasActiveUser: async () => false };
const fakeSlugCheck = { isSlugAvailable: async () => true };
const fakeHasher = { hash: async (x) => `h:${x}`, verify: async () => true };
const fakePlanCatalog = {
    listPublicSignupPlans: async () => [],
    findPublicSignupPlan: async () => null,
};
const fakePaymentProvider = {
    createCheckoutSession: async () => ({
        sessionId: 's',
        checkoutUrl: 'u',
        provider: 'fake',
    }),
};
const fakePaymentEventLog = {
    tryClaim: async () => true,
};
const fakeActivationOrchestrator = {
    activate: async () => ({ userId: 'u', tenantId: 't', subscriptionId: 's' }),
};

const fakeConfiguratorCatalog = {
    cycleDiscount: 10,
    currency: 'EUR',
    vatRate: 0,
    categories: [],
    models: [
        {
            id: 'starter',
            code: 'STARTER',
            name: 'Starter',
            glyph: '*',
            tagline: '',
            planId: 'STARTER',
            monthlyNet: 9.9,
            yearlyNet: 99,
            tags: [],
            includedModuleIds: [],
            quotaBase: {},
        },
    ],
    modules: [],
    bundles: [],
    quotas: [],
};
const fakeConfiguratorLookup = {
    getCatalog: async () => fakeConfiguratorCatalog,
};

class FakeBusinessTypeLookup {
    constructor(views = new Map()) {
        this.views = views;
    }
    async findPublishedVersion(id) {
        return this.views.get(id) ?? null;
    }
}

function makeService({ businessTypeLookup } = {}) {
    const repo = new FakeRepository();
    const service = new PendingRegistrationService(
        repo,
        fakeOtpDelivery,
        fakeUserLookup,
        fakeSlugCheck,
        fakeHasher,
        fakePlanCatalog,
        fakePaymentProvider,
        fakePaymentEventLog,
        fakeActivationOrchestrator,
        fakeAudit,
        undefined, // resumeTokenSigner
        undefined, // resumeDelivery
        undefined, // resumeBaseUrl
        fakeConfiguratorLookup,
        undefined, // promoPreview
        businessTypeLookup,
    );
    return { service, repo };
}

async function seedEmailVerified(repo) {
    return repo.create({
        tenantName: 'V',
        tenantSlug: null,
        salutation: null,
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.de',
        passwordHash: 'h',
        locale: 'de',
        otpHash: null,
        otpExpiresAt: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
}

const VALID_UUID = '11111111-2222-3333-4444-555555555555';
const UNKNOWN_UUID = '99999999-9999-9999-9999-999999999999';

const baseSelection = {
    modelId: 'starter',
    moduleIds: [],
    bundleIds: [],
    quotaDelta: {},
    billingCycle: 'MONTHLY',
    appliedPromoCode: null,
};

test('saveConfiguration: ohne BusinessType-Lookup wird die ID ungeprüft akzeptiert', async () => {
    const { service, repo } = makeService(); // kein businessTypeLookup
    const pending = await seedEmailVerified(repo);

    const result = await service.saveConfiguration({
        pendingRegistrationId: pending.id,
        selection: { ...baseSelection, businessTypeVersionId: UNKNOWN_UUID },
    });

    assert.equal(result.status, 'PLAN_SELECTED');
    assert.equal(result.selection.businessTypeVersionId, UNKNOWN_UUID);
    const stored = await repo.findById(pending.id);
    assert.equal(stored.configJson.businessTypeVersionId, UNKNOWN_UUID);
});

test('saveConfiguration: mit Lookup → bekannte ID akzeptiert + persistiert', async () => {
    const businessTypeLookup = new FakeBusinessTypeLookup(
        new Map([
            [
                VALID_UUID,
                {
                    businessTypeVersionId: VALID_UUID,
                    businessTypeId: 'bt-uuid-1',
                    businessTypeKey: 'SPORT_VEREIN',
                    label: 'Sportverein',
                    version: 1,
                    projectKey: 'clubapp',
                },
            ],
        ]),
    );
    const { service, repo } = makeService({ businessTypeLookup });
    const pending = await seedEmailVerified(repo);

    const result = await service.saveConfiguration({
        pendingRegistrationId: pending.id,
        selection: { ...baseSelection, businessTypeVersionId: VALID_UUID },
    });

    assert.equal(result.status, 'PLAN_SELECTED');
    assert.equal(result.selection.businessTypeVersionId, VALID_UUID);
    const stored = await repo.findById(pending.id);
    assert.equal(stored.configJson.businessTypeVersionId, VALID_UUID);
});

test('saveConfiguration: mit Lookup → unbekannte ID wirft BUSINESS_TYPE_NOT_AVAILABLE', async () => {
    const businessTypeLookup = new FakeBusinessTypeLookup(); // leer
    const { service, repo } = makeService({ businessTypeLookup });
    const pending = await seedEmailVerified(repo);

    await assert.rejects(
        () =>
            service.saveConfiguration({
                pendingRegistrationId: pending.id,
                selection: { ...baseSelection, businessTypeVersionId: UNKNOWN_UUID },
            }),
        (err) => {
            assert.equal(err.status, 400);
            assert.equal(err.response?.code, 'BUSINESS_TYPE_NOT_AVAILABLE');
            return true;
        },
    );
});

test('saveConfiguration: mit Lookup, ohne BusinessType-Wahl → kein Lookup-Call', async () => {
    let calls = 0;
    const businessTypeLookup = {
        async findPublishedVersion() {
            calls++;
            return null;
        },
    };
    const { service, repo } = makeService({ businessTypeLookup });
    const pending = await seedEmailVerified(repo);

    const result = await service.saveConfiguration({
        pendingRegistrationId: pending.id,
        selection: { ...baseSelection /* keine businessTypeVersionId */ },
    });

    assert.equal(result.status, 'PLAN_SELECTED');
    assert.equal(calls, 0, 'Lookup darf bei null/undefined-ID nicht aufgerufen werden');
});

test('saveConfiguration: businessTypeVersionId === null → kein Lookup-Call', async () => {
    let calls = 0;
    const businessTypeLookup = {
        async findPublishedVersion() {
            calls++;
            return null;
        },
    };
    const { service, repo } = makeService({ businessTypeLookup });
    const pending = await seedEmailVerified(repo);

    const result = await service.saveConfiguration({
        pendingRegistrationId: pending.id,
        selection: { ...baseSelection, businessTypeVersionId: null },
    });

    assert.equal(result.status, 'PLAN_SELECTED');
    assert.equal(calls, 0);
    assert.equal(result.selection.businessTypeVersionId ?? null, null);
});
