// PrismaSubscriberRepository against a fake client: which rows a write reads,
// locks and writes, and how the changes of the tax origin and the checks of a
// VAT id it records are shaped. The semantics — the lock holding, a rollback
// taking the change with it — are the persistence contract's, run against
// PostgreSQL in tests/integration/.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaSubscriberRepository } from '../dist/index.js';

const CREATED = new Date('2026-09-01T00:00:00.000Z');
const TENANT_USER = 'web:owner@tenant.example:tenant-self-service';

function subscriberRow(overrides = {}) {
    return {
        id: 'subscriber-1',
        customerSequence: 10001,
        customerNumberPrefix: 'K-',
        legalName: 'Wien Handel GmbH',
        vatId: null,
        taxNumber: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: 'München',
        country: 'DE',
        invoiceEmail: null,
        business: null,
        currentVatIdCheckId: null,
        vatIdSince: null,
        migrated: false,
        createdAt: CREATED,
        updatedAt: CREATED,
        ...overrides,
    };
}

function check(overrides = {}) {
    return {
        vatId: 'ATU12345678',
        checkedAt: new Date('2026-10-01T08:30:00.000Z'),
        valid: true,
        service: 'VIES',
        confirmation: { requestIdentifier: 'WAPIAAAAZ1x2y3' },
        ...overrides,
    };
}

/** The delegates the repository uses, over one subscriber live for `tenant-1`. */
function fakeClient(row = subscriberRow()) {
    const rows = new Map([[row.id, { ...row }]]);
    const raw = [];
    const changes = [];
    const checks = [];
    const corrections = [];
    const withTenant = (stored) => ({ ...stored, tenants: [{ tenantId: 'tenant-1' }] });
    const client = {
        raw,
        changes,
        checks,
        corrections,
        rows,
        subscriber: {
            async findUnique({ where }) {
                const stored = rows.get(where.id);
                return stored ? withTenant(stored) : null;
            },
            async update({ where, data }) {
                const stored = rows.get(where.id);
                const defined = Object.fromEntries(
                    Object.entries(data).filter(([, value]) => value !== undefined),
                );
                Object.assign(stored, defined);
                return withTenant(stored);
            },
        },
        subscriberCorrection: {
            async create({ data }) {
                const created = { id: `correction-${corrections.length + 1}`, ...data };
                corrections.push(created);
                return created;
            },
        },
        subscriberTaxOriginChange: {
            async create({ data }) {
                const created = {
                    id: `change-${changes.length + 1}`,
                    seq: changes.length + 1,
                    ...data,
                };
                changes.push(created);
                return created;
            },
            async findMany({ where, orderBy }) {
                assert.deepEqual(orderBy, [{ seq: 'desc' }]);
                return changes
                    .filter((change) => change.subscriberId === where.subscriberId)
                    .sort((a, b) => b.seq - a.seq);
            },
        },
        subscriberVatIdCheck: {
            async create({ data }) {
                const created = {
                    id: `check-${checks.length + 1}`,
                    recordedAt: new Date(),
                    ...data,
                };
                checks.push(created);
                return created;
            },
            async findUnique({ where }) {
                return checks.find((candidate) => candidate.id === where.id) ?? null;
            },
            async findMany({ where, orderBy }) {
                assert.deepEqual(orderBy, [
                    { checkedAt: 'desc' },
                    { recordedAt: 'desc' },
                    { id: 'desc' },
                ]);
                return checks
                    .filter((candidate) => candidate.subscriberId === where.subscriberId)
                    .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
            },
        },
        async $queryRaw(strings, ...values) {
            raw.push({ sql: strings.join('?').replace(/\s+/g, ' ').trim(), values });
            return [];
        },
        $transaction(fn) {
            return fn(client);
        },
    };
    return client;
}

describe('PrismaSubscriberRepository and the tax origin', () => {
    test('a contact change locks the row, and records a change of the country by whoever made it', async () => {
        const client = fakeClient();
        const repo = new PrismaSubscriberRepository(client);

        await repo.updateContact('subscriber-1', { city: 'Passau' }, TENANT_USER);
        assert.equal(
            client.changes.length,
            0,
            'a contact change that kept the country recorded one',
        );

        const before = Date.now();
        const moved = await repo.updateContact(
            'subscriber-1',
            { country: 'AT', city: 'Wien' },
            TENANT_USER,
        );

        assert.deepEqual([moved.country, moved.city, moved.tenantId], ['AT', 'Wien', 'tenant-1']);
        assert.match(client.raw[0].sql, /FOR UPDATE/);
        assert.deepEqual(client.raw[0].values, ['subscriber-1']);
        assert.deepEqual(
            client.changes.map(({ subscriberId, previous, changed, changedBy }) => ({
                subscriberId,
                previous,
                changed,
                changedBy,
            })),
            [
                {
                    subscriberId: 'subscriber-1',
                    previous: { country: 'DE' },
                    changed: { country: 'AT' },
                    changedBy: TENANT_USER,
                },
            ],
        );
        assert.ok(client.changes[0].changedAt.getTime() >= before);
        assert.equal(
            await repo.updateContact('subscriber-nobody', { city: 'Kiel' }, TENANT_USER),
            null,
        );
    });

    test('a corrected VAT id is recorded as a change by whoever corrected it, and ends the counting check', async () => {
        const client = fakeClient(
            subscriberRow({ vatId: 'ATU12345678', currentVatIdCheckId: 'check-0' }),
        );
        const repo = new PrismaSubscriberRepository(client);

        await repo.correctIdentity('subscriber-1', {
            corrected: { legalName: 'Wien Handel GesmbH' },
            reason: 'Legal form spelt as registered',
            correctedBy: 'operator:anna',
        });
        assert.equal(client.changes.length, 0, 'a correction of the name alone recorded a change');
        assert.equal(client.rows.get('subscriber-1').currentVatIdCheckId, 'check-0');

        const before = Date.now();
        await repo.correctIdentity('subscriber-1', {
            corrected: { vatId: 'ATU87654321' },
            reason: 'Digits swapped',
            correctedBy: 'operator:anna',
        });

        assert.deepEqual(
            client.changes.map(({ previous, changed, changedBy }) => ({
                previous,
                changed,
                changedBy,
            })),
            [
                {
                    previous: { vatId: 'ATU12345678' },
                    changed: { vatId: 'ATU87654321' },
                    changedBy: 'operator:anna',
                },
            ],
        );
        assert.ok(
            client.changes[0].changedAt.getTime() >= before,
            'dated before the lock was held',
        );
        assert.equal(client.rows.get('subscriber-1').currentVatIdCheckId, null);
        assert.equal(
            client.rows.get('subscriber-1').vatIdSince?.getTime(),
            client.changes[0].changedAt.getTime(),
            'the number is not held from the change that wrote it',
        );
        assert.equal(
            client.corrections.at(-1).correctedAt.getTime(),
            client.changes[0].changedAt.getTime(),
            'the correction and the change it made are dated apart',
        );
    });

    test('a business status is written and recorded once, and the same status writes nothing', async () => {
        const client = fakeClient();
        const repo = new PrismaSubscriberRepository(client);

        const stated = await repo.changeBusinessStatus('subscriber-1', {
            business: true,
            changedBy: 'operator:ben',
        });
        const again = await repo.changeBusinessStatus('subscriber-1', {
            business: true,
            changedBy: 'operator:ben',
        });

        assert.equal(stated.subscriber.business, true);
        assert.deepEqual(
            [stated.change.previous, stated.change.changed, stated.change.changedBy],
            [{ business: null }, { business: true }, 'operator:ben'],
        );
        assert.equal(again.change, null);
        assert.equal(client.changes.length, 1);
        assert.equal(
            await repo.changeBusinessStatus('subscriber-nobody', {
                business: true,
                changedBy: 'operator:ben',
            }),
            null,
        );
    });

    test('every VAT check is recorded, and only one of the number held, completed latest, counts', async () => {
        const client = fakeClient(subscriberRow({ vatId: 'ATU12345678' }));
        const repo = new PrismaSubscriberRepository(client);

        const first = await repo.recordVatIdCheck('subscriber-1', check());
        assert.equal(first.current.id, first.recorded.id);
        assert.deepEqual(first.recorded.confirmation, { requestIdentifier: 'WAPIAAAAZ1x2y3' });
        assert.equal(client.rows.get('subscriber-1').currentVatIdCheckId, first.recorded.id);

        const stray = await repo.recordVatIdCheck('subscriber-1', check({ vatId: 'ATU99999999' }));
        const older = await repo.recordVatIdCheck(
            'subscriber-1',
            check({ checkedAt: new Date('2026-09-01T08:30:00.000Z'), valid: false }),
        );
        assert.equal(stray.current.id, first.recorded.id, 'a check of another number counts');
        assert.equal(older.current.id, first.recorded.id, 'an older check replaced a newer one');
        assert.equal((await repo.findCurrentVatIdCheck('subscriber-1')).id, first.recorded.id);

        assert.equal(client.checks.length, 3, 'a check was not recorded');
        assert.deepEqual(
            (await repo.listVatIdChecks('subscriber-1')).map((recorded) => recorded.id),
            [first.recorded.id, stray.recorded.id, older.recorded.id],
        );
        assert.equal(await repo.recordVatIdCheck('subscriber-nobody', check()), null);
        assert.equal(await repo.findCurrentVatIdCheck('subscriber-nobody'), null);
    });

    test('the changes are listed by the order the database numbered them in', async () => {
        const client = fakeClient();
        const repo = new PrismaSubscriberRepository(client);
        await repo.changeBusinessStatus('subscriber-1', {
            business: true,
            changedBy: 'operator:ben',
        });
        await repo.correctIdentity('subscriber-1', {
            corrected: { vatId: 'ATU12345678' },
            reason: 'VAT id handed in',
            correctedBy: 'operator:anna',
        });

        const listed = await repo.listTaxOriginChanges('subscriber-1');

        assert.deepEqual(
            listed.map((change) => change.changed),
            [{ vatId: 'ATU12345678' }, { business: true }],
        );
        assert.deepEqual(await repo.listTaxOriginChanges('subscriber-nobody'), []);
    });
});
