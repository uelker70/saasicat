// What the Prisma adapter asks the client for a contract's confirmation —
// where it stands, and the archive that keeps its file.
//
// That a confirmation is archived once and mailed once however many instances
// run is the contract's to prove against PostgreSQL, in tests/integration/.
// What this holds is the translation: every write after the first rendering
// is one `updateMany` on the guard the port names, and every answer is read
// back as the port says.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CONFIRMATION_ARCHIVE_TRIGGERS,
    CONTRACT_ERROR_CODES,
    isPersistenceRefusal,
} from '@saasicat/core';

import {
    PrismaContractConfirmationArchive,
    PrismaContractConfirmationRepository,
} from '../dist/index.js';

const CONTRACT = 'contract-1';
const CHECKSUM = 'c'.repeat(64);
const ANOTHER = 'd'.repeat(64);
const CLAIMED = new Date('2026-10-23T06:15:00.000Z');
const LEASE = new Date('2026-10-23T06:00:00.000Z');

const RENDERED = {
    checksum: CHECKSUM,
    mediaType: 'application/pdf',
    fileName: `contract-${CONTRACT}.pdf`,
    size: 4096,
    renderedAt: CLAIMED,
};
const STANDING = {
    contractId: CONTRACT,
    ...RENDERED,
    archivedAt: null,
    deliveryClaimedAt: null,
    deliveredAt: null,
    deliveredTo: null,
};

/**
 * A client that answers each delegate call with `answers[call]` and records
 * it under `<delegate>.<call>`: `confirmation` and `contract` for the
 * repository, `archive` and `$queryRaw` for the archive.
 */
function clientAnswering(answers = {}) {
    const asked = [];
    const delegate = (name) =>
        new Proxy(
            {},
            {
                get: (_, call) => async (args) => {
                    asked.push([`${name}.${String(call)}`, args]);
                    return answers[call];
                },
            },
        );
    return {
        asked,
        contractConfirmation: delegate('confirmation'),
        subscriptionContract: delegate('contract'),
        contractConfirmationArchive: delegate('archive'),
        $queryRaw: async (strings) => {
            asked.push(['$queryRaw', strings.join('?')]);
            return answers.$queryRaw ?? [];
        },
    };
}

/** What the one call the client was asked was given. */
function theOneCall(client) {
    assert.equal(client.asked.length, 1, JSON.stringify(client.asked));
    return client.asked[0];
}

describe('where a contract’s confirmation stands, as the Prisma adapter writes it', () => {
    for (const [what, write, where, data] of [
        [
            'the archive’s confirmation, for the recorded checksum and once',
            (repository) => repository.markArchived(CONTRACT, CLAIMED, CHECKSUM),
            { checksum: CHECKSUM, archivedAt: null },
            { archivedAt: CLAIMED },
        ],
        [
            'a claim of the mail, where none holds it or the one that does is stale',
            (repository) => repository.claimDelivery(CONTRACT, CLAIMED, LEASE),
            {
                archivedAt: { not: null },
                deliveredAt: null,
                OR: [{ deliveryClaimedAt: null }, { deliveryClaimedAt: { lt: LEASE } }],
            },
            { deliveryClaimedAt: CLAIMED },
        ],
        [
            'the mail, under the claim that took it',
            (repository) =>
                repository.markDelivered(CONTRACT, {
                    claimedAt: CLAIMED,
                    at: LEASE,
                    to: 'billing@example.com',
                }),
            { archivedAt: { not: null }, deliveredAt: null, deliveryClaimedAt: CLAIMED },
            { deliveredAt: LEASE, deliveredTo: 'billing@example.com' },
        ],
        [
            'a claim let go, while it is still the one that holds it',
            (repository) => repository.releaseDelivery(CONTRACT, CLAIMED),
            { deliveredAt: null, deliveryClaimedAt: CLAIMED },
            { deliveryClaimedAt: null },
        ],
    ]) {
        test(`${what}: one guarded update`, async () => {
            const client = clientAnswering({ updateMany: { count: 1 } });

            await write(new PrismaContractConfirmationRepository(client));

            assert.deepEqual(theOneCall(client), [
                'confirmation.updateMany',
                { where: { contractId: CONTRACT, ...where }, data },
            ]);
        });
    }

    test('a guarded write that takes no row answers false', async () => {
        const repository = new PrismaContractConfirmationRepository(
            clientAnswering({ updateMany: { count: 0 } }),
        );

        assert.equal(await repository.markArchived(CONTRACT, CLAIMED, CHECKSUM), false);
        assert.equal(await repository.claimDelivery(CONTRACT, CLAIMED, LEASE), false);
    });

    test('a rendering is inserted conflict-free, and the one found instead is compared by its checksum', async () => {
        const written = clientAnswering({ createManyAndReturn: [STANDING] });
        const found = clientAnswering({ createManyAndReturn: [], findUnique: STANDING });
        const other = clientAnswering({
            createManyAndReturn: [],
            findUnique: { ...STANDING, checksum: ANOTHER },
        });

        const record = await new PrismaContractConfirmationRepository(written).recordRendering(
            CONTRACT,
            RENDERED,
        );
        assert.deepEqual(theOneCall(written), [
            'confirmation.createManyAndReturn',
            { data: [{ contractId: CONTRACT, ...RENDERED }], skipDuplicates: true },
        ]);
        assert.deepEqual(record, STANDING);
        assert.deepEqual(
            await new PrismaContractConfirmationRepository(found).recordRendering(
                CONTRACT,
                RENDERED,
            ),
            STANDING,
        );
        await assert.rejects(
            new PrismaContractConfirmationRepository(other).recordRendering(CONTRACT, RENDERED),
            (error) =>
                isPersistenceRefusal(error) &&
                error.code === CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_CHANGED &&
                error.params.recorded === ANOTHER,
        );
    });

    test('a rendering neither written nor found is said', async () => {
        const repository = new PrismaContractConfirmationRepository(
            clientAnswering({ createManyAndReturn: [], findUnique: null }),
        );

        await assert.rejects(repository.recordRendering(CONTRACT, RENDERED), /after recording it/);
    });

    test('a rendering replaced in place of the one recorded is read back, and nothing where none was', async () => {
        const replaced = clientAnswering({
            updateMany: { count: 1 },
            findUnique: { ...STANDING, checksum: ANOTHER },
        });
        const missed = clientAnswering({ updateMany: { count: 0 } });

        const record = await new PrismaContractConfirmationRepository(replaced).replaceRendering(
            CONTRACT,
            { ...RENDERED, checksum: ANOTHER },
            CHECKSUM,
        );

        assert.deepEqual(replaced.asked[0], [
            'confirmation.updateMany',
            {
                where: { contractId: CONTRACT, checksum: CHECKSUM, archivedAt: null },
                data: { ...RENDERED, checksum: ANOTHER },
            },
        ]);
        assert.equal(record.checksum, ANOTHER);
        assert.equal(
            await new PrismaContractConfirmationRepository(missed).replaceRendering(
                CONTRACT,
                RENDERED,
                ANOTHER,
            ),
            null,
        );
        assert.equal(missed.asked.length, 1, 'a replacement that took nothing read the row');
    });

    test('the contracts due one are read over the contracts, those for the mail over the confirmations, page by page', async () => {
        const client = clientAnswering({ findMany: [] });
        const repository = new PrismaContractConfirmationRepository(client);

        await repository.listAwaitingConfirmation({ limit: 5 });
        await repository.listAwaitingDelivery({ limit: 5, after: CONTRACT });

        assert.deepEqual(client.asked, [
            [
                'contract.findMany',
                {
                    where: {
                        confirmationDue: true,
                        // The first page starts nowhere; Prisma leaves out what is undefined.
                        id: undefined,
                        OR: [
                            { confirmation: { is: null } },
                            { confirmation: { is: { archivedAt: null } } },
                        ],
                    },
                    select: { id: true },
                    orderBy: { id: 'asc' },
                    take: 5,
                },
            ],
            [
                'confirmation.findMany',
                {
                    where: {
                        contractId: { gt: CONTRACT },
                        archivedAt: { not: null },
                        deliveredAt: null,
                    },
                    select: { contractId: true },
                    orderBy: { contractId: 'asc' },
                    take: 5,
                },
            ],
        ]);
    });

    test('a confirmation is found by its contract, and nothing where none is recorded', async () => {
        const recorded = new PrismaContractConfirmationRepository(
            clientAnswering({ findUnique: STANDING }),
        );
        const none = new PrismaContractConfirmationRepository(
            clientAnswering({ findUnique: null }),
        );

        assert.deepEqual(await recorded.find(CONTRACT), STANDING);
        assert.equal(await none.find(CONTRACT), null);
    });
});

describe('each contract’s standing, as the Prisma adapter reads it', () => {
    test('is read over the contracts asked for, with their confirmation, by id', async () => {
        const client = clientAnswering({
            findMany: [
                { id: CONTRACT, confirmationDue: true, confirmation: STANDING },
                { id: 'contract-2', confirmationDue: false, confirmation: null },
            ],
        });

        const standings = await new PrismaContractConfirmationRepository(client).listStandings([
            CONTRACT,
            'contract-2',
        ]);

        assert.deepEqual(theOneCall(client), [
            'contract.findMany',
            {
                where: { id: { in: [CONTRACT, 'contract-2'] } },
                select: { id: true, confirmationDue: true, confirmation: true },
                orderBy: { id: 'asc' },
            },
        ]);
        assert.deepEqual(standings, [
            { contractId: CONTRACT, due: true, confirmation: STANDING },
            { contractId: 'contract-2', due: false, confirmation: null },
        ]);
    });

    test('of no contract asks nothing', async () => {
        const client = clientAnswering();

        assert.deepEqual(
            await new PrismaContractConfirmationRepository(client).listStandings([]),
            [],
        );
        assert.equal(client.asked.length, 0);
    });
});

describe('the Prisma archive of the confirmations', () => {
    const FILE = {
        contractId: CONTRACT,
        checksum: CHECKSUM,
        mediaType: 'application/pdf',
        fileName: `contract-${CONTRACT}.pdf`,
        content: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        archivedAt: LEASE,
    };

    test('stores a file once, and compares one stored before by its checksum', async () => {
        const written = clientAnswering({ createManyAndReturn: [{ contractId: CONTRACT }] });
        const same = clientAnswering({
            createManyAndReturn: [],
            findUnique: { checksum: CHECKSUM },
        });
        const other = clientAnswering({
            createManyAndReturn: [],
            findUnique: { checksum: ANOTHER },
        });

        await new PrismaContractConfirmationArchive(written).store(FILE);
        await new PrismaContractConfirmationArchive(same).store(FILE);

        assert.deepEqual(theOneCall(written), [
            'archive.createManyAndReturn',
            { data: [FILE], skipDuplicates: true, select: { contractId: true } },
        ]);
        assert.equal(same.asked.length, 2);
        await assert.rejects(
            new PrismaContractConfirmationArchive(other).store(FILE),
            (error) =>
                isPersistenceRefusal(error) &&
                error.code === CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_CHANGED,
        );
    });

    test('reads a file back as bytes of its own, and nothing where none is kept', async () => {
        const kept = await new PrismaContractConfirmationArchive(
            clientAnswering({ findUnique: FILE }),
        ).read(CONTRACT);

        assert.deepEqual(kept, FILE);
        assert.notEqual(kept.content, FILE.content);
        assert.equal(
            await new PrismaContractConfirmationArchive(clientAnswering()).read(CONTRACT),
            null,
        );
    });

    test('says what would let a kept confirmation change, from the enabled triggers of its table', async () => {
        const guarded = clientAnswering({
            $queryRaw: CONFIRMATION_ARCHIVE_TRIGGERS.map((name) => ({ name })),
        });
        const bare = clientAnswering({ $queryRaw: [] });

        assert.equal(
            await new PrismaContractConfirmationArchive(guarded).protectionProblem(),
            null,
        );
        const problem = await new PrismaContractConfirmationArchive(bare).protectionProblem();
        assert.ok(problem.includes(`lacks ${CONFIRMATION_ARCHIVE_TRIGGERS.join(' and ')},`));
        const [, query] = theOneCall(guarded);
        assert.ok(query.includes("to_regclass('contract_confirmation_archive')"), query);
    });
});
