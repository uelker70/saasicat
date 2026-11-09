// An invoice unpaid on its due date holds its tenant back to reading, and
// stops once it no longer owes (`SC-PRIC-098`, `SC-ADM-024`).
//
// The quarter-hourly run compares the invoices that hold their tenant back
// with the open `overdue` reasons and records and lifts the difference, so a
// cancellation, a reversal and its giving back, and a subscriber now live for
// another tenant each come right within a run without a path of their own. A
// payment that settles an invoice lifts its reason at once as well, so a tenant
// that pays does not wait for the run.
//
// The tenant held is the one the invoice's subscriber is live for now, not the
// one the invoice was issued in: a join moves the invoices of an earlier
// tenant to the subscriber it joined, and a subscriber without a live tenant
// holds nobody back.
//
// Platform-wide: the invoices are read across tenants, through `RlsBypassPort`.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    dayInZone,
    type CalendarDay,
    installationZoneOf,
    overdueHoldChanges,
    owedWhenReplaced,
    paymentTakenBack,
    unpaidInvoiceHoldsBack,
    type InvoiceCollectionRepository,
    type CollectionAttemptStanding,
    type OverdueInvoice,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriberPaymentRepository,
    type SubscriberRepository,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceRepository,
    type TenantAccessHold,
    type TenantAccessHoldPort,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { platformJobActor } from '../../admin/admin-audit.service.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { actorTagOf } from '../../core/web-audit.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { TENANT_ACCESS_HOLDS_TOKEN } from '../../tenant-access/tenant-access.tokens.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import {
    INVOICE_COLLECTION_REPOSITORY_TOKEN,
    SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN,
} from './invoice-collection.tokens.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** How many open invoices one read of the store returns. */
const OVERDUE_PAGE_SIZE = 200;

/** Who records and lifts the reasons, as the audit log tags a run. */
const OVERDUE_RUN = actorTagOf(platformJobActor('overdue-invoices'));

/** What one comparison changed. */
export interface OverdueInvoiceRun {
    /** Reasons recorded: invoices that hold their tenant back from now on. */
    held: number;
    /** Reasons lifted: invoices that hold their tenant back no longer. */
    lifted: number;
}

@Injectable()
export class OverdueInvoiceService {
    private readonly logger = new Logger(OverdueInvoiceService.name);

    constructor(
        @Inject(SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN)
        private readonly payments: SubscriberPaymentRepository,
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly subscribers: SubscriberRepository,
        @Inject(INVOICE_COLLECTION_REPOSITORY_TOKEN)
        private readonly collections: InvoiceCollectionRepository,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'timeZone'>,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing keeps the reasons then, and nothing
        // enforces them, so there is nothing to record.
        @Optional()
        @Inject(TENANT_ACCESS_HOLDS_TOKEN)
        private readonly holds: TenantAccessHoldPort | null = null,
    ) {}

    /**
     * Records a reason for every invoice that holds its tenant back on `at` —
     * open on or after its due date, and not merely waiting for its first
     * answer — on the tenant its subscriber is live for, and lifts every
     * `overdue` reason whose invoice that no longer describes.
     */
    async holdBackDue(at: Date): Promise<OverdueInvoiceRun> {
        const holds = this.holds;
        if (!holds) return { held: 0, lifted: 0 };
        const overdue = await this.overdueOn(at);
        const heldTenants = await holds.listTenantIdsHeldBy(['overdue']);
        const open = heldTenants.length > 0 ? await holds.listOpenFor(heldTenants) : [];
        const changes = overdueHoldChanges(overdue, open);
        // Another instance running at the same moment may record or lift a
        // reason first; the store answers null then, and it is not counted.
        let held = 0;
        for (const invoice of changes.record) {
            const recorded = await holds.record({
                tenantId: invoice.tenantId,
                kind: 'overdue',
                reference: invoice.invoiceId,
                note: null,
                since: at,
                recordedBy: OVERDUE_RUN,
            });
            if (!recorded) continue;
            // A payment that settled the invoice after it was read as unpaid
            // found no reason to lift, so the reason is held against the
            // invoice as it stands now. Asked after recording: a payment
            // recorded later finds the reason itself, so none of the two
            // orders leaves it standing.
            if (await this.isSettled(invoice.invoiceId)) {
                await holds.lift(recorded.id, at, OVERDUE_RUN);
                continue;
            }
            held += 1;
        }
        let lifted = 0;
        for (const hold of changes.lift) {
            if (await holds.lift(hold.id, at, OVERDUE_RUN)) lifted += 1;
        }
        return { held, lifted };
    }

    /**
     * Lifts the reason `invoiceId` holds its tenant back for, at `at` and as
     * `liftedBy`, where it owes nothing any more — what a payment that settles
     * it does at once rather than leaving to the next run. Returns the reasons
     * lifted.
     */
    async liftSettled(invoiceId: string, at: Date, liftedBy: string): Promise<number> {
        const holds = this.holds;
        if (!holds) return 0;
        if (!(await this.isSettled(invoiceId))) return 0;
        const lifted: TenantAccessHold[] = [];
        for (const hold of await this.reasonsOf(holds, invoiceId)) {
            const done = await holds.lift(hold.id, at, liftedBy);
            if (done) lifted.push(done);
        }
        if (lifted.length > 0) {
            this.logger.log(
                `Invoice ${invoiceId} is settled, and holds its tenant back no longer.`,
            );
        }
        return lifted.length;
    }

    /** Whether `invoiceId` owes nothing any more, as its settlements read now. */
    private async isSettled(invoiceId: string): Promise<boolean> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const owed = await this.payments.owedBy(invoiceId);
            return owed !== null && owed <= 0;
        });
    }

    /** Every invoice that holds its tenant back on `at`, with that tenant. */
    private async overdueOn(at: Date): Promise<OverdueInvoice[]> {
        const today = dayInZone(at, installationZoneOf(this.settings));
        // Every open invoice, the ones not due yet included: one that replaced
        // an invoice refused once it was due holds its tenant back before its
        // own due date, and the rule decides that rather than the store.
        return readAcrossTenants(this.rlsBypass, async () => {
            const invoiceIds: string[] = [];
            let after: string | undefined;
            for (;;) {
                const page = await this.payments.listOpenInvoices(
                    after === undefined
                        ? { limit: OVERDUE_PAGE_SIZE }
                        : { limit: OVERDUE_PAGE_SIZE, after },
                );
                invoiceIds.push(...page.invoices.map(({ invoiceId }) => invoiceId));
                const last = page.invoices.at(-1);
                if (!page.hasMore || !last) break;
                after = last.invoiceId;
            }
            const unpaid = await this.unpaidOf(invoiceIds, today);
            return this.liveTenantsOf(unpaid);
        });
    }

    /**
     * Of the open invoices `invoiceIds`, those that hold their tenant back on
     * `today`, each decided on its own attempts and on those of the invoices it
     * replaced, back to the first that was paid when it was replaced. A
     * payment of a replaced invoice taken back after the cancellation opens
     * the replacement again, and counts against it as a payment of its own
     * taken back, until it is given back.
     */
    private async unpaidOf(
        invoiceIds: readonly string[],
        today: CalendarDay,
    ): Promise<SubscriptionInvoiceRecord[]> {
        if (invoiceIds.length === 0) return [];
        const { chainOf, replacedIn } = await this.chainsOf(invoiceIds);
        const zone = installationZoneOf(this.settings);
        const chained = [...new Set([...chainOf.values()].flat())];
        const records = new Map(
            (await this.invoices.findByIds(chained)).map((invoice) => [invoice.id, invoice]),
        );
        const settlements = await this.payments.listSettlements(chained);
        const settlementsOf = (invoiceId: string) =>
            settlements.filter((settlement) => settlement.invoiceId === invoiceId);
        const attempts = await this.collections.listByInvoices(chained);
        const standingsOf = (invoiceId: string, dueOn: CalendarDay | null) =>
            attempts
                .filter((attempt) => attempt.invoiceId === invoiceId)
                .map((attempt): CollectionAttemptStanding => ({
                    status: attempt.status,
                    sentOn: attempt.submittedAt ? dayInZone(attempt.submittedAt, zone) : null,
                    dueOn,
                }));
        /** An invoice of a chain that still owed when it was replaced, with when that was. */
        const owingWhenReplaced = (invoiceId: string) => {
            const invoice = records.get(invoiceId);
            const replaced = replacedIn.get(invoiceId);
            if (!invoice || !replaced) return null;
            const owed = owedWhenReplaced(invoice.totalGross, settlementsOf(invoiceId), replaced);
            return owed > 0 ? { invoice, replaced } : null;
        };
        return invoiceIds.flatMap((invoiceId) => {
            const invoice = records.get(invoiceId);
            if (!invoice) return [];
            const standings = standingsOf(invoiceId, invoice.dueDate);
            if (paymentTakenBack(settlementsOf(invoiceId))) {
                standings.push({ status: 'REVERSED', sentOn: null, dueOn: invoice.dueDate });
            }
            // Back through the invoices it replaced, as far as the first that
            // was paid when it was replaced: a refusal before that was made good.
            for (const earlier of (chainOf.get(invoiceId) ?? [invoiceId]).slice(1)) {
                const owing = owingWhenReplaced(earlier);
                if (!owing) break;
                const cameDue =
                    owing.invoice.dueDate <= dayInZone(owing.replaced.cancelledAt, zone);
                standings.push(...standingsOf(earlier, cameDue ? owing.invoice.dueDate : null));
            }
            return unpaidInvoiceHoldsBack(invoice.dueDate, standings, today) ? [invoice] : [];
        });
    }

    /**
     * Each of `invoiceIds` with itself and every invoice it replaced, through
     * as many cancellations as led to it, and the cancellation that replaced
     * each of those: a refusal of an invoice cancelled since still counts
     * against the invoice that took its place.
     */
    private async chainsOf(invoiceIds: readonly string[]): Promise<{
        chainOf: Map<string, string[]>;
        replacedIn: Map<string, { cancellationId: string; cancelledAt: Date }>;
    }> {
        const replacedBy = new Map<string, string>();
        const replacedIn = new Map<string, { cancellationId: string; cancelledAt: Date }>();
        const seen = new Set(invoiceIds);
        let frontier = [...invoiceIds];
        while (frontier.length > 0) {
            const asked = new Set(frontier);
            const next: string[] = [];
            for (const cancellation of await this.invoices.listCancellations(frontier)) {
                const replacement = cancellation.replacementInvoiceId;
                if (replacement === null || !asked.has(replacement)) continue;
                replacedBy.set(replacement, cancellation.cancelledInvoiceId);
                replacedIn.set(cancellation.cancelledInvoiceId, {
                    cancellationId: cancellation.id,
                    cancelledAt: cancellation.cancelledAt,
                });
                if (seen.has(cancellation.cancelledInvoiceId)) continue;
                seen.add(cancellation.cancelledInvoiceId);
                next.push(cancellation.cancelledInvoiceId);
            }
            frontier = next;
        }
        const chainOf = new Map(
            invoiceIds.map((invoiceId) => {
                const chain = [invoiceId];
                for (
                    let earlier = replacedBy.get(invoiceId);
                    earlier !== undefined && !chain.includes(earlier);
                    earlier = replacedBy.get(earlier)
                ) {
                    chain.push(earlier);
                }
                return [invoiceId, chain];
            }),
        );
        return { chainOf, replacedIn };
    }

    /** Each of `invoices` with the tenant its subscriber is live for; one without is left out. */
    private async liveTenantsOf(
        invoices: readonly SubscriptionInvoiceRecord[],
    ): Promise<OverdueInvoice[]> {
        if (invoices.length === 0) return [];
        const subscribers = await this.subscribers.findByIds([
            ...new Set(invoices.map((invoice) => invoice.subscriberId)),
        ]);
        const liveTenant = new Map(
            subscribers.map((subscriber) => [subscriber.id, subscriber.tenantId]),
        );
        return invoices.flatMap((invoice) => {
            const tenantId = liveTenant.get(invoice.subscriberId);
            return tenantId ? [{ invoiceId: invoice.id, tenantId }] : [];
        });
    }

    /**
     * The open reasons `invoiceId` holds a tenant back for, on the tenant its
     * subscriber is live for — the one the run holds back —, and those of the
     * invoices it replaced, which a run may not have moved onto it yet: paying
     * it pays what they were held back for. Read for that tenant alone, so a
     * payment costs the same however many tenants are held back; a reason left
     * on a tenant the subscriber has left is the next run's to lift.
     */
    private async reasonsOf(
        holds: TenantAccessHoldPort,
        invoiceId: string,
    ): Promise<TenantAccessHold[]> {
        const { held, chain } = await readAcrossTenants(this.rlsBypass, async () => {
            const [tenant] = await this.liveTenantsOf(await this.invoices.findByIds([invoiceId]));
            const { chainOf } = await this.chainsOf([invoiceId]);
            return { held: tenant, chain: chainOf.get(invoiceId) ?? [invoiceId] };
        });
        if (!held) return [];
        return (await holds.listOpen(held.tenantId)).filter(
            (hold) =>
                hold.kind === 'overdue' &&
                hold.reference !== null &&
                chain.includes(hold.reference),
        );
    }
}
