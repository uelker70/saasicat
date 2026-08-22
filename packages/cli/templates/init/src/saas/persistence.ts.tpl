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
    // If your models are called something else, map them here:
    // `adminResources: { delegates: { tenant: 'organization' },
    //                    fields: { tenant: { users: 'members' } } }`
    // — see docs/migrating-an-existing-app.md. Left out on purpose otherwise:
    // the tenant row counter defaults to whatever the mapping says the users
    // relation is called, and naming it here would hardcode `users` past that.
});
