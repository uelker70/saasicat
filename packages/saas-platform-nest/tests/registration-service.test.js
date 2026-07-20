// Tests for @saasicat/nest/registration — PendingRegistrationService.
//
// Covers the paths from the registration spec:
//  - start() creates PendingRegistration + OTP dispatch
//  - start() neutralizes active user (case A)
//  - start() regenerates OTP for existing PENDING_EMAIL_VERIFICATION (case B)
//  - start() deletes expired PendingRegistration and creates a new one (case E)
//  - start() resolves slug collision via suffix variant
//  - start() generates slug from tenantName when empty
//  - verifyOtp() success → EMAIL_VERIFIED + nextStep=3
//  - verifyOtp() expired → OTP_EXPIRED
//  - verifyOtp() wrong → OTP_INVALID
//  - verifyOtp() brute-force lockout → OTP_LOCKED (even with correct code)
//  - resendOtp() success
//  - resendOtp() rate-limited → silently dropped
//  - OTP is never stored in plaintext

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OTP_VERIFY_MAX_ATTEMPTS } from '@saasicat/types';
import { PendingRegistrationService, hashOtpCode } from '../dist/registration/index.js';

// ─── Test doubles ───────────────────────────────────────────────────────────

class FakeRepository {
    constructor() {
        this.rows = new Map();
        this.nextId = 1;
    }
    async findById(id) {
        return this.rows.get(id) ?? null;
    }
    async findByEmail(email) {
        for (const row of this.rows.values()) {
            if (row.email === email) return row;
        }
        return null;
    }
    async findByCheckoutSession(sessionId) {
        for (const row of this.rows.values()) {
            if (row.checkoutSessionId === sessionId) return row;
        }
        return null;
    }
    async findExpired(now, limit) {
        const expired = [];
        for (const row of this.rows.values()) {
            if (row.expiresAt.getTime() < now.getTime()) {
                expired.push(row);
                if (expired.length >= limit) break;
            }
        }
        return expired;
    }
    async create(input) {
        const id = `pending_${this.nextId++}`;
        const now = new Date();
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
            status: 'PENDING_EMAIL_VERIFICATION',
            currentStep: 2,
            emailVerifiedAt: null,
            otpHash: input.otpHash,
            otpExpiresAt: input.otpExpiresAt,
            otpSendCount: 1,
            lastOtpSentAt: now,
            otpAttemptCount: 0,
            selectedPlanId: null,
            checkoutSessionId: null,
            checkoutStartedAt: null,
            expiresAt: input.expiresAt,
            createdAt: now,
            updatedAt: now,
        };
        this.rows.set(id, row);
        return row;
    }
    // Deliberately last-write-wins (like an UPDATE ... SET in the DB): parallel
    // writers with a stale read state overwrite each other.
    async update(id, input) {
        const existing = this.rows.get(id);
        if (!existing) throw new Error(`pending ${id} not found`);
        const updated = { ...existing, ...input, updatedAt: new Date() };
        this.rows.set(id, updated);
        return updated;
    }
    // Truly atomic: reads the state at execution time, not a
    // previously read snapshot — analogous to Prisma `{ increment: 1 }`.
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

class FakeOtpDelivery {
    constructor() {
        this.sent = [];
    }
    async sendVerificationOtp(params) {
        this.sent.push(params);
    }
}

class FakeUserLookup {
    constructor(activeEmails = []) {
        this.activeEmails = new Set(activeEmails);
    }
    async hasActiveUser(email) {
        return this.activeEmails.has(email);
    }
}

class FakeSlugCheck {
    constructor(takenSlugs = []) {
        this.taken = new Set(takenSlugs);
    }
    async isSlugAvailable(slug) {
        return !this.taken.has(slug);
    }
}

class FakePasswordHasher {
    async hash(plain) {
        return `hashed:${plain}`;
    }
    async verify(hash, plain) {
        return hash === `hashed:${plain}`;
    }
}

class FakeResumeTokenSigner {
    constructor() {
        this.tokens = new Map();
        this.next = 1;
    }
    async sign(params) {
        const t = `resume_${this.next++}`;
        this.tokens.set(t, params.pendingRegistrationId);
        return t;
    }
    async verify(token) {
        const pid = this.tokens.get(token);
        if (!pid) throw new Error('invalid');
        return { pendingRegistrationId: pid };
    }
}

class FakeResumeDelivery {
    constructor() {
        this.sent = [];
    }
    async sendResumeEmail(params) {
        this.sent.push(params);
    }
}

class FakeAuditLogger {
    constructor() {
        this.events = [];
    }
    async log(event) {
        this.events.push(event);
    }
    byType(type) {
        return this.events.filter((e) => e.eventType === type);
    }
}

class FakePaymentEventLog {
    constructor() {
        this.claimed = new Map();
    }
    async tryClaim(eventId, payload) {
        if (this.claimed.has(eventId)) return false;
        this.claimed.set(eventId, { ...payload, at: new Date() });
        return true;
    }
}

class FakeActivationOrchestrator {
    constructor() {
        this.calls = [];
        this.nextId = 1;
    }
    async activate(pending) {
        this.calls.push(pending);
        const n = this.nextId++;
        return {
            userId: `user_${n}`,
            tenantId: `tenant_${n}`,
            subscriptionId: `sub_${n}`,
        };
    }
}

class FakePaymentProvider {
    constructor() {
        this.calls = [];
    }
    async createCheckoutSession(params) {
        this.calls.push(params);
        return {
            sessionId: `stub_${this.calls.length}`,
            checkoutUrl: `https://stub.example/checkout/${this.calls.length}?ref=${params.pendingRegistrationId}`,
            provider: 'fake',
        };
    }
}

class FakePlanCatalog {
    constructor(
        plans = [
            {
                id: 'STANDARD',
                name: 'Standard',
                monthlyNet: 19,
                yearlyNet: 190,
                features: ['members'],
            },
            {
                id: 'PROFESSIONAL',
                name: 'Professional',
                monthlyNet: 49,
                yearlyNet: 490,
                popular: true,
                features: ['members', 'finance'],
            },
        ],
    ) {
        this.plans = plans;
    }
    async listPublicSignupPlans() {
        return this.plans;
    }
    async findPublicSignupPlan(id) {
        return this.plans.find((p) => p.id === id) ?? null;
    }
}

function makeService(overrides = {}) {
    const repo = overrides.repo ?? new FakeRepository();
    const delivery = overrides.delivery ?? new FakeOtpDelivery();
    const userLookup = overrides.userLookup ?? new FakeUserLookup();
    const slugCheck = overrides.slugCheck ?? new FakeSlugCheck();
    const hasher = overrides.hasher ?? new FakePasswordHasher();
    const planCatalog = overrides.planCatalog ?? new FakePlanCatalog();
    const paymentProvider = overrides.paymentProvider ?? new FakePaymentProvider();
    const paymentEventLog = overrides.paymentEventLog ?? new FakePaymentEventLog();
    const activationOrchestrator =
        overrides.activationOrchestrator ?? new FakeActivationOrchestrator();
    const audit = overrides.audit ?? new FakeAuditLogger();
    const resumeTokenSigner =
        overrides.resumeTokenSigner === undefined
            ? new FakeResumeTokenSigner()
            : overrides.resumeTokenSigner;
    const resumeDelivery =
        overrides.resumeDelivery === undefined
            ? new FakeResumeDelivery()
            : overrides.resumeDelivery;
    const resumeBaseUrl = overrides.resumeBaseUrl ?? 'https://app.example';
    return {
        service: new PendingRegistrationService(
            repo,
            delivery,
            userLookup,
            slugCheck,
            hasher,
            planCatalog,
            paymentProvider,
            paymentEventLog,
            activationOrchestrator,
            audit,
            resumeTokenSigner ?? undefined,
            resumeDelivery ?? undefined,
            resumeBaseUrl,
        ),
        repo,
        delivery,
        userLookup,
        slugCheck,
        hasher,
        planCatalog,
        paymentProvider,
        paymentEventLog,
        activationOrchestrator,
        audit,
        resumeTokenSigner,
        resumeDelivery,
    };
}

function baseInput(overrides = {}) {
    return {
        tenantName: 'Mein Verein',
        firstName: 'Max',
        lastName: 'Mustermann',
        email: 'max@example.com',
        password: 'Password123',
        locale: 'de',
        ...overrides,
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('start() creates PendingRegistration and sends OTP', async () => {
    const ctx = makeService();
    const result = await ctx.service.start(baseInput());
    assert.deepEqual(result, { neutral: true });

    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.ok(stored);
    assert.equal(stored.tenantName, 'Mein Verein');
    assert.equal(stored.tenantSlug, 'mein-verein');
    assert.equal(stored.firstName, 'Max');
    assert.equal(stored.lastName, 'Mustermann');
    assert.equal(stored.email, 'max@example.com');
    assert.equal(stored.passwordHash, 'hashed:Password123');
    assert.equal(stored.status, 'PENDING_EMAIL_VERIFICATION');
    assert.equal(stored.locale, 'de');
    assert.equal(typeof stored.otpHash, 'string');
    assert.equal(stored.otpHash.length, 64);

    assert.equal(ctx.delivery.sent.length, 1);
    assert.equal(ctx.delivery.sent[0].to, 'max@example.com');
    assert.match(ctx.delivery.sent[0].code, /^\d{6}$/);
});

test('start() stores OTP only as a hash, never in plaintext', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const stored = await ctx.repo.findByEmail('max@example.com');
    const sentCode = ctx.delivery.sent[0].code;
    assert.notEqual(stored.otpHash, sentCode);
    assert.equal(stored.otpHash, hashOtpCode(sentCode));
});

test('start() with active user → no PendingRegistration created', async () => {
    const ctx = makeService({
        userLookup: new FakeUserLookup(['max@example.com']),
    });
    const result = await ctx.service.start(baseInput());
    assert.deepEqual(result, { neutral: true });
    assert.equal(await ctx.repo.findByEmail('max@example.com'), null);
    assert.equal(ctx.delivery.sent.length, 0);
});

test('start() with colliding slug → suffix variant', async () => {
    const ctx = makeService({
        slugCheck: new FakeSlugCheck(['mein-verein', 'mein-verein-2']),
    });
    await ctx.service.start(baseInput());
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.tenantSlug, 'mein-verein-3');
});

test('start() with explicit tenantSlug adopts it when available', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ tenantSlug: 'fc-bayern' }));
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.tenantSlug, 'fc-bayern');
});

test('start() email normalization: trim + lowercase', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ email: '  MAX@Example.COM  ' }));
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.ok(stored);
});

test('start() with expired PendingRegistration → deletes + creates new', async () => {
    const ctx = makeService();
    // Manually create the first registration with an expired expiresAt.
    const past = new Date(Date.now() - 1000);
    await ctx.repo.create({
        tenantName: 'Alt',
        tenantSlug: 'alt',
        salutation: null,
        firstName: 'Old',
        lastName: 'Data',
        email: 'max@example.com',
        passwordHash: 'hashed:old',
        locale: 'de',
        otpHash: 'oldhash',
        otpExpiresAt: past,
        expiresAt: past,
    });

    await ctx.service.start(baseInput());
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.tenantName, 'Mein Verein');
    assert.equal(stored.firstName, 'Max');
    // Exactly one entry (the old one was deleted):
    let count = 0;
    for (const _ of ctx.repo.rows.values()) count++;
    assert.equal(count, 1);
});

test('start() with existing PENDING_EMAIL_VERIFICATION → OTP is regenerated', async () => {
    const ctx = makeService();
    const future = new Date(Date.now() + 3600_000);
    const created = await ctx.repo.create({
        tenantName: 'Bestand',
        tenantSlug: 'bestand',
        salutation: null,
        firstName: 'Be',
        lastName: 'Stand',
        email: 'max@example.com',
        passwordHash: 'hashed:secret',
        locale: 'de',
        otpHash: 'oldhash',
        otpExpiresAt: future,
        expiresAt: future,
    });
    const oldHash = created.otpHash;

    await ctx.service.start(baseInput());
    const after = await ctx.repo.findByEmail('max@example.com');
    // Tenant name stays (no overwrite by a potential attacker):
    assert.equal(after.tenantName, 'Bestand');
    // But the OTP was regenerated:
    assert.notEqual(after.otpHash, oldHash);
    assert.equal(ctx.delivery.sent.length, 1);
});

test('verifyOtp() success → EMAIL_VERIFIED + nextStep 3', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const code = ctx.delivery.sent[0].code;
    const result = await ctx.service.verifyOtp('max@example.com', code);
    assert.equal(result.status, 'EMAIL_VERIFIED');
    assert.equal(result.nextStep, 3);

    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.status, 'EMAIL_VERIFIED');
    assert.equal(stored.currentStep, 3);
    assert.equal(stored.otpHash, null);
    assert.equal(stored.otpExpiresAt, null);
    assert.ok(stored.emailVerifiedAt instanceof Date);
});

test('verifyOtp() expired OTP → OTP_EXPIRED', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const stored = await ctx.repo.findByEmail('max@example.com');
    // Set OTP expiry into the past:
    await ctx.repo.update(stored.id, { otpExpiresAt: new Date(Date.now() - 1000) });
    const code = ctx.delivery.sent[0].code;
    await assert.rejects(
        () => ctx.service.verifyOtp('max@example.com', code),
        (err) => err.getResponse().code === 'OTP_EXPIRED',
    );
});

test('verifyOtp() wrong code → OTP_INVALID', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    await assert.rejects(
        () => ctx.service.verifyOtp('max@example.com', '000000'),
        (err) => err.getResponse().code === 'OTP_INVALID',
    );
});

test('verifyOtp() unknown email → OTP_INVALID', async () => {
    const ctx = makeService();
    await assert.rejects(
        () => ctx.service.verifyOtp('unknown@example.com', '123456'),
        (err) => err.getResponse().code === 'OTP_INVALID',
    );
});

// ─── Brute-force lockout ────────────────────────────────────────────────────

async function exhaustOtpAttempts(ctx, email = 'max@example.com') {
    for (let i = 0; i < OTP_VERIFY_MAX_ATTEMPTS; i++) {
        await assert.rejects(
            () => ctx.service.verifyOtp(email, '000000'),
            (err) => err.getResponse().code === 'OTP_INVALID',
        );
    }
}

test('verifyOtp() after 5 failed attempts → OTP_LOCKED', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    await exhaustOtpAttempts(ctx);

    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.otpAttemptCount, OTP_VERIFY_MAX_ATTEMPTS);
    await assert.rejects(
        () => ctx.service.verifyOtp('max@example.com', '000000'),
        (err) => err.getResponse().code === 'OTP_LOCKED',
    );
});

test('verifyOtp() correct code after lockout → still OTP_LOCKED', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const code = ctx.delivery.sent[0].code;
    await exhaustOtpAttempts(ctx);

    await assert.rejects(
        () => ctx.service.verifyOtp('max@example.com', code),
        (err) => err.getResponse().code === 'OTP_LOCKED',
    );
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.status, 'PENDING_EMAIL_VERIFICATION');
});

test('verifyOtp() correct code under the limit → success', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const code = ctx.delivery.sent[0].code;
    for (let i = 0; i < OTP_VERIFY_MAX_ATTEMPTS - 1; i++) {
        await assert.rejects(
            () => ctx.service.verifyOtp('max@example.com', '000000'),
            (err) => err.getResponse().code === 'OTP_INVALID',
        );
    }

    const result = await ctx.service.verifyOtp('max@example.com', code);
    assert.equal(result.status, 'EMAIL_VERIFIED');
});

test('verifyOtp() parallel failed attempts with stale counter → atomic increment locks', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const code = ctx.delivery.sent[0].code;
    for (let i = 0; i < OTP_VERIFY_MAX_ATTEMPTS - 1; i++) {
        await assert.rejects(
            () => ctx.service.verifyOtp('max@example.com', '000000'),
            (err) => err.getResponse().code === 'OTP_INVALID',
        );
    }

    // Both requests read the same state (limit-1) and pass the
    // pre-check — only the atomic increment counts both correctly: one
    // consumes the last attempt (OTP_INVALID), the other runs into
    // the barrier (OTP_LOCKED). With the earlier read-modify-write via
    // update() (last-write-wins in FakeRepository) both would have written the
    // same state and one guess attempt would have been lost.
    const results = await Promise.allSettled([
        ctx.service.verifyOtp('max@example.com', '000000'),
        ctx.service.verifyOtp('max@example.com', '000000'),
    ]);
    assert.ok(results.every((r) => r.status === 'rejected'));
    const codes = results.map((r) => r.reason.getResponse().code).sort();
    assert.deepEqual(codes, ['OTP_INVALID', 'OTP_LOCKED']);

    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.otpAttemptCount, OTP_VERIFY_MAX_ATTEMPTS + 1);
    // After a total of >= 5 failed attempts even the correct code stays locked.
    await assert.rejects(
        () => ctx.service.verifyOtp('max@example.com', code),
        (err) => err.getResponse().code === 'OTP_LOCKED',
    );
});

test('resendOtp() after lockout → new code unlocks (counter reset)', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    await exhaustOtpAttempts(ctx);

    await ctx.service.resendOtp('max@example.com');
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.otpAttemptCount, 0);

    const newCode = ctx.delivery.sent[ctx.delivery.sent.length - 1].code;
    const result = await ctx.service.verifyOtp('max@example.com', newCode);
    assert.equal(result.status, 'EMAIL_VERIFIED');
});

test('verifyOtp() lockout limit overridable via env', async () => {
    const oldEnv = process.env.SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS;
    process.env.SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS = '2';
    try {
        const ctx = makeService();
        await ctx.service.start(baseInput());
        for (let i = 0; i < 2; i++) {
            await assert.rejects(
                () => ctx.service.verifyOtp('max@example.com', '000000'),
                (err) => err.getResponse().code === 'OTP_INVALID',
            );
        }
        await assert.rejects(
            () => ctx.service.verifyOtp('max@example.com', '000000'),
            (err) => err.getResponse().code === 'OTP_LOCKED',
        );
    } finally {
        if (oldEnv === undefined) delete process.env.SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS;
        else process.env.SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS = oldEnv;
    }
});

test('resendOtp() success → new OTP is sent', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const firstCode = ctx.delivery.sent[0].code;
    const result = await ctx.service.resendOtp('max@example.com');
    assert.deepEqual(result, { neutral: true });
    assert.equal(ctx.delivery.sent.length, 2);
    // Code changes (with high probability):
    assert.notEqual(ctx.delivery.sent[1].code, firstCode);
});

test('resendOtp() rate limit kicks in → silently dropped after 3 sends', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput()); // send 1
    await ctx.service.resendOtp('max@example.com'); // send 2
    await ctx.service.resendOtp('max@example.com'); // send 3
    await ctx.service.resendOtp('max@example.com'); // dropped
    assert.equal(ctx.delivery.sent.length, 3);
});

test('resendOtp() unknown email → neutral response, no throw', async () => {
    const ctx = makeService();
    const result = await ctx.service.resendOtp('unknown@example.com');
    assert.deepEqual(result, { neutral: true });
    assert.equal(ctx.delivery.sent.length, 0);
});

// ─── Step 3: selectPlan ─────────────────────────────────────────────────────

async function startThenVerify(ctx, email = 'plan@example.com') {
    await ctx.service.start(baseInput({ email }));
    const code = ctx.delivery.sent[ctx.delivery.sent.length - 1].code;
    return ctx.service.verifyOtp(email, code);
}

test('selectPlan() success → status PLAN_SELECTED + nextStep 4', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx);
    const result = await ctx.service.selectPlan({
        pendingRegistrationId: verify.pendingRegistrationId,
        planId: 'STANDARD',
    });
    assert.equal(result.status, 'PLAN_SELECTED');
    assert.equal(result.nextStep, 4);
    assert.equal(result.selectedPlanId, 'STANDARD');

    const stored = await ctx.repo.findById(verify.pendingRegistrationId);
    assert.equal(stored.status, 'PLAN_SELECTED');
    assert.equal(stored.currentStep, 4);
    assert.equal(stored.selectedPlanId, 'STANDARD');
});

test('selectPlan() unknown PendingRegistration → PENDING_REGISTRATION_NOT_FOUND', async () => {
    const ctx = makeService();
    await assert.rejects(
        () =>
            ctx.service.selectPlan({ pendingRegistrationId: 'does-not-exist', planId: 'STANDARD' }),
        (err) => err.getResponse().code === 'PENDING_REGISTRATION_NOT_FOUND',
    );
});

test('selectPlan() without email verification (PENDING_EMAIL_VERIFICATION) → INVALID_REGISTRATION_STATE', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const stored = await ctx.repo.findByEmail('max@example.com');
    await assert.rejects(
        () => ctx.service.selectPlan({ pendingRegistrationId: stored.id, planId: 'STANDARD' }),
        (err) => err.getResponse().code === 'INVALID_REGISTRATION_STATE',
    );
});

test('selectPlan() non-catalogued plan → PLAN_NOT_AVAILABLE', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx);
    await assert.rejects(
        () =>
            ctx.service.selectPlan({
                pendingRegistrationId: verify.pendingRegistrationId,
                planId: 'ENTERPRISE',
            }),
        (err) => err.getResponse().code === 'PLAN_NOT_AVAILABLE',
    );
});

test('selectPlan() plan change in status PLAN_SELECTED is allowed', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx);
    await ctx.service.selectPlan({
        pendingRegistrationId: verify.pendingRegistrationId,
        planId: 'STANDARD',
    });
    const second = await ctx.service.selectPlan({
        pendingRegistrationId: verify.pendingRegistrationId,
        planId: 'PROFESSIONAL',
    });
    assert.equal(second.selectedPlanId, 'PROFESSIONAL');
});

test('listPublicPlans() passes the plan list through', async () => {
    const ctx = makeService();
    const plans = await ctx.service.listPublicPlans();
    assert.equal(plans.length, 2);
    assert.deepEqual(plans.map((p) => p.id).sort(), ['PROFESSIONAL', 'STANDARD']);
});

// ─── Step 4: startCheckout ──────────────────────────────────────────────────

async function startVerifyPlan(ctx, email = 'checkout@example.com', planId = 'STANDARD') {
    await ctx.service.start(baseInput({ email }));
    const code = ctx.delivery.sent[ctx.delivery.sent.length - 1].code;
    const verify = await ctx.service.verifyOtp(email, code);
    await ctx.service.selectPlan({ pendingRegistrationId: verify.pendingRegistrationId, planId });
    return verify.pendingRegistrationId;
}

test('startCheckout() success → status CHECKOUT_STARTED + url + sessionId', async () => {
    const ctx = makeService();
    const pendingId = await startVerifyPlan(ctx);
    const result = await ctx.service.startCheckout({
        pendingRegistrationId: pendingId,
        successUrl: 'https://app.example/success',
        cancelUrl: 'https://app.example/cancel',
    });
    assert.equal(result.status, 'CHECKOUT_STARTED');
    assert.equal(result.nextStep, 4);
    assert.match(result.checkoutSessionId, /^stub_/);
    assert.match(result.checkoutUrl, /^https:\/\/stub\.example\/checkout/);

    const stored = await ctx.repo.findById(pendingId);
    assert.equal(stored.status, 'CHECKOUT_STARTED');
    assert.equal(stored.checkoutSessionId, result.checkoutSessionId);
    assert.ok(stored.checkoutStartedAt instanceof Date);
});

test('startCheckout() without plan selection → PLAN_NOT_SELECTED', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const code = ctx.delivery.sent[ctx.delivery.sent.length - 1].code;
    const verify = await ctx.service.verifyOtp('max@example.com', code);
    await assert.rejects(
        () =>
            ctx.service.startCheckout({
                pendingRegistrationId: verify.pendingRegistrationId,
                successUrl: 'https://app.example/s',
                cancelUrl: 'https://app.example/c',
            }),
        (err) => err.getResponse().code === 'PLAN_NOT_SELECTED',
    );
});

test('startCheckout() unknown Pending → PENDING_REGISTRATION_NOT_FOUND', async () => {
    const ctx = makeService();
    await assert.rejects(
        () =>
            ctx.service.startCheckout({
                pendingRegistrationId: 'none',
                successUrl: 'https://app.example/s',
                cancelUrl: 'https://app.example/c',
            }),
        (err) => err.getResponse().code === 'PENDING_REGISTRATION_NOT_FOUND',
    );
});

test('startCheckout() calls provider with correct params', async () => {
    const ctx = makeService();
    const pendingId = await startVerifyPlan(ctx, 'p@example.com', 'PROFESSIONAL');
    await ctx.service.startCheckout({
        pendingRegistrationId: pendingId,
        successUrl: 'https://app.example/s',
        cancelUrl: 'https://app.example/c',
    });
    assert.equal(ctx.paymentProvider.calls.length, 1);
    const call = ctx.paymentProvider.calls[0];
    assert.equal(call.planId, 'PROFESSIONAL');
    assert.equal(call.pendingRegistrationId, pendingId);
    assert.equal(call.email, 'p@example.com');
});

test('startCheckout() again in status CHECKOUT_STARTED → creates new session (resume allowed)', async () => {
    const ctx = makeService();
    const pendingId = await startVerifyPlan(ctx);
    const first = await ctx.service.startCheckout({
        pendingRegistrationId: pendingId,
        successUrl: 'https://app.example/s',
        cancelUrl: 'https://app.example/c',
    });
    const second = await ctx.service.startCheckout({
        pendingRegistrationId: pendingId,
        successUrl: 'https://app.example/s',
        cancelUrl: 'https://app.example/c',
    });
    assert.notEqual(second.checkoutSessionId, first.checkoutSessionId);
});

// ─── Webhook + activation (Phase 2.3) ───────────────────────────────────────

async function startThroughCheckout(ctx, email = 'pay@example.com') {
    const pendingId = await startVerifyPlan(ctx, email);
    const checkout = await ctx.service.startCheckout({
        pendingRegistrationId: pendingId,
        successUrl: 'https://app.example/s',
        cancelUrl: 'https://app.example/c',
    });
    return { pendingId, sessionId: checkout.checkoutSessionId };
}

test('handlePaymentEvent() SUCCEEDED → activated + User/Tenant/Subscription created', async () => {
    const ctx = makeService();
    const { pendingId, sessionId } = await startThroughCheckout(ctx);
    const result = await ctx.service.handlePaymentEvent({
        eventId: 'evt_1',
        sessionId,
        provider: 'fake',
        status: 'SUCCEEDED',
    });
    assert.equal(result.activated, true);
    assert.ok(result.result?.userId);
    assert.ok(result.result?.tenantId);
    assert.ok(result.result?.subscriptionId);
    assert.equal(ctx.activationOrchestrator.calls.length, 1);
    assert.equal(await ctx.repo.findById(pendingId), null, 'PendingRegistration was deleted');
});

test('handlePaymentEvent() duplicate webhook → ALREADY_PROCESSED + no second activation', async () => {
    const ctx = makeService();
    const { sessionId } = await startThroughCheckout(ctx);
    const first = await ctx.service.handlePaymentEvent({
        eventId: 'evt_idem',
        sessionId,
        provider: 'fake',
        status: 'SUCCEEDED',
    });
    assert.equal(first.activated, true);

    const second = await ctx.service.handlePaymentEvent({
        eventId: 'evt_idem',
        sessionId,
        provider: 'fake',
        status: 'SUCCEEDED',
    });
    assert.equal(second.activated, false);
    assert.equal(second.reason, 'ALREADY_PROCESSED');
    assert.equal(ctx.activationOrchestrator.calls.length, 1, 'Activated only once');
});

test('handlePaymentEvent() FAILED → no activation, but event claimed', async () => {
    const ctx = makeService();
    const { pendingId, sessionId } = await startThroughCheckout(ctx);
    const result = await ctx.service.handlePaymentEvent({
        eventId: 'evt_fail',
        sessionId,
        provider: 'fake',
        status: 'FAILED',
    });
    assert.equal(result.activated, false);
    assert.equal(result.reason, 'PAYMENT_NOT_SUCCEEDED');
    assert.equal(ctx.activationOrchestrator.calls.length, 0);
    // Pending remains, user can pay again:
    const stored = await ctx.repo.findById(pendingId);
    assert.ok(stored);
    assert.equal(stored.status, 'CHECKOUT_STARTED');
});

test('handlePaymentEvent() unknown session → PENDING_REGISTRATION_NOT_FOUND', async () => {
    const ctx = makeService();
    const result = await ctx.service.handlePaymentEvent({
        eventId: 'evt_x',
        sessionId: 'no-such-session',
        provider: 'fake',
        status: 'SUCCEEDED',
    });
    assert.equal(result.activated, false);
    assert.equal(result.reason, 'PENDING_REGISTRATION_NOT_FOUND');
});

test('handlePaymentEvent() without sessionId → MISSING_SESSION_ID', async () => {
    const ctx = makeService();
    const result = await ctx.service.handlePaymentEvent({
        eventId: 'evt_no_session',
        sessionId: null,
        provider: 'fake',
        status: 'SUCCEEDED',
    });
    assert.equal(result.activated, false);
    assert.equal(result.reason, 'MISSING_SESSION_ID');
});

// ─── Phase 3.1: runCleanup ──────────────────────────────────────────────────

function ageExpiry(repo, id, expiresAt) {
    const row = repo.rows.get(id);
    if (!row) throw new Error(`row ${id} not found`);
    row.expiresAt = expiresAt;
}

test('runCleanup() deletes expired, leaves active alone', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ email: 'expired@example.com' }));
    await ctx.service.start(baseInput({ email: 'active@example.com' }));
    const expired = await ctx.repo.findByEmail('expired@example.com');
    ageExpiry(ctx.repo, expired.id, new Date(Date.now() - 1000));

    const result = await ctx.service.runCleanup(new Date());
    assert.equal(result.deleted, 1);
    assert.equal(result.moreAvailable, false);
    assert.equal(await ctx.repo.findByEmail('expired@example.com'), null);
    assert.ok(await ctx.repo.findByEmail('active@example.com'));
});

test('runCleanup() without expired → deleted=0, idempotent', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ email: 'live@example.com' }));
    const first = await ctx.service.runCleanup(new Date());
    const second = await ctx.service.runCleanup(new Date());
    assert.equal(first.deleted, 0);
    assert.equal(second.deleted, 0);
    assert.ok(await ctx.repo.findByEmail('live@example.com'));
});

test('runCleanup() honors batch limit → moreAvailable=true on full run', async () => {
    const ctx = makeService();
    // Create 3 expired pendings.
    for (let i = 0; i < 3; i++) {
        await ctx.service.start(baseInput({ email: `exp-${i}@example.com` }));
        const row = await ctx.repo.findByEmail(`exp-${i}@example.com`);
        ageExpiry(ctx.repo, row.id, new Date(Date.now() - 1000));
    }
    const first = await ctx.service.runCleanup(new Date(), 2);
    assert.equal(first.deleted, 2);
    assert.equal(first.moreAvailable, true);

    const second = await ctx.service.runCleanup(new Date(), 2);
    assert.equal(second.deleted, 1);
    assert.equal(second.moreAvailable, false);
});

test('runCleanup() frees the email again after deletion → repeated start() works', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ email: 'reuse@example.com' }));
    const row = await ctx.repo.findByEmail('reuse@example.com');
    ageExpiry(ctx.repo, row.id, new Date(Date.now() - 1000));
    await ctx.service.runCleanup(new Date());
    // Repeated registration with the same email must go through.
    const result = await ctx.service.start(baseInput({ email: 'reuse@example.com' }));
    assert.deepEqual(result, { neutral: true });
    const fresh = await ctx.repo.findByEmail('reuse@example.com');
    assert.ok(fresh);
    assert.equal(fresh.status, 'PENDING_EMAIL_VERIFICATION');
});

// ─── Phase 3.3: Audit-Logging ───────────────────────────────────────────────

test('audit: start() logs REGISTRATION_STARTED + pendingId', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput(), { ipHash: 'ip-abc', userAgent: 'curl/1.0' });
    const evs = ctx.audit.byType('REGISTRATION_STARTED');
    assert.equal(evs.length, 1);
    assert.ok(evs[0].pendingRegistrationId);
    assert.equal(evs[0].context.ipHash, 'ip-abc');
});

test('audit: start() with active user → REGISTRATION_NEUTRAL_ACTIVE_USER, no Pending', async () => {
    const ctx = makeService({
        userLookup: new FakeUserLookup(['max@example.com']),
    });
    await ctx.service.start(baseInput(), { ipHash: 'ip-1' });
    const evs = ctx.audit.byType('REGISTRATION_NEUTRAL_ACTIVE_USER');
    assert.equal(evs.length, 1);
    assert.equal(evs[0].pendingRegistrationId, null);
});

test('audit: verifyOtp success → OTP_VERIFIED, wrong → OTP_VERIFY_FAILED', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const code = ctx.delivery.sent[0].code;

    // Wrong
    await assert.rejects(() =>
        ctx.service.verifyOtp('max@example.com', '000000', { ipHash: 'ip' }),
    );
    assert.equal(ctx.audit.byType('OTP_VERIFY_FAILED').length, 1);
    assert.equal(ctx.audit.byType('OTP_VERIFY_FAILED')[0].metadata.reason, 'wrong_code');

    // Correct
    await ctx.service.verifyOtp('max@example.com', code);
    assert.equal(ctx.audit.byType('OTP_VERIFIED').length, 1);
});

test('audit: handlePaymentEvent → PAYMENT_RECEIVED + ACTIVATION_COMPLETED, duplicate → PAYMENT_DUPLICATE_IGNORED', async () => {
    const ctx = makeService();
    const { sessionId } = await startThroughCheckout(ctx);

    await ctx.service.handlePaymentEvent({
        eventId: 'evt_audit_1',
        sessionId,
        provider: 'fake',
        status: 'SUCCEEDED',
    });
    assert.equal(ctx.audit.byType('PAYMENT_RECEIVED').length, 1);
    assert.equal(ctx.audit.byType('ACTIVATION_COMPLETED').length, 1);

    // Duplicate
    await ctx.service.handlePaymentEvent({
        eventId: 'evt_audit_1',
        sessionId,
        provider: 'fake',
        status: 'SUCCEEDED',
    });
    assert.equal(ctx.audit.byType('PAYMENT_DUPLICATE_IGNORED').length, 1);
});

// ─── Phase 3.4: Resume-Token ────────────────────────────────────────────────

test('resume: start() with existing EMAIL_VERIFIED pending sends resume mail (no OTP)', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx);
    // Existing pending has status EMAIL_VERIFIED — calling start() again
    // with the same email should send a resume mail, NO new OTP.
    const otpsBefore = ctx.delivery.sent.length;
    await ctx.service.start(baseInput({ email: 'plan@example.com' }));
    assert.equal(ctx.delivery.sent.length, otpsBefore, 'no new OTP');
    assert.equal(ctx.resumeDelivery.sent.length, 1);
    const link = ctx.resumeDelivery.sent[0].resumeUrl;
    assert.match(link, /^https:\/\/app\.example\/login\?resume=/);
    assert.equal(ctx.resumeDelivery.sent[0].to, 'plan@example.com');
    // Pending ID must be contained in the token:
    const token = new URL(link).searchParams.get('resume');
    const decoded = await ctx.resumeTokenSigner.verify(token);
    assert.equal(decoded.pendingRegistrationId, verify.pendingRegistrationId);
});

test('resume: start() with PENDING_EMAIL_VERIFICATION still OTP resend (case B unchanged)', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ email: 'b@example.com' }));
    const before = ctx.delivery.sent.length;
    await ctx.service.start(baseInput({ email: 'b@example.com' }));
    assert.equal(ctx.delivery.sent.length, before + 1, 'OTP was regenerated');
    assert.equal(ctx.resumeDelivery.sent.length, 0, 'no resume link in case B');
});

test('resume: resumeWithToken() success → returns pending ID + nextStep + snapshot', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx);
    await ctx.service.start(baseInput({ email: 'plan@example.com' }));
    const token = new URL(ctx.resumeDelivery.sent[0].resumeUrl).searchParams.get('resume');
    const result = await ctx.service.resumeWithToken({ token });
    assert.equal(result.pendingRegistrationId, verify.pendingRegistrationId);
    assert.equal(result.status, 'EMAIL_VERIFIED');
    assert.equal(result.nextStep, 3);
    // Snapshot is public-safe (no passwordHash / no otpHash) and fills
    // the completed steps in the frontend:
    assert.equal(result.snapshot.email, 'plan@example.com');
    assert.equal(result.snapshot.firstName, 'Max');
    assert.equal(result.snapshot.lastName, 'Mustermann');
    assert.equal(result.snapshot.status, 'EMAIL_VERIFIED');
    assert.ok(result.snapshot.emailVerifiedAt);
    assert.equal('passwordHash' in result.snapshot, false);
    assert.equal('otpHash' in result.snapshot, false);
});

test('signResumeToken() returns a token that is resolvable via resumeWithToken', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx, 'login-resume@example.com');
    const token = await ctx.service.signResumeToken(verify.pendingRegistrationId);
    assert.ok(token);
    const result = await ctx.service.resumeWithToken({ token: token });
    assert.equal(result.pendingRegistrationId, verify.pendingRegistrationId);
    assert.equal(result.snapshot.email, 'login-resume@example.com');
});

test('resume: resumeWithToken() invalid token → RESUME_TOKEN_INVALID', async () => {
    const ctx = makeService();
    await assert.rejects(
        () => ctx.service.resumeWithToken({ token: 'kaputt' }),
        (err) => err.getResponse().code === 'RESUME_TOKEN_INVALID',
    );
});

test('resume: resumeWithToken() token points to deleted Pending → RESUME_TOKEN_INVALID', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx);
    const token = await ctx.resumeTokenSigner.sign({
        pendingRegistrationId: verify.pendingRegistrationId,
    });
    await ctx.repo.delete(verify.pendingRegistrationId);
    await assert.rejects(
        () => ctx.service.resumeWithToken({ token }),
        (err) => err.getResponse().code === 'RESUME_TOKEN_INVALID',
    );
});

test('resume: without configured signer start() falls back to OTP resend', async () => {
    const ctx = makeService({ resumeTokenSigner: null, resumeDelivery: null });
    await startThenVerify(ctx);
    const before = ctx.delivery.sent.length;
    await ctx.service.start(baseInput({ email: 'plan@example.com' }));
    assert.equal(ctx.delivery.sent.length, before + 1, 'OTP fallback active');
});

test('audit: failure in AuditLogger does not crash the auth flow', async () => {
    class ExplodingAudit {
        async log() {
            throw new Error('audit-down');
        }
    }
    const ctx = makeService({ audit: new ExplodingAudit() });
    // Despite the audit crash, start() must go through neutrally.
    const result = await ctx.service.start(baseInput());
    assert.deepEqual(result, { neutral: true });
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.ok(stored);
});
