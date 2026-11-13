// The notes app's export of a tenant's data: everything it keeps for the
// tenant, as one JSON file, read for that tenant alone. DB-free — the Prisma
// client is stood in for by one that answers what it is asked for.

// @requirement SC-COMP-014 — The example application is kept in step with the platform

import 'reflect-metadata';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { NotesDataExport } from '../dist/saas/notes-data-export.js';

const CREATED = new Date('2026-10-01T09:00:00.000Z');

/** A client that answers for `t1` and records which tenant each read was for. */
function clientOf() {
    const askedFor = [];
    const scoped =
        (rows) =>
        async ({ where }) => {
            askedFor.push(where.tenantId ?? where.id);
            return rows.filter((row) => row.tenantId === (where.tenantId ?? where.id));
        };
    return {
        askedFor,
        tenant: {
            findUniqueOrThrow: async ({ where }) => {
                askedFor.push(where.id);
                return { id: where.id, slug: 'acme', name: 'Acme', createdAt: CREATED };
            },
        },
        user: {
            findMany: scoped([
                { tenantId: 't1', id: 'u1', email: 'admin@acme.example', createdAt: CREATED },
                { tenantId: 't2', id: 'u2', email: 'other@else.example', createdAt: CREATED },
            ]),
        },
        note: {
            findMany: scoped([
                { tenantId: 't1', id: 'n1', title: 'Hello', body: null, createdAt: CREATED },
                { tenantId: 't2', id: 'n2', title: 'Not yours', body: null, createdAt: CREATED },
            ]),
        },
    };
}

describe("the notes app's export of a tenant", () => {
    test('is the tenant, its users and its notes as one JSON file named after it', async () => {
        const client = clientOf();
        const file = await new NotesDataExport(client).export('t1');

        assert.equal(file.mediaType, 'application/json');
        assert.equal(file.fileName, 'acme-export.json');
        assert.ok(file.content instanceof Uint8Array);
        const exported = JSON.parse(new TextDecoder().decode(file.content));
        assert.equal(exported.tenant.slug, 'acme');
        assert.deepEqual(
            exported.users.map((user) => user.email),
            ['admin@acme.example'],
        );
        assert.deepEqual(
            exported.notes.map((note) => note.title),
            ['Hello'],
        );
    });

    test('reads for the tenant it is asked for and no other', async () => {
        const client = clientOf();
        await new NotesDataExport(client).export('t1');
        assert.deepEqual([...new Set(client.askedFor)], ['t1']);
    });
});
