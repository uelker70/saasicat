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

async function seed(): Promise<void> {
    const prisma = new PrismaClient();
    try {
        await seedTenants(prisma);
        await seedSuperAdmin(prisma);
        const notes = DEMO_TENANTS.reduce((sum, t) => sum + t.notes, 0);
        console.log(
            `seeded ${DEMO_TENANTS.length} tenants, ${notes} notes, ` +
                `SuperAdmin ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`,
        );
    } finally {
        await prisma.$disconnect();
    }
}

void seed();
