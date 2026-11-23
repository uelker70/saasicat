// Whether a contract's confirmation was made in a test operation: the run
// reads the installation's mark when it first renders the confirmation, and
// records with that rendering what the mark says. Every later rendering and
// the mail read it from the record, whatever the mark says by then — and a
// contract written before the installation was marked is confirmed as the
// mark says on the day its confirmation is first made.
//
// Through `ContractConfirmationService.archiveDue` and `deliverDue`, over an
// installation in memory whose mark and confirmations are kept as the
// persistence contract holds both adapters to keep them.

import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';

import { ContractConfirmationService, InvoiceOperationCheck } from '../dist/billing/index.js';
import { AT, aConfirmingInstallation } from './helpers/contract-confirmations.js';
import { changeTo, documentsIssued, markAs, marked } from './helpers/installation-marks.js';
import {
    aConfirmationArchive,
    aConfirmationRecord,
    aConfirmationRenderer,
    aMailbox,
    confirmationOf,
} from './helpers/invoice-documents.js';
import { INVOICING_SETTINGS } from './helpers/invoice-run.js';

const LATER = new Date('2026-02-01T05:45:00.000Z');

function quietLog() {
    mock.method(Logger.prototype, 'warn', () => {});
    mock.method(Logger.prototype, 'error', () => {});
}

/** What the renderer was asked, what the record says and what the mail was told of each confirmation. */
async function operationsOf(installation, contractId) {
    return {
        rendered: installation.renderer.rendered.map((asked) => asked.testOperation),
        recorded: (await installation.record.find(contractId))?.testOperation,
        mailed: installation.mail.confirmed.map((mail) => mail.testOperation),
    };
}

describe('a confirmation is made in the operation the mark says when it is first rendered', () => {
    for (const [mark, testOperation] of [
        ['a test operation', true],
        ['a live operation', false],
        ['nobody', null],
    ]) {
        test(`marked as ${mark}: rendered, recorded and mailed as ${testOperation === true ? 'a test' : 'live'}`, async () => {
            const installation = aConfirmingInstallation({ marks: await marked(testOperation) });
            const contract = await installation.aConfirmableContract('t1');

            assert.equal((await installation.confirmations.archiveDue(AT)).archived, 1);
            assert.equal((await installation.confirmations.deliverDue()).delivered, 1);

            const operation = testOperation === true;
            assert.deepEqual(await operationsOf(installation, contract.id), {
                rendered: [operation],
                recorded: operation,
                mailed: [operation],
            });
        });
    }

    test('a contract written before the installation was marked a test is confirmed as a test', async () => {
        const marks = await marked(null);
        const installation = aConfirmingInstallation({ marks });
        const contract = await installation.aConfirmableContract('t1');
        await markAs(marks, true, new Date(contract.createdAt.getTime() + 60_000));

        await installation.confirmations.archiveDue(AT);
        await installation.confirmations.deliverDue();

        assert.deepEqual(await operationsOf(installation, contract.id), {
            rendered: [true],
            recorded: true,
            mailed: [true],
        });
    });

    test('a file the archive already holds is recorded in the operation the mark says', async () => {
        const installation = aConfirmingInstallation({ marks: await marked(true) });
        const contract = await installation.aConfirmableContract('t1');
        const file = confirmationOf({ contract });
        installation.archive.files.set(contract.id, {
            ...file,
            contractId: contract.id,
            checksum: createHash('sha256').update(file.content).digest('hex'),
            archivedAt: AT,
        });

        assert.equal((await installation.confirmations.archiveDue(AT)).archived, 1);

        assert.deepEqual(await operationsOf(installation, contract.id), {
            rendered: [],
            recorded: true,
            mailed: [],
        });
    });
});

// @requirement SC-AUD-025 — An operator's command line starts where the application refuses on its documents
describe('a confirmation first rendered in an operator command line', () => {
    /**
     * An installation marked as a test operation, whose documents say `issued`,
     * as the check of its operation finds it in a command line, whose start
     * leaves that check to the document.
     */
    async function inACommandLine(issued) {
        const marks = await marked(true);
        const { invoices, confirmations } = documentsIssued({ invoices: issued });
        const operations = new InvoiceOperationCheck(invoices, confirmations, marks, null, true);
        return aConfirmingInstallation({ marks, operations });
    }

    test('is not made while the documents recorded another operation than the mark', async () => {
        quietLog();
        const installation = await inACommandLine([false]);
        const contract = await installation.aConfirmableContract('t1');

        assert.equal((await installation.confirmations.archiveDue(AT)).failed, 1);

        assert.deepEqual(await operationsOf(installation, contract.id), {
            rendered: [],
            recorded: undefined,
            mailed: [],
        });
    });

    test('is made where they recorded the operation the mark says', async () => {
        const installation = await inACommandLine([true]);
        const contract = await installation.aConfirmableContract('t1');

        assert.equal((await installation.confirmations.archiveDue(AT)).archived, 1);

        assert.deepEqual((await operationsOf(installation, contract.id)).rendered, [true]);
    });
});

describe('a confirmation made again reads its operation from its record, whatever the mark says by then', () => {
    for (const [madeIn, changedTo] of [
        [true, false],
        [false, true],
    ]) {
        test(`first rendered ${madeIn ? 'as a test' : 'live'}, archived after the mark changed`, async () => {
            quietLog();
            const marks = await marked(madeIn);
            const installation = aConfirmingInstallation({ marks });
            const contract = await installation.aConfirmableContract('t1');
            installation.archive.failingStores.push(new Error('the archive did not answer'));
            assert.equal((await installation.confirmations.archiveDue(AT)).failed, 1);
            await changeTo(marks, changedTo);

            assert.equal((await installation.confirmations.archiveDue(LATER)).archived, 1);
            await installation.confirmations.deliverDue();

            assert.deepEqual(await operationsOf(installation, contract.id), {
                rendered: [madeIn, madeIn],
                recorded: madeIn,
                mailed: [madeIn],
            });
        });
    }

    test('a rendering that takes the place of the one recorded keeps the operation recorded first', async () => {
        quietLog();
        let version = 0;
        const renderer = aConfirmationRenderer({
            render: (confirmation) => {
                version += 1;
                const file = confirmationOf(confirmation);
                return { ...file, content: new TextEncoder().encode(`%PDF-1.7 v${version}`) };
            },
        });
        const marks = await marked(true);
        const installation = aConfirmingInstallation({ marks, renderer });
        const contract = await installation.aConfirmableContract('t1');
        installation.archive.failingStores.push(new Error('the archive did not answer'));
        await installation.confirmations.archiveDue(AT);
        const first = await installation.record.find(contract.id);
        await changeTo(marks, false);

        await installation.confirmations.archiveDue(LATER);

        const replaced = await installation.record.find(contract.id);
        assert.notEqual(replaced.checksum, first.checksum, 'the rendering was not replaced');
        assert.deepEqual(await operationsOf(installation, contract.id), {
            rendered: [true, true],
            recorded: true,
            mailed: [],
        });
    });

    test('mailed in the operation its record says, after the mark changed', async () => {
        const marks = await marked(true);
        const installation = aConfirmingInstallation({ marks });
        const contract = await installation.aConfirmableContract('t1');
        await installation.confirmations.archiveDue(AT);
        await changeTo(marks, false);

        await installation.confirmations.deliverDue();

        assert.deepEqual((await operationsOf(installation, contract.id)).mailed, [true]);
    });
});

describe('the confirmations start', () => {
    test('not where the mark cannot be read, naming how to wire it', async () => {
        const service = new ContractConfirmationService(
            aConfirmationRecord(() => []),
            aConfirmationRenderer(),
            aConfirmationArchive(),
            aMailbox(),
            null,
            null,
            INVOICING_SETTINGS,
        );

        await assert.rejects(
            service.onModuleInit(),
            (error) =>
                error.message.startsWith('Contract confirmations cannot start:\n- ') &&
                error.message.includes('whether they are made in a test operation') &&
                error.message.includes('InstallationMarkPort'),
        );
    });
});
