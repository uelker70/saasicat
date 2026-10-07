// The run that issues the invoices the charge journal is owed (`SC-PRIC-022`).
//
// It reads the subscriptions with a charge to invoice, page by page, and issues
// one invoice for each group of their charges — the charges booked at the same
// moment under the same contract. An invoice is put together from what holds on
// its issue date: the subscriber as its record stands, the issuer of the
// contract (`SC-PRIC-026`), the treatment the tax adapter decides for the
// subscriber now (`SC-PRIC-043`), the tax by the adapter's rule
// (`SC-PRIC-041`), and its days in the installation's time zone
// (`SC-PRIC-045`). The adapter checks its content before the number is drawn
// (`SC-PRIC-027`), and the store draws the number in the transaction that
// writes the invoice (`SC-PRIC-072`).
//
// A group that cannot be invoiced yet is held rather than guessed at: a
// subscriber whose invoice address has gaps (`SC-PRIC-032`), one the adapter
// supports no treatment for (`SC-PRIC-039`), a contract whose parties nobody
// has confirmed (`SC-AUD-012`), or content the law requires and the invoice
// lacks. Each is logged on every run and written to the audit log once per
// process; the charges wait on no invoice, and the invoice takes the next
// number on the first run after what held it is put right.
//
// Platform-wide, so inside `RlsBypassPort`. Several instances may run it at
// once: a charge another one invoiced first is passed over.

import { HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    INVOICE_ERROR_CODES,
    draftSubscriptionInvoice,
    invoiceContentDraftOf,
    invoiceGroupsOf,
    invoiceIssuerOf,
    isPersistenceRefusal,
    type AppliedSettingsPort,
    type InvoiceGroup,
    type IssuerHistoryStep,
    type NewSubscriptionInvoice,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriptionContractRepository,
    type SubscriptionInvoiceRepository,
    type TaxTreatment,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { AdminAuditService, platformJobActor } from '../../admin/admin-audit.service.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { APPLIED_SETTINGS_PORT_TOKEN } from '../../settings/settings.tokens.js';
import { SubscriberService } from '../../subscriber/subscriber.service.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { TAX_TREATMENTS_TOKEN } from '../../tax/tax.tokens.js';
import type { TaxPeriod, TaxTreatments } from '../../tax/tax-treatments.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** The name the run writes its audit entries under: `job:platform:subscription-invoices`. */
const JOB = 'subscription-invoices';

/** How many subscriptions one page of the run reads. */
const PAGE_SIZE = 100;

/** What holds a group of charges back from its invoice, as a coded refusal says it. */
export interface InvoiceHold {
    code: string;
    params: Record<string, unknown>;
}

/** What a run did. */
export interface SubscriptionInvoiceRun {
    issued: number;
    /** Groups held back by what is missing; each is tried again by the next run. */
    held: number;
    /** Groups that failed for another reason; each is tried again by the next run. */
    failed: number;
}

type GroupOutcome = 'issued' | 'held' | 'failed' | 'taken';

/** Thrown inside a group to hold it; never leaves the service. */
class Held extends Error {
    constructor(readonly hold: InvoiceHold) {
        super(hold.code);
    }
}

@Injectable()
export class SubscriptionInvoiceService {
    private readonly logger = new Logger(SubscriptionInvoiceService.name);
    /**
     * The holds already written to the audit log by this process, so a group
     * held on every run is recorded once rather than every quarter of an hour.
     * A restart records it once more.
     */
    private readonly auditedHolds = new Set<string>();

    constructor(
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: SubscriptionContractRepository,
        @Inject(SubscriberService)
        private readonly subscribers: SubscriberService,
        @Inject(TAX_TREATMENTS_TOKEN)
        private readonly taxes: TaxTreatments,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        // Optional — without the settings record no declared correction of the
        // issuer can be followed, and a contract whose copy names the issuer
        // otherwise than the file does is invoiced under its copy.
        @Optional()
        @Inject(APPLIED_SETTINGS_PORT_TOKEN)
        private readonly appliedSettings: AppliedSettingsPort | null = null,
        // The run is the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    /** Issues every invoice the charge journal is owed at `now`. */
    async issueDue(now: Date): Promise<SubscriptionInvoiceRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const history = await this.issuerHistory();
            const run: SubscriptionInvoiceRun = { issued: 0, held: 0, failed: 0 };
            let after: string | undefined;
            for (;;) {
                const page = await this.invoices.listSubscriptionsWithUninvoicedCharges({
                    limit: PAGE_SIZE,
                    after,
                });
                for (const subscriptionId of page) {
                    const charges = await this.invoices.listUninvoicedCharges(subscriptionId);
                    for (const group of invoiceGroupsOf(charges)) {
                        const outcome = await this.issueGroup(group, now, history);
                        if (outcome !== 'taken') run[outcome] += 1;
                    }
                }
                if (page.length < PAGE_SIZE) return run;
                after = page.at(-1);
            }
        });
    }

    private async issueGroup(
        group: InvoiceGroup,
        now: Date,
        history: readonly IssuerHistoryStep[],
    ): Promise<GroupOutcome> {
        try {
            const invoice = await this.invoiceOf(group, now, history);
            const issued = await this.invoices.issue(invoice);
            this.logger.log(
                `Invoice ${issued.number} issued to subscriber ${issued.subscriberId} for ` +
                    `contract ${issued.contractId}.`,
            );
            return 'issued';
        } catch (error) {
            if (error instanceof Held) {
                await this.held(group, error.hold);
                return 'held';
            }
            if (
                isPersistenceRefusal(error) &&
                error.code === INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CHARGE_INVOICED
            ) {
                return 'taken';
            }
            this.logger.error(
                `The invoice for contract ${group.contractId} booked at ` +
                    `${group.bookedAt.toISOString()} failed; the next run tries again.`,
                error instanceof Error ? error.stack : String(error),
            );
            return 'failed';
        }
    }

    private async invoiceOf(
        group: InvoiceGroup,
        now: Date,
        history: readonly IssuerHistoryStep[],
    ): Promise<NewSubscriptionInvoice> {
        const [first] = group.charges;
        const contract = await this.contracts.findById(group.contractId);
        if (!contract) throw new Error(`Contract ${group.contractId} does not exist.`);
        const copy = contract.issuer;
        if (contract.partiesMigrated || !copy) {
            throw new Held({
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_PARTIES_UNCONFIRMED,
                params: { contractId: contract.id },
            });
        }
        const { parties, origin } = await held(() =>
            this.subscribers.invoicePartyOf(first!.subscriberId),
        );
        const treatment = treatmentOf(
            await held(async () => this.taxes.decide(origin, periodOf(group))),
        );
        const invoicing = this.settings.invoicing!;
        const invoice = draftSubscriptionInvoice({
            group,
            contractLines: contract.lineItems,
            tenantId: first!.tenantId,
            subscriberId: first!.subscriberId,
            subscriber: parties.subscriber,
            issuer: invoiceIssuerOf(copy, parties.issuer, history),
            treatment,
            tax: (lines) => this.taxes.invoiceTax(lines),
            issuedAt: now,
            // Required with a tax adapter, which invoicing requires.
            timeZone: this.settings.timeZone!,
            numberPrefix: invoicing.numberPrefix,
            paymentTermDays: invoicing.paymentTermDays,
        });
        const missing = this.taxes.invoiceContentGaps(invoiceContentDraftOf(invoice));
        if (missing.length > 0) {
            throw new Held({
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CONTENT_INCOMPLETE,
                params: { adapter: treatment.adapter.name, missing: [...missing] },
            });
        }
        return invoice;
    }

    /** The recorded settings changes, the oldest first; none without the record. */
    private async issuerHistory(): Promise<IssuerHistoryStep[]> {
        if (!this.appliedSettings) return [];
        // The port lists them in the order the database numbered them, the
        // latest first. Their `noticedAt` is each recording start's own clock,
        // which can run behind an earlier start's, so it orders nothing.
        return [...(await this.appliedSettings.listChanges())].reverse();
    }

    private async held(group: InvoiceGroup, hold: InvoiceHold): Promise<void> {
        const [first] = group.charges;
        this.logger.warn(
            `The invoice for contract ${group.contractId} booked at ` +
                `${group.bookedAt.toISOString()} is held: ${hold.code} ` +
                `${JSON.stringify(hold.params)}. The next run tries again.`,
        );
        const key = `${group.contractId}|${group.bookedAt.toISOString()}|${hold.code}`;
        if (this.auditedHolds.has(key)) return;
        this.auditedHolds.add(key);
        try {
            await this.audit?.log({
                actor: platformJobActor(JOB),
                entity: 'SubscriptionContract',
                entityId: group.contractId,
                action: 'SUBSCRIPTION_INVOICE_HELD',
                changes: {
                    tenantId: first!.tenantId,
                    subscriberId: first!.subscriberId,
                    subscriptionId: first!.subscriptionId,
                    bookedAt: group.bookedAt.toISOString(),
                    code: hold.code,
                    params: hold.params,
                },
            });
        } catch (error) {
            // The hold stands either way; the lost record of it is said loudly.
            this.logger.error(
                `Writing the audit entry SUBSCRIPTION_INVOICE_HELD for contract ${group.contractId} failed.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

/**
 * Runs `read`, turning a coded `422` — the refusal of a subscriber whose
 * invoice address has gaps, or of a case the tax adapter does not support —
 * into a hold. Anything else comes through: a failing read is not an answer.
 */
async function held<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (error) {
        const coded = codedRefusalOf(error);
        if (coded) throw new Held(coded);
        throw error;
    }
}

function codedRefusalOf(error: unknown): InvoiceHold | null {
    if (!(error instanceof HttpException) || error.getStatus() !== 422) return null;
    const response = error.getResponse() as { code?: unknown; params?: unknown };
    if (typeof response.code !== 'string') return null;
    const params =
        response.params !== null && typeof response.params === 'object'
            ? (response.params as Record<string, unknown>)
            : {};
    return { code: response.code, params };
}

/** The period an invoice's charges cover: from the first start to the last end. */
function periodOf(group: InvoiceGroup): TaxPeriod {
    const starts = group.charges.map((charge) => charge.periodStart.getTime());
    const ends = group.charges.map((charge) => charge.periodEnd.getTime());
    return { from: new Date(Math.min(...starts)), until: new Date(Math.max(...ends)) };
}

function treatmentOf(applied: { treatment: TaxTreatment | null }): TaxTreatment {
    // Invoicing starts only beside a tax adapter, which decides every treatment.
    if (!applied.treatment) throw new Error('No tax adapter decided a treatment for the invoice.');
    return applied.treatment;
}
