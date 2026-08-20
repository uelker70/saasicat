import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PrismaAdminResourcesAdapter,
    assertDelegatesExist,
    resolveAdminResourcesSchema,
} from '../dist/index.js';

// An application whose tenant model is called `organization` and whose activity
// flag is `enabled` used to have one option: `adminResources: false`, and no
// SuperAdmin endpoints at all. `docs/migrating-an-existing-app.md` said so, and
// it was the honest thing to say about an adapter that resolved delegates by
// hardcoded name.
//
// The names are a mapping now. The SHAPE is not: an app whose tenants have no
// activity flag, or an m:n tenant/user relation, still implements
// `AdminResourcesPort` itself — that boundary is real and stays where it was.

/** The error `fn` threw. `assert.throws` returns nothing, so it cannot be used. */
function thrownBy(fn) {
    try {
        fn();
    } catch (err) {
        return err;
    }
    assert.fail('expected a throw, got none');
}

/** A Prisma-ish client that records what was asked of it. */
function clientWith(delegateNames, rowsByDelegate = {}) {
    const calls = [];
    const client = {};
    for (const name of delegateNames) {
        client[name] = {
            findMany: async (args) => {
                calls.push({ delegate: name, method: 'findMany', args });
                return rowsByDelegate[name] ?? [];
            },
            findUnique: async (args) => {
                calls.push({ delegate: name, method: 'findUnique', args });
                return (rowsByDelegate[name] ?? [])[0] ?? null;
            },
            update: async (args) => {
                calls.push({ delegate: name, method: 'update', args });
                return {};
            },
            updateMany: async (args) => {
                calls.push({ delegate: name, method: 'updateMany', args });
                return {};
            },
        };
    }
    // Not a delegate: the check must not offer these as suggestions.
    client.$connect = async () => {};
    client.$transaction = async (fn) => fn(client);
    return { client, calls };
}

const CONVENTIONAL = ['tenant', 'user', 'subscription', 'auditLog'];
const RENAMED = ['organization', 'account', 'subscription', 'auditLog'];

describe('the mapping', () => {
    test('defaults to exactly the names that used to be hardcoded', () => {
        const schema = resolveAdminResourcesSchema();
        assert.deepEqual(schema.delegates, {
            tenant: 'tenant',
            user: 'user',
            subscription: 'subscription',
        });
        assert.equal(schema.tenant.isActive, 'isActive');
        assert.equal(schema.user.firstName, 'firstName');
    });

    test('a partial mapping leaves the rest at the defaults', () => {
        // The common case is one renamed model, not a whole vocabulary.
        const schema = resolveAdminResourcesSchema(
            { tenant: 'organization' },
            { tenant: { isActive: 'enabled' } },
        );
        assert.equal(schema.delegates.tenant, 'organization');
        assert.equal(schema.delegates.user, 'user');
        assert.equal(schema.tenant.isActive, 'enabled');
        assert.equal(schema.tenant.slug, 'slug');
    });
});

describe('a mapped delegate that does not exist fails at construction', () => {
    test('and names what the client does have', () => {
        const { client } = clientWith(CONVENTIONAL);
        const error = thrownBy(() =>
            assertDelegatesExist(client, resolveAdminResourcesSchema({ tenant: 'organisation' })),
        );
        assert.match(error.message, /tenant → 'organisation'/);
        assert.match(error.message, /The client offers: auditLog, subscription, tenant, user/);
    });

    test('and does not offer $connect as a candidate', () => {
        const { client } = clientWith(CONVENTIONAL);
        const error = thrownBy(() =>
            assertDelegatesExist(client, resolveAdminResourcesSchema({ user: 'nope' })),
        );
        assert.doesNotMatch(error.message, /\$connect|\$transaction/);
    });

    test('the adapter refuses to be built with it', () => {
        const { client } = clientWith(CONVENTIONAL);
        assert.throws(
            () => new PrismaAdminResourcesAdapter(client, { delegates: { tenant: 'nope' } }),
            /does not have/,
        );
    });

    test('but an unmapped adapter is built even without those delegates', () => {
        // `prismaPersistence()` constructs this adapter for every bundle,
        // including for apps that never enable adminResources. Refusing there
        // would break a bundle nobody was going to ask about.
        const { client } = clientWith(['auditLog']);
        assert.doesNotThrow(() => new PrismaAdminResourcesAdapter(client));
    });
});

describe('an app that calls everything something else', () => {
    const OPTIONS = {
        delegates: { tenant: 'organization', user: 'account' },
        fields: {
            tenant: { isActive: 'enabled', slug: 'handle', name: 'title', users: 'members' },
            user: { email: 'mail', firstName: 'givenName', lastName: 'familyName' },
        },
    };

    test('the tenant list queries and reads the mapped names', async () => {
        const { client, calls } = clientWith(RENAMED, {
            organization: [
                {
                    id: 't1',
                    handle: 'acme',
                    title: 'Acme',
                    enabled: false,
                    createdAt: new Date('2026-01-01'),
                    subscription: { plan: 'PRO', status: 'active' },
                },
            ],
        });
        const adapter = new PrismaAdminResourcesAdapter(client, OPTIONS);
        const rows = await adapter.listTenants({ status: 'ACTIVE', search: 'ac' });

        const [call] = calls;
        assert.equal(call.delegate, 'organization');
        assert.equal(call.args.where.enabled, true, 'the status filter uses the mapped flag');
        assert.deepEqual(
            call.args.where.OR.map((clause) => Object.keys(clause)[0]),
            ['handle', 'title'],
            'the search filter uses the mapped columns',
        );

        assert.deepEqual(rows, [
            {
                id: 't1',
                slug: 'acme',
                name: 'Acme',
                isActive: false,
                deletedAt: null,
                plan: 'PRO',
                status: 'active',
                createdAt: new Date('2026-01-01').toISOString(),
            },
        ]);
    });

    test('the detail route addresses the tenant by the mapped slug', async () => {
        const { client, calls } = clientWith(RENAMED, {
            organization: [
                {
                    id: 't1',
                    handle: 'acme',
                    title: 'Acme',
                    enabled: true,
                    createdAt: new Date('2026-01-01'),
                    subscription: null,
                    members: [
                        {
                            id: 'u1',
                            mail: 'a@b.c',
                            givenName: 'Ada',
                            familyName: 'L',
                            createdAt: new Date('2026-01-02'),
                        },
                    ],
                },
            ],
        });
        const adapter = new PrismaAdminResourcesAdapter(client, OPTIONS);
        const detail = await adapter.getTenantDetail('acme');

        assert.deepEqual(calls[0].args.where, { handle: 'acme' });
        assert.ok('members' in calls[0].args.include, 'the users relation is included by its name');
        assert.equal(detail.slug, 'acme');
        assert.deepEqual(detail.users, [
            {
                id: 'u1',
                email: 'a@b.c',
                firstName: 'Ada',
                lastName: 'L',
                createdAt: '2026-01-02T00:00:00.000Z',
            },
        ]);
    });

    test('suspending writes the mapped flag', async () => {
        const { client, calls } = clientWith(RENAMED, {
            organization: [{ id: 't1', handle: 'acme' }],
        });
        const adapter = new PrismaAdminResourcesAdapter(client, OPTIONS);
        await adapter.setTenantActive('acme', false, 'suspended');

        const update = calls.find((c) => c.method === 'update');
        assert.deepEqual(update.args.data, { enabled: false });
    });

    test('the user list filters and reads the mapped names', async () => {
        const { client, calls } = clientWith(RENAMED, {
            account: [
                {
                    id: 'u1',
                    mail: 'a@b.c',
                    givenName: 'Ada',
                    familyName: 'L',
                    createdAt: new Date('2026-01-02'),
                    tenant: { handle: 'acme' },
                },
            ],
        });
        const adapter = new PrismaAdminResourcesAdapter(client, OPTIONS);
        const rows = await adapter.listUsers({ q: 'ada', tenant: 'acme' });

        assert.equal(calls[0].delegate, 'account');
        assert.deepEqual(calls[0].args.where.mail, { contains: 'ada', mode: 'insensitive' });
        assert.deepEqual(calls[0].args.where.tenant, { handle: 'acme' });
        assert.equal(rows[0].email, 'a@b.c');
        assert.equal(rows[0].firstName, 'Ada');
        assert.equal(rows[0].tenantSlug, 'acme');
    });
});

describe('an app that matches the convention is unaffected', () => {
    test('no mapping means the same queries as before', async () => {
        const { client, calls } = clientWith(CONVENTIONAL, {
            tenant: [
                {
                    id: 't1',
                    slug: 'acme',
                    name: 'Acme',
                    isActive: true,
                    createdAt: new Date('2026-01-01'),
                },
            ],
        });
        const adapter = new PrismaAdminResourcesAdapter(client);
        const rows = await adapter.listTenants({ status: 'INACTIVE' });

        assert.equal(calls[0].delegate, 'tenant');
        assert.deepEqual(calls[0].args.where, { isActive: false });
        assert.equal(rows[0].slug, 'acme');
    });
});

describe('the mapping reaches the two places it used to stop short of', () => {
    // Both were found by review, both on the very example the migration guide
    // now prints. The adapter constructed fine, the app booted, and the two
    // endpoints the feature exists to serve answered with
    // PrismaClientValidationError.

    const OPTIONS = {
        delegates: { tenant: 'organization', user: 'account' },
        fields: {
            tenant: { isActive: 'enabled', slug: 'handle', name: 'title', users: 'members' },
            user: { email: 'mail' },
        },
    };

    test('the relation counter defaults to the mapped users relation', async () => {
        const { client, calls } = clientWith(RENAMED, { organization: [] });
        const adapter = new PrismaAdminResourcesAdapter(client, OPTIONS);
        await adapter.listTenants({});

        assert.deepEqual(
            calls[0].args.include._count.select,
            { members: true },
            '`users: true` on a model whose relation is `members` is a validation error',
        );
    });

    test('an explicit tenantMetrics still wins', () => {
        // The option is how an app counts something else entirely; the mapping
        // is only what it falls back to.
        const { client } = clientWith(RENAMED);
        assert.doesNotThrow(
            () => new PrismaAdminResourcesAdapter(client, { ...OPTIONS, tenantMetrics: ['notes'] }),
        );
    });

    test('the subscription list selects and reads the mapped tenant columns', async () => {
        const { client, calls } = clientWith(RENAMED, {
            subscription: [
                {
                    id: 's1',
                    plan: 'PRO',
                    status: 'active',
                    billingCycle: 'MONTHLY',
                    tenant: { handle: 'acme', title: 'Acme' },
                },
            ],
        });
        const adapter = new PrismaAdminResourcesAdapter(client, OPTIONS);
        const rows = await adapter.listSubscriptions();

        assert.deepEqual(calls[0].args.include.tenant.select, { handle: true, title: true });
        assert.deepEqual(rows[0].tenant, { slug: 'acme', name: 'Acme' });
    });

    test('and an unmapped app still selects slug and name', async () => {
        const { client, calls } = clientWith(CONVENTIONAL, { subscription: [] });
        const adapter = new PrismaAdminResourcesAdapter(client);
        await adapter.listSubscriptions();
        assert.deepEqual(calls[0].args.include.tenant.select, { slug: true, name: true });
    });
});
