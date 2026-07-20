// Tests fuer @saasicat/nest/registration — PendingRegistrationService.
//
// Deckt die Pfade aus der Registrierungs-Spec ab:
//  - start() erzeugt PendingRegistration + OTP-Versand
//  - start() neutralisiert aktiven User (Fall A)
//  - start() regeneriert OTP fuer bestehende PENDING_EMAIL_VERIFICATION (Fall B)
//  - start() loescht abgelaufene PendingRegistration und legt neu an (Fall E)
//  - start() loest Slug-Kollision via Suffix-Variante
//  - start() generiert Slug aus tenantName wenn leer
//  - verifyOtp() success → EMAIL_VERIFIED + nextStep=3
//  - verifyOtp() expired → OTP_EXPIRED
//  - verifyOtp() wrong → OTP_INVALID
//  - verifyOtp() Brute-Force-Lockout → OTP_LOCKED (auch bei korrektem Code)
//  - resendOtp() success
//  - resendOtp() rate-limited → still gedropt
//  - OTP wird niemals im Klartext gespeichert

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OTP_VERIFY_MAX_ATTEMPTS } from '@saasicat/types';
import { PendingRegistrationService, hashOtpCode } from '../dist/registration/index.js';

// ─── Test-Doubles ───────────────────────────────────────────────────────────

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
    // Bewusst last-write-wins (wie ein UPDATE ... SET in der DB): parallele
    // Schreiber mit stale gelesenem Stand ueberschreiben sich gegenseitig.
    async update(id, input) {
        const existing = this.rows.get(id);
        if (!existing) throw new Error(`pending ${id} not found`);
        const updated = { ...existing, ...input, updatedAt: new Date() };
        this.rows.set(id, updated);
        return updated;
    }
    // Echt atomar: liest den Stand zum Ausfuehrungszeitpunkt, nicht einen
    // vorab gelesenen Snapshot — analog Prisma `{ increment: 1 }`.
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

test('start() legt PendingRegistration an und sendet OTP', async () => {
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

test('start() speichert OTP nur als Hash, nie im Klartext', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const stored = await ctx.repo.findByEmail('max@example.com');
    const sentCode = ctx.delivery.sent[0].code;
    assert.notEqual(stored.otpHash, sentCode);
    assert.equal(stored.otpHash, hashOtpCode(sentCode));
});

test('start() bei aktivem User → keine PendingRegistration angelegt', async () => {
    const ctx = makeService({
        userLookup: new FakeUserLookup(['max@example.com']),
    });
    const result = await ctx.service.start(baseInput());
    assert.deepEqual(result, { neutral: true });
    assert.equal(await ctx.repo.findByEmail('max@example.com'), null);
    assert.equal(ctx.delivery.sent.length, 0);
});

test('start() bei kollidierendem Slug → Suffix-Variante', async () => {
    const ctx = makeService({
        slugCheck: new FakeSlugCheck(['mein-verein', 'mein-verein-2']),
    });
    await ctx.service.start(baseInput());
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.tenantSlug, 'mein-verein-3');
});

test('start() mit explizitem tenantSlug uebernimmt diesen, wenn frei', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ tenantSlug: 'fc-bayern' }));
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.tenantSlug, 'fc-bayern');
});

test('start() Email-Normalization: trim + lowercase', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ email: '  MAX@Example.COM  ' }));
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.ok(stored);
});

test('start() bei abgelaufener PendingRegistration → loescht + legt neu an', async () => {
    const ctx = makeService();
    // Erste Registrierung manuell mit abgelaufenem expiresAt anlegen.
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
    // Genau ein Eintrag (alter wurde geloescht):
    let count = 0;
    for (const _ of ctx.repo.rows.values()) count++;
    assert.equal(count, 1);
});

test('start() bei bestehender PENDING_EMAIL_VERIFICATION → OTP wird regeneriert', async () => {
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
    // Tenantname bleibt (kein Overwrite durch potentiellen Angreifer):
    assert.equal(after.tenantName, 'Bestand');
    // Aber OTP wurde regeneriert:
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

test('verifyOtp() abgelaufenes OTP → OTP_EXPIRED', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const stored = await ctx.repo.findByEmail('max@example.com');
    // OTP-Expiry in die Vergangenheit setzen:
    await ctx.repo.update(stored.id, { otpExpiresAt: new Date(Date.now() - 1000) });
    const code = ctx.delivery.sent[0].code;
    await assert.rejects(
        () => ctx.service.verifyOtp('max@example.com', code),
        (err) => err.getResponse().code === 'OTP_EXPIRED',
    );
});

test('verifyOtp() falscher Code → OTP_INVALID', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    await assert.rejects(
        () => ctx.service.verifyOtp('max@example.com', '000000'),
        (err) => err.getResponse().code === 'OTP_INVALID',
    );
});

test('verifyOtp() unbekannte Email → OTP_INVALID', async () => {
    const ctx = makeService();
    await assert.rejects(
        () => ctx.service.verifyOtp('unknown@example.com', '123456'),
        (err) => err.getResponse().code === 'OTP_INVALID',
    );
});

// ─── Brute-Force-Lockout ────────────────────────────────────────────────────

async function exhaustOtpAttempts(ctx, email = 'max@example.com') {
    for (let i = 0; i < OTP_VERIFY_MAX_ATTEMPTS; i++) {
        await assert.rejects(
            () => ctx.service.verifyOtp(email, '000000'),
            (err) => err.getResponse().code === 'OTP_INVALID',
        );
    }
}

test('verifyOtp() nach 5 Fehlversuchen → OTP_LOCKED', async () => {
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

test('verifyOtp() korrekter Code nach Lockout → weiterhin OTP_LOCKED', async () => {
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

test('verifyOtp() korrekter Code unter dem Limit → Erfolg', async () => {
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

test('verifyOtp() parallele Fehlversuche mit stale Zaehlerstand → atomarer Inkrement sperrt', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const code = ctx.delivery.sent[0].code;
    for (let i = 0; i < OTP_VERIFY_MAX_ATTEMPTS - 1; i++) {
        await assert.rejects(
            () => ctx.service.verifyOtp('max@example.com', '000000'),
            (err) => err.getResponse().code === 'OTP_INVALID',
        );
    }

    // Beide Requests lesen denselben Stand (Limit-1) und passieren den
    // Vorab-Check — nur der atomare Inkrement zaehlt beide korrekt: einer
    // verbraucht den letzten Versuch (OTP_INVALID), der andere laeuft in
    // die Schranke (OTP_LOCKED). Mit dem frueheren Read-Modify-Write via
    // update() (last-write-wins im FakeRepository) haetten beide denselben
    // Stand geschrieben und ein Rateversuch waere verloren gegangen.
    const results = await Promise.allSettled([
        ctx.service.verifyOtp('max@example.com', '000000'),
        ctx.service.verifyOtp('max@example.com', '000000'),
    ]);
    assert.ok(results.every((r) => r.status === 'rejected'));
    const codes = results.map((r) => r.reason.getResponse().code).sort();
    assert.deepEqual(codes, ['OTP_INVALID', 'OTP_LOCKED']);

    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.equal(stored.otpAttemptCount, OTP_VERIFY_MAX_ATTEMPTS + 1);
    // Nach insgesamt >= 5 Fehlversuchen bleibt auch der korrekte Code gesperrt.
    await assert.rejects(
        () => ctx.service.verifyOtp('max@example.com', code),
        (err) => err.getResponse().code === 'OTP_LOCKED',
    );
});

test('resendOtp() nach Lockout → neuer Code entsperrt (Zaehler zurueckgesetzt)', async () => {
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

test('verifyOtp() Lockout-Limit per Env uebersteuerbar', async () => {
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

test('resendOtp() success → neuer OTP wird gesendet', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const firstCode = ctx.delivery.sent[0].code;
    const result = await ctx.service.resendOtp('max@example.com');
    assert.deepEqual(result, { neutral: true });
    assert.equal(ctx.delivery.sent.length, 2);
    // Code wechselt (mit hoher Wahrscheinlichkeit):
    assert.notEqual(ctx.delivery.sent[1].code, firstCode);
});

test('resendOtp() Rate-Limit greift → still gedropt nach 3 Sends', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput()); // send 1
    await ctx.service.resendOtp('max@example.com'); // send 2
    await ctx.service.resendOtp('max@example.com'); // send 3
    await ctx.service.resendOtp('max@example.com'); // gedropt
    assert.equal(ctx.delivery.sent.length, 3);
});

test('resendOtp() unbekannte Email → neutrale Antwort, kein Throw', async () => {
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

test('selectPlan() unbekannte PendingRegistration → PENDING_REGISTRATION_NOT_FOUND', async () => {
    const ctx = makeService();
    await assert.rejects(
        () =>
            ctx.service.selectPlan({ pendingRegistrationId: 'does-not-exist', planId: 'STANDARD' }),
        (err) => err.getResponse().code === 'PENDING_REGISTRATION_NOT_FOUND',
    );
});

test('selectPlan() ohne Email-Verifikation (PENDING_EMAIL_VERIFICATION) → INVALID_REGISTRATION_STATE', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const stored = await ctx.repo.findByEmail('max@example.com');
    await assert.rejects(
        () => ctx.service.selectPlan({ pendingRegistrationId: stored.id, planId: 'STANDARD' }),
        (err) => err.getResponse().code === 'INVALID_REGISTRATION_STATE',
    );
});

test('selectPlan() nicht-katalogisierter Plan → PLAN_NOT_AVAILABLE', async () => {
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

test('selectPlan() Plan-Wechsel im Status PLAN_SELECTED ist erlaubt', async () => {
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

test('listPublicPlans() liefert Plan-Liste durch', async () => {
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

test('startCheckout() ohne Plan-Auswahl → PLAN_NOT_SELECTED', async () => {
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

test('startCheckout() unbekannte Pending → PENDING_REGISTRATION_NOT_FOUND', async () => {
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

test('startCheckout() ruft Provider mit korrekten Params', async () => {
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

test('startCheckout() im Status CHECKOUT_STARTED erneut → erzeugt neue Session (Resume erlaubt)', async () => {
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

// ─── Webhook + Aktivierung (Phase 2.3) ──────────────────────────────────────

async function startThroughCheckout(ctx, email = 'pay@example.com') {
    const pendingId = await startVerifyPlan(ctx, email);
    const checkout = await ctx.service.startCheckout({
        pendingRegistrationId: pendingId,
        successUrl: 'https://app.example/s',
        cancelUrl: 'https://app.example/c',
    });
    return { pendingId, sessionId: checkout.checkoutSessionId };
}

test('handlePaymentEvent() SUCCEEDED → activated + User/Tenant/Subscription erzeugt', async () => {
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
    assert.equal(await ctx.repo.findById(pendingId), null, 'PendingRegistration wurde geloescht');
});

test('handlePaymentEvent() doppelter Webhook → ALREADY_PROCESSED + keine zweite Aktivierung', async () => {
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
    assert.equal(ctx.activationOrchestrator.calls.length, 1, 'Nur einmal aktiviert');
});

test('handlePaymentEvent() FAILED → keine Aktivierung, aber Event geclaimed', async () => {
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
    // Pending bleibt bestehen, User kann erneut zahlen:
    const stored = await ctx.repo.findById(pendingId);
    assert.ok(stored);
    assert.equal(stored.status, 'CHECKOUT_STARTED');
});

test('handlePaymentEvent() unbekannte Session → PENDING_REGISTRATION_NOT_FOUND', async () => {
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

test('handlePaymentEvent() ohne sessionId → MISSING_SESSION_ID', async () => {
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

test('runCleanup() loescht expired, laesst active in Ruhe', async () => {
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

test('runCleanup() ohne expired → deleted=0, idempotent', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ email: 'live@example.com' }));
    const first = await ctx.service.runCleanup(new Date());
    const second = await ctx.service.runCleanup(new Date());
    assert.equal(first.deleted, 0);
    assert.equal(second.deleted, 0);
    assert.ok(await ctx.repo.findByEmail('live@example.com'));
});

test('runCleanup() honoriert Batch-Limit → moreAvailable=true bei Voll-Lauf', async () => {
    const ctx = makeService();
    // 3 abgelaufene Pendings anlegen.
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

test('runCleanup() gibt Email nach Loeschung wieder frei → erneutes start() klappt', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ email: 'reuse@example.com' }));
    const row = await ctx.repo.findByEmail('reuse@example.com');
    ageExpiry(ctx.repo, row.id, new Date(Date.now() - 1000));
    await ctx.service.runCleanup(new Date());
    // Erneute Registrierung mit gleicher Mail muss durchgehen.
    const result = await ctx.service.start(baseInput({ email: 'reuse@example.com' }));
    assert.deepEqual(result, { neutral: true });
    const fresh = await ctx.repo.findByEmail('reuse@example.com');
    assert.ok(fresh);
    assert.equal(fresh.status, 'PENDING_EMAIL_VERIFICATION');
});

// ─── Phase 3.3: Audit-Logging ───────────────────────────────────────────────

test('audit: start() loggt REGISTRATION_STARTED + pendingId', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput(), { ipHash: 'ip-abc', userAgent: 'curl/1.0' });
    const evs = ctx.audit.byType('REGISTRATION_STARTED');
    assert.equal(evs.length, 1);
    assert.ok(evs[0].pendingRegistrationId);
    assert.equal(evs[0].context.ipHash, 'ip-abc');
});

test('audit: start() bei aktivem User → REGISTRATION_NEUTRAL_ACTIVE_USER, keine Pending', async () => {
    const ctx = makeService({
        userLookup: new FakeUserLookup(['max@example.com']),
    });
    await ctx.service.start(baseInput(), { ipHash: 'ip-1' });
    const evs = ctx.audit.byType('REGISTRATION_NEUTRAL_ACTIVE_USER');
    assert.equal(evs.length, 1);
    assert.equal(evs[0].pendingRegistrationId, null);
});

test('audit: verifyOtp success → OTP_VERIFIED, falsch → OTP_VERIFY_FAILED', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput());
    const code = ctx.delivery.sent[0].code;

    // Falsch
    await assert.rejects(() =>
        ctx.service.verifyOtp('max@example.com', '000000', { ipHash: 'ip' }),
    );
    assert.equal(ctx.audit.byType('OTP_VERIFY_FAILED').length, 1);
    assert.equal(ctx.audit.byType('OTP_VERIFY_FAILED')[0].metadata.reason, 'wrong_code');

    // Korrekt
    await ctx.service.verifyOtp('max@example.com', code);
    assert.equal(ctx.audit.byType('OTP_VERIFIED').length, 1);
});

test('audit: handlePaymentEvent → PAYMENT_RECEIVED + ACTIVATION_COMPLETED, Duplikat → PAYMENT_DUPLICATE_IGNORED', async () => {
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

    // Duplikat
    await ctx.service.handlePaymentEvent({
        eventId: 'evt_audit_1',
        sessionId,
        provider: 'fake',
        status: 'SUCCEEDED',
    });
    assert.equal(ctx.audit.byType('PAYMENT_DUPLICATE_IGNORED').length, 1);
});

// ─── Phase 3.4: Resume-Token ────────────────────────────────────────────────

test('resume: start() bei bestehender EMAIL_VERIFIED-Pending sendet Resume-Mail (kein OTP)', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx);
    // Vorhandene Pending hat Status EMAIL_VERIFIED — start() noch einmal
    // mit gleicher Email soll Resume-Mail senden, KEIN neuer OTP.
    const otpsBefore = ctx.delivery.sent.length;
    await ctx.service.start(baseInput({ email: 'plan@example.com' }));
    assert.equal(ctx.delivery.sent.length, otpsBefore, 'kein neuer OTP');
    assert.equal(ctx.resumeDelivery.sent.length, 1);
    const link = ctx.resumeDelivery.sent[0].resumeUrl;
    assert.match(link, /^https:\/\/app\.example\/login\?resume=/);
    assert.equal(ctx.resumeDelivery.sent[0].to, 'plan@example.com');
    // Pending-ID muss im Token enthalten sein:
    const token = new URL(link).searchParams.get('resume');
    const decoded = await ctx.resumeTokenSigner.verify(token);
    assert.equal(decoded.pendingRegistrationId, verify.pendingRegistrationId);
});

test('resume: start() bei PENDING_EMAIL_VERIFICATION weiterhin OTP-Resend (Fall B unveraendert)', async () => {
    const ctx = makeService();
    await ctx.service.start(baseInput({ email: 'b@example.com' }));
    const before = ctx.delivery.sent.length;
    await ctx.service.start(baseInput({ email: 'b@example.com' }));
    assert.equal(ctx.delivery.sent.length, before + 1, 'OTP wurde regeneriert');
    assert.equal(ctx.resumeDelivery.sent.length, 0, 'kein Resume-Link in Fall B');
});

test('resume: resumeWithToken() success → liefert pending-ID + nextStep + snapshot', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx);
    await ctx.service.start(baseInput({ email: 'plan@example.com' }));
    const token = new URL(ctx.resumeDelivery.sent[0].resumeUrl).searchParams.get('resume');
    const result = await ctx.service.resumeWithToken({ token });
    assert.equal(result.pendingRegistrationId, verify.pendingRegistrationId);
    assert.equal(result.status, 'EMAIL_VERIFIED');
    assert.equal(result.nextStep, 3);
    // Snapshot ist Public-Safe (kein passwordHash / kein otpHash) und fuellt
    // die abgeschlossenen Steps im Frontend:
    assert.equal(result.snapshot.email, 'plan@example.com');
    assert.equal(result.snapshot.firstName, 'Max');
    assert.equal(result.snapshot.lastName, 'Mustermann');
    assert.equal(result.snapshot.status, 'EMAIL_VERIFIED');
    assert.ok(result.snapshot.emailVerifiedAt);
    assert.equal('passwordHash' in result.snapshot, false);
    assert.equal('otpHash' in result.snapshot, false);
});

test('signResumeToken() liefert Token, der via resumeWithToken aufloesbar ist', async () => {
    const ctx = makeService();
    const verify = await startThenVerify(ctx, 'login-resume@example.com');
    const token = await ctx.service.signResumeToken(verify.pendingRegistrationId);
    assert.ok(token);
    const result = await ctx.service.resumeWithToken({ token: token });
    assert.equal(result.pendingRegistrationId, verify.pendingRegistrationId);
    assert.equal(result.snapshot.email, 'login-resume@example.com');
});

test('resume: resumeWithToken() ungueltiger Token → RESUME_TOKEN_INVALID', async () => {
    const ctx = makeService();
    await assert.rejects(
        () => ctx.service.resumeWithToken({ token: 'kaputt' }),
        (err) => err.getResponse().code === 'RESUME_TOKEN_INVALID',
    );
});

test('resume: resumeWithToken() Token zeigt auf geloeschte Pending → RESUME_TOKEN_INVALID', async () => {
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

test('resume: ohne konfigurierten Signer faellt start() auf OTP-Resend zurueck', async () => {
    const ctx = makeService({ resumeTokenSigner: null, resumeDelivery: null });
    await startThenVerify(ctx);
    const before = ctx.delivery.sent.length;
    await ctx.service.start(baseInput({ email: 'plan@example.com' }));
    assert.equal(ctx.delivery.sent.length, before + 1, 'OTP-Fallback aktiv');
});

test('audit: Failure im AuditLogger crasht den Auth-Flow nicht', async () => {
    class ExplodingAudit {
        async log() {
            throw new Error('audit-down');
        }
    }
    const ctx = makeService({ audit: new ExplodingAudit() });
    // Trotz Audit-Crash muss start() neutral durchgehen.
    const result = await ctx.service.start(baseInput());
    assert.deepEqual(result, { neutral: true });
    const stored = await ctx.repo.findByEmail('max@example.com');
    assert.ok(stored);
});
