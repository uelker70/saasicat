// What the Drizzle adapter sends for a contract's confirmation, through
// Drizzle's own query builder and a transport that records each statement.
//
// That a confirmation is archived once and mailed once however many instances
// run, and that the archive's triggers refuse every change of it, is the
// persistence contract's to prove against PostgreSQL. What can be read off the
// statements without one is pinned here: every write after the first
// rendering is one conditional UPDATE, the first one INSERT … ON CONFLICT DO
// NOTHING, and the lists read the contracts due one rather than every contract.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pg-proxy';
import {
    CONFIRMATION_ARCHIVE_TRIGGERS,
    CONTRACT_ERROR_CODES,
    isPersistenceRefusal,
} from '@saasicat/core';

import {
    DrizzleContractConfirmationArchive,
    DrizzleContractConfirmationRepository,
} from '../dist/index.js';

const CONTRACT = 'contract-7';
const CHECKSUM = 'e'.repeat(64);
const AT = new Date('2026-10-23T07:00:00.000Z');

const RENDERING = {
    checksum: CHECKSUM,
    mediaType: 'application/pdf',
    fileName: 'contract-7.pdf',
    size: 512,
    renderedAt: AT,
};
/** A `contract_confirmations` row as the transport answers it, in column order. */
const ROW = [CONTRACT, CHECKSUM, 'application/pdf', 'contract-7.pdf', 512, '2026-10-23 07:00:00'];
const STANDING = [...ROW, null, null, null, null];

/** A database over a transport that records each statement and answers the next rows given. */
function recording(...answers) {
    const statements = [];
    const db = drizzle(async (sql, params) => {
        statements.push({ sql, params });
        return { rows: answers.shift() ?? [] };
    });
    return { db, statements };
}

describe('where a confirmation stands, as Drizzle writes it', () => {
    test('a rendering is one insert that leaves one recorded before alone', async () => {
        const { db, statements } = recording([STANDING]);

        const record = await new DrizzleContractConfirmationRepository(db).recordRendering(
            CONTRACT,
            RENDERING,
        );

        assert.equal(statements.length, 1);
        assert.match(statements[0].sql, /^insert into "contract_confirmations"/i);
        assert.match(statements[0].sql, /on conflict \("contractId"\) do nothing/i);
        assert.equal(record.archivedAt, null);
    });

    test('a rendering recorded before under another checksum is refused, and none at all is said', async () => {
        const changed = recording(
            [],
            [[CONTRACT, 'f'.repeat(64), ...ROW.slice(2), null, null, null, null]],
        );
        const vanished = recording([], []);

        await assert.rejects(
            new DrizzleContractConfirmationRepository(changed.db).recordRendering(
                CONTRACT,
                RENDERING,
            ),
            (error) =>
                isPersistenceRefusal(error) &&
                error.code === CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_CHANGED,
        );
        assert.match(changed.statements[1].sql, /^select .* from "contract_confirmations"/i);
        await assert.rejects(
            new DrizzleContractConfirmationRepository(vanished.db).recordRendering(
                CONTRACT,
                RENDERING,
            ),
            /after recording it/,
        );
    });

    for (const [what, write, guard, answers] of [
        [
            'the archive’s confirmation',
            (repository) => repository.markArchived(CONTRACT, AT, CHECKSUM),
            /"checksum" = \$\d+ and "contract_confirmations"\."archivedAt" is null/,
            [true, false],
        ],
        [
            'a claim of the mail',
            (repository) => repository.claimDelivery(CONTRACT, AT, AT),
            /"deliveryClaimedAt" is null or "contract_confirmations"\."deliveryClaimedAt" < \$\d+/,
            [true, false],
        ],
        [
            'the mail',
            (repository) =>
                repository.markDelivered(CONTRACT, { claimedAt: AT, at: AT, to: 'a@example.com' }),
            /"deliveredAt" is null and "contract_confirmations"\."deliveryClaimedAt" = \$\d+/,
            [true, false],
        ],
        [
            'a claim let go',
            (repository) => repository.releaseDelivery(CONTRACT, AT),
            /"deliveredAt" is null and "contract_confirmations"\."deliveryClaimedAt" = \$\d+\) returning/,
            [undefined, undefined],
        ],
    ]) {
        test(`${what} is one update on its guard, answered by whether it took the row`, async () => {
            const took = recording([[CONTRACT]]);
            const missed = recording([]);

            const answered = [
                await write(new DrizzleContractConfirmationRepository(took.db)),
                await write(new DrizzleContractConfirmationRepository(missed.db)),
            ];

            assert.equal(took.statements.length, 1);
            assert.match(took.statements[0].sql, /^update "contract_confirmations" set/i);
            assert.match(took.statements[0].sql, guard);
            assert.deepEqual(answered, answers);
        });
    }

    test('a rendering is replaced in place of the recorded checksum while nothing is archived', async () => {
        const { db, statements } = recording([STANDING], []);
        const repository = new DrizzleContractConfirmationRepository(db);

        assert.equal(
            (await repository.replaceRendering(CONTRACT, RENDERING, 'f'.repeat(64))).checksum,
            CHECKSUM,
        );
        assert.equal(await repository.replaceRendering(CONTRACT, RENDERING, 'f'.repeat(64)), null);
        assert.match(
            statements[0].sql,
            /"checksum" = \$\d+ and "contract_confirmations"\."archivedAt" is null/,
        );
    });

    test('the contracts due one are the contracts marked due, joined to their confirmation', async () => {
        const { db, statements } = recording([['contract-8']], [['contract-9']]);
        const repository = new DrizzleContractConfirmationRepository(db);

        assert.deepEqual(await repository.listAwaitingConfirmation({ limit: 2, after: CONTRACT }), [
            'contract-8',
        ]);
        assert.deepEqual(await repository.listAwaitingDelivery({ limit: 2 }), ['contract-9']);

        assert.match(
            statements[0].sql,
            /from "subscription_contracts" left join "contract_confirmations"/,
        );
        assert.match(statements[0].sql, /"confirmationDue" = \$\d+/);
        assert.match(statements[0].sql, /"subscription_contracts"\."id" > \$\d+/);
        assert.match(
            statements[1].sql,
            /"archivedAt" is not null and "contract_confirmations"\."deliveredAt" is null/,
        );
    });

    test('a confirmation is found by its contract, and nothing where none is recorded', async () => {
        const { db } = recording([STANDING], []);
        const repository = new DrizzleContractConfirmationRepository(db);

        assert.equal((await repository.find(CONTRACT)).contractId, CONTRACT);
        assert.equal(await repository.find(CONTRACT), null);
    });
});

describe('the Drizzle archive of the confirmations', () => {
    const FILE = {
        contractId: CONTRACT,
        checksum: CHECKSUM,
        mediaType: 'application/pdf',
        fileName: 'contract-7.pdf',
        content: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        archivedAt: AT,
    };
    const STORED = [
        CONTRACT,
        CHECKSUM,
        'application/pdf',
        'contract-7.pdf',
        Buffer.from(FILE.content),
        '2026-10-23 07:00:00',
    ];

    test('stores a file by one insert, and compares one stored before by its checksum', async () => {
        const written = recording([[CONTRACT]]);
        const same = recording([], [[CHECKSUM]]);
        const other = recording([], [['f'.repeat(64)]]);

        await new DrizzleContractConfirmationArchive(written.db).store(FILE);
        await new DrizzleContractConfirmationArchive(same.db).store(FILE);

        assert.equal(written.statements.length, 1);
        assert.match(written.statements[0].sql, /^insert into "contract_confirmation_archive"/i);
        assert.equal(same.statements.length, 2);
        await assert.rejects(
            new DrizzleContractConfirmationArchive(other.db).store(FILE),
            (error) =>
                isPersistenceRefusal(error) &&
                error.code === CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_CHANGED,
        );
    });

    test('reads a file back as it was archived, and nothing where none is', async () => {
        const { db } = recording([STORED], []);
        const archive = new DrizzleContractConfirmationArchive(db);

        const read = await archive.read(CONTRACT);
        assert.deepEqual(read, FILE);
        assert.ok(!Buffer.isBuffer(read.content));
        assert.equal(await archive.read(CONTRACT), null);
    });

    test('says what would let a kept confirmation change, from the enabled triggers', async () => {
        const guarded = recording(CONFIRMATION_ARCHIVE_TRIGGERS.map((name) => ({ name })));
        const bare = recording([]);

        assert.equal(
            await new DrizzleContractConfirmationArchive(guarded.db).protectionProblem(),
            null,
        );
        assert.match(guarded.statements[0].sql, /to_regclass\('contract_confirmation_archive'\)/);
        const problem = await new DrizzleContractConfirmationArchive(bare.db).protectionProblem();
        assert.ok(problem.includes(`lacks ${CONFIRMATION_ARCHIVE_TRIGGERS.join(' and ')},`));
    });
});
