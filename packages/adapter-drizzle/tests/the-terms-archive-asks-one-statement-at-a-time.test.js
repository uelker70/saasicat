// What `DrizzleTermsArchive` asks the database, through Drizzle's own query
// builder and a transport that records what it would send.
//
// That a version is kept once when two starts archive it at the same time, and
// that the triggers refuse every change of it, is the persistence contract's to
// prove against PostgreSQL. These cases pin what can be read off the statements
// without one: one conflict-free insert, the checksum read only where it wrote
// nothing, and the enabled triggers read in the shape either driver answers.

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { SETTINGS_ERROR_CODES, TERMS_ARCHIVE_TRIGGERS, isPersistenceRefusal } from '@saasicat/core';

import { DrizzleTermsArchive } from '../dist/index.js';

const CHECKSUM = 'a'.repeat(64);
const AT = new Date('2026-10-22T08:00:00.000Z');
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

const TERMS = {
    version: '2026-10',
    checksum: CHECKSUM,
    mediaType: 'application/pdf',
    fileName: 'agb-2026-10.pdf',
    content: new Uint8Array(PDF),
    archivedAt: AT,
};

/** An archive over a transport that records each statement and answers the next rows given. */
function recordingArchive(...answers) {
    const statements = [];
    const db = drizzle(async (sql, params) => {
        statements.push({ sql, params });
        return { rows: answers.shift() ?? [] };
    });
    return { archive: new DrizzleTermsArchive(db), statements };
}

describe('a version of the terms is stored', () => {
    test('by one insert that leaves a version stored before alone, and nothing more where it wrote', async () => {
        const { archive, statements } = recordingArchive([['2026-10']]);

        await archive.store(TERMS);

        assert.equal(statements.length, 1);
        assert.match(statements[0].sql, /^insert into "terms_versions"/i);
        assert.match(statements[0].sql, /on conflict \("version"\) do nothing/i);
        assert.deepEqual(statements[0].params.slice(0, 4), [
            '2026-10',
            CHECKSUM,
            'application/pdf',
            'agb-2026-10.pdf',
        ]);
    });

    test('where it wrote nothing, as the same write for the same checksum', async () => {
        const { archive, statements } = recordingArchive([], [[CHECKSUM]]);

        await archive.store(TERMS);

        assert.match(statements[1].sql, /^select "checksum" from "terms_versions"/i);
        assert.deepEqual(statements[1].params, ['2026-10', 1]);
    });

    test('and refused for another checksum, naming both', async () => {
        const { archive } = recordingArchive([], [['b'.repeat(64)]]);

        await assert.rejects(
            archive.store(TERMS),
            (error) =>
                isPersistenceRefusal(error) &&
                error.code === SETTINGS_ERROR_CODES.TERMS_VERSION_CHANGED &&
                error.params.recorded === 'b'.repeat(64) &&
                error.params.given === CHECKSUM,
        );
    });
});

describe('a version of the terms is read', () => {
    test('as it was archived, its bytes its own', async () => {
        const { archive } = recordingArchive([
            [
                '2026-10',
                CHECKSUM,
                'application/pdf',
                'agb-2026-10.pdf',
                Buffer.from(PDF),
                '2026-10-22 08:00:00',
            ],
        ]);

        const read = await archive.read('2026-10');

        assert.deepEqual(read, TERMS);
        assert.ok(!Buffer.isBuffer(read.content));
    });

    test('as nothing where none is archived', async () => {
        const { archive } = recordingArchive([]);

        assert.equal(await archive.read('2026-11'), null);
    });
});

/** A database that answers a raw query with `answer`, the one call the check makes. */
const answering = (answer) => ({ execute: async () => answer });

describe('the archive says what would let a version change', () => {
    const named = TERMS_ARCHIVE_TRIGGERS.map((name) => ({ name }));

    test('from the enabled triggers of its table, asked for by their state', async () => {
        const { archive, statements } = recordingArchive(named);

        assert.equal(await archive.protectionProblem(), null);
        assert.match(statements[0].sql, /tgenabled IN \('O', 'A'\)/);
        assert.match(statements[0].sql, /to_regclass\('terms_versions'\)/);
    });

    test('from the triggers as node-postgres answers them, a result holding the rows', async () => {
        const archive = new DrizzleTermsArchive(answering({ rows: named }));

        assert.equal(await archive.protectionProblem(), null);
    });

    test('naming the triggers it lacks', async () => {
        const { archive } = recordingArchive([]);

        const problem = await archive.protectionProblem();

        assert.ok(problem.includes(`lacks ${TERMS_ARCHIVE_TRIGGERS.join(' and ')},`), problem);
    });

    for (const [what, answer] of [
        ['a row without a name', [{ trigger: 'terms_versions_are_kept' }]],
        ['a result without rows', { rowCount: 0 }],
        ['nothing at all', null],
    ]) {
        test(`refusing to read ${what} as no triggers`, async () => {
            const archive = new DrizzleTermsArchive(answering(answer));

            await assert.rejects(archive.protectionProblem(), /pg_trigger/);
        });
    }
});
