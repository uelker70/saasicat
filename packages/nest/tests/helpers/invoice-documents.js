// What an application wires for an invoice's document, in memory: a renderer
// whose bytes depend on nothing but the invoice, an archive that keeps one file
// per invoice and never another, and a mail that takes every message unless a
// test tells it to fail.

import { subscriptionInvoiceDocumentChanged } from '@saasicat/core';

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
 * `failures` with `refusal`, and every collection notice, after failing the
 * first `tellFailures` — of the kind `tellFailing`, where it names one.
 */
export function aMailbox({
    failures = 0,
    refusal = 'the mail server refused the message',
    tellFailures = 0,
    tellFailing = null,
} = {}) {
    let left = failures;
    let tellsLeft = tellFailures;
    const sent = [];
    const told = [];
    return {
        sent,
        /** What the subscriber was told about collecting an invoice, in order. */
        told,
        deliver: async (mail) => {
            if (left > 0) {
                left -= 1;
                throw new Error(refusal);
            }
            sent.push(structuredClone(mail));
        },
        tell: async (mail) => {
            if (tellsLeft > 0 && (tellFailing === null || mail.notice.kind === tellFailing)) {
                tellsLeft -= 1;
                throw new Error(refusal);
            }
            told.push(structuredClone(mail));
        },
    };
}
