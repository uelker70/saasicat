import { PrismaClient } from '@prisma/client';

/**
 * Seeds the demo tenants the curl walkthrough uses. Tenant ids equal the
 * `x-demo-tenant` header values on purpose — the DemoAuthGuard maps the
 * header straight to the tenant id.
 */
const DEMO_TENANTS = [
    { id: 'tenant-a', slug: 'tenant-a', name: 'Tenant A (Starter)' },
    { id: 'tenant-b', slug: 'tenant-b', name: 'Tenant B (Starter)' },
];

async function seed(): Promise<void> {
    const prisma = new PrismaClient();
    try {
        for (const tenant of DEMO_TENANTS) {
            await prisma.tenant.upsert({
                where: { id: tenant.id },
                create: tenant,
                update: { name: tenant.name },
            });
            await prisma.user.upsert({
                where: { email: `demo@${tenant.slug}.example` },
                create: {
                    tenantId: tenant.id,
                    email: `demo@${tenant.slug}.example`,
                },
                update: {},
            });
        }
        console.log(`seeded ${DEMO_TENANTS.length} demo tenants`);
    } finally {
        await prisma.$disconnect();
    }
}

void seed();
