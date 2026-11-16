// The notes app's eraser: what it holds for one tenant, counted, and then
// erased — the tenant's audit entries first, then the tenant's row, whose
// foreign keys take its users, notes and subscription along. And what it tells
// a tenant to keep: nothing. DB-free — the Prisma client is stood in for by
// one that keeps rows and refuses, as Prisma does, to delete one that is not
// there; that the subscriber's commercial record outlives the tenant's row is
// shown against PostgreSQL in `integration/`.

// @requirement SC-COMP-014 — The example application is kept in step with the platform

import 'reflect-metadata';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { NotesDataEraser } from '../dist/saas/notes-data-eraser.js';
import { NotesKeepReport } from '../dist/saas/notes-keep-report.js';

/**
 * A client over the rows of two tenants, `t1` and `t2`, that records every
 * write in the order it was made and whether it was made in a transaction.
 */
function clientOf() {
    const rows = {
        tenant: [{ id: 't1' }, { id: 't2' }],
        user: [
            { tenantId: 't1', id: 'u1' },
            { tenantId: 't1', id: 'u2' },
            { tenantId: 't2', id: 'u3' },
        ],
        note: [
            { tenantId: 't1', id: 'n1' },
            { tenantId: 't1', id: 'n2' },
            { tenantId: 't1', id: 'n3' },
            { tenantId: 't2', id: 'n4' },
        ],
        auditLog: [
            { tenantId: 't1', id: 'a1' },
            { tenantId: null, id: 'a2' },
            { tenantId: 't2', id: 'a3' },
        ],
    };
    const writes = [];
    const asked = [];
    let inTransaction = false;
    const matches = (where) => (row) =>
        Object.entries(where).every(([column, value]) => row[column] === value);
    const delegate = (model) => ({
        count: async ({ where }) => {
            asked.push([model, 'count', where]);
            return rows[model].filter(matches(where)).length;
        },
        deleteMany: async ({ where }) => {
            writes.push([model, 'deleteMany', where, inTransaction]);
            const kept = rows[model].filter((row) => !matches(where)(row));
            const count = rows[model].length - kept.length;
            rows[model] = kept;
            return { count };
        },
        delete: async ({ where }) => {
            writes.push([model, 'delete', where, inTransaction]);
            if (!rows[model].some(matches(where))) {
                throw new Error(
                    'An operation failed because it depends on records that were not found.',
                );
            }
            rows[model] = rows[model].filter((row) => !matches(where)(row));
        },
    });
    const delegates = {
        tenant: delegate('tenant'),
        user: delegate('user'),
        note: delegate('note'),
        auditLog: delegate('auditLog'),
    };
    return {
        rows,
        writes,
        asked,
        ...delegates,
        $transaction: async (work) => {
            inTransaction = true;
            try {
                return await work(delegates);
            } finally {
                inTransaction = false;
            }
        },
    };
}

/** The tenants the client was asked about or wrote for, each once. */
function tenantsTouched(client) {
    return [
        ...new Set(
            [...client.asked, ...client.writes].map(([, , where]) => where.tenantId ?? where.id),
        ),
    ];
}

const NOT_ONE_TENANT = [
    ['missing', undefined],
    ['blank', ''],
    ['surrounding-space', 't1 '],
];

describe("the notes app's eraser", () => {
    test('is named with a stable key', () => {
        assert.equal(new NotesDataEraser(clientOf()).name, 'notes-data');
    });

    // @requirement SC-PRIV-016 — Erasing a tenant's data or files is refused unless exactly one tenant is named
    test('refuses what does not name exactly one tenant before it asks the database anything', async () => {
        for (const [problem, value] of NOT_ONE_TENANT) {
            const client = clientOf();
            const eraser = new NotesDataEraser(client);

            const refused = { name: 'TenantIdRefused', problem };
            await assert.rejects(eraser.count(value), refused);
            await assert.rejects(eraser.erase(value), refused);

            assert.deepEqual(client.asked, [], `counting for a value that is ${problem}`);
            assert.deepEqual(client.writes, [], `erasing for a value that is ${problem}`);
        }
    });

    test("counts the tenant's notes, users and audit entries, and no other tenant's", async () => {
        const client = clientOf();

        assert.deepEqual(await new NotesDataEraser(client).count('t1'), [
            { category: 'notes', count: 3 },
            { category: 'users', count: 2 },
            { category: 'audit-entries', count: 1 },
        ]);
        assert.deepEqual(tenantsTouched(client), ['t1']);
    });

    test("erases the tenant's audit entries, then its row, in one transaction and for it alone", async () => {
        const client = clientOf();

        await new NotesDataEraser(client).erase('t1');

        assert.deepEqual(client.writes, [
            ['auditLog', 'deleteMany', { tenantId: 't1' }, true],
            ['tenant', 'deleteMany', { id: 't1' }, true],
        ]);
        assert.deepEqual(
            client.rows.tenant.map((tenant) => tenant.id),
            ['t2'],
        );
        assert.deepEqual(
            client.rows.auditLog.map((entry) => entry.id),
            ['a2', 'a3'],
        );
    });

    // @requirement SC-PRIV-018 — A tenant's deletion can safely run again, and is done only once every store confirms
    test('erasing a tenant already gone is done, and erases nothing of another', async () => {
        const client = clientOf();
        const eraser = new NotesDataEraser(client);
        await eraser.erase('t1');

        await eraser.erase('t1');

        assert.deepEqual(
            client.rows.tenant.map((tenant) => tenant.id),
            ['t2'],
        );
        assert.deepEqual(tenantsTouched(client), ['t1']);
    });
});

describe("the notes app's report of what a tenant keeps", () => {
    test('is nothing: the notes app holds nothing a tenant has to keep for obligations of its own', async () => {
        assert.deepEqual(await new NotesKeepReport().keep('t1'), []);
    });
});
