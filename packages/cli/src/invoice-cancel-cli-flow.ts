// InvoiceCancelCliFlow — `<app> invoices cancel`.
//
// Cancels an issued invoice by a cancellation invoice and its replacement, on
// the operator's command (`SC-PRIC-095`):
//
//     <app> invoices cancel --tenant acme --invoice AHP-2026-000123 \
//         --reason "The billing address was wrong."          # shows what it writes
//     <app> invoices cancel … --line 2=not-owed --line 3=24.50   # lines not owed in full
//     <app> invoices cancel … --apply                        # writes it
//
// Without `--apply` it writes nothing and draws no number: the preview is the
// command, and the cancellation the second one. `--line` names a line by its
// position on the document, as not owed or with what is still owed of it, net
// (`SC-ADM-035`). `--apply` asks for the second
// factor (`SC-ADM-019`) and, against production, a confirmation; the audit log
// records the operator and the reason (`SC-ADM-020`). The invoice is named by
// the number on its document and the tenant it belongs to.

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    INVOICE_SUBSCRIBER_DETAILS,
    sumToCents,
    type InvoiceCancellationRequest,
    type InvoiceLineOwed,
    type InvoiceSubscriberDetail,
    type NewCorrectionInvoice,
    type RlsBypassPort,
} from '@saasicat/core';
import {
    InvoiceCancellationService,
    RLS_BYPASS_PORT_TOKEN,
    invoiceCancellationAudit,
    type CancelledInvoice,
    type InvoiceCancellationPlan,
} from '@saasicat/nest';
import { AdminResourcesService } from '@saasicat/nest/platform';

import { CliContextService, CliError } from './cli-context.service.js';
import { refusalsAsCliErrors } from './cli-refusals.js';

/** Exit code per `cli-conventions.md` §6. */
const EXIT_USER_ERROR = 1;

/** What `--line` takes for a line none of which is owed. */
const NOT_OWED = 'not-owed';
/** A position on the document: a whole number from 1. */
const POSITION = /^[1-9]\d*$/;
/** An amount as the command line takes it: digits, and at most two decimals after a dot. */
const AMOUNT = /^\d+(?:\.\d{1,2})?$/;

export interface InvoiceCancelOptions {
    as?: string;
    yes?: boolean;
    /** The tenant's slug. */
    tenant?: string;
    /** The invoice's number, as its document names it. */
    invoice?: string;
    /** Why it is cancelled; both invoices name it. */
    reason?: string;
    /** Corrected details of the subscriber, each `field=value`; `field=` clears one. */
    correct?: string[];
    /** Lines not owed in full, each `position=not-owed` or `position=<amount>`. */
    line?: string[];
    /** Where both invoices are sent. */
    deliverTo?: string;
    /** Cancel it; without it nothing is written. */
    apply?: boolean;
}

@Injectable()
export class InvoiceCancelCliFlow {
    constructor(
        @Inject(CliContextService) private readonly ctx: CliContextService,
        @Inject(AdminResourcesService) private readonly tenants: AdminResourcesService,
        @Inject(InvoiceCancellationService)
        private readonly cancellations: InvoiceCancellationService,
        // The command runs outside any request, so nothing else lifts the
        // tenant policy for it: where row-level security is on, the tenant
        // would read as none without it.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    /**
     * What cancelling the invoice would write. Writes nothing and draws no
     * number; asks for the operator's identity, because it reads a tenant's
     * invoices, and for neither the second factor nor a confirmation.
     */
    async preview(options: InvoiceCancelOptions): Promise<InvoiceCancellationPlan> {
        const request = requestOf(options);
        await this.operator(options.as);
        const { tenantId, invoiceId } = await this.invoiceOf(options);
        return refusalsAsCliErrors('INVOICE_CANCELLATION_REFUSED', () =>
            this.cancellations.preview(tenantId, invoiceId, request),
        );
    }

    /**
     * Cancels the invoice, with the second factor and, against production, a
     * confirmation, and records it in the audit log under the operator.
     * Refused as the route refuses: exit code 6 where the invoice was
     * cancelled already, 1 for every other refusal.
     */
    async apply(options: InvoiceCancelOptions): Promise<CancelledInvoice> {
        const request = requestOf(options);
        const identity = this.ctx.resolveIdentity(options.as);
        const user = await this.ctx.ensureSuperAdmin(identity);
        const { tenantId, invoiceId } = await this.invoiceOf(options);
        await this.ctx.requireMfa(user.id);
        await this.ctx.ensureProductionConfirmation({ yes: options.yes });
        const cancelled = await refusalsAsCliErrors('INVOICE_CANCELLATION_REFUSED', () =>
            this.cancellations.cancel(tenantId, invoiceId, request, identity.actor),
        );
        await this.ctx.log({ identity, userId: user.id, ...invoiceCancellationAudit(cancelled) });
        return cancelled;
    }

    /** What the preview shows, for the terminal. */
    formatPreview(plan: InvoiceCancellationPlan): string {
        const { cancelled } = plan;
        return [
            `Invoice ${cancelled.number} of ${cancelled.subscriber.legalName} would be cancelled — ` +
                'nothing is written yet.',
            describe('Cancellation invoice', plan.cancellation),
            ...movedLinesOf(plan),
            ...(plan.replacement
                ? [
                      describe('Replacement', plan.replacement),
                      ...plan.replacement.lines.map(
                          (line) =>
                              `  ${line.position}. ${line.title}: ${line.amountNet.toFixed(2)}` +
                              (line.correctsPosition === null
                                  ? ''
                                  : ` (corrects line ${line.correctsPosition})`),
                      ),
                  ]
                : ['Replacement: none — nothing of the invoice is owed any more.']),
            `Taken over as paid: ${plan.movedIn.toFixed(2)} ${cancelled.currency}` +
                (plan.credited > 0
                    ? `; credited for the operator to refund: ${plan.credited.toFixed(2)}`
                    : ''),
            `Reason: ${plan.reason}`,
            ...(plan.deliverTo ? ['Both invoices go to the address given.'] : []),
            'Run again with --apply to cancel it.',
        ].join('\n');
    }

    /** What the cancellation wrote, for the terminal. */
    formatCancelled(cancelled: CancelledInvoice): string {
        const { cancellationInvoice, replacement } = cancelled;
        const credited = cancelled.credits.reduce(
            (sum, credit) => sumToCents(sum, credit.amount),
            0,
        );
        const refund =
            credited > 0 ? `; credited for the operator to refund: ${credited.toFixed(2)}` : '';
        if (!replacement) {
            return [
                `Cancelled by ${cancellationInvoice.number}; nothing of the invoice is owed any ` +
                    'more, so there is no replacement.',
                `Taken over as paid: 0.00 ${cancellationInvoice.currency}${refund}`,
                'The next run archives the cancellation invoice and sends it.',
            ].join('\n');
        }
        return [
            `Cancelled by ${cancellationInvoice.number}, replaced by ${replacement.number}.`,
            // What was written, which a payment arriving after the preview may
            // have moved: the command line is not held to its preview.
            `Taken over as paid: ${replacement.paidOnIssue.toFixed(2)} ${replacement.currency}${refund}`,
            'The next run archives both and sends them.',
        ].join('\n');
    }

    private async operator(as: string | undefined): Promise<void> {
        await this.ctx.ensureSuperAdmin(this.ctx.resolveIdentity(as));
    }

    /** The tenant's id and the id of its invoice numbered as the options say. */
    private async invoiceOf(
        options: InvoiceCancelOptions,
    ): Promise<{ tenantId: string; invoiceId: string }> {
        const slug = required(options.tenant, '--tenant <slug>');
        const number = required(options.invoice, '--invoice <number>');
        const tenant = await refusalsAsCliErrors('TENANT_NOT_FOUND', () =>
            this.acrossTenants(() => this.tenants.getTenantDetail(slug)),
        );
        const invoiceId = await this.cancellations.invoiceIdNumbered(tenant.id, number);
        if (!invoiceId) {
            throw new CliError(
                'SUBSCRIPTION_INVOICE_NOT_FOUND',
                `Tenant ${slug} has no invoice numbered ${number}.`,
                EXIT_USER_ERROR,
            );
        }
        return { tenantId: tenant.id, invoiceId };
    }

    /** `read` in the bypass frame where one is bound, and plainly where none is. */
    private acrossTenants<T>(read: () => Promise<T>): Promise<T> {
        return this.rlsBypass ? this.rlsBypass.runWithBypass(read) : read();
    }
}

/** What the options give the cancellation; the service settles each part. */
function requestOf(options: InvoiceCancelOptions): InvoiceCancellationRequest {
    return {
        reason: required(options.reason, '--reason "<why>"'),
        corrections: correctionsOf(options.correct ?? []),
        deliverTo: options.deliverTo ?? null,
        lines: linesOf(options.line ?? []),
    };
}

/**
 * `position=not-owed` or `position=<amount>` per line not owed in full. The
 * amount takes a dot: a comma is refused rather than read as a locale would
 * read it, since `1,000` is a thousand to one reader and one to another.
 * Whether the line may be corrected, and to what, the cancellation says.
 */
function linesOf(given: readonly string[]): InvoiceLineOwed[] {
    return given.map((each) => {
        const at = each.indexOf('=');
        const position = each.slice(0, at);
        const owed = each.slice(at + 1);
        if (at > 0 && POSITION.test(position) && owed.includes(',')) {
            throw new CliError(
                'INVOICE_LINE_INVALID',
                `--line takes the amount with a dot and at most two decimals, as 2=24.50 — ` +
                    `got '${each}'.`,
                EXIT_USER_ERROR,
            );
        }
        if (at <= 0 || !POSITION.test(position) || (owed !== NOT_OWED && !AMOUNT.test(owed))) {
            throw new CliError(
                'INVOICE_LINE_INVALID',
                `--line takes <position>=${NOT_OWED} or <position>=<amount>, as 2=${NOT_OWED} ` +
                    `or 2=24.50 — got '${each}'.`,
                EXIT_USER_ERROR,
            );
        }
        return { position: Number(position), owed: owed === NOT_OWED ? 0 : Number(owed) };
    });
}

/** Each line of the cancelled invoice that moves, from what to what, for the terminal. */
function movedLinesOf(plan: InvoiceCancellationPlan): string[] {
    const moved = plan.lines.filter((line) => line.becomes !== line.standsAt);
    if (moved.length === 0) return [];
    return [
        'Lines not owed in full:',
        ...moved.map((line) => {
            const title =
                plan.cancelled.lines.find((each) => each.position === line.position)?.title ?? '';
            return (
                `  ${line.position}. ${title}: ${line.standsAt.toFixed(2)} → ` +
                line.becomes.toFixed(2)
            );
        }),
    ];
}

/** `field=value` per corrected detail; `field=` clears it. */
function correctionsOf(
    given: readonly string[],
): Partial<Record<InvoiceSubscriberDetail, string | null>> {
    const corrections: Partial<Record<InvoiceSubscriberDetail, string | null>> = {};
    for (const each of given) {
        const at = each.indexOf('=');
        const field = INVOICE_SUBSCRIBER_DETAILS.find((detail) => detail === each.slice(0, at));
        if (at <= 0 || !field) {
            throw new CliError(
                'INVOICE_CORRECTION_INVALID',
                `--correct takes field=value with a field of ${INVOICE_SUBSCRIBER_DETAILS.join(', ')} — got '${each}'.`,
                EXIT_USER_ERROR,
            );
        }
        const value = each.slice(at + 1);
        corrections[field] = value === '' ? null : value;
    }
    return corrections;
}

function required(value: string | undefined, flag: string): string {
    if (value === undefined || value.trim() === '') {
        throw new CliError('MISSING_FLAG', `${flag} is required.`, EXIT_USER_ERROR);
    }
    return value;
}

function describe(
    title: string,
    invoice: Pick<NewCorrectionInvoice, 'totalGross' | 'currency' | 'issueDate' | 'dueDate'>,
): string {
    return (
        `${title}: ${invoice.totalGross.toFixed(2)} ${invoice.currency} gross, ` +
        `issued ${invoice.issueDate}, due ${invoice.dueDate}`
    );
}
