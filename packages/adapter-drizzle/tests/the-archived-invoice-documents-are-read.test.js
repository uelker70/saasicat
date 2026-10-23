// Which of the invoices asked for have their document archived, as Drizzle
// asks it: one statement over the ids, and none for no id. That the answer is
// the archived ones alone is the persistence contract's to prove against
// PostgreSQL.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pg-proxy';

import { DrizzleSubscriptionInvoiceRepository } from '../dist/index.js';

describe('the invoices whose document is archived', () => {
    test('are read by one statement over the ids asked for, the archived ones only', async () => {
        const statements = [];
        const db = drizzle(async (sql, params) => {
            statements.push({ sql, params });
            return { rows: [['invoice-1']] };
        });

        const archived = await new DrizzleSubscriptionInvoiceRepository(db).listArchivedDocuments([
            'invoice-1',
            'invoice-2',
        ]);

        assert.deepEqual(archived, ['invoice-1']);
        assert.equal(statements.length, 1);
        assert.match(statements[0].sql, /"invoiceId" in \(\$1, \$2\)/);
        assert.match(statements[0].sql, /"archivedAt" is not null/);
    });

    test('of no invoice asks nothing', async () => {
        const statements = [];
        const db = drizzle(async (sql) => {
            statements.push(sql);
            return { rows: [] };
        });

        assert.deepEqual(
            await new DrizzleSubscriptionInvoiceRepository(db).listArchivedDocuments([]),
            [],
        );
        assert.equal(statements.length, 0);
    });
});
