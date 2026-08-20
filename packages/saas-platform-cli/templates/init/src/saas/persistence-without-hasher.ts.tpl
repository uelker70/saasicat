import { prismaPersistence } from '@saasicat/adapter-prisma';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Every repository the platform needs, from one Prisma client.
 *
 * The `--skip-hasher` variant. The bundle is still generated — an app without
 * one fails `core.adapters-bound` on its first boot — but it names no hasher,
 * because you said you have your own.
 *
 * Bind it before the SuperAdmin setup wizard or self-registration runs: both
 * write a password, and neither can do it without one.
 */
export const persistence = prismaPersistence({
    client: PrismaService,
    // passwordHasher: YourHasher,
    // Relation counters on the tenant rows. The names must be relations on
    // your Tenant model. If your models are called something else, map them:
    // `delegates: { tenant: 'organization' }` — see docs/migrating-an-existing-app.md.
    adminResources: { tenantMetrics: ['users'] },
});
