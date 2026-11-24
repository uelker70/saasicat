// An installation that confirms its contracts, in memory: the invoicing one,
// with a footer in its file, and the confirmations' record, archive and mail
// beside it, as the persistence contract holds both adapters to keep them.

import { ContractConfirmationService } from '../../dist/billing/index.js';
import {
    aConfirmationArchive,
    aConfirmationRecord,
    aConfirmationRenderer,
    aMailbox,
} from './invoice-documents.js';
import { INVOICING_SETTINGS, anInvoicingInstallation, berlin, line } from './invoice-run.js';

/** When the archiving runs read the clock. */
export const AT = new Date('2026-02-01T05:30:00.000Z');
export const INVOICE_EMAIL = 'rechnung@t1.example';
export const FOOTER = ['Issuer GmbH · HRB 12345 · Amtsgericht München'];
export const TERMS = {
    version: '2026-10',
    checksum: 'a'.repeat(64),
    mediaType: 'application/pdf',
    fileName: 'agb-2026-10.pdf',
    content: new TextEncoder().encode('%PDF-1.7 the terms of 2026-10'),
    archivedAt: AT,
};

/** The operator's terms, in memory: the versions given, and nothing else. */
export function aTermsArchive(...versions) {
    const kept = new Map(versions.map((terms) => [terms.version, terms]));
    return {
        kept,
        read: async (version) => structuredClone(kept.get(version) ?? null),
    };
}

/**
 * An installation that confirms its contracts: the invoicing one, with a
 * footer in its file, and the confirmations' record, archive and mail beside
 * it. `writtenBefore` names contracts written before confirmations, `marks`
 * where the mark of the installation is kept — unmarked, and so live, unless
 * a test marks it — and `operations` the check of the installation's operation
 * a first rendering asks, where a test gives one.
 */
export function aConfirmingInstallation({
    terms = aTermsArchive(TERMS),
    renderer = aConfirmationRenderer(),
    archive = aConfirmationArchive(),
    mail = aMailbox(),
    writtenBefore = [],
    marks,
    operations = null,
} = {}) {
    const settings = {
        ...INVOICING_SETTINGS,
        invoicing: { ...INVOICING_SETTINGS.invoicing, footer: FOOTER },
    };
    const installation = anInvoicingInstallation({ settings, mail, marks });
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
        installation.marks,
        operations,
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
