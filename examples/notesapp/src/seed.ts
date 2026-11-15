import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { PrismaSubscriberRepository } from '@saasicat/adapter-prisma';
import {
    SUBSCRIBER_INVOICE_ADDRESS_FIELDS,
    type SubscriberInvoiceAddressField,
    type SubscriberRecord,
} from '@saasicat/core';
import { loadPlanCatalogFromFile } from '@saasicat/nest/billing';
import { aesGcmSecretSealer } from '@saasicat/nest/platform';
import { SubscriberService } from '@saasicat/nest/subscriber';

import {
    activateSeededSubscriptions,
    seedActivationPlatformOf,
    type SeededSubscription,
} from './seed-activation';
import { SeedModule } from './seed.module';
import { DEMO_SUPER_ADMIN, seedSuperAdmin } from './seed-super-admin';

/**
 * Seeds the demo data for both surfaces:
 *
 *   - the curl walkthrough in the README (`tenant-a`, `tenant-b`)
 *   - the SuperAdmin UI, which needs tenants with some spread (an inactive
 *     one, different note counts against the STARTER limit of 25) and at
 *     least one SuperAdmin user so the Users page is not empty.
 *
 * Tenant ids equal the `x-demo-tenant` header values on purpose — the
 * DemoAuthGuard maps the header straight to the tenant id.
 */

/** The address an invoice names, every field given. */
type SubscriberInvoiceAddress = Record<SubscriberInvoiceAddressField, string>;

interface DemoTenant {
    id: string;
    slug: string;
    name: string;
    isActive?: boolean;
    /** Notes to create; drives the quota usage the admin UI displays. */
    notes: number;
}

const DEMO_TENANTS: DemoTenant[] = [
    { id: 'tenant-a', slug: 'tenant-a', name: 'Tenant A (Starter)', notes: 3 },
    { id: 'tenant-b', slug: 'tenant-b', name: 'Tenant B (Starter)', notes: 0 },
    { id: 'acme', slug: 'acme', name: 'ACME GmbH', notes: 24 },
    { id: 'globex', slug: 'globex', name: 'Globex Ltd.', notes: 12 },
    { id: 'initech', slug: 'initech', name: 'Initech AG', isActive: false, notes: 7 },
];

/**
 * The address an invoice names for each demo tenant's subscriber; the country
 * is what the tax adapter decides from, and without the whole address no
 * contract can name the subscriber. Every one is a business; Globex, outside
 * the European Union, is not taxable in Germany and so shows a contract at 0 %.
 */
const SUBSCRIBER_ADDRESSES: Record<string, SubscriberInvoiceAddress> = {
    'tenant-a': {
        addressLine1: 'Hauptstraße 1',
        postalCode: '10115',
        city: 'Berlin',
        country: 'DE',
    },
    'tenant-b': {
        addressLine1: 'Marktplatz 2',
        postalCode: '80331',
        city: 'München',
        country: 'DE',
    },
    acme: {
        addressLine1: 'Industriestraße 24',
        postalCode: '20457',
        city: 'Hamburg',
        country: 'DE',
    },
    globex: {
        addressLine1: '12 King Street',
        postalCode: 'EC2V 8EA',
        city: 'London',
        country: 'GB',
    },
    initech: { addressLine1: 'Am Hafen 7', postalCode: '50667', city: 'Köln', country: 'DE' },
};

/** Who the seed's changes of a subscriber's details are recorded as made by. */
const SEEDED_BY = 'seed:notesapp';

/** The one `marketing_settings` row, matching the schema's constant default. */
const MARKETING_SETTINGS_ROW_ID = 'marketing-settings';

/** A plan stem plus its single published v1 (mirrors config/saas.yaml). */
interface PlanSeed {
    planKey: string;
    label: string;
    description: string;
    sortOrder: number;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: number;
    yearlyNet: number;
    changeNote: string;
}

const PLANS: PlanSeed[] = [
    {
        planKey: 'STARTER',
        label: 'Starter',
        description: 'For getting started — notes only.',
        sortOrder: 10,
        features: ['NOTES'],
        quotas: { notesMax: 25 },
        monthlyNet: 9,
        yearlyNet: 90,
        changeNote: 'Initial release (seed).',
    },
    {
        planKey: 'PRO',
        label: 'Pro',
        description: 'Notes plus export and a generous quota.',
        sortOrder: 20,
        features: ['NOTES', 'NOTES_EXPORT'],
        quotas: { notesMax: 1000 },
        monthlyNet: 29,
        yearlyNet: 290,
        changeNote: 'Initial release (seed).',
    },
];

/** A reusable add-on bundle plus its single published v1. */
interface BundleSeed {
    bundleKey: string;
    label: string;
    description: string;
    icon: string;
    sortOrder: number;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: number;
    /**
     * Both plans here are sold monthly *and* yearly, and a bundle offered to a
     * plan has to resolve a price in the rhythm that plan is bought in — the
     * publish gate refuses a version that cannot, and the booking preview
     * blocks one that slipped through. Seeded with only a monthly price, these
     * two were permanently unbookable for every tenant on a yearly plan, which
     * is what an integrator would have copied.
     */
    yearlyNet: number;
    changeNote: string;
}

const BUNDLES: BundleSeed[] = [
    {
        bundleKey: 'EXPORT_PRO',
        label: 'Export Pro',
        description: 'Adds note export to any plan.',
        icon: 'file_download',
        sortOrder: 10,
        features: ['NOTES_EXPORT'],
        quotas: {},
        monthlyNet: 5,
        yearlyNet: 50,
        changeNote: 'Initial release (seed).',
    },
    {
        bundleKey: 'POWER_QUOTA',
        label: 'Power Quota',
        description: 'Raises the notes limit to 5000.',
        icon: 'trending_up',
        sortOrder: 20,
        features: [],
        quotas: { notesMax: 5000 },
        monthlyNet: 8,
        yearlyNet: 80,
        changeNote: 'Initial release (seed).',
    },
];

/**
 * Catalog-side pricing campaigns. `Promotion` has no natural unique key, so a
 * fixed `id` per record keeps the seed idempotent (upsert on the primary key).
 */
interface PromotionSeed {
    id: string;
    internalLabel: string;
    type: string;
    value: number;
    appliesTo: string[];
    billingCycle: string;
    priority: number;
    color: string;
    i18n: Record<string, { badge: string; fineprint: string }>;
}

const PROMOTIONS: PromotionSeed[] = [
    {
        id: '11111111-1111-4111-8111-111111111111',
        internalLabel: 'Launch offer',
        type: 'percent',
        value: 20,
        appliesTo: ['PRO'],
        billingCycle: 'both',
        priority: 20,
        color: '#2563eb',
        i18n: {
            en: { badge: 'Launch deal', fineprint: '20% off Pro during launch.' },
        },
    },
    {
        id: '22222222-2222-4222-8222-222222222222',
        internalLabel: 'Yearly saver',
        type: 'percent',
        value: 15,
        appliesTo: ['STARTER', 'PRO'],
        billingCycle: 'yearly',
        priority: 10,
        color: '#16a34a',
        i18n: {
            en: { badge: 'Yearly saver', fineprint: '15% off on annual billing.' },
        },
    },
];

/** 90-day validity window from a reference instant. */
const PROMOTION_WINDOW_DAYS = 90;

/**
 * Binds a handful of the demo tenants to a live Subscription so the
 * SuperAdmin tenants/subscriptions pages show plan + status. `planKey` maps to
 * the seeded PlanVersion (see `seedPlans`); the DB CHECK constraint
 * `subscriptions_plan_or_bt_check` requires the `planVersionId` this sets.
 */
interface SubscriptionSeed {
    tenantId: string;
    planKey: string;
    /** Add-on bundles booked with it, by key, at their published v1 — so the tenant bundle store has data. */
    addOns: string[];
}

const SUBSCRIPTIONS: SubscriptionSeed[] = [
    { tenantId: 'tenant-a', planKey: 'STARTER', addOns: [] },
    { tenantId: 'acme', planKey: 'PRO', addOns: ['EXPORT_PRO'] },
    { tenantId: 'globex', planKey: 'PRO', addOns: [] },
];

/** Days a seeded subscription's current billing period runs for (YEARLY). */
const SUBSCRIPTION_PERIOD_DAYS = 365;

/**
 * Onboarding-checkout promo codes for the SuperAdmin promo-codes page. `code`
 * is the unique key, so the upsert stays idempotent.
 */
interface PromoCodeSeed {
    code: string;
    valueType: 'PERCENT' | 'ABSOLUTE';
    value: number;
    durationType: 'ONCE' | 'MONTHS' | 'BILLING_CYCLES';
    durationValue: number | null;
    status: 'ACTIVE' | 'PAUSED' | 'EXHAUSTED' | 'EXPIRED';
    maxRedemptions: number | null;
    appliesToPlans: string[];
    campaignTag: string;
    description: string;
    /** Days from now until the code expires; negative = already expired. */
    validUntilInDays: number | null;
}

const PROMO_CODES: PromoCodeSeed[] = [
    {
        code: 'WELCOME25',
        valueType: 'PERCENT',
        value: 25,
        durationType: 'ONCE',
        durationValue: null,
        status: 'ACTIVE',
        maxRedemptions: 100,
        appliesToPlans: [],
        campaignTag: 'welcome',
        description: '25% off the first invoice for new customers.',
        validUntilInDays: 90,
    },
    {
        code: 'TEAM10',
        valueType: 'PERCENT',
        value: 10,
        durationType: 'BILLING_CYCLES',
        durationValue: 12,
        status: 'ACTIVE',
        maxRedemptions: null,
        appliesToPlans: ['PRO'],
        campaignTag: 'team',
        description: '10% off Pro for the first twelve billing cycles.',
        validUntilInDays: null,
    },
    {
        code: 'OLD2025',
        valueType: 'PERCENT',
        value: 15,
        durationType: 'ONCE',
        durationValue: null,
        status: 'EXPIRED',
        maxRedemptions: 500,
        appliesToPlans: [],
        campaignTag: 'legacy',
        description: 'Expired 2025 launch code.',
        validUntilInDays: -30,
    },
];

async function seedTenants(prisma: PrismaClient): Promise<void> {
    for (const tenant of DEMO_TENANTS) {
        const { notes, ...row } = tenant;
        await prisma.tenant.upsert({
            where: { id: row.id },
            create: row,
            update: { name: row.name, isActive: row.isActive ?? true },
        });
        await prisma.user.upsert({
            where: { email: `demo@${row.slug}.example` },
            create: { tenantId: row.id, email: `demo@${row.slug}.example` },
            update: {},
        });

        // Re-seeding must not stack notes on top of the previous run, or the
        // quota usage drifts upwards on every `db:seed`.
        await prisma.note.deleteMany({ where: { tenantId: row.id } });
        if (notes > 0) {
            await prisma.note.createMany({
                data: Array.from({ length: notes }, (_, i) => ({
                    tenantId: row.id,
                    title: `${row.name} — note ${i + 1}`,
                    body: 'Seeded demo note.',
                })),
            });
        }
    }
}

/**
 * The party each tenant's contracts are concluded with.
 *
 * An application that creates tenants creates their subscribers in the same
 * step, through the platform, which numbers them behind the prefix in
 * `config/saas.yaml`. Here the tenant's name stands in for the legal name a
 * sign-up form would ask for. Only where a tenant has none yet, so a second
 * seed run leaves the customer numbers as they are.
 */
async function seedSubscribers(prisma: PrismaClient): Promise<void> {
    const subscribers = new SubscriberService(
        new PrismaSubscriberRepository(prisma),
        loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
    );
    for (const tenant of DEMO_TENANTS) {
        const existing = await subscribers.findByTenantId(tenant.id);
        if (!existing) {
            await subscribers.createForTenant(tenant.id, {
                legalName: tenant.name,
                invoiceEmail: `billing@${tenant.slug}.example`,
                ...SUBSCRIBER_ADDRESSES[tenant.id],
                business: true,
            });
            continue;
        }
        // A subscriber seeded without its address or a business status: the
        // tax adapter decides from the country and the business status, and a
        // contract names the whole address, so what is missing is filled in
        // and nothing else is touched.
        const missing = addressGapsOf(existing, SUBSCRIBER_ADDRESSES[tenant.id]);
        if (Object.keys(missing).length > 0) {
            await subscribers.changeContactOfTenant(tenant.id, missing, SEEDED_BY);
        }
        if (existing.business === null) {
            await subscribers.changeBusinessStatus(existing.id, {
                business: true,
                changedBy: SEEDED_BY,
                reason: 'Every demo tenant is a business.',
            });
        }
    }
}

/** The fields of `address` the subscriber has none of yet. */
function addressGapsOf(
    subscriber: SubscriberRecord,
    address: SubscriberInvoiceAddress,
): Partial<SubscriberInvoiceAddress> {
    return Object.fromEntries(
        SUBSCRIBER_INVOICE_ADDRESS_FIELDS.filter((field) => subscriber[field] === null).map(
            (field) => [field, address[field]],
        ),
    );
}

async function seedPlans(prisma: PrismaClient): Promise<void> {
    const now = new Date();
    for (const spec of PLANS) {
        await prisma.plan.upsert({
            where: { planKey: spec.planKey },
            create: {
                planKey: spec.planKey,
                label: spec.label,
                description: spec.description,
                sortOrder: spec.sortOrder,
            },
            update: {
                label: spec.label,
                description: spec.description,
                sortOrder: spec.sortOrder,
                // Undo a soft delete. Re-seeding is how a developer gets the
                // demo state back after trying the archive action in the UI,
                // and an `update` that leaves `deletedAt` set reports success
                // while changing nothing they can see.
                deletedAt: null,
            },
        });
        // `planId` is the plan KEY (soft binding), not the stem UUID.
        await prisma.planVersion.upsert({
            where: { planId_version: { planId: spec.planKey, version: 1 } },
            create: {
                planId: spec.planKey,
                version: 1,
                features: spec.features,
                quotas: spec.quotas,
                monthlyNet: spec.monthlyNet,
                yearlyNet: spec.yearlyNet,
                marketed: true,
                publishedAt: now,
                changeNote: spec.changeNote,
                nonRegressive: true,
            },
            update: {
                features: spec.features,
                quotas: spec.quotas,
                monthlyNet: spec.monthlyNet,
                yearlyNet: spec.yearlyNet,
                publishedAt: now,
            },
        });
    }
}

async function seedBundles(prisma: PrismaClient): Promise<void> {
    const now = new Date();
    for (const spec of BUNDLES) {
        // BundleVersion.bundleId is a real FK to Bundle.id, so upsert the stem
        // first and reuse its generated id for the version.
        const bundle = await prisma.bundle.upsert({
            where: { bundleKey: spec.bundleKey },
            create: {
                bundleKey: spec.bundleKey,
                label: spec.label,
                description: spec.description,
                icon: spec.icon,
                sortOrder: spec.sortOrder,
            },
            update: {
                label: spec.label,
                description: spec.description,
                icon: spec.icon,
                sortOrder: spec.sortOrder,
                // See the plan upsert above: without this, a bundle deleted
                // through the UI stays deleted and the seed says nothing.
                deletedAt: null,
            },
        });
        await prisma.bundleVersion.upsert({
            where: { bundleId_version: { bundleId: bundle.id, version: 1 } },
            create: {
                bundleId: bundle.id,
                version: 1,
                features: spec.features,
                quotas: spec.quotas,
                monthlyNet: spec.monthlyNet,
                yearlyNet: spec.yearlyNet,
                marketed: true,
                publishedAt: now,
                changeNote: spec.changeNote,
                nonRegressive: true,
            },
            update: {
                features: spec.features,
                quotas: spec.quotas,
                monthlyNet: spec.monthlyNet,
                yearlyNet: spec.yearlyNet,
                publishedAt: now,
            },
        });
    }
}

async function seedMarketing(prisma: PrismaClient): Promise<void> {
    // The table holds at most one row, and the schema's constant primary key
    // is what enforces it — so the seed addresses the same row on every run.
    await prisma.marketingSettings.upsert({
        where: { id: MARKETING_SETTINGS_ROW_ID },
        create: { id: MARKETING_SETTINGS_ROW_ID, activeLocales: ['en'] },
        update: { activeLocales: ['en'] },
    });

    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + PROMOTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    for (const promo of PROMOTIONS) {
        await prisma.promotion.upsert({
            where: { id: promo.id },
            create: {
                id: promo.id,
                internalLabel: promo.internalLabel,
                type: promo.type,
                value: promo.value,
                targetType: 'PLAN',
                appliesTo: promo.appliesTo,
                billingCycle: promo.billingCycle,
                validFrom,
                validTo,
                priority: promo.priority,
                color: promo.color,
                i18n: promo.i18n,
            },
            update: {
                internalLabel: promo.internalLabel,
                type: promo.type,
                value: promo.value,
                appliesTo: promo.appliesTo,
                billingCycle: promo.billingCycle,
                validFrom,
                validTo,
                priority: promo.priority,
                color: promo.color,
                i18n: promo.i18n,
            },
        });
    }
}

/**
 * Writes each demo subscription where its tenant has none, and returns them as
 * they stand, each with the add-ons it has no booking of yet. A subscription
 * that exists is left as it is: its plan, its add-ons and its contract change
 * only the way the platform changes them, and a seed that wrote a plan back
 * over a contract would bill the one while the other is in force. The add-ons
 * are booked by the platform, when it activates the subscription
 * (`activateSeededSubscriptions`).
 */
async function seedSubscriptions(prisma: PrismaClient): Promise<SeededSubscription[]> {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const seeded: SeededSubscription[] = [];
    for (const spec of SUBSCRIPTIONS) {
        const planVersion = await prisma.planVersion.findUnique({
            where: { planId_version: { planId: spec.planKey, version: 1 } },
        });
        if (!planVersion) {
            throw new Error(
                `No seeded PlanVersion for plan ${spec.planKey} — run seedPlans first.`,
            );
        }
        const row = await prisma.subscription.upsert({
            where: { tenantId: spec.tenantId },
            create: {
                tenantId: spec.tenantId,
                plan: spec.planKey,
                billingCycle: 'YEARLY',
                status: 'ACTIVE',
                planVersionId: planVersion.id,
                startedAt: now,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                // The day the window opened, as the platform writes it when it
                // opens one.
                billingAnchorDay: now.getUTCDate(),
            },
            update: {},
        });
        seeded.push({
            id: row.id,
            tenantId: row.tenantId,
            plan: row.plan,
            billingCycle: row.billingCycle,
            currentPeriodStart: row.currentPeriodStart,
            currentPeriodEnd: row.currentPeriodEnd,
            billingAnchorDay: row.billingAnchorDay,
            canceledAt: row.canceledAt,
            canceledEffectiveAt: row.canceledEffectiveAt,
            addOns: await addOnsNotYetBooked(prisma, row.id, spec.addOns),
        });
    }
    return seeded;
}

/** The published v1 of each add-on in `bundleKeys` that `subscriptionId` has no booking of, cancelled or not. */
async function addOnsNotYetBooked(
    prisma: PrismaClient,
    subscriptionId: string,
    bundleKeys: readonly string[],
): Promise<string[]> {
    const versionIds: string[] = [];
    for (const bundleKey of bundleKeys) {
        const bundle = await prisma.bundle.findUnique({ where: { bundleKey } });
        const version = bundle
            ? await prisma.bundleVersion.findUnique({
                  where: { bundleId_version: { bundleId: bundle.id, version: 1 } },
              })
            : null;
        if (!version) {
            throw new Error(`No seeded ${bundleKey} BundleVersion v1 — run seedBundles first.`);
        }
        const booked = await prisma.subscriptionBundle.findFirst({
            where: { subscriptionId, bundleVersionId: version.id },
        });
        if (!booked) versionIds.push(version.id);
    }
    return versionIds;
}

async function seedPromoCodes(prisma: PrismaClient): Promise<void> {
    const admin = await prisma.superAdminUser.findUnique({
        where: { email: DEMO_SUPER_ADMIN.email },
    });
    const createdById = admin?.id ?? 'seed';
    const now = Date.now();
    for (const spec of PROMO_CODES) {
        const validUntil =
            spec.validUntilInDays === null
                ? null
                : new Date(now + spec.validUntilInDays * 24 * 60 * 60 * 1000);
        await prisma.promoCode.upsert({
            where: { code: spec.code },
            create: {
                code: spec.code,
                valueType: spec.valueType,
                value: spec.value,
                durationType: spec.durationType,
                durationValue: spec.durationValue,
                status: spec.status,
                maxRedemptions: spec.maxRedemptions,
                appliesToPlans: spec.appliesToPlans,
                campaignTag: spec.campaignTag,
                description: spec.description,
                validUntil,
                createdById,
            },
            update: {
                valueType: spec.valueType,
                value: spec.value,
                durationType: spec.durationType,
                durationValue: spec.durationValue,
                status: spec.status,
                maxRedemptions: spec.maxRedemptions,
                appliesToPlans: spec.appliesToPlans,
                campaignTag: spec.campaignTag,
                description: spec.description,
                validUntil,
            },
        });
    }
}

/**
 * Starts the platform from the application's options and activates each seeded
 * subscription through it (`activateSeededSubscriptions`).
 */
async function activateThroughThePlatform(
    subscriptions: readonly SeededSubscription[],
): Promise<string[]> {
    const app = await NestFactory.createApplicationContext(SeedModule, {
        logger: ['error', 'warn'],
    });
    try {
        return await activateSeededSubscriptions(seedActivationPlatformOf(app), subscriptions);
    } finally {
        await app.close();
    }
}

async function seed(): Promise<void> {
    const prisma = new PrismaClient();
    try {
        await seedTenants(prisma);
        await seedSubscribers(prisma);
        // The installation's sealer, under the key the application opens
        // the second factor with.
        const otpauthUri = await seedSuperAdmin(
            prisma,
            aesGcmSecretSealer(process.env.SECRET_SEALER_KEY),
        );
        await seedPlans(prisma);
        await seedBundles(prisma);
        await seedMarketing(prisma);
        const subscriptions = await seedSubscriptions(prisma);
        await seedPromoCodes(prisma);
        const activated = await activateThroughThePlatform(subscriptions);
        const notes = DEMO_TENANTS.reduce((sum, t) => sum + t.notes, 0);
        console.log(
            `seeded ${DEMO_TENANTS.length} tenants, ${notes} notes, ` +
                `${PLANS.length} plans, ${BUNDLES.length} bundles, ` +
                `${SUBSCRIPTIONS.length} subscriptions (1 add-on bundle; ` +
                `${activated.length} activated by this run), ` +
                `${PROMO_CODES.length} promo codes, ` +
                `${PROMOTIONS.length} promotions, 1 marketing-settings row, ` +
                `SuperAdmin ${DEMO_SUPER_ADMIN.email} / ${DEMO_SUPER_ADMIN.password}`,
        );
        console.log(
            otpauthUri
                ? `second factor for ${DEMO_SUPER_ADMIN.email} — add to an authenticator app: ${otpauthUri}`
                : `second factor for ${DEMO_SUPER_ADMIN.email} already set up — the authenticator entry from the first seed still applies`,
        );
    } finally {
        await prisma.$disconnect();
    }
}

void seed();
