// What becomes of a contract once it is written: its confirmation rendered
// from the contract, archived, and mailed to the subscriber's invoice email
// with the terms of the version the contract records — or held, and said,
// where it cannot be yet.
//
// The record, the archives and the mail are in memory, holding what the
// persistence contract holds both adapters to: one rendering and one file per
// contract, and one run holding its mail at a time. How a file is rendered,
// archived and mailed is the run the invoices' documents go through, which
// their own suite pins case by case; this one pins what a confirmation adds.

// @requirement SC-AUD-016 — Concluding or changing a contract gives the subscriber a confirmation to keep

import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import 'reflect-metadata';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CONTRACT_CONFIRMATIONS_CAPABILITY, CONTRACT_ERROR_CODES } from '@saasicat/core';

import { ContractConfirmationService, SubscriptionInvoiceCron } from '../dist/billing/index.js';
import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import {
    aConfirmationArchive,
    aConfirmationRecord,
    aConfirmationRenderer,
    aMailbox,
} from './helpers/invoice-documents.js';
import {
    INVOICING_SETTINGS,
    anInvoicingInstallation,
    berlin,
    line,
} from './helpers/invoice-run.js';
import { invoicingPlatform, wiredInvoices } from './helpers/invoicing-platform.js';
import { controllersIn, handlersOf } from './helpers/operator-routes.js';

const AT = new Date('2026-02-01T05:30:00.000Z');
const INVOICE_EMAIL = 'rechnung@t1.example';
const FOOTER = ['Issuer GmbH · HRB 12345 · Amtsgericht München'];
const TERMS = {
    version: '2026-10',
    checksum: 'a'.repeat(64),
    mediaType: 'application/pdf',
    fileName: 'agb-2026-10.pdf',
    content: new TextEncoder().encode('%PDF-1.7 the terms of 2026-10'),
    archivedAt: AT,
};

/** The operator's terms, in memory: the versions given, and nothing else. */
function aTermsArchive(...versions) {
    const kept = new Map(versions.map((terms) => [terms.version, terms]));
    return {
        kept,
        read: async (version) => structuredClone(kept.get(version) ?? null),
    };
}

/**
 * An installation that confirms its contracts: the invoicing one, with a
 * footer in its file, and the confirmations' record, archive and mail beside
 * it. `writtenBefore` names contracts written before confirmations.
 */
function aConfirmingInstallation({
    terms = aTermsArchive(TERMS),
    renderer = aConfirmationRenderer(),
    archive = aConfirmationArchive(),
    mail = aMailbox(),
    writtenBefore = [],
} = {}) {
    const settings = {
        ...INVOICING_SETTINGS,
        invoicing: { ...INVOICING_SETTINGS.invoicing, footer: FOOTER },
    };
    const installation = anInvoicingInstallation({ settings, mail });
    const written = [];
    const subscribed = new Set();
    const record = aConfirmationRecord(() => written, { writtenBefore });
    const confirmations = new ContractConfirmationService(
        record,
        renderer,
        archive,
        mail,
        installation.contracts,
        installation.subscribers,
        settings,
        terms,
        null,
        installation.auditLog,
        installation.store,
    );
    return {
        ...installation,
        record,
        renderer,
        archive,
        mail,
        terms,
        confirmations,
        /** A contract of a subscriber of `tenantId`, recording `termsVersion`. */
        async aConfirmableContract(
            tenantId,
            { termsVersion = TERMS.version, details, ...rest } = {},
        ) {
            // One subscriber per tenant, created with its first contract.
            if (!subscribed.has(tenantId)) {
                subscribed.add(tenantId);
                await installation.aSubscriber(tenantId, {
                    invoiceEmail: INVOICE_EMAIL,
                    ...details,
                });
            }
            const { parties } = await installation.subscribers.contractPartyFor(tenantId, {
                forTaxAdapter: false,
            });
            const contract = await installation.contracts.create({
                tenantId,
                parties: { ...parties, ...rest.parties },
                partiesMigrated: rest.partiesMigrated ?? false,
                cancellationNoticeDays: 14,
                termsVersion,
                agreedAt: berlin('2026-01-01'),
                effectiveFrom: berlin('2026-01-01'),
                priceSnapshot: {
                    currency: 'EUR',
                    billingCycle: 'monthly',
                    subtotalNet: 49,
                    discountNet: 0,
                    totalNet: 49,
                    vatRate: 19,
                    totalGross: 58.31,
                },
                lineItems: rest.lineItems ?? [line('plan', 'STANDARD', 49, 'Standard, monthly')],
            });
            written.push(contract.id);
            return contract;
        },
    };
}

/** The audit entries of `action`, as code and params. */
const entriesOf = (audits, action) =>
    audits
        .filter((entry) => entry.action === action)
        .map((entry) => [entry.changes.code, entry.changes.params]);

function quietLog() {
    mock.method(Logger.prototype, 'warn', () => {});
    mock.method(Logger.prototype, 'error', () => {});
}

describe('a contract written is confirmed', () => {
    test('rendered from the contract with the footer the file names and the zone it is told in, archived, and mailed with the terms', async () => {
        const installation = aConfirmingInstallation();
        const contract = await installation.aConfirmableContract('t1');

        assert.deepEqual(await installation.confirmations.archiveDue(AT), {
            archived: 1,
            held: 0,
            failed: 0,
        });
        assert.deepEqual(await installation.confirmations.deliverDue(), {
            delivered: 1,
            held: 0,
            failed: 0,
        });

        const [rendered] = installation.renderer.rendered;
        assert.deepEqual(
            [rendered.contract.id, rendered.footer, rendered.timeZone],
            [contract.id, FOOTER, 'Europe/Berlin'],
        );
        const kept = installation.archive.files.get(contract.id);
        assert.equal(kept.checksum, createHash('sha256').update(kept.content).digest('hex'));
        const [mail] = installation.mail.confirmed;
        assert.deepEqual(
            [mail.contract.id, mail.to, mail.documents.map((file) => file.fileName)],
            [contract.id, INVOICE_EMAIL, [`contract-${contract.id}.pdf`, TERMS.fileName]],
        );
        assert.deepEqual(mail.documents[1].content, TERMS.content);
        const state = await installation.record.find(contract.id);
        assert.deepEqual([state.archivedAt, state.deliveredTo], [AT, INVOICE_EMAIL]);
    });

    test('a second run renders and mails nothing again', async () => {
        const installation = aConfirmingInstallation();
        await installation.aConfirmableContract('t1');
        await installation.confirmations.archiveDue(AT);
        await installation.confirmations.deliverDue();

        assert.deepEqual(await installation.confirmations.archiveDue(AT), {
            archived: 0,
            held: 0,
            failed: 0,
        });
        assert.equal((await installation.confirmations.deliverDue()).delivered, 0);
        assert.equal(installation.renderer.rendered.length, 1);
        assert.equal(installation.mail.confirmed.length, 1);
    });

    test('a contract that records no terms is mailed with its confirmation alone', async () => {
        const installation = aConfirmingInstallation({ terms: aTermsArchive() });
        await installation.aConfirmableContract('t1', { termsVersion: null });

        await installation.confirmations.archiveDue(AT);
        await installation.confirmations.deliverDue();

        assert.equal(installation.mail.confirmed[0].documents.length, 1);
    });

    test('a contract that names another entity than the file is confirmed without the file’s footer', async () => {
        const installation = aConfirmingInstallation();
        await installation.aConfirmableContract('t1', {
            parties: { issuer: { ...INVOICING_SETTINGS.issuer, legalName: 'Other GmbH' } },
        });

        await installation.confirmations.archiveDue(AT);

        assert.deepEqual(installation.renderer.rendered[0].footer, []);
    });

    test('a contract written before confirmations is due none', async () => {
        const installation = aConfirmingInstallation({ writtenBefore: ['contract-1'] });
        const before = await installation.aConfirmableContract('t1');
        assert.equal(before.id, 'contract-1');
        const after = await installation.aConfirmableContract('t2');

        await installation.confirmations.archiveDue(AT);

        assert.deepEqual(
            installation.renderer.rendered.map((rendered) => rendered.contract.id),
            [after.id],
        );
    });
});

describe('a confirmation that cannot be made yet is held, and said once', () => {
    test('for a contract whose parties a migration copied, or that names no issuer', async () => {
        quietLog();
        const installation = aConfirmingInstallation();
        const copied = await installation.aConfirmableContract('t1', { partiesMigrated: true });
        const unnamed = await installation.aConfirmableContract('t2', {
            parties: { issuer: null },
        });

        assert.equal((await installation.confirmations.archiveDue(AT)).held, 2);
        assert.equal((await installation.confirmations.archiveDue(AT)).held, 2);

        const code = CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_PARTIES_UNCONFIRMED;
        assert.deepEqual(entriesOf(installation.audits, 'CONTRACT_CONFIRMATION_HELD'), [
            [code, { contractId: copied.id }],
            [code, { contractId: unnamed.id }],
        ]);
        assert.equal(installation.renderer.rendered.length, 0);
    });

    test('for a contract whose terms the archive does not hold, until it does', async () => {
        quietLog();
        const installation = aConfirmingInstallation({ terms: aTermsArchive() });
        const contract = await installation.aConfirmableContract('t1');

        assert.equal((await installation.confirmations.archiveDue(AT)).held, 1);
        installation.terms.kept.set(TERMS.version, TERMS);
        assert.equal((await installation.confirmations.archiveDue(AT)).archived, 1);

        assert.deepEqual(entriesOf(installation.audits, 'CONTRACT_CONFIRMATION_HELD'), [
            [
                CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_TERMS_NOT_ARCHIVED,
                { contractId: contract.id, version: TERMS.version },
            ],
        ]);
    });

    test('for a subscriber without an invoice email, until one is entered', async () => {
        quietLog();
        const installation = aConfirmingInstallation();
        const contract = await installation.aConfirmableContract('t1', {
            details: { invoiceEmail: null },
        });
        await installation.confirmations.archiveDue(AT);

        assert.equal((await installation.confirmations.deliverDue()).held, 1);
        assert.deepEqual(entriesOf(installation.audits, 'CONTRACT_CONFIRMATION_DELIVERY_HELD'), [
            [
                CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_NO_INVOICE_EMAIL,
                { subscriberId: contract.subscriberId },
            ],
        ]);
    });

    test('for a mail that fails, which the next run sends', async () => {
        quietLog();
        const installation = aConfirmingInstallation({
            mail: aMailbox({ confirmationFailures: 1 }),
        });
        await installation.aConfirmableContract('t1');
        await installation.confirmations.archiveDue(AT);

        assert.equal((await installation.confirmations.deliverDue()).failed, 1);
        assert.equal((await installation.confirmations.deliverDue()).delivered, 1);
        assert.equal(
            entriesOf(installation.audits, 'CONTRACT_CONFIRMATION_DELIVERY_FAILED').length,
            1,
        );
    });
});

describe('the confirmation handed out again', () => {
    test('is the archived file, and refused for no contract, one with none archived, and a file that does not match', async () => {
        quietLog();
        const installation = aConfirmingInstallation();
        const confirmed = await installation.aConfirmableContract('t1');
        await installation.confirmations.archiveDue(AT);
        const waiting = await installation.aConfirmableContract('t2');

        const file = await installation.confirmations.confirmationOf(confirmed.id);
        assert.deepEqual(file.content, installation.archive.files.get(confirmed.id).content);
        const refused = (code, Kind) => (error) =>
            error instanceof Kind && error.getResponse().code === code;
        await assert.rejects(
            installation.confirmations.confirmationOf('no-such-contract'),
            refused(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_NOT_FOUND, NotFoundException),
        );
        await assert.rejects(
            installation.confirmations.confirmationOf(waiting.id),
            refused(CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_NOT_ARCHIVED, ConflictException),
        );

        installation.archive.files.get(confirmed.id).content = new TextEncoder().encode('changed');
        await assert.rejects(
            installation.confirmations.confirmationOf(confirmed.id),
            refused(CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_MISMATCH, ConflictException),
        );
        assert.equal(entriesOf(installation.audits, 'CONTRACT_CONFIRMATION_MISMATCH').length, 1);
    });
});

describe('a subscriber’s contracts, as the operator reads them', () => {
    test('are every contract, the newest first, each with where its confirmation stands', async () => {
        const installation = aConfirmingInstallation({ writtenBefore: ['contract-1'] });
        const before = await installation.aConfirmableContract('t1');
        const sent = await installation.aConfirmableContract('t1', { termsVersion: null });
        await installation.confirmations.archiveDue(AT);
        await installation.confirmations.deliverDue();
        const archived = await installation.aConfirmableContract('t1');
        await installation.confirmations.archiveDue(AT);
        const waiting = await installation.aConfirmableContract('t1');
        await installation.aConfirmableContract('t2');

        const { contracts } = await installation.confirmations.contractsOf(
            (await installation.subscriberRepository.findByTenantId('t1')).id,
        );

        assert.deepEqual(
            contracts.map((contract) => [contract.id, contract.confirmation.state]),
            [
                [waiting.id, 'being-made'],
                [archived.id, 'awaiting-mail'],
                [sent.id, 'sent'],
                [before.id, 'not-due'],
            ],
        );
        const [, , mailed] = contracts;
        assert.deepEqual(mailed, {
            id: sent.id,
            tenantId: 't1',
            status: 'active',
            concludedAt: sent.createdAt.toISOString(),
            effectiveFrom: sent.effectiveFrom.toISOString(),
            effectiveUntil: null,
            firstDay: '2026-01-01',
            lastDay: null,
            neverInForce: false,
            billingCycle: 'monthly',
            currency: 'EUR',
            totalGross: 58.31,
            termsVersion: null,
            cancellationNoticeDays: 14,
            plan: { key: 'STANDARD', title: 'Standard, monthly' },
            bundles: [],
            minimumTermUntil: null,
            change: {
                concluded: false,
                plan: null,
                bundlesAdded: [],
                bundlesRemoved: [],
                frozenAnew: true,
                priceChanged: false,
                cancelled: false,
            },
            confirmation: {
                state: 'sent',
                archivedAt: AT.toISOString(),
                deliveredAt: mailed.confirmation.deliveredAt,
                deliveredTo: INVOICE_EMAIL,
            },
        });
        assert.ok(mailed.confirmation.deliveredAt, 'the moment it was mailed');
    });

    test('of a subscriber without contracts are none, and of one there is not are refused', async () => {
        const installation = aConfirmingInstallation();
        const subscriber = await installation.aSubscriber('t1');

        assert.deepEqual(await installation.confirmations.contractsOf(subscriber.id), {
            contracts: [],
        });
        await assert.rejects(
            installation.confirmations.contractsOf('no-such-subscriber'),
            (error) => error.getResponse?.().code === 'SUBSCRIBER_NOT_FOUND',
        );
    });
});

// @requirement SC-ADM-041 — The record shows every contract as it was concluded, and how one followed another
describe('a contract’s dossier', () => {
    /** Where each line came from, by its key; a key it does not name is in the catalogue. */
    const sourcesSaying = (states = {}) => ({
        asked: [],
        async stateOf(asking) {
            this.asked.push(asking.sourceKey);
            return states[asking.sourceKey] ?? 'in-catalog';
        },
    });

    test('is the contract as it was frozen, each line with where it came from, and the invoices issued under it', async () => {
        const installation = aConfirmingInstallation();
        const contract = await installation.aConfirmableContract('t1', {
            lineItems: [
                line('plan', 'STANDARD', 49, 'Standard, monthly'),
                line('discount', 'WELCOME', -4.9, 'Welcome discount'),
            ],
        });
        const other = await installation.aConfirmableContract('t1');
        installation.charge(contract, 'plan');
        installation.charge(other, 'plan', {
            periodStart: berlin('2026-03-01'),
            periodEnd: berlin('2026-04-01'),
        });
        await installation.run(new Date('2026-03-01T05:15:00.000Z'));
        await installation.confirmations.archiveDue(AT);
        const sources = sourcesSaying({ STANDARD: 'removed' });

        const dossier = await installation.confirmations.dossierOf(
            contract.subscriberId,
            contract.id,
            sources,
        );

        assert.equal(dossier.contract.id, contract.id);
        assert.deepEqual(
            dossier.lines.map(({ kind, key, title, priceNet, source }) => [
                kind,
                key,
                title,
                priceNet,
                source,
            ]),
            [
                ['plan', 'STANDARD', 'Standard, monthly', 49, 'removed'],
                ['discount', 'WELCOME', 'Welcome discount', -4.9, null],
            ],
        );
        assert.deepEqual(sources.asked, ['STANDARD'], 'a discount is not asked about');
        const own = installation.store.invoices.filter((each) => each.contractId === contract.id);
        assert.equal(own.length, 1, 'the fixture issued one invoice under the contract');
        assert.deepEqual(
            dossier.invoices.map(({ id }) => id),
            own.map(({ id }) => id),
            'and none of the other contract',
        );
        assert.equal(dossier.integrity, 'intact');
        assert.deepEqual(
            [dossier.agreedAt, dossier.totalNet, dossier.partiesMigrated],
            [berlin('2026-01-01').toISOString(), 49, false],
        );
    });

    test('says when its archived confirmation no longer matches, and writes that to the audit log once', async () => {
        quietLog();
        const installation = aConfirmingInstallation();
        const contract = await installation.aConfirmableContract('t1');
        await installation.confirmations.archiveDue(AT);
        installation.archive.files.get(contract.id).content = new TextEncoder().encode(
            '%PDF-1.7 something else',
        );

        const read = () =>
            installation.confirmations.dossierOf(contract.subscriberId, contract.id, null);

        assert.equal((await read()).integrity, 'mismatch');
        assert.equal((await read()).integrity, 'mismatch');
        assert.equal(entriesOf(installation.audits, 'CONTRACT_CONFIRMATION_MISMATCH').length, 1);
    });

    test('is waiting while its confirmation is due and not archived, and not due for one written before', async () => {
        const installation = aConfirmingInstallation({ writtenBefore: ['contract-1'] });
        const before = await installation.aConfirmableContract('t1');
        const due = await installation.aConfirmableContract('t1');

        const integrityOf = async (contract) =>
            (await installation.confirmations.dossierOf(contract.subscriberId, contract.id, null))
                .integrity;

        assert.equal(before.id, 'contract-1');
        assert.deepEqual(
            [await integrityOf(before), await integrityOf(due)],
            ['not-due', 'waiting'],
        );
    });

    test('without a catalogue to ask, no line says where it came from', async () => {
        const installation = aConfirmingInstallation();
        const contract = await installation.aConfirmableContract('t1');

        const dossier = await installation.confirmations.dossierOf(
            contract.subscriberId,
            contract.id,
            null,
        );

        assert.deepEqual(
            dossier.lines.map(({ source }) => source),
            [null],
        );
    });

    test('of another subscriber’s contract is refused as one that does not exist, as are an unknown one and an unknown subscriber', async () => {
        const installation = aConfirmingInstallation();
        const mine = await installation.aConfirmableContract('t1');
        const theirs = await installation.aConfirmableContract('t2');
        const refusedWith = (code) => (error) => error.getResponse?.().code === code;

        await assert.rejects(
            installation.confirmations.dossierOf(mine.subscriberId, theirs.id, null),
            refusedWith(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_NOT_FOUND),
        );
        await assert.rejects(
            installation.confirmations.dossierOf(mine.subscriberId, 'no-such-contract', null),
            refusedWith(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_NOT_FOUND),
        );
        await assert.rejects(
            installation.confirmations.dossierOf('no-such-subscriber', mine.id, null),
            refusedWith('SUBSCRIBER_NOT_FOUND'),
        );
    });
});

describe('the confirmations start', () => {
    test('not beside an archive that would let a confirmation it keeps be changed, naming why', async () => {
        const installation = aConfirmingInstallation({
            archive: aConfirmationArchive({ problem: 'the triggers are missing' }),
        });

        await assert.rejects(
            installation.confirmations.onModuleInit(),
            /Contract confirmations cannot start:\n- the triggers are missing/,
        );
    });
});

describe('the quarter-hourly run', () => {
    test('confirms a contract written since the last one', async () => {
        const installation = aConfirmingInstallation();
        await installation.aConfirmableContract('t1');

        await new SubscriptionInvoiceCron(
            installation.service,
            null,
            null,
            null,
            null,
            installation.confirmations,
        ).issueDueInvoices();

        assert.equal(installation.mail.confirmed.length, 1);
    });
});

describe('the operator’s download of a confirmation', () => {
    const ROUTE = 'GET admin/contracts/:id/confirmation';

    /**
     * The platform serving `installation`'s confirmations, the route where it
     * serves the download, and the read of a tenant's contracts. `adjust` may
     * change the options before the platform is built.
     */
    async function aServingPlatform(installation, options = {}, adjust = () => {}) {
        const confirmations = {
            renderer: installation.renderer,
            repository: installation.record,
            archive: installation.archive,
        };
        // The installation's invoices, which a contract's dossier names.
        const platform = invoicingPlatform({
            invoices: wiredInvoices({ confirmations, invoiceRepository: installation.store }),
        });
        // The contracts the installation wrote, which the download reads its contract from.
        platform.tenantBilling.contractFreeze.subscriptionContractRepository =
            installation.contracts;
        // And the subscribers they name, which the contracts are listed by.
        platform.tenantBilling.contractFreeze.subscriberRepository =
            installation.subscriberRepository;
        adjust(platform);
        const root = SaaSiCatModule.forRoot({ ...platform, ...options });
        const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
        await moduleRef.init();
        const handlers = controllersIn(root).flatMap(handlersOf);
        const served = handlers.find(({ route }) => route === ROUTE);
        const contracts = handlers.find(
            ({ route }) => route === 'GET admin/subscribers/:id/contracts',
        );
        const dossier = handlers.find(
            ({ route }) => route === 'GET admin/subscribers/:id/contracts/:contractId',
        );
        return {
            moduleRef,
            served,
            contractsOf: (subscriberId) =>
                moduleRef
                    .get(contracts.controller, { strict: false })
                    [contracts.name](subscriberId),
            dossierOf: (subscriberId, contractId) =>
                moduleRef
                    .get(dossier.controller, { strict: false })
                    [dossier.name](subscriberId, contractId),
        };
    }

    test('is served beside the invoices’ documents, and answers the archived file under its name', async () => {
        const installation = aConfirmingInstallation();
        const contract = await installation.aConfirmableContract('t1');
        await installation.confirmations.archiveDue(AT);
        const { moduleRef, served } = await aServingPlatform(installation);

        const file = await moduleRef
            .get(served.controller, { strict: false })
            [served.name](contract.id);

        const chunks = [];
        for await (const chunk of file.getStream()) chunks.push(chunk);
        assert.deepEqual(
            Buffer.concat(chunks),
            Buffer.from(installation.archive.files.get(contract.id).content),
        );
        assert.equal(
            file.getHeaders().disposition,
            `attachment; filename="contract-${contract.id}.pdf"`,
        );
        await moduleRef.close();
    });

    test('serves the subscriber’s contracts in its record, read outside any row policy, and the manifest announces both', async () => {
        const installation = aConfirmingInstallation();
        const contract = await installation.aConfirmableContract('t1');
        const reads = [];
        let bypassed = 0;
        const { moduleRef, contractsOf } = await aServingPlatform(installation, {}, (platform) => {
            platform.persistence.core.rlsBypass = {
                runWithBypass: async (fn) => {
                    bypassed += 1;
                    try {
                        return await fn();
                    } finally {
                        bypassed -= 1;
                    }
                },
            };
            const listed = installation.contracts.list.bind(installation.contracts);
            installation.contracts.list = (filter) => {
                reads.push({ filter, bypassed: bypassed > 0 });
                return listed(filter);
            };
        });

        const { contracts } = await contractsOf(contract.subscriberId);

        assert.deepEqual(
            contracts.map((each) => each.confirmation.state),
            ['being-made'],
        );
        assert.deepEqual(reads, [
            { filter: { subscriberId: contract.subscriberId }, bypassed: true },
        ]);
        await assert.rejects(contractsOf('nobody'), NotFoundException);
        const manifest = await moduleRef.get(AdminManifestService).getManifest();
        assert.equal(manifest.capabilities[CONTRACT_CONFIRMATIONS_CAPABILITY], true);
        await moduleRef.close();
    });

    // @requirement SC-ADM-041 — The record shows every contract as it was concluded, and how one followed another
    test('serves a contract’s dossier in its record, read outside any row policy, each line with where the platform’s catalogue has it', async () => {
        const installation = aConfirmingInstallation();
        const contract = await installation.aConfirmableContract('t1', {
            lineItems: [
                line('plan', 'STANDARD', 49, 'Standard, monthly'),
                line('bundle', 'STORAGE', 5, 'Storage'),
                line('bundle', 'GONE', 5, 'Gone'),
            ],
        });
        const theirs = await installation.aConfirmableContract('t2');
        const reads = [];
        let bypassed = 0;
        const { moduleRef, dossierOf } = await aServingPlatform(installation, {}, (platform) => {
            platform.persistence.core.rlsBypass = {
                runWithBypass: async (fn) => {
                    bypassed += 1;
                    try {
                        return await fn();
                    } finally {
                        bypassed -= 1;
                    }
                },
            };
            const listed = installation.contracts.list.bind(installation.contracts);
            installation.contracts.list = (filter) => {
                reads.push({ filter, bypassed: bypassed > 0 });
                return listed(filter);
            };
            // The plan was removed from the catalogue; one add-on is still in
            // it, and the catalogue never knew the other. Each repository keeps
            // the rest of what the platform's catalogue asks of it at start.
            const { catalog } = platform.persistence;
            catalog.planRepository = Object.assign(Object.create(catalog.planRepository), {
                findByKey: async (key) =>
                    key === 'STANDARD' ? { planKey: key, deletedAt: new Date() } : null,
            });
            catalog.bundleRepository = Object.assign(Object.create(catalog.bundleRepository), {
                findByKey: async (key) =>
                    key === 'STORAGE' ? { bundleKey: key, deletedAt: null } : null,
            });
        });

        const dossier = await dossierOf(contract.subscriberId, contract.id);

        assert.deepEqual(
            dossier.lines.map(({ key, source }) => [key, source]),
            [
                ['STANDARD', 'removed'],
                ['STORAGE', 'in-catalog'],
                ['GONE', 'deleted'],
            ],
        );
        assert.deepEqual(reads, [
            { filter: { subscriberId: contract.subscriberId }, bypassed: true },
        ]);
        await assert.rejects(dossierOf(contract.subscriberId, theirs.id), NotFoundException);
        await moduleRef.close();
    });

    test('is not served where the administration is not', async () => {
        const installation = aConfirmingInstallation();
        const { moduleRef, served } = await aServingPlatform(installation, {
            adminResources: false,
        });

        assert.equal(served, undefined);
        const manifest = await moduleRef.get(AdminManifestService).getManifest();
        assert.notEqual(manifest.capabilities?.[CONTRACT_CONFIRMATIONS_CAPABILITY], true);
        await moduleRef.close();
    });
});
