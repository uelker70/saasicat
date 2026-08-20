import { prismaPersistence } from '@saasicat/adapter-prisma';

import { PrismaService } from '../prisma/prisma.service';
import { __HASHER_CLASS__ } from '../auth/__HASHER_FILE__';

/**
 * Every repository the platform needs, from one Prisma client.
 *
 * Split out of `app.module.ts` so the wiring is one import there and the
 * decisions are visible here: which client, which hasher, and what the
 * SuperAdmin tenant list counts.
 */
export const persistence = prismaPersistence({
    client: PrismaService,
    passwordHasher: __HASHER_CLASS__,
    // Relation counters on the tenant rows. The names must be relations on
    // your Tenant model. If your models are called something else, map them:
    // `delegates: { tenant: 'organization' }` — see docs/migrating-an-existing-app.md.
    adminResources: { tenantMetrics: ['users'] },
});
