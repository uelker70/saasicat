// The confirmation a subscriber keeps of the contract they are bound by
// (`SC-AUD-016`): rendered from the contract, archived write-once like an
// invoice's document, and mailed to the invoice email with the terms of the
// version the contract records.
//
// Every contract written once confirmations exist is due one — the column
// `confirmationDue` is written with the contract itself, so nothing between
// two writes can lose it — and a contract written before is not. A
// confirmation states the whole contract in force, not what changed, and has
// no number of its own: it names the contract and the day it was written.

import type { InvoiceDocument } from './invoice-document.types.js';
import type {
    ContractLineItemKind,
    SubscriptionContractRecord,
    SubscriptionContractStatus,
} from './subscription-contract.types.js';
import type { CalendarDay } from './zoned-day.js';

/** A rendered confirmation: its bytes, as a file. */
export type ContractConfirmationDocument = InvoiceDocument;

/** What a confirmation is rendered from. */
export interface ContractToConfirm {
    contract: SubscriptionContractRecord;
    /**
     * The lines a business letter of the issuer states, as `config/saas.yaml`
     * names them, where the contract names that issuer; none where it names
     * the copy of another entity (`invoiceFooterOf`).
     */
    footer: readonly string[];
    /** The installation's time zone, which the contract's days are told in. */
    timeZone: string;
}

/**
 * Renders a contract's confirmation — the application's own renderer, or the
 * default one SaaSiCat ships in `@saasicat/invoice-zugferd`.
 *
 * Given the same contract, it renders the same bytes every time, so a repeated
 * attempt archives the file whose checksum was recorded: whatever it would take
 * from the clock, such as a PDF's creation date, it takes from the contract's
 * `createdAt`. It states the whole contract in force — the parties, the plan
 * and the add-ons with their prices and tax treatment, the rhythm, the start,
 * the minimum terms, the notice period and the version of the terms.
 */
export interface ContractConfirmationRenderer {
    render(confirmation: ContractToConfirm): Promise<ContractConfirmationDocument>;
}

/** A confirmation to archive: the file, under its contract, with the checksum recorded for it. */
export interface ContractConfirmationToArchive extends ContractConfirmationDocument {
    contractId: string;
    /** SHA-256 of `content`, lower-case hex. */
    checksum: string;
    archivedAt: Date;
}

/** A confirmation as the archive hands it back. */
export type ArchivedContractConfirmation = ContractConfirmationToArchive;

/** A confirmation on its way to the subscriber. */
export interface ContractConfirmationMail {
    contract: SubscriptionContractRecord;
    /** The invoice email on the subscriber's record. */
    to: string;
    /**
     * The files to attach: the archived confirmation, and the terms of the
     * version the contract records, where it records one.
     */
    documents: readonly InvoiceDocument[];
}

/** Where a contract's confirmation stands. */
export interface ContractConfirmationRecord {
    contractId: string;
    /** SHA-256 of the rendered file, lower-case hex, recorded before it is archived. */
    checksum: string;
    mediaType: string;
    fileName: string;
    /** In bytes. */
    size: number;
    renderedAt: Date;
    /** When the archive confirmed it; `null` while the contract waits for its confirmation. */
    archivedAt: Date | null;
    /**
     * When the run that is mailing it took it on; `null` while no run holds it.
     * A claim older than the lease is taken on by the next run.
     */
    deliveryClaimedAt: Date | null;
    /** When it was handed to the mail; `null` until then. */
    deliveredAt: Date | null;
    /** The address it was sent to. */
    deliveredTo: string | null;
}

/** What is recorded of a rendering before its file is archived. */
export type NewContractConfirmationRendering = Pick<
    ContractConfirmationRecord,
    'checksum' | 'mediaType' | 'fileName' | 'size' | 'renderedAt'
>;

/** Whether a contract is due a confirmation, and where its confirmation stands. */
export interface ContractConfirmationStanding {
    contractId: string;
    /** `false` for a contract written before confirmations existed (`confirmationDue`). */
    due: boolean;
    /** Where its confirmation stands; `null` while none is rendered, and for one not due. */
    confirmation: ContractConfirmationRecord | null;
}

/**
 * The manifest capability that announces the operator's read of a tenant's
 * contracts with their confirmations, and the confirmation's download. The
 * platform sets it where it serves the routes.
 */
export const CONTRACT_CONFIRMATIONS_CAPABILITY = 'contracts.read';

/**
 * Where a contract's confirmation stands, as the operator reads it:
 *
 * - `not-due` — the contract was written before confirmations existed;
 * - `being-made` — due, and not archived yet: rendered or waiting for its
 *   rendering, or held, which the audit log says why;
 * - `awaiting-mail` — archived, and not handed to the mail yet;
 * - `sent` — handed to the mail.
 */
export type AdminContractConfirmationState = 'not-due' | 'being-made' | 'awaiting-mail' | 'sent';

/** A plan or an add-on as a contract froze it: its key in the catalogue, and the title it bore. */
export interface AdminContractSource {
    key: string;
    title: string;
}

/**
 * What a contract changed against the one before it for the same tenant, read
 * from the two as they were frozen and never from today's catalogue.
 */
export interface AdminContractChange {
    /** The first contract of its tenant: concluded rather than changed. */
    concluded: boolean;
    /**
     * Another plan than before: `upgraded` or `downgraded` by the plan's net
     * price per month, `changed` at the same price or in another currency;
     * `null` for the same plan, and for the first contract.
     */
    plan: 'upgraded' | 'downgraded' | 'changed' | null;
    /** The add-ons it carries and the contract before it did not. */
    bundlesAdded: AdminContractSource[];
    /** The add-ons the contract before it carried and it does not. */
    bundlesRemoved: AdminContractSource[];
    /**
     * The same plan and add-ons as before, written anew — its features, its
     * terms or its price frozen again.
     */
    frozenAnew: boolean;
    /** Written anew at another price than the contract before it. */
    priceChanged: boolean;
    /** The last of its tenant, and ended: cancelled to its `effectiveUntil`. */
    cancelled: boolean;
}

/** One of a subscriber's contracts, with where its confirmation stands. */
export interface AdminSubscriberContract {
    id: string;
    /** The tenant it was concluded for, which the timeline groups its contracts by. */
    tenantId: string;
    status: SubscriptionContractStatus;
    /** ISO 8601. When the contract was written. */
    concludedAt: string;
    /** ISO 8601. */
    effectiveFrom: string;
    /** ISO 8601; `null` while it runs open-ended. */
    effectiveUntil: string | null;
    /** The first day it is in force, in the installation's time zone. */
    firstDay: CalendarDay;
    /** The last day it is in force there; `null` while it runs open-ended, and for one never in force. */
    lastDay: CalendarDay | null;
    /**
     * Superseded before it began, as a scheduled change is when another change
     * replaces it first: in force on no day.
     */
    neverInForce: boolean;
    billingCycle: 'monthly' | 'yearly';
    currency: string;
    /** What the contract costs per billing period, tax included. */
    totalGross: number;
    termsVersion: string | null;
    cancellationNoticeDays: number;
    /** The plan it was concluded on, as frozen; `null` for a contract without a plan line. */
    plan: AdminContractSource | null;
    /** The add-ons it carries, as frozen. */
    bundles: AdminContractSource[];
    /** The latest minimum term any of its lines binds to, ISO 8601; `null` where none does. */
    minimumTermUntil: string | null;
    change: AdminContractChange;
    confirmation: {
        state: AdminContractConfirmationState;
        /** ISO 8601; `null` until the archive confirmed it. */
        archivedAt: string | null;
        /** ISO 8601; `null` until the mail took it. */
        deliveredAt: string | null;
        /** The address it was sent to. */
        deliveredTo: string | null;
    };
}

/** A subscriber's contracts, the newest first. */
export interface AdminSubscriberContracts {
    contracts: AdminSubscriberContract[];
}

/**
 * Where the source of a contract line stands in today's catalogue: still in it,
 * removed from it (soft-deleted, so it can come back), or deleted — purged, or
 * a key the catalogue never knew. The line itself is read from what the
 * contract froze; this says only where it came from.
 */
export type AdminContractSourceState = 'in-catalog' | 'removed' | 'deleted';

/** A contract's line, as the contract froze it. */
export interface AdminContractLine {
    id: string;
    kind: ContractLineItemKind;
    /** The plan's or add-on's key in the catalogue. */
    key: string;
    /** The version it was concluded on; `null` where the line names none. */
    versionId: string | null;
    title: string;
    description: string | null;
    quantity: number;
    unit: string | null;
    /** What the line costs over one of its billing periods, `quantity` already in it. */
    priceNet: number;
    priceGross: number;
    /** In percent. */
    taxRate: number;
    taxAmount: number;
    billingCycle: 'monthly' | 'yearly';
    currency: string;
    /** ISO 8601; `null` where the line binds to no minimum term. */
    minimumTermUntil: string | null;
    features: string[];
    quotas: Record<string, number>;
    /**
     * Where its source stands in today's catalogue; `null` for a discount, and
     * where the installation keeps no catalogue to ask.
     */
    source: AdminContractSourceState | null;
}

/**
 * Whether the archived confirmation is the file recorded for it: `intact`;
 * `mismatch`, which no longer matches the checksum recorded when it was
 * rendered and is not handed out; `waiting`, due and not archived yet; or
 * `not-due`, for a contract written before confirmations existed.
 */
export type AdminContractIntegrity = 'intact' | 'mismatch' | 'waiting' | 'not-due';

/** An invoice issued under a contract. */
export interface AdminContractInvoice {
    id: string;
    number: string;
    issueDate: CalendarDay;
    currency: string;
    totalGross: number;
}

/** A contract as it was frozen, with the invoices issued under it and the state of its confirmation. */
export interface AdminSubscriberContractDossier {
    /** The contract as the list of contracts shows it. */
    contract: AdminSubscriberContract;
    /** ISO 8601. When the subscriber agreed to its terms and notice period. */
    agreedAt: string;
    originalOfferId: string | null;
    originalPlanVersionId: string | null;
    originalBundleVersionIds: string[];
    /**
     * The parties were copied by the migration that attached contracts written
     * before subscribers existed, not agreed on the day.
     */
    partiesMigrated: boolean;
    subtotalNet: number;
    discountNet: number;
    totalNet: number;
    /** The plan first, then the add-ons, then the discounts, each in the order the contract holds them. */
    lines: AdminContractLine[];
    /** The latest issue day first. */
    invoices: AdminContractInvoice[];
    integrity: AdminContractIntegrity;
}
