// Canonical row -> record mapping for a contract's confirmation: where it
// stands, and the archived file. Pure, and shared by both adapters, read as
// defensively as an invoice's document (`invoice-document-mapping.ts`).

import type {
    AdminContractConfirmationState,
    ArchivedContractConfirmation,
    ContractConfirmationRecord,
    ContractConfirmationStanding,
} from './contract-confirmation.types.js';
import { CONTRACT_ERROR_CODES } from './error-codes.js';
import { PersistenceRefusal } from './errors.js';
import { isInvoiceDocumentChecksum } from './invoice-document-mapping.js';

const CONFIRMATIONS = 'contract_confirmations';
const ARCHIVE = 'contract_confirmation_archive';

/** A `contract_confirmations` row as either adapter reads it back. */
export interface CanonicalContractConfirmationRow {
    contractId: string;
    checksum: string;
    mediaType: string;
    fileName: string;
    size: unknown;
    renderedAt: Date;
    archivedAt: Date | null;
    deliveryClaimedAt: Date | null;
    deliveredAt: Date | null;
    deliveredTo: string | null;
}

/** A `contract_confirmation_archive` row as either adapter reads it back. */
export interface CanonicalContractConfirmationArchiveRow {
    contractId: string;
    checksum: string;
    mediaType: string;
    fileName: string;
    content: Uint8Array;
    archivedAt: Date;
}

export function toContractConfirmationRecord(
    row: CanonicalContractConfirmationRow,
): ContractConfirmationRecord {
    if (!isInvoiceDocumentChecksum(row.checksum)) {
        throw new Error(`${CONFIRMATIONS}.checksum of ${row.contractId} is not a SHA-256 digest.`);
    }
    const size = Number(row.size);
    if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error(`${CONFIRMATIONS}.size of ${row.contractId} is not a size in bytes.`);
    }
    return { ...row, size };
}

export function toArchivedContractConfirmation(
    row: CanonicalContractConfirmationArchiveRow,
): ArchivedContractConfirmation {
    if (!isInvoiceDocumentChecksum(row.checksum)) {
        throw new Error(`${ARCHIVE}.checksum of ${row.contractId} is not a SHA-256 digest.`);
    }
    if (!(row.content instanceof Uint8Array)) {
        throw new Error(`${ARCHIVE}.content of ${row.contractId} is not a file.`);
    }
    return {
        contractId: row.contractId,
        checksum: row.checksum,
        mediaType: row.mediaType,
        fileName: row.fileName,
        // Bytes of its own, for the reason `toArchivedInvoiceDocument` gives.
        content: new Uint8Array(row.content),
        archivedAt: row.archivedAt,
    };
}

/**
 * The triggers of `contract_confirmation_archive` that keep a confirmation as
 * it was archived (`1.0-a-contract-confirmation-is-archived.postgres.sql`):
 * one refuses every update and delete of a row, the other every truncate.
 */
export const CONFIRMATION_ARCHIVE_TRIGGERS = [
    'contract_confirmation_archive_is_kept',
    'contract_confirmation_archive_is_not_emptied',
] as const;

/**
 * Why the database archive would let a confirmation be changed, given the
 * triggers that fire on its table, or `null` where both of its own do.
 */
export function confirmationArchiveProtectionProblem(
    enabledTriggers: readonly string[],
): string | null {
    const missing = CONFIRMATION_ARCHIVE_TRIGGERS.filter((name) => !enabledTriggers.includes(name));
    if (missing.length === 0) return null;
    return (
        `${ARCHIVE} lacks ${missing.join(' and ')}, which keep an archived contract confirmation ` +
        'as it was archived: run @saasicat/spec/sql/1.0-a-contract-confirmation-is-archived.postgres.sql ' +
        'after db push, and enable the triggers where they were disabled.'
    );
}

/**
 * A confirmation whose checksum is not the one recorded or archived for its
 * contract, refused: the first stays. Only the run replaces a recorded
 * rendering, and only while nothing is archived.
 */
export function contractConfirmationChanged(
    contractId: string,
    recorded: string,
    rendered: string,
): PersistenceRefusal {
    return new PersistenceRefusal(
        CONTRACT_ERROR_CODES.CONTRACT_CONFIRMATION_CHANGED,
        'moved',
        `The confirmation rendered for contract '${contractId}' differs from the one recorded for it.`,
        { contractId, recorded, rendered },
    );
}

/**
 * Where a contract's confirmation stands, as the operator reads it: what its
 * record says, and for a contract without one, whether it is due one.
 */
export function confirmationStateOf(
    standing: ContractConfirmationStanding,
): AdminContractConfirmationState {
    const { confirmation } = standing;
    if (confirmation?.deliveredAt) return 'sent';
    if (confirmation?.archivedAt) return 'awaiting-mail';
    return standing.due || confirmation ? 'being-made' : 'not-due';
}
