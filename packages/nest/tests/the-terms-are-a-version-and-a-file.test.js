// The operator's terms are a version and a file: the start archives a version
// `config/saas.yaml` names, once, read beside the file, and refuses a different
// file under a version already archived; every contract records the version
// named when it is written.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TermsArchiveCheck } from '../dist/platform/index.js';
import { SubscriptionContractService } from '../dist/subscription-contract/index.js';
import { FakeSubscriptionContractRepository } from '../dist/testing/index.js';
import { line } from './helpers/charge-journal.js';
import { invoicingPlatform, refusal } from './helpers/invoicing-platform.js';
import { subscribersFor } from './helpers/subscribers.js';
import { TERMS, TERMS_PDF, aTermsArchive } from './helpers/terms.js';

const NOW = new Date('2026-10-22T08:00:00.000Z');
const IN_CODE = 'the object passed to SaaSiCatModule.forRoot({ planCatalog })';
const checksumOf = (bytes) => createHash('sha256').update(bytes).digest('hex');

const scratch = [];
afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A directory holding `saas.yaml` and the PDF beside it, as an operator lays them out. */
function aConfigDirectory() {
    const dir = mkdtempSync(join(tmpdir(), 'saasicat-terms-'));
    scratch.push(dir);
    writeFileSync(join(dir, 'saas.yaml'), 'schemaVersion: 1\n');
    copyFileSync(TERMS_PDF, join(dir, 'agb-2026-10.pdf'));
    return dir;
}

/** The start's check for `terms`, read from the file at `source`, into `archive`. */
const checkFor = (terms, { source = IN_CODE, archive = aTermsArchive() } = {}) => ({
    check: new TermsArchiveCheck({ terms }, source, archive),
    archive,
});

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was
describe('the start archives the version of the terms the file names', () => {
    test('read beside config/saas.yaml, with its checksum, its name and every byte', async () => {
        const dir = aConfigDirectory();
        const { check, archive } = checkFor(
            { version: '2026-10', file: 'agb-2026-10.pdf' },
            { source: join(dir, 'saas.yaml') },
        );

        assert.equal(await check.archived(NOW), null);

        const pdf = readFileSync(TERMS_PDF);
        assert.deepEqual(await archive.read('2026-10'), {
            version: '2026-10',
            checksum: checksumOf(pdf),
            mediaType: 'application/pdf',
            fileName: 'agb-2026-10.pdf',
            content: new Uint8Array(pdf),
            archivedAt: NOW,
        });
    });

    test('by an absolute path wherever the settings came from', async () => {
        const { check, archive } = checkFor(TERMS);

        assert.equal(await check.archived(NOW), null);
        assert.equal((await archive.read(TERMS.version)).fileName, 'terms-2026-10.pdf');
    });

    test('and nothing where the file names no terms', async () => {
        const { check, archive } = checkFor(undefined);

        assert.equal(await check.archived(NOW), null);
        assert.equal(archive.stores, 0);
    });

    test('a second start with the same file archives nothing again', async () => {
        const { check, archive } = checkFor(TERMS);
        await check.archived(NOW);

        assert.equal(await check.archived(new Date('2026-11-01')), null);

        assert.equal(archive.stores, 1);
        assert.deepEqual((await archive.read(TERMS.version)).archivedAt, NOW);
    });

    test('a new version is archived beside the one before, which stays', async () => {
        const dir = aConfigDirectory();
        const archive = aTermsArchive();
        await checkFor(TERMS, { archive }).check.archived(NOW);
        writeFileSync(join(dir, 'agb-2026-11.pdf'), '%PDF-1.4\nthe November terms\n%%EOF\n');

        const later = checkFor(
            { version: '2026-11', file: 'agb-2026-11.pdf' },
            { source: join(dir, 'saas.yaml'), archive },
        );
        assert.equal(await later.check.archived(NOW), null);

        assert.deepEqual([...archive.versions.keys()].sort(), ['2026-10', '2026-11']);
    });
});

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was
describe('the start refuses terms it cannot keep as they were agreed', () => {
    test('another file under a version already archived, asking for a new version', async () => {
        const dir = aConfigDirectory();
        const archive = aTermsArchive();
        await checkFor(
            { version: '2026-10', file: 'agb-2026-10.pdf' },
            {
                source: join(dir, 'saas.yaml'),
                archive,
            },
        ).check.archived(NOW);
        writeFileSync(join(dir, 'agb-2026-10.pdf'), '%PDF-1.4\nchanged in place\n%%EOF\n');

        const problem = await checkFor(
            { version: '2026-10', file: 'agb-2026-10.pdf' },
            { source: join(dir, 'saas.yaml'), archive },
        ).check.archived(NOW);

        assert.match(
            problem,
            /^version 2026-10 of the terms was archived with another file than .*agb-2026-10\.pdf: a changed file is a new version — name one in config\/saas\.yaml\.$/,
        );
        assert.equal((await archive.read('2026-10')).checksum, checksumOf(readFileSync(TERMS_PDF)));
    });

    for (const [what, terms, options, said] of [
        [
            'a relative file where the settings came from code',
            { version: '2026-10', file: 'agb-2026-10.pdf' },
            {},
            'terms.file names agb-2026-10.pdf relative to config/saas.yaml, and the settings were handed in as code: name the PDF by an absolute path.',
        ],
        [
            'a file that is not there',
            { version: '2026-10', file: '/nowhere/agb.pdf' },
            {},
            'terms.file names /nowhere/agb.pdf, which cannot be read',
        ],
        [
            'a file that is no PDF',
            { version: '2026-10', file: 'saas.yaml' },
            { inTheDirectory: true },
            'which is no PDF: the terms are kept as one.',
        ],
        [
            'a version no file could name',
            { version: 'Oktober 2026', file: TERMS_PDF },
            {},
            'terms.version is "Oktober 2026", and a version is called by letters, digits',
        ],
        [
            'no archive to keep them in',
            TERMS,
            { archive: null },
            'config/saas.yaml names terms, and nothing archives them: adopt prisma-fragments/25-terms.prisma',
        ],
        [
            'an archive that would let a version be changed',
            TERMS,
            { archive: aTermsArchive({ problem: 'terms_versions lacks terms_versions_are_kept' }) },
            'terms_versions lacks terms_versions_are_kept',
        ],
    ]) {
        test(`${what}, saying what to do, and archives nothing`, async () => {
            const source = options.inTheDirectory ? join(aConfigDirectory(), 'saas.yaml') : IN_CODE;
            const archive = 'archive' in options ? options.archive : aTermsArchive();
            const { check } = checkFor(terms, { source, archive });

            const problem = await check.archived(NOW);

            assert.ok(problem?.includes(said), problem);
            assert.equal(archive?.versions.size ?? 0, 0);
        });
    }

    test('a contract service that would record terms nothing archives does not start', async () => {
        const { service: subscribers } = await subscribersFor(['t1']);
        const settings = { tenantBilling: { cancellationNoticeDays: NOTICE }, terms: TERMS };
        const repo = new FakeSubscriptionContractRepository();
        const unarchived = new SubscriptionContractService(repo, subscribers, null, null, settings);
        const archived = new SubscriptionContractService(
            repo,
            subscribers,
            null,
            null,
            settings,
            checkFor(TERMS).check,
        );

        assert.throws(
            () => unarchived.onModuleInit(),
            /a contract records the version of the terms `config\/saas\.yaml#terms` names, and nothing archives them — import `TermsModule\.forRoot\(\{ archive \}\)`/,
        );
        assert.doesNotThrow(() => archived.onModuleInit());
    });

    test('refused, the start says so and stops', async () => {
        const { check } = checkFor({ version: '2026-10', file: '/nowhere/agb.pdf' });

        await assert.rejects(
            check.onModuleInit(),
            /^Error: Terms cannot start:\n- terms\.file names/,
        );
    });
});

/** A contract of tenant t1, as a caller asks for one. */
const contractFor = (effectiveFrom) => ({
    tenantId: 't1',
    effectiveFrom,
    priceSnapshot: {
        currency: 'EUR',
        billingCycle: 'monthly',
        subtotalNet: 49,
        discountNet: 0,
        totalNet: 49,
        vatRate: 19,
        totalGross: 58.31,
    },
    lineItems: [line('plan', 'STANDARD', 49)],
});

const NOTICE = { monthly: 14, yearly: 90 };

/** The contract service over `repo`, the file naming `terms` and `notice`. */
async function contractsUnder(
    terms,
    repo = new FakeSubscriptionContractRepository(),
    notice = NOTICE,
) {
    const { service: subscribers } = await subscribersFor(['t1']);
    const settings = { tenantBilling: { cancellationNoticeDays: notice }, terms };
    return {
        repo,
        contracts: new SubscriptionContractService(repo, subscribers, null, null, settings),
    };
}

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was
describe('a contract records the version of the terms the subscriber agreed to', () => {
    test('concluded, the version the file names', async () => {
        const { contracts } = await contractsUnder(TERMS);

        const concluded = await contracts.create(contractFor(new Date('2026-06-01')));

        assert.equal(concluded.termsVersion, '2026-10');
    });

    test('a change of the subscriber’s records the version named then, and the one it replaces keeps its own', async () => {
        const { repo, contracts: before } = await contractsUnder(TERMS);
        const first = await before.create(contractFor(new Date('2026-06-01')));
        const { contracts: after } = await contractsUnder(
            { version: '2026-11', file: TERMS_PDF },
            repo,
        );

        const successor = await after.writeSuccessor(
            first,
            contractFor(new Date('2026-07-01')),
            new Date('2026-07-01'),
        );

        assert.equal(successor.termsVersion, '2026-11');
        assert.equal((await repo.findById(first.id)).termsVersion, '2026-10');
    });

    // @requirement SC-CANC-026 — A cancellation is judged by the notice period the subscriber agreed to
    test('a successor the operator writes keeps the version and the days of notice of the contract it replaces', async () => {
        const { repo, contracts: before } = await contractsUnder(TERMS);
        const first = await before.create(contractFor(new Date('2026-06-01')));
        const { contracts: after } = await contractsUnder(
            { version: '2026-11', file: TERMS_PDF },
            repo,
            { monthly: 30, yearly: 120 },
        );

        const successor = await after.writeSuccessor(
            first,
            contractFor(new Date('2026-07-01')),
            new Date('2026-07-01'),
            { agreement: 'kept' },
        );

        assert.deepEqual(
            [successor.termsVersion, successor.cancellationNoticeDays],
            ['2026-10', 14],
        );
    });

    // @requirement SC-CANC-026 — A cancellation is judged by the notice period the subscriber agreed to
    test('and refuses to keep the days of one rhythm in a contract of another, writing nothing', async () => {
        const { repo, contracts } = await contractsUnder(TERMS);
        const first = await contracts.create(contractFor(new Date('2026-06-01')));
        const monthly = contractFor(new Date('2026-07-01'));
        const yearly = {
            ...monthly,
            priceSnapshot: { ...monthly.priceSnapshot, billingCycle: 'yearly' },
            lineItems: [line('plan', 'STANDARD', 49, { billingCycle: 'yearly' })],
        };

        await assert.rejects(
            contracts.writeSuccessor(first, yearly, new Date('2026-07-01'), {
                agreement: 'kept',
            }),
            /stays in its rhythm, monthly, and this one is yearly/,
        );

        assert.equal((await repo.findById(first.id)).status, 'active');
    });

    test('none where the file names no terms', async () => {
        const { contracts } = await contractsUnder(undefined);

        const concluded = await contracts.create(contractFor(new Date('2026-06-01')));

        assert.equal(concluded.termsVersion, null);
    });
});

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was
describe('invoices', () => {
    test('do not start without terms, which every contract they invoice records', async () => {
        const options = invoicingPlatform();
        const { terms: _terms, ...planCatalog } = options.planCatalog;

        const message = await refusal({ ...options, planCatalog });

        assert.ok(
            message.includes(
                'invoices are issued for contracts that record the version of the terms',
            ),
            message,
        );
    });
});
