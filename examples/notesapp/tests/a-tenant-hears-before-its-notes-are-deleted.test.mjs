// The notes app's notice port: a reminder before a tenant's data is deleted
// reaches that tenant's users, in the app's words, and the answer says who and
// how, for the platform to record. DB-free — the Prisma client is stood in for
// by one that answers what it is asked for.

// @requirement SC-COMP-014 — The example application is kept in step with the platform

import 'reflect-metadata';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';

import { NotesNoticeLog } from '../dist/saas/notes-notice-log.js';

const REMINDER = {
    kind: 'deletion-reminder',
    tenantId: 't1',
    subscriptionId: 'sub-t1',
    subscriptionEndId: 'end-t1',
    daysBefore: 10,
    readOnlyUntil: '2027-01-30',
    deletesOn: '2027-01-31',
};

/** A client whose users are `users`, and a log that keeps what is written to it. */
function portOver(users) {
    const askedFor = [];
    const port = new NotesNoticeLog({
        user: {
            findMany: async ({ where }) => {
                askedFor.push(where.tenantId);
                return users.filter((user) => user.tenantId === where.tenantId);
            },
        },
    });
    const logged = [];
    port.logger = new Logger('test');
    port.logger.log = (line) => logged.push(line);
    return { port, askedFor, logged };
}

describe("the notes app's notice port", () => {
    test("tells the tenant's own users the deletion day and where the export is, and says so", async () => {
        const { port, askedFor, logged } = portOver([
            { tenantId: 't1', id: 'u1' },
            { tenantId: 't2', id: 'u2' },
        ]);

        assert.deepEqual(await port.deliver(REMINDER), { recipients: ['u1'], channel: 'log' });

        assert.deepEqual(askedFor, ['t1']);
        assert.equal(logged.length, 1);
        assert.match(logged[0], /deleted on 2027-01-31/);
        assert.match(logged[0], /Until 2027-01-30/);
        assert.match(logged[0], /GET billing\/export/);
    });

    test('tells nobody of a tenant without users, and says so', async () => {
        const { port, logged } = portOver([]);

        assert.deepEqual(await port.deliver(REMINDER), { recipients: [], channel: 'log' });
        assert.deepEqual(logged, []);
    });
});
