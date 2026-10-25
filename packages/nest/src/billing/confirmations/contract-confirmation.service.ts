// The confirmation a subscriber keeps of the contract they are bound by
// (`SC-AUD-016`): rendered from the contract, archived and mailed the way an
// invoice's document is (`ArchivedFileRun`), with the terms of the version the
// contract records attached.
//
// Every contract written since confirmations exist is due one, and none
// written before is (`confirmationDue`). A contract that does not say who its
// parties were when it was written is held, like its invoices; so is one whose
// terms the archive does not hold, since the subscriber is owed both together.
// Platform-wide, so inside `RlsBypassPort`.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    type OnModuleInit,
    Optional,
} from '@nestjs/common';
import {
    CONTRACT_ERROR_CODES,
    confirmationStateOf,
    contractPartiesOf,
    invoiceFooterOf,
    type AdminSubscriberContract,
    type AdminSubscriberContracts,
    type ContractConfirmationStanding,
    type ContractConfirmationArchivePort,
    type ContractConfirmationRenderer,
    type ContractConfirmationRepository,
    type InvoiceDocument,
    type InvoiceMailPort,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriptionContractRecord,
    type SubscriptionContractRepository,
    type TermsArchivePort,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { AdminAuditService } from '../../admin/admin-audit.service.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { codedError } from '../../errors/coded-error.js';
import { SubscriberService } from '../../subscriber/subscriber.service.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { TERMS_ARCHIVE_TOKEN } from '../../terms/terms.tokens.js';
import {
    ArchivedFileRun,
    Held,
    type ArchivingRun,
    type MailingRun,
} from '../archived-files/archived-file-run.js';
import { INVOICE_MAIL_PORT_TOKEN } from '../invoices/invoice-document.tokens.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import {
    CONTRACT_CONFIRMATION_ARCHIVE_TOKEN,
    CONTRACT_CONFIRMATION_RENDERER_TOKEN,
    CONTRACT_CONFIRMATION_REPOSITORY_TOKEN,
} from './contract-confirmation.tokens.js';

@Injectable()
export class ContractConfirmationService implements OnModuleInit {
    private readonly run: ArchivedFileRun<SubscriptionContractRecord>;

    constructor(
        @Inject(CONTRACT_CONFIRMATION_REPOSITORY_TOKEN)
        private readonly confirmations: ContractConfirmationRepository,
        @Inject(CONTRACT_CONFIRMATION_RENDERER_TOKEN)
        renderer: ContractConfirmationRenderer,
        @Inject(CONTRACT_CONFIRMATION_ARCHIVE_TOKEN)
        private readonly archive: ContractConfirmationArchivePort,
        @Inject(INVOICE_MAIL_PORT_TOKEN)
        mail: InvoiceMailPort,
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: SubscriptionContractRepository,
        @Inject(SubscriberService)
        private readonly subscribers: SubscriberService,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        settings: PlanCatalogSettings,
        // The terms the contracts record; the start refuses contracts that
        // record terms without an archive for them.
        @Optional()
        @Inject(TERMS_ARCHIVE_TOKEN)
        terms: TermsArchivePort | null = null,
        // The runs are the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        audit: AdminAuditService | null = null,
    ) {
        /** The archived terms of the version `contract` records, or `null` where it records none. */
        const termsOf = async (contract: SubscriptionContractRecord) => {
            if (!contract.termsVersion) return null;
            const kept = await terms?.read(contract.termsVersion);
            if (kept) return kept;
            throw new Held({
                code: CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_TERMS_NOT_ARCHIVED,
                params: { contractId: contract.id, version: contract.termsVersion },
            });
        };
        this.run = new ArchivedFileRun({
            job: 'contract-confirmations',
            entity: 'SubscriptionContract',
            logger: new Logger(ContractConfirmationService.name),
            fileOfId: (id) => `the confirmation of contract ${id}`,
            nameOf: (contract) => `the confirmation of contract ${contract.id}`,
            idOf: (contract) => contract.id,
            auditOf: (contract) => ({
                tenantId: contract.tenantId,
                subscriberId: contract.subscriberId,
            }),
            load: (id) => contracts.findById(id),
            render: async (contract) => {
                const issuer = contract.issuer;
                if (contract.partiesMigrated || !issuer) {
                    throw new Held({
                        code: CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_PARTIES_UNCONFIRMED,
                        params: { contractId: contract.id },
                    });
                }
                await termsOf(contract);
                const subscriber = await subscribers.getById(contract.subscriberId);
                const configured = contractPartiesOf(subscriber, subscribers.issuerNamed()).issuer;
                return renderer.render({
                    contract,
                    footer: invoiceFooterOf(issuer, configured, settings.invoicing?.footer ?? []),
                    // Required with a tax adapter, which invoicing requires.
                    timeZone: settings.timeZone!,
                });
            },
            // The tax adapter judges invoices; a confirmation is the contract's
            // own statement, checked by nobody but its renderer.
            check: async () => {},
            recipient: async (contract) =>
                (await subscribers.getById(contract.subscriberId)).invoiceEmail,
            send: async (contract, to, confirmation) => {
                const documents: InvoiceDocument[] = [confirmation];
                const kept = await termsOf(contract);
                if (kept) {
                    documents.push({
                        content: kept.content,
                        mediaType: kept.mediaType,
                        fileName: kept.fileName,
                    });
                }
                await mail.deliverConfirmation({ contract, to, documents });
            },
            marks: {
                find: (id) => confirmations.find(id),
                recordRendering: (id, rendering) => confirmations.recordRendering(id, rendering),
                replaceRendering: (id, rendering, replaced) =>
                    confirmations.replaceRendering(id, rendering, replaced),
                markArchived: (id, at, checksum) => confirmations.markArchived(id, at, checksum),
                claimDelivery: (id, at, staleBefore) =>
                    confirmations.claimDelivery(id, at, staleBefore),
                markDelivered: (id, delivery) => confirmations.markDelivered(id, delivery),
                releaseDelivery: (id, claimedAt) => confirmations.releaseDelivery(id, claimedAt),
                listAwaitingArchive: (page) => confirmations.listAwaitingConfirmation(page),
                listAwaitingDelivery: (page) => confirmations.listAwaitingDelivery(page),
            },
            archive: {
                store: (contractId, file) => archive.store({ ...file, contractId }),
                read: (contractId) => archive.read(contractId),
            },
            codes: {
                changed: CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_CHANGED,
                mismatch: CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_MISMATCH,
                noAddress: CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_NO_INVOICE_EMAIL,
            },
            actions: {
                held: 'CONTRACT_CONFIRMATION_HELD',
                rerendered: 'CONTRACT_CONFIRMATION_RERENDERED',
                mismatch: 'CONTRACT_CONFIRMATION_MISMATCH',
                deliveryHeld: 'CONTRACT_CONFIRMATION_DELIVERY_HELD',
                deliveryFailed: 'CONTRACT_CONFIRMATION_DELIVERY_FAILED',
            },
            fileParams: (contract) => ({ contractId: contract.id }),
            addressParams: (contract) => ({ subscriberId: contract.subscriberId }),
            audit,
        });
    }

    /**
     * Refuses to start beside an archive that would let a confirmation it
     * keeps be changed: what the subscriber was sent would be kept only until
     * somebody changed it, and nothing would say so.
     */
    async onModuleInit(): Promise<void> {
        const problem = await this.archive.protectionProblem();
        if (problem) throw new Error(`Contract confirmations cannot start:\n- ${problem}`);
    }

    /** Renders and archives the confirmation of every contract due one and still waiting for it. */
    async archiveDue(now: Date): Promise<ArchivingRun> {
        return readAcrossTenants(this.rlsBypass, () => this.run.archiveDue(now));
    }

    /** Mails every archived confirmation not yet handed to the mail and held by no other run. */
    async deliverDue(): Promise<MailingRun> {
        return readAcrossTenants(this.rlsBypass, () => this.run.deliverDue());
    }

    /**
     * The archived confirmation of a contract, after checking it against the
     * checksum recorded when it was rendered. Refused with
     * `SUBSCRIPTION_CONTRACT_NOT_FOUND` (404) for no such contract,
     * `CONTRACT_CONFIRMATION_NOT_ARCHIVED` (409) for one with no archived
     * confirmation, and `CONTRACT_CONFIRMATION_MISMATCH` (409) for a file that
     * does not match — which is not handed out but written to the audit log
     * for the operator.
     */
    async confirmationOf(contractId: string): Promise<InvoiceDocument> {
        const found = await readAcrossTenants(this.rlsBypass, () => this.run.handOut(contractId));
        switch (found.kind) {
            case 'file':
                return found.file;
            case 'unknown':
                throw new NotFoundException(
                    codedError(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_NOT_FOUND, {
                        contractId,
                    }),
                );
            case 'waiting':
                throw new ConflictException(
                    codedError(CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_NOT_ARCHIVED, {
                        contractId,
                    }),
                );
            case 'mismatch':
                throw new ConflictException(
                    codedError(CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_MISMATCH, { contractId }),
                );
        }
    }

    /**
     * The subscriber's contracts — in force, superseded and ended, whichever
     * tenant each was for — the newest first, each with where its confirmation
     * stands (`SC-AUD-016`). Refused where there is no such subscriber.
     */
    async contractsOf(subscriberId: string): Promise<AdminSubscriberContracts> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const subscriber = await this.subscribers.requireById(subscriberId);
            const contracts = await this.contracts.list({ subscriberId: subscriber.id });
            const standings = await this.confirmations.listStandings(
                contracts.map((contract) => contract.id),
            );
            const byContract = new Map(
                standings.map((standing) => [standing.contractId, standing]),
            );
            return {
                contracts: [...contracts]
                    .sort(newestFirst)
                    .map((contract) => adminContractOf(contract, byContract.get(contract.id))),
            };
        });
    }
}

/** The contract written last first; of two written at once, the larger id first. */
function newestFirst(a: SubscriptionContractRecord, b: SubscriptionContractRecord): number {
    return (
        b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    );
}

/** A contract as the operator reads it beside its tenant. */
function adminContractOf(
    contract: SubscriptionContractRecord,
    standing: ContractConfirmationStanding | undefined,
): AdminSubscriberContract {
    // A contract the store answers without a standing is one it did not find a
    // moment later, which is no confirmation either.
    const known = standing ?? { contractId: contract.id, due: false, confirmation: null };
    const { confirmation } = known;
    return {
        id: contract.id,
        status: contract.status,
        concludedAt: contract.createdAt.toISOString(),
        effectiveFrom: contract.effectiveFrom.toISOString(),
        effectiveUntil: contract.effectiveUntil?.toISOString() ?? null,
        billingCycle: contract.priceSnapshot.billingCycle,
        currency: contract.priceSnapshot.currency,
        totalGross: contract.priceSnapshot.totalGross,
        termsVersion: contract.termsVersion,
        cancellationNoticeDays: contract.cancellationNoticeDays,
        confirmation: {
            state: confirmationStateOf(known),
            archivedAt: confirmation?.archivedAt?.toISOString() ?? null,
            deliveredAt: confirmation?.deliveredAt?.toISOString() ?? null,
            deliveredTo: confirmation?.deliveredTo ?? null,
        },
    };
}
