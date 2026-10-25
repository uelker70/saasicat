// Cancelling one of a subscriber's invoices from its record, in two steps: the
// operator says why — what of each line is still owed, where not all of it is,
// and, where the invoice named them wrongly, the subscriber's details the
// replacement is to name —, reads what the server says the cancellation will
// write, and confirms that behind the second factor (`SC-ADM-019`,
// `SC-ADM-020`, `SC-ADM-035`). The lines are read when the dialog opens, each
// saying whether the cancellation may correct it, so the dialog offers what
// the server accepts rather than deciding it a second time.
//
// What is confirmed is what was shown (`SC-UI-017`): the cancellation sends
// the request the preview answered, not whatever was entered since; going
// back discards the preview; an answer to a question no longer asked is
// dropped; and the cancellation carries the preview's digest, so the server
// refuses it with the new preview where it would write anything else.
//
// Both steps are a form dialog's `submit`: each rejects on a failure, so the
// dialog keeps what is on screen and shows why, and resolves `null` where
// nothing was written — a preview read, or the second factor not given.
//
// Offered only where the manifest announces it, which the platform does where
// it serves the invoices' documents: an invoice is cancelled once its document
// is archived.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
    INVOICE_CANCEL_CAPABILITY,
    INVOICE_ERROR_CODES,
    SUBSCRIBER_PAYMENTS_CAPABILITY,
    type AdminCancelledInvoice,
    type AdminInvoice,
    type AdminInvoiceCancellationPlan,
    type AdminManifest,
    type AdminSubscriberInvoice,
    type InvoiceCancellationRequest,
} from '@saasicat/core';

import { toAdminError } from '../client/admin-error.js';
import { attachCause } from '../client/attach-cause.js';
import { formatMessage } from '../client/i18n/format.js';
import {
    cancellationRequestOf,
    isAskable,
    isCancellable,
    type InvoiceCancellationDraft,
} from '../client/invoice-cancellation.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import { report } from './report.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';
import type { UiNotify } from './ui-notify.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/**
 * The preview a refusal carries where what the cancellation would write
 * changed since it was shown; `null` for any other failure.
 */
function changedPreviewOf(err: unknown): AdminInvoiceCancellationPlan | null {
    const failure = toAdminError(err);
    if (failure.code !== INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED) {
        return null;
    }
    // SAFETY: the platform refuses with this code only beside the preview it
    // computed for the same request, under `preview`.
    const body = failure.body as { preview?: AdminInvoiceCancellationPlan } | undefined;
    return body?.preview ?? null;
}

/** The invoice operations a cancellation calls, already bound to the shell's client. */
export type InvoiceCancellationResource = Pick<
    Bound<(typeof subscribersResource)['ops']>,
    'invoice' | 'previewInvoiceCancellation' | 'cancelInvoice'
>;

export interface InvoiceCancellationPorts {
    notify: UiNotify;
    /** The page's second-factor prompt; the cancellation asks it for a code. */
    mfa: Pick<MfaPrompt, 'run'>;
    /** Reads again what a cancellation changes: the invoices and the credits. */
    onCancelled: () => unknown;
}

export interface InvoiceCancellationFlow {
    /** Whether the platform serves cancelling; the action is not offered without it. */
    readonly available: ComputedRef<boolean>;
    /** Whether `invoice` is offered for cancelling. */
    canCancel: (invoice: AdminSubscriberInvoice) => boolean;
    /** The invoice being cancelled while the dialog is open. */
    readonly target: Ref<AdminSubscriberInvoice | null>;
    /** The invoice's lines, read when the dialog opens; `null` while closed. */
    readonly invoice: AsyncData<AdminInvoice | null>;
    /** What the cancellation will write, once read — the second step. */
    readonly preview: Ref<AdminInvoiceCancellationPlan | null>;
    open: (invoice: AdminSubscriberInvoice) => void;
    close: () => void;
    /**
     * The first step: reads what `draft` would write, which is the second.
     * Rejects on a refusal; resolves `null`, having asked nothing for a draft
     * that gives no reason or leaves an amount owed in part out.
     */
    ask: (draft: InvoiceCancellationDraft) => Promise<null>;
    /** Back to the first step, the preview discarded. */
    back: () => void;
    /**
     * The second step: cancels as previewed, behind the second factor.
     * Rejects on a failure — with the new preview in place where what it
     * writes changed —, `null` where the second factor was not given.
     */
    cancel: () => Promise<AdminCancelledInvoice | null>;
}

export function useInvoiceCancellation(
    manifest: Ref<AdminManifest | null>,
    invoices: InvoiceCancellationResource,
    ports: InvoiceCancellationPorts,
): InvoiceCancellationFlow {
    const msg = useSaMessages('subscribers');
    const shell = useSaMessages('shell');

    const capable = (capability: string) => manifest.value?.capabilities?.[capability] === true;
    const available = computed(
        () => capable(SUBSCRIBER_PAYMENTS_CAPABILITY) && capable(INVOICE_CANCEL_CAPABILITY),
    );
    const target = ref<AdminSubscriberInvoice | null>(null);
    const preview = ref<AdminInvoiceCancellationPlan | null>(null);
    const invoice = useAsyncData(
        async () => (target.value ? invoices.invoice(target.value.id) : null),
        { initial: null, immediate: false, subject: () => target.value?.id },
    );

    // The request the standing preview answers, which the cancellation sends —
    // not the draft as it is by then.
    let previewed: InvoiceCancellationRequest | null = null;
    // Each question asked; an answer to an earlier one is dropped.
    let asked = 0;

    /** Leaves any question still on its way unanswered, and the preview with it. */
    function abandon(): void {
        asked += 1;
        preview.value = null;
        previewed = null;
    }

    function open(invoice: AdminSubscriberInvoice): void {
        abandon();
        target.value = invoice;
    }

    function close(): void {
        abandon();
        target.value = null;
    }

    async function ask(draft: InvoiceCancellationDraft): Promise<null> {
        const cancelled = target.value;
        if (!cancelled || !isAskable(draft)) return null;
        const question = (asked += 1);
        const request = cancellationRequestOf(draft);
        try {
            const answer = await invoices.previewInvoiceCancellation(cancelled.id, request);
            if (question === asked) {
                preview.value = answer;
                previewed = request;
            }
            return null;
        } catch (err) {
            // A refusal of a question no longer asked says nothing about the
            // one on screen.
            if (question !== asked) return null;
            throw err;
        }
    }

    async function cancel(): Promise<AdminCancelledInvoice | null> {
        const cancelled = target.value;
        const shown = preview.value;
        const request = previewed;
        if (!cancelled || !shown || !request) return null;
        let outcome;
        try {
            outcome = await ports.mfa.run(
                formatMessage(msg.value.payments.mfaCancel, { number: cancelled.number }),
                shell.value.mfa.invalidCode,
                (code) =>
                    invoices.cancelInvoice(
                        cancelled.id,
                        { ...request, previewDigest: shown.digest },
                        code,
                    ),
            );
        } catch (err) {
            const changed = changedPreviewOf(err);
            if (!changed) throw err;
            // What it writes now is shown in place of what it would have
            // written, so the operator confirms what is true rather than what
            // was.
            preview.value = changed;
            throw attachCause(new Error(msg.value.payments.cancelDialog.previewChanged), err);
        }
        if (!outcome.done) return null;
        const { cancellationInvoice, replacement } = outcome.value;
        report(() =>
            ports.notify(
                'positive',
                replacement
                    ? formatMessage(msg.value.payments.cancelled, {
                          cancellation: cancellationInvoice.number,
                          replacement: replacement.number,
                      })
                    : formatMessage(msg.value.payments.cancelledWithoutReplacement, {
                          cancellation: cancellationInvoice.number,
                      }),
            ),
        );
        close();
        await ports.onCancelled();
        return outcome.value;
    }

    return {
        available,
        canCancel: (invoice) => available.value && isCancellable(invoice),
        target,
        invoice,
        preview,
        open,
        close,
        ask,
        back: abandon,
        cancel,
    };
}
