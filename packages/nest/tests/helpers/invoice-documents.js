// What an application wires for an invoice's document, in memory: a renderer
// whose bytes depend on nothing but the invoice, an archive that keeps one file
// per invoice and never another, and a mail that takes every message unless a
// test tells it to fail.

import { contractConfirmationChanged, subscriptionInvoiceDocumentChanged } from '@saasicat/core';

/** The file a renderer makes of `invoice` where a test names no other. */
export const documentOf = (invoice) => ({
    content: new TextEncoder().encode(`%PDF-1.7 invoice ${invoice.number}`),
    mediaType: 'application/pdf',
    fileName: `${invoice.number}.pdf`,
});

/** A renderer that records each invoice it renders; `render` replaces what it makes. */
export function aRenderer({ render = documentOf } = {}) {
    const rendered = [];
    return {
        rendered,
        render: async (invoice) => {
            rendered.push(invoice.id);
            return render(invoice);
        },
    };
}

/**
 * The archive, as the database keeps it: one file per invoice, written once.
 * `problem` is what it says would let a file it keeps be changed.
 */
export function anArchive({ problem = null } = {}) {
    const files = new Map();
    const archive = {
        files,
        protectionProblem: async () => problem,
        /** Errors the next stores throw instead of writing, one each. */
        failingStores: [],
        async store(document) {
            const failure = archive.failingStores.shift();
            if (failure) throw failure;
            const kept = files.get(document.invoiceId);
            if (kept && kept.checksum !== document.checksum) {
                throw subscriptionInvoiceDocumentChanged(
                    document.invoiceId,
                    kept.checksum,
                    document.checksum,
                );
            }
            if (!kept) files.set(document.invoiceId, structuredClone(document));
        },
        async read(invoiceId) {
            return structuredClone(files.get(invoiceId) ?? null);
        },
    };
    return archive;
}

/**
 * The application's mail: every invoice it took, after failing the first
 * `failures` with `refusal`, every collection notice, after failing the
 * first `tellFailures` — of the kind `tellFailing`, where it names one — and
 * every one `tellRefuses` answers `true` for, and every contract confirmation.
 */
export function aMailbox({
    failures = 0,
    refusal = 'the mail server refused the message',
    tellFailures = 0,
    tellFailing = null,
    tellRefuses = null,
    confirmationFailures = 0,
} = {}) {
    let left = failures;
    let tellsLeft = tellFailures;
    let confirmationsLeft = confirmationFailures;
    const sent = [];
    const told = [];
    const confirmed = [];
    return {
        sent,
        /** What the subscriber was told about collecting an invoice, in order. */
        told,
        /** Every contract confirmation it took, after failing the first `confirmationFailures`. */
        confirmed,
        deliverConfirmation: async (mail) => {
            if (confirmationsLeft > 0) {
                confirmationsLeft -= 1;
                throw new Error(refusal);
            }
            confirmed.push(structuredClone(mail));
        },
        deliver: async (mail) => {
            if (left > 0) {
                left -= 1;
                throw new Error(refusal);
            }
            sent.push(structuredClone(mail));
        },
        tell: async (mail) => {
            if (tellRefuses?.(mail.notice)) throw new Error(refusal);
            if (tellsLeft > 0 && (tellFailing === null || mail.notice.kind === tellFailing)) {
                tellsLeft -= 1;
                throw new Error(refusal);
            }
            told.push(structuredClone(mail));
        },
    };
}

/** The confirmation a renderer makes of a contract where a test names no other. */
export const confirmationOf = ({ contract }) => ({
    content: new TextEncoder().encode(`%PDF-1.7 confirmation of ${contract.id}`),
    mediaType: 'application/pdf',
    fileName: `contract-${contract.id}.pdf`,
});

/** A confirmation renderer that records what it was asked to render; `render` replaces what it makes. */
export function aConfirmationRenderer({ render = confirmationOf } = {}) {
    const rendered = [];
    return {
        rendered,
        render: async (confirmation) => {
            rendered.push(structuredClone(confirmation));
            return render(confirmation);
        },
    };
}

/** The confirmations' archive, as the database keeps it: one file per contract, written once. */
export function aConfirmationArchive({ problem = null } = {}) {
    const files = new Map();
    return {
        files,
        protectionProblem: async () => problem,
        async store(confirmation) {
            const kept = files.get(confirmation.contractId);
            if (kept && kept.checksum !== confirmation.checksum) {
                throw contractConfirmationChanged(
                    confirmation.contractId,
                    kept.checksum,
                    confirmation.checksum,
                );
            }
            if (!kept) files.set(confirmation.contractId, structuredClone(confirmation));
        },
        async read(contractId) {
            return structuredClone(files.get(contractId) ?? null);
        },
    };
}

/**
 * Where each contract's confirmation stands, in memory, as the persistence
 * contract holds both adapters to keep it: over the contracts `contractIds`
 * names, less the ones written before confirmations.
 */
export function aConfirmationRecord(contractIds, { writtenBefore = [] } = {}) {
    const states = new Map();
    const stateOf = (contractId) => states.get(contractId);
    const page = (ids, { limit, after }) =>
        ids
            .filter((id) => after === undefined || id > after)
            .sort()
            .slice(0, limit);
    return {
        states,
        async recordRendering(contractId, rendering) {
            const kept = stateOf(contractId);
            if (kept && kept.checksum !== rendering.checksum) {
                throw contractConfirmationChanged(contractId, kept.checksum, rendering.checksum);
            }
            if (!kept) {
                states.set(contractId, {
                    contractId,
                    ...rendering,
                    archivedAt: null,
                    deliveryClaimedAt: null,
                    deliveredAt: null,
                    deliveredTo: null,
                });
            }
            return structuredClone(stateOf(contractId));
        },
        async replaceRendering(contractId, rendering, replaced) {
            const kept = stateOf(contractId);
            if (kept?.checksum !== replaced || kept.archivedAt) return null;
            Object.assign(kept, rendering);
            return structuredClone(kept);
        },
        async markArchived(contractId, at, checksum) {
            const kept = stateOf(contractId);
            if (kept?.checksum !== checksum || kept.archivedAt) return false;
            kept.archivedAt = at;
            return true;
        },
        async claimDelivery(contractId, at, staleBefore) {
            const kept = stateOf(contractId);
            if (!kept?.archivedAt || kept.deliveredAt) return false;
            if (kept.deliveryClaimedAt && kept.deliveryClaimedAt >= staleBefore) return false;
            kept.deliveryClaimedAt = at;
            return true;
        },
        async markDelivered(contractId, { claimedAt, at, to }) {
            const kept = stateOf(contractId);
            if (!kept?.archivedAt || kept.deliveredAt) return false;
            if (kept.deliveryClaimedAt?.getTime() !== claimedAt.getTime()) return false;
            Object.assign(kept, { deliveredAt: at, deliveredTo: to });
            return true;
        },
        async releaseDelivery(contractId, claimedAt) {
            const kept = stateOf(contractId);
            if (!kept || kept.deliveredAt) return;
            if (kept.deliveryClaimedAt?.getTime() === claimedAt.getTime()) {
                kept.deliveryClaimedAt = null;
            }
        },
        async find(contractId) {
            return structuredClone(stateOf(contractId) ?? null);
        },
        async listAwaitingConfirmation(at) {
            const due = contractIds().filter((id) => !writtenBefore.includes(id));
            return page(
                due.filter((id) => !stateOf(id)?.archivedAt),
                at,
            );
        },
        async listStandings(ids) {
            const known = new Set(contractIds());
            return [...new Set(ids)]
                .filter((id) => known.has(id))
                .sort()
                .map((contractId) => ({
                    contractId,
                    due: !writtenBefore.includes(contractId),
                    confirmation: structuredClone(stateOf(contractId) ?? null),
                }));
        },
        async listAwaitingDelivery(at) {
            const waiting = [...states.values()].filter(
                (kept) => kept.archivedAt && !kept.deliveredAt,
            );
            return page(
                waiting.map((kept) => kept.contractId),
                at,
            );
        },
    };
}
