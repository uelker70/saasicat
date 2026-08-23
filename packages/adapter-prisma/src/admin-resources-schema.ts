// What `PrismaAdminResourcesAdapter` calls things, and what your schema does.
//
// The adapter used to resolve `tenant`, `user` and `subscription` by hardcoded
// name and read `isActive`, `deletedAt`, `firstName`, `lastName` off them.
// `docs/guides/integrate-into-an-existing-app.md` was honest about it and drew the only
// conclusion available: an app whose tenant model is called `organization`, or
// whose flag is `enabled`, should set `adminResources: false` — and lose every
// SuperAdmin endpoint over a naming difference.
//
// So the names are a mapping now. Nothing else about the adapter changes: it
// still expects the same SHAPE — a tenant with a slug and an activity flag, a
// user with a mail address, a subscription with a plan and a status. A schema
// that differs in shape rather than in vocabulary still implements
// `AdminResourcesPort` itself, and that is the honest boundary.
//
// Defaults are exactly the names that were hardcoded, so an app that matched
// the convention passes `{}` and nothing moves.

/** The Prisma delegates the adapter needs, by the name your client uses. */
export interface AdminResourcesDelegates {
    /** Default `tenant`. */
    tenant?: string;
    /** Default `user`. */
    user?: string;
    /** Default `subscription`. */
    subscription?: string;
}

/** The scalar and relation fields the adapter reads, by your name for them. */
export interface AdminResourcesFields {
    tenant?: {
        /** Default `slug` — the stable identifier every admin route addresses. */
        slug?: string;
        /** Default `name`. */
        name?: string;
        /** Default `isActive`. */
        isActive?: string;
        /** Default `deletedAt`. */
        deletedAt?: string;
        /** The tenant→users relation. Default `users`. */
        users?: string;
        /**
         * The tenant→subscription relation. Default `subscription`.
         *
         * On YOUR model, so your name for it: Prisma names a relation field
         * after what it points at, and an app whose tenant is `Organization`
         * has usually not renamed this one — but it may have.
         */
        subscription?: string;
    };
    user?: {
        /** Default `email`. */
        email?: string;
        /** Default `firstName`. */
        firstName?: string;
        /** Default `lastName`. */
        lastName?: string;
        /** Default `isActive`. */
        isActive?: string;
        /**
         * The user→tenant relation. Default `tenant`.
         *
         * The one the documented example gets wrong by omission: an app whose
         * tenant model is `Organization` calls this field `organization`, by
         * the same Prisma convention that named the delegate.
         */
        tenant?: string;
    };
}

/** The mapping with every default filled in — what the adapter actually reads. */
export interface ResolvedAdminResourcesSchema {
    readonly delegates: Required<AdminResourcesDelegates>;
    readonly tenant: Required<NonNullable<AdminResourcesFields['tenant']>>;
    readonly user: Required<NonNullable<AdminResourcesFields['user']>>;
}

const DEFAULTS: ResolvedAdminResourcesSchema = {
    delegates: { tenant: 'tenant', user: 'user', subscription: 'subscription' },
    tenant: {
        slug: 'slug',
        name: 'name',
        isActive: 'isActive',
        deletedAt: 'deletedAt',
        users: 'users',
        subscription: 'subscription',
    },
    user: {
        email: 'email',
        firstName: 'firstName',
        lastName: 'lastName',
        isActive: 'isActive',
        tenant: 'tenant',
    },
};

export function resolveAdminResourcesSchema(
    delegates: AdminResourcesDelegates = {},
    fields: AdminResourcesFields = {},
): ResolvedAdminResourcesSchema {
    return {
        delegates: { ...DEFAULTS.delegates, ...delegates },
        tenant: { ...DEFAULTS.tenant, ...fields.tenant },
        user: { ...DEFAULTS.user, ...fields.user },
    };
}

/**
 * Refuses a mapping that names a delegate the client does not have.
 *
 * At construction, which is boot: a mapped delegate is resolved lazily, so a
 * typo used to surface as a 500 on the tenants page long after deployment —
 * and only if somebody opened it. The message lists what the client does have,
 * because the answer is almost always a near miss (`organisation` for
 * `organization`, `users` for `user`).
 *
 * Only for an EXPLICIT mapping. `prismaPersistence()` builds this adapter for
 * every bundle, including for applications that never switch `adminResources`
 * on, and several of them have no `tenant` delegate at all — asserting the
 * defaults here would refuse to construct a bundle nobody was going to ask
 * about. Those keep failing where they always did, at the first request, with
 * a message that now names the way out.
 */
export function assertDelegatesExist(client: unknown, schema: ResolvedAdminResourcesSchema): void {
    const available = new Set(delegateNamesOf(client));
    const missing = Object.entries(schema.delegates)
        .filter(([, delegateName]) => !available.has(delegateName))
        .map(([role, delegateName]) => `${role} → '${delegateName}'`);
    if (missing.length === 0) return;

    throw new Error(
        `PrismaAdminResourcesAdapter is mapped to delegates the Prisma client does not have: ` +
            `${missing.join(', ')}. The client offers: ${[...available].sort().join(', ') || '(none)'}. ` +
            'Map them with `adminResources: { delegates: { tenant: "organization" } }`, or ' +
            'implement `AdminResourcesPort` yourself if the shape differs rather than the names.',
    );
}

/**
 * Model delegates on a Prisma client.
 *
 * A delegate is an own enumerable object property with a `findMany` — the
 * client also carries `$connect`, `$transaction` and internal symbols, and a
 * list including those would make the error message above useless.
 */
function delegateNamesOf(client: unknown): string[] {
    if (!client || typeof client !== 'object') return [];
    return Object.keys(client as Record<string, unknown>).filter((key) => {
        if (key.startsWith('$') || key.startsWith('_')) return false;
        const value = (client as Record<string, unknown>)[key];
        return (
            typeof value === 'object' &&
            value !== null &&
            typeof (value as { findMany?: unknown }).findMany === 'function'
        );
    });
}
