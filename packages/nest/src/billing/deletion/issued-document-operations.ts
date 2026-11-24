// The operations the documents an installation issued were issued in, as the
// documents recorded them: its invoices and its contract confirmations. They
// fix the operation its mark says (`SC-AUD-023`), so both the command that
// marks it and the start that issues invoices read them from here.

import type {
    ContractConfirmationRepository,
    DocumentOperations,
    InstallationOperation,
    RlsBypassPort,
    SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { readAcrossTenants } from '../../admin/read-across-tenants.js';

/**
 * Where the documents are read from: each store answers the operations its
 * documents recorded. A store that is `null` is read as holding none.
 */
export interface IssuedDocumentStores {
    readonly invoices: Pick<SubscriptionInvoiceRepository, 'issuedOperations'>;
    readonly confirmations: Pick<ContractConfirmationRepository, 'recordedOperations'> | null;
}

const NO_DOCUMENTS: DocumentOperations = { test: false, live: false };

/**
 * The operations the documents in `stores` were issued in, together. Read
 * across every tenant, one store after the other: the documents are the
 * installation's, and a frame that lifts row-level security may run on one
 * connection.
 */
export async function issuedOperationsIn(
    stores: IssuedDocumentStores,
    rlsBypass: RlsBypassPort | null,
): Promise<DocumentOperations> {
    return readAcrossTenants(rlsBypass, async () => {
        const invoices = await stores.invoices.issuedOperations();
        const confirmations = stores.confirmations
            ? await stores.confirmations.recordedOperations()
            : NO_DOCUMENTS;
        return {
            test: invoices.test || confirmations.test,
            live: invoices.live || confirmations.live,
        };
    });
}

/** The operation an installation does not operate in where it operates in `operation`. */
export function operationOtherThan(operation: InstallationOperation): InstallationOperation {
    return operation === 'test' ? 'live' : 'test';
}
