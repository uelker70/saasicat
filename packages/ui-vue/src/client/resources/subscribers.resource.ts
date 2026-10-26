// Subscribers, and everything the operator reads about one in its record: its
// standing and tenants, its history and corrections, its account, credits,
// invoices and contracts.
//
// Keyed by the subscriber's id rather than by a tenant's slug, because the
// record outlives the tenant: a subscriber whose tenant was deleted still has
// invoices to cancel and credits to pay out (`SC-ADM-021`). An invoice and a
// contract are reached by their own ids, as their files already were. Each
// operation is served where the manifest announces its capability; elsewhere
// the route answers 404.

import type {
    AdminCancelledInvoice,
    AdminInvoice,
    AdminInvoiceCancellationPlan,
    AdminSubscriberAccount,
    AdminSubscriberContractDossier,
    AdminSubscriberContracts,
    AdminSubscriberCorrected,
    AdminSubscriberCredits,
    AdminSubscriberHistoryEntry,
    AdminSubscriberList,
    AdminSubscriberPayments,
    AdminSubscriberPayout,
    AdminSubscriberRecord,
    InvoiceCancellationRequest,
} from '@saasicat/core';

import { mfaHeader } from '../mfa-header.js';
import { defineResource, type ResourceContext } from './define-resource.js';
import { requestFile, requestJsonBody, type DownloadedFile } from './resource-request.js';

/**
 * A correction of a subscriber's legal identity, as the operator states it:
 * the fields that change — `null` clears a tax identifier — and why. It is
 * always a correction of the same legal entity; a takeover is not an edit.
 */
export interface SubscriberIdentityCorrectionInput {
    legalName?: string;
    vatId?: string | null;
    taxNumber?: string | null;
    reason: string;
}

/** Whether the subscriber acts as a business — `null` for not stated — and why. */
export interface SubscriberBusinessStatusInput {
    business: boolean | null;
    reason: string;
}

/** What one page of the list of subscribers is asked for. */
export interface SubscriberListRequest {
    /** A customer number, a legal name or a VAT number; blank for every subscriber. */
    query?: string;
    /** Only those whose every tenant link is closed. */
    withoutLiveTenant?: boolean;
    /** The subscriber the page before ended with. */
    after?: string;
}

function subscriberUrl(ctx: ResourceContext, id: string): string {
    return `${ctx.apiBase}/subscribers/${encodeURIComponent(id)}`;
}

function invoiceUrl(ctx: ResourceContext, invoiceId: string): string {
    return `${ctx.apiBase}/invoices/${encodeURIComponent(invoiceId)}`;
}

export const subscribersResource = defineResource('subscribers', {
    /**
     * One page of the subscribers, the latest customer number first: every
     * one, those the query matches, or those without a live tenant.
     */
    list: (http, ctx, request: SubscriberListRequest = {}): Promise<AdminSubscriberList> => {
        const query = new URLSearchParams();
        const text = request.query?.trim() ?? '';
        if (text !== '') query.set('q', text);
        if (request.withoutLiveTenant) query.set('withoutLiveTenant', 'true');
        if (request.after) query.set('after', request.after);
        const search = query.toString();
        return requestJsonBody<AdminSubscriberList>(
            http,
            `${ctx.apiBase}/subscribers${search === '' ? '' : `?${search}`}`,
            'The subscribers returned no body',
        );
    },

    /** The head of the subscriber's record: its standing and every tenant it was linked to. */
    record: (http, ctx, id: string): Promise<AdminSubscriberRecord> =>
        requestJsonBody<AdminSubscriberRecord>(
            http,
            subscriberUrl(ctx, id),
            'The subscriber returned no body',
        ),

    /** The subscriber's corrections, changes of country or business status, and checks, the latest first. */
    history: async (http, ctx, id: string): Promise<AdminSubscriberHistoryEntry[]> => {
        const answer = await requestJsonBody<{ entries: AdminSubscriberHistoryEntry[] }>(
            http,
            `${subscriberUrl(ctx, id)}/history`,
            'The history returned no body',
        );
        return answer.entries;
    },

    /**
     * Corrects the subscriber's legal identity — the same legal entity, with a
     * reason. Requires the second factor. A VAT number it gives is checked
     * right after, where a tax adapter decides, and the answer says how.
     */
    correctIdentity: (
        http,
        ctx,
        id: string,
        correction: SubscriberIdentityCorrectionInput,
        mfaCode?: string,
    ): Promise<AdminSubscriberCorrected> =>
        requestJsonBody<AdminSubscriberCorrected>(
            http,
            `${subscriberUrl(ctx, id)}/identity`,
            'The correction returned no body',
            {
                method: 'POST',
                body: { kind: 'correction', ...correction },
                headers: mfaHeader(mfaCode),
            },
        ),

    /** Records whether the subscriber acts as a business, and why. Requires the second factor. */
    changeBusinessStatus: (
        http,
        ctx,
        id: string,
        change: SubscriberBusinessStatusInput,
        mfaCode?: string,
    ): Promise<AdminSubscriberCorrected> =>
        requestJsonBody<AdminSubscriberCorrected>(
            http,
            `${subscriberUrl(ctx, id)}/business-status`,
            'The change returned no body',
            { method: 'POST', body: change, headers: mfaHeader(mfaCode) },
        ),

    /** Checks the VAT number the subscriber holds again, without changing it. */
    checkVatId: (http, ctx, id: string): Promise<AdminSubscriberCorrected> =>
        requestJsonBody<AdminSubscriberCorrected>(
            http,
            `${subscriberUrl(ctx, id)}/vat-id-check`,
            'The check returned no body',
            { method: 'POST' },
        ),

    /**
     * The subscriber's charges, newest first. Served only where the manifest
     * announces `charges.read`.
     */
    charges: (http, ctx, id: string): Promise<AdminSubscriberAccount> =>
        requestJsonBody<AdminSubscriberAccount>(
            http,
            `${subscriberUrl(ctx, id)}/charges`,
            'The account returned no body',
        ),

    /**
     * The subscriber's credits, the oldest first. Served only where the
     * manifest announces `credits.read`.
     */
    credits: (http, ctx, id: string): Promise<AdminSubscriberCredits> =>
        requestJsonBody<AdminSubscriberCredits>(
            http,
            `${subscriberUrl(ctx, id)}/credits`,
            'The credits returned no body',
        ),

    /**
     * Records a payout made outside the gateway against one of the
     * subscriber's credits, and answers the credits as they stand after it.
     * Requires the second factor; served where the manifest announces
     * `credits.payout`.
     */
    recordPayout: (
        http,
        ctx,
        id: string,
        creditId: string,
        payout: AdminSubscriberPayout,
        mfaCode?: string,
    ): Promise<AdminSubscriberCredits> =>
        requestJsonBody<AdminSubscriberCredits>(
            http,
            `${subscriberUrl(ctx, id)}/credits/${encodeURIComponent(creditId)}/payouts`,
            'The payout returned no body',
            { method: 'POST', body: payout, headers: mfaHeader(mfaCode) },
        ),

    /**
     * The subscriber's invoices with what each still owes, and its cases still
     * open to reconcile. Served only where the manifest announces
     * `payments.read`.
     */
    payments: (http, ctx, id: string): Promise<AdminSubscriberPayments> =>
        requestJsonBody<AdminSubscriberPayments>(
            http,
            `${subscriberUrl(ctx, id)}/payments`,
            'The payments returned no body',
        ),

    /**
     * The subscriber's contracts, the newest first, each with where its
     * confirmation stands. Served only where the manifest announces
     * `contracts.read`.
     */
    contracts: (http, ctx, id: string): Promise<AdminSubscriberContracts> =>
        requestJsonBody<AdminSubscriberContracts>(
            http,
            `${subscriberUrl(ctx, id)}/contracts`,
            'The contracts returned no body',
        ),

    /**
     * One of the subscriber's contracts as it was frozen, with where each line
     * came from, the invoices issued under it and whether its archived
     * confirmation is intact (`SC-ADM-041`). Served where the manifest
     * announces `contracts.read`.
     */
    contract: (
        http,
        ctx,
        id: string,
        contractId: string,
    ): Promise<AdminSubscriberContractDossier> =>
        requestJsonBody<AdminSubscriberContractDossier>(
            http,
            `${subscriberUrl(ctx, id)}/contracts/${encodeURIComponent(contractId)}`,
            'The contract returned no body',
        ),

    /**
     * The archived confirmation of one contract, the file its subscriber was
     * sent. Served where the manifest announces `contracts.read`.
     */
    contractConfirmation: (http, ctx, contractId: string): Promise<DownloadedFile> =>
        requestFile(
            http,
            `${ctx.apiBase}/contracts/${encodeURIComponent(contractId)}/confirmation`,
            'contract-confirmation.pdf',
        ),

    /**
     * The archived document of one invoice, the file it was issued as. Served
     * where the manifest announces `invoices.read`.
     */
    invoiceDocument: (http, ctx, invoiceId: string): Promise<DownloadedFile> =>
        requestFile(http, `${invoiceUrl(ctx, invoiceId)}/document`, 'invoice.pdf'),

    /**
     * One invoice with its lines, each with what its charge stands at and
     * whether a cancellation may correct it. Served where the manifest
     * announces `invoices.cancel`.
     */
    invoice: (http, ctx, invoiceId: string): Promise<AdminInvoice> =>
        requestJsonBody<AdminInvoice>(
            http,
            invoiceUrl(ctx, invoiceId),
            'The invoice returned no body',
        ),

    /**
     * What cancelling the invoice would write — the cancellation invoice, the
     * replacement and where what was paid goes —, computed as the cancellation
     * computes it and refused as it is; nothing is written. Served where the
     * manifest announces `invoices.cancel`.
     */
    previewInvoiceCancellation: (
        http,
        ctx,
        invoiceId: string,
        request: InvoiceCancellationRequest,
    ): Promise<AdminInvoiceCancellationPlan> =>
        requestJsonBody<AdminInvoiceCancellationPlan>(
            http,
            `${invoiceUrl(ctx, invoiceId)}/cancellation/preview`,
            'The cancellation preview returned no body',
            { method: 'POST', body: request },
        ),

    /**
     * Cancels the invoice by a cancellation invoice and its replacement.
     * Requires the second factor; the request carries the preview's digest,
     * and a preview that no longer holds is refused with the new one.
     */
    cancelInvoice: (
        http,
        ctx,
        invoiceId: string,
        request: InvoiceCancellationRequest,
        mfaCode?: string,
    ): Promise<AdminCancelledInvoice> =>
        requestJsonBody<AdminCancelledInvoice>(
            http,
            `${invoiceUrl(ctx, invoiceId)}/cancellation`,
            'The cancellation returned no body',
            { method: 'POST', body: request, headers: mfaHeader(mfaCode) },
        ),
});
