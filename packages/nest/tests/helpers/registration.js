// The adapters a registration test wires, in memory. For tests whose subject is
// the registration flow; what each one stands in for is the port it is named
// after in `@saasicat/core`.

export class FakeRepository {
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
    async findByCheckoutSession(gatewayAccount, sessionId) {
        for (const row of this.rows.values()) {
            if (row.checkoutGatewayAccount === gatewayAccount && row.checkoutSessionId === sessionId) {
                return row;
            }
        }
        return null;
    }
    async findOpenCheckoutAccounts(now) {
        const accounts = [...this.rows.values()]
            .filter((row) => row.status === 'CHECKOUT_STARTED' && row.expiresAt > now)
            .map((row) => row.checkoutGatewayAccount);
        return [...new Set(accounts)];
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
            addressLine1: null,
            addressLine2: null,
            postalCode: null,
            city: null,
            country: null,
            vatId: null,
            taxNumber: null,
            checkoutSessionId: null,
            checkoutGatewayAccount: null,
            gatewayCustomerRef: null,
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

export class FakeOtpDelivery {
    constructor() {
        this.sent = [];
    }
    async sendVerificationOtp(params) {
        this.sent.push(params);
    }
}

export class FakeUserLookup {
    constructor(activeEmails = []) {
        this.activeEmails = new Set(activeEmails);
    }
    async hasActiveUser(email) {
        return this.activeEmails.has(email);
    }
}

export class FakeSlugCheck {
    constructor(takenSlugs = []) {
        this.taken = new Set(takenSlugs);
    }
    async isSlugAvailable(slug) {
        return !this.taken.has(slug);
    }
}

export class FakePasswordHasher {
    async hash(plain) {
        return `hashed:${plain}`;
    }
    async verify(hash, plain) {
        return hash === `hashed:${plain}`;
    }
}

export class FakeResumeTokenSigner {
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

export class FakeResumeDelivery {
    constructor() {
        this.sent = [];
    }
    async sendResumeEmail(params) {
        this.sent.push(params);
    }
}

export class FakeAuditLogger {
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

export class FakeActivationOrchestrator {
    constructor() {
        this.calls = [];
        this.nextId = 1;
    }
    async activate(pending, activation) {
        this.calls.push({ pending, activation });
        const n = this.nextId++;
        return {
            userId: `user_${n}`,
            tenantId: `tenant_${n}`,
            subscriberId: `subscriber_${n}`,
            subscriptionId: `sub_${n}`,
        };
    }
}

export class FakePlanCatalog {
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


export function baseInput(overrides = {}) {
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

/** A sign-up taken through the first three steps, to the plan it chose. */
export async function startVerifyPlan(
    { service, delivery },
    email = 'checkout@example.com',
    planId = 'STANDARD',
) {
    await service.start(baseInput({ email }));
    const code = delivery.sent[delivery.sent.length - 1].code;
    const verify = await service.verifyOtp(email, code);
    await service.selectPlan({ pendingRegistrationId: verify.pendingRegistrationId, planId });
    return verify.pendingRegistrationId;
}
