import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaBundleRepository } from '../dist/index.js';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

function bundleRow(overrides = {}) {
    return {
        id: 'bundle-1',
        projectKey: 'test-app',
        bundleKey: 'SPORT',
        label: 'Sport',
        description: null,
        icon: null,
        sortOrder: 0,
        i18n: {},
        createdAt: EPOCH,
        updatedAt: EPOCH,
        deletedAt: null,
        ...overrides,
    };
}

function bundleVersionRow(overrides = {}) {
    return {
        id: 'version-1',
        bundleId: 'bundle-1',
        version: 1,
        baseVersionId: null,
        features: ['MEMBERS'],
        quotas: {},
        compatibility: {},
        pricingOverrides: [],
        monthlyNet: '9.90',
        yearlyNet: '99.00',
        marketed: true,
        publishedAt: null,
        supersededAt: null,
        publishedChanges: null,
        changeNote: '',
        nonRegressive: true,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        ...overrides,
    };
}

function fakePrisma(seedVersions = []) {
    const versions = new Map(seedVersions.map((row) => [row.id, row]));
    const calls = {
        transactions: 0,
        creates: [],
        findFirst: [],
        updates: [],
        updateMany: [],
    };
    const bundle = bundleRow();

    const client = {
        calls,
        async $transaction(work) {
            calls.transactions += 1;
            return work(client);
        },
        bundle: {
            async findUnique({ where }) {
                return where.id === bundle.id ? bundle : null;
            },
            async findFirst() {
                return bundle;
            },
            async findMany() {
                return [bundle];
            },
        },
        bundleVersion: {
            async findUnique({ where }) {
                return versions.get(where.id) ?? null;
            },
            async findFirst({ where, orderBy } = {}) {
                calls.findFirst.push({ where, orderBy });
                const matching = [...versions.values()].filter((row) => {
                    if (where?.bundleId && row.bundleId !== where.bundleId) return false;
                    if (where?.publishedAt === null && row.publishedAt !== null) return false;
                    if (where?.publishedAt?.not === null && row.publishedAt === null) return false;
                    if (where?.supersededAt === null && row.supersededAt !== null) return false;
                    for (const clause of where?.AND ?? []) {
                        const matchesAlternative = clause.OR.some((alternative) => {
                            if ('validFrom' in alternative) {
                                if (alternative.validFrom === null) return row.validFrom == null;
                                return (
                                    row.validFrom instanceof Date &&
                                    row.validFrom <= alternative.validFrom.lte
                                );
                            }
                            if ('validUntil' in alternative) {
                                if (alternative.validUntil === null) return row.validUntil == null;
                                return (
                                    row.validUntil instanceof Date &&
                                    row.validUntil >= alternative.validUntil.gte
                                );
                            }
                            return false;
                        });
                        if (!matchesAlternative) return false;
                    }
                    return true;
                });
                if (Array.isArray(orderBy)) {
                    matching.sort((left, right) => {
                        const leftFrom =
                            left.validFrom instanceof Date
                                ? left.validFrom.getTime()
                                : Number.NEGATIVE_INFINITY;
                        const rightFrom =
                            right.validFrom instanceof Date
                                ? right.validFrom.getTime()
                                : Number.NEGATIVE_INFINITY;
                        return rightFrom - leftFrom || right.version - left.version;
                    });
                } else if (orderBy?.version === 'desc') {
                    matching.sort((a, b) => b.version - a.version);
                }
                return matching[0] ?? null;
            },
            async findMany() {
                return [...versions.values()];
            },
            async create({ data }) {
                calls.creates.push(data);
                const row = bundleVersionRow({
                    id: `version-${versions.size + 1}`,
                    ...data,
                });
                versions.set(row.id, row);
                return row;
            },
            async update({ where, data }) {
                calls.updates.push({ where, data });
                const existing = versions.get(where.id);
                if (!existing) throw Object.assign(new Error('not found'), { code: 'P2025' });
                const row = { ...existing, ...data, updatedAt: new Date(EPOCH.getTime() + 1) };
                versions.set(row.id, row);
                return row;
            },
            async updateMany(args) {
                calls.updateMany.push(args);
                return { count: 1 };
            },
            async delete({ where }) {
                const existing = versions.get(where.id);
                if (!existing) throw Object.assign(new Error('not found'), { code: 'P2025' });
                versions.delete(where.id);
                return existing;
            },
        },
    };
    return client;
}

const draftInput = {
    bundleId: 'bundle-1',
    features: ['MEMBERS'],
    monthlyNet: '9.90',
    yearlyNet: '99.00',
    validFrom: '2026-08-10',
    validUntil: '2026-12-31',
};

const publishMeta = {
    publishedByUserId: 'admin-1',
    publishedChanges: [],
    nonRegressive: true,
    validFrom: new Date('2026-08-10T00:00:00.000Z'),
    validUntil: new Date('2026-12-31T00:00:00.000Z'),
};

describe('PrismaBundleRepository validity-window schema mode', () => {
    test('legacy default never requires, writes or exposes validity columns', async () => {
        const prisma = fakePrisma();
        const repo = new PrismaBundleRepository(prisma);

        assert.equal(repo.findActiveBundleVersion, undefined);
        const draft = await repo.createDraft(draftInput);
        assert.equal(draft.validFrom, null);
        assert.equal(draft.validUntil, null);
        assert.equal('validFrom' in prisma.calls.creates[0], false);
        assert.equal('validUntil' in prisma.calls.creates[0], false);

        await repo.publishDraft(draft.id, publishMeta);
        assert.equal(prisma.calls.transactions, 0, 'legacy transaction behavior stays unchanged');
        assert.equal('validUntil' in prisma.calls.updateMany[0].data, false);
        assert.equal('validFrom' in prisma.calls.updates.at(-1).data, false);
        assert.equal('validUntil' in prisma.calls.updates.at(-1).data, false);
    });

    test('enabled mode round-trips validity dates on create and update', async () => {
        const prisma = fakePrisma();
        const repo = new PrismaBundleRepository(prisma, { validityWindows: true });

        const draft = await repo.createDraft(draftInput);
        assert.equal(draft.validFrom, '2026-08-10T00:00:00.000Z');
        assert.equal(draft.validUntil, '2026-12-31T00:00:00.000Z');
        assert.deepEqual(prisma.calls.creates[0].validFrom, publishMeta.validFrom);
        assert.deepEqual(prisma.calls.creates[0].validUntil, publishMeta.validUntil);

        const updated = await repo.updateDraft(draft.id, {
            validFrom: '2026-09-01',
            validUntil: null,
        });
        assert.equal(updated.validFrom, '2026-09-01T00:00:00.000Z');
        assert.equal(updated.validUntil, null);
        assert.deepEqual(
            prisma.calls.updates.at(-1).data.validFrom,
            new Date('2026-09-01T00:00:00.000Z'),
        );
        assert.equal(prisma.calls.updates.at(-1).data.validUntil, null);
    });

    test('enabled mode resolves the active version with inclusive days and deterministic priority', async () => {
        const publishedAt = new Date('2026-01-01T00:00:00.000Z');
        const prisma = fakePrisma([
            bundleVersionRow({
                id: 'legacy-fallback',
                version: 1,
                publishedAt,
                validFrom: null,
                validUntil: null,
            }),
            bundleVersionRow({
                id: 'older-window',
                version: 2,
                publishedAt,
                validFrom: new Date('2026-05-01T00:00:00.000Z'),
                validUntil: new Date('2026-06-03T00:00:00.000Z'),
            }),
            bundleVersionRow({
                id: 'same-start-lower-version',
                version: 3,
                publishedAt,
                validFrom: new Date('2026-06-01T00:00:00.000Z'),
                validUntil: new Date('2026-06-03T00:00:00.000Z'),
            }),
            bundleVersionRow({
                id: 'active-winner',
                version: 4,
                publishedAt,
                supersededAt: new Date('2026-06-04T00:00:00.000Z'),
                validFrom: new Date('2026-06-01T00:00:00.000Z'),
                validUntil: new Date('2026-06-03T00:00:00.000Z'),
            }),
            bundleVersionRow({
                id: 'future',
                version: 5,
                publishedAt,
                validFrom: new Date('2026-06-04T00:00:00.000Z'),
                validUntil: null,
            }),
        ]);
        const repo = new PrismaBundleRepository(prisma, { validityWindows: true });
        const asOf = new Date('2026-06-03T23:59:59.999Z');

        assert.equal(typeof repo.findActiveBundleVersion, 'function');
        const active = await repo.findActiveBundleVersion('bundle-1', asOf);

        assert.equal(active?.id, 'active-winner');
        const query = prisma.calls.findFirst.at(-1);
        const validUntilClause = query.where.AND.find((clause) =>
            clause.OR.some((alternative) => 'validUntil' in alternative),
        );
        assert.deepEqual(validUntilClause.OR, [
            { validUntil: null },
            { validUntil: { gte: new Date('2026-06-03T00:00:00.000Z') } },
        ]);
        assert.deepEqual(query.orderBy, [
            { validFrom: { sort: 'desc', nulls: 'last' } },
            { version: 'desc' },
        ]);
    });

    test('enabled publish is internally atomic and applies auto-succession', async () => {
        const draft = bundleVersionRow({ id: 'draft-2', version: 2 });
        const prisma = fakePrisma([draft]);
        const repo = new PrismaBundleRepository(prisma, { validityWindows: true });

        const published = await repo.publishDraft(draft.id, publishMeta);

        assert.equal(prisma.calls.transactions, 1);
        assert.equal(prisma.calls.updateMany.length, 1);
        const supersede = prisma.calls.updateMany[0];
        assert.deepEqual(supersede.data.validUntil, new Date('2026-08-09T00:00:00.000Z'));
        assert.ok(supersede.data.supersededAt instanceof Date);

        const publish = prisma.calls.updates.at(-1).data;
        assert.strictEqual(
            publish.publishedAt,
            supersede.data.supersededAt,
            'both writes use one publish timestamp',
        );
        assert.strictEqual(publish.validFrom, publishMeta.validFrom);
        assert.strictEqual(publish.validUntil, publishMeta.validUntil);
        assert.equal(published.validFrom, '2026-08-10T00:00:00.000Z');
        assert.equal(published.validUntil, '2026-12-31T00:00:00.000Z');
    });

    test('enabled publish reuses a caller transaction instead of nesting one', async () => {
        const draft = bundleVersionRow({ id: 'draft-2', version: 2 });
        const root = fakePrisma();
        const transaction = fakePrisma([draft]);
        const repo = new PrismaBundleRepository(root, { validityWindows: true });

        await repo.publishDraft(draft.id, publishMeta, transaction);

        assert.equal(root.calls.transactions, 0);
        assert.equal(root.calls.updateMany.length, 0);
        assert.equal(transaction.calls.updateMany.length, 1);
        assert.equal(transaction.calls.updates.length, 1);
    });
});
