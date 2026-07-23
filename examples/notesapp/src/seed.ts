import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

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

/** Matches DemoPasswordHasher — scrypt with a 64-byte key. */
const SUPER_ADMIN = { email: 'admin@notesapp.example', password: 'demo' };

/** Catalog rows are scoped to the app via `projectKey` (matches config/saas.yaml). */
const PROJECT_KEY = 'notesapp';

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

function hashPassword(plain: string): string {
    const salt = randomBytes(16).toString('hex');
    return `scrypt:${salt}:${scryptSync(plain, salt, 64).toString('hex')}`;
}

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

async function seedSuperAdmin(prisma: PrismaClient): Promise<void> {
    await prisma.superAdminUser.upsert({
        where: { email: SUPER_ADMIN.email },
        create: {
            email: SUPER_ADMIN.email,
            passwordHash: hashPassword(SUPER_ADMIN.password),
            firstName: 'Demo',
            lastName: 'Admin',
        },
        // Keep an existing password — re-seeding should not invalidate a
        // password the developer changed through the UI.
        update: { isActive: true, deletedAt: null },
    });
}

async function seedPlans(prisma: PrismaClient): Promise<void> {
    const now = new Date();
    for (const spec of PLANS) {
        await prisma.plan.upsert({
            where: { projectKey_planKey: { projectKey: PROJECT_KEY, planKey: spec.planKey } },
            create: {
                projectKey: PROJECT_KEY,
                planKey: spec.planKey,
                label: spec.label,
                description: spec.description,
                sortOrder: spec.sortOrder,
            },
            update: {
                label: spec.label,
                description: spec.description,
                sortOrder: spec.sortOrder,
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
            where: { projectKey_bundleKey: { projectKey: PROJECT_KEY, bundleKey: spec.bundleKey } },
            create: {
                projectKey: PROJECT_KEY,
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
                marketed: true,
                publishedAt: now,
                changeNote: spec.changeNote,
                nonRegressive: true,
            },
            update: {
                features: spec.features,
                quotas: spec.quotas,
                monthlyNet: spec.monthlyNet,
                publishedAt: now,
            },
        });
    }
}

async function seedMarketing(prisma: PrismaClient): Promise<void> {
    await prisma.marketingSettings.upsert({
        where: { projectKey: PROJECT_KEY },
        create: { projectKey: PROJECT_KEY, activeLocales: ['en'] },
        update: { activeLocales: ['en'] },
    });

    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + PROMOTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    for (const promo of PROMOTIONS) {
        await prisma.promotion.upsert({
            where: { id: promo.id },
            create: {
                id: promo.id,
                projectKey: PROJECT_KEY,
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

async function seed(): Promise<void> {
    const prisma = new PrismaClient();
    try {
        await seedTenants(prisma);
        await seedSuperAdmin(prisma);
        await seedPlans(prisma);
        await seedBundles(prisma);
        await seedMarketing(prisma);
        const notes = DEMO_TENANTS.reduce((sum, t) => sum + t.notes, 0);
        console.log(
            `seeded ${DEMO_TENANTS.length} tenants, ${notes} notes, ` +
                `${PLANS.length} plans, ${BUNDLES.length} bundles, ` +
                `${PROMOTIONS.length} promotions, 1 marketing-settings row, ` +
                `SuperAdmin ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`,
        );
    } finally {
        await prisma.$disconnect();
    }
}

void seed();
