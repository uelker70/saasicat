// What a tenant's users holding the billing permission read of their
// subscription: every invoice of the subscriber their tenant belongs to, an
// earlier tenant's joined into it included, each with where it stands, what
// the account adds up to, and the contract confirmations beside them
// (`SC-UI-022`, `SC-UI-024`, `SC-AUD-016`, `SC-PRIC-049`).
//
// The subscriber comes from the session's tenant and never from the request.
// An earlier tenant's invoices keep that tenant's id after a join, so under
// row policies keyed by tenant they are read across the tenant boundary — the
// one read a tenant makes there (`SC-SEC-013`), and only by that subscriber's
// id. A download is checked against the same subscriber first: another
// subscriber's invoice or contract is answered as one that does not exist.

import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    INVOICE_ERROR_CODES,
    TENANT_INVOICE_PAGE_SIZE,
    announcedCollectionDay,
    dayInZone,
    directDebitLeadDaysOf,
    installationZoneOf,
    invoiceStandingsOf,
    tenantAccountOf,
    type InvoiceDocument,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriberPaymentRepository,
    type SubscriberCreditStanding,
    type SubscriberRecord,
    type InvoiceStanding,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceRepository,
    type TenantAccount,
    type TenantContractConfirmations,
    type TenantInvoice,
    type TenantInvoicePage,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { codedError } from '../../errors/coded-error.js';
import { SubscriberService } from '../../subscriber/subscriber.service.js';
import type { OpenInvoiceSource } from '../../tenant-access/tenant-access.service.js';
import {
    ContractConfirmationService,
    contractNotFound,
} from '../confirmations/contract-confirmation.service.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import { SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN } from './invoice-collection.tokens.js';
import { InvoiceDocumentService } from './invoice-document.service.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

@Injectable()
export class TenantInvoiceService implements OpenInvoiceSource {
    constructor(
        @Inject(SubscriberService) private readonly subscribers: SubscriberService,
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(InvoiceDocumentService) private readonly documents: InvoiceDocumentService,
        // Without payments nothing settles an invoice and no credit arises:
        // each is open for what it states.
        @Optional()
        @Inject(SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN)
        private readonly payments: SubscriberPaymentRepository | null = null,
        @Optional()
        @Inject(ContractConfirmationService)
        private readonly confirmations: ContractConfirmationService | null = null,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<
            PlanCatalogSettings,
            'timeZone' | 'invoicing'
        > | null = null,
    ) {}

    /**
     * One page of the invoices of `tenantId`'s subscriber, the newest first,
     * after the invoice `after` names; none for a tenant without a subscriber.
     * The standing of each is read over all of them, as a cancelled invoice and
     * its cancellation invoice may fall on two pages.
     */
    async page(tenantId: string, after?: string): Promise<TenantInvoicePage> {
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        if (!subscriber) return { invoices: [], next: null };
        const invoices = await this.read(() => this.invoices.listBySubscriber(subscriber.id));
        const { standings } = await this.standingsOf(subscriber, invoices);
        const at = after === undefined ? -1 : invoices.findIndex((invoice) => invoice.id === after);
        // A page after an invoice the subscriber does not have is empty, not the first again.
        if (after !== undefined && at === -1) return { invoices: [], next: null };
        const start = at + 1;
        const page = standings.slice(start, start + TENANT_INVOICE_PAGE_SIZE);
        const archived = new Set(
            await this.read(() =>
                this.invoices.listArchivedDocuments(page.map(({ invoice }) => invoice.id)),
            ),
        );
        const last = page.at(-1);
        return {
            invoices: page.map(({ invoice, standing }) => ({
                ...tenantInvoiceOf(invoice),
                ...standing,
                documentArchived: archived.has(invoice.id),
            })),
            next: last && start + page.length < invoices.length ? last.invoice.id : null,
        };
    }

    /**
     * What `tenantId`'s subscriber owes and is owed, per currency, read from
     * the standings its invoice list shows — nothing for a tenant without a
     * subscriber —, and the day a direct debit announced now is collected on.
     */
    async accountOf(tenantId: string, now: Date = new Date()): Promise<TenantAccount> {
        const today = dayInZone(now, installationZoneOf(this.settings));
        const directDebitCollectedOn = announcedCollectionDay(
            today,
            today,
            directDebitLeadDaysOf(this.settings?.invoicing ?? {}),
        );
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        if (!subscriber) return { balances: [], directDebitCollectedOn };
        const invoices = await this.read(() => this.invoices.listBySubscriber(subscriber.id));
        const { standings, credits } = await this.standingsOf(subscriber, invoices);
        return { ...tenantAccountOf(standings, credits), directDebitCollectedOn };
    }

    /**
     * Whether `tenantId`'s subscriber has an invoice that still owes something,
     * as its account shows it: what read-only leaves starting a payment open
     * for (`SC-ADM-052`). Not for a tenant without a subscriber.
     */
    async hasOpenInvoice(tenantId: string): Promise<boolean> {
        const { balances } = await this.accountOf(tenantId);
        return balances.some((balance) => balance.owed > 0);
    }

    /** The archived document of an invoice of `tenantId`'s subscriber; any other is not found. */
    async documentOf(tenantId: string, invoiceId: string): Promise<InvoiceDocument> {
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        const invoice = await this.read(() => this.invoices.findById(invoiceId));
        if (!subscriber || invoice?.subscriberId !== subscriber.id) {
            throw new NotFoundException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND, { invoiceId }),
            );
        }
        return this.documents.documentOf(invoiceId);
    }

    /** The confirmations of `tenantId`'s subscriber's contracts, the newest first. */
    async confirmationsOf(tenantId: string): Promise<TenantContractConfirmations> {
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        if (!subscriber || !this.confirmations) return { confirmations: [] };
        const { contracts } = await this.confirmations.contractsOf(subscriber.id);
        const timeZone = installationZoneOf(this.settings);
        return {
            confirmations: contracts
                .filter(({ confirmation }) => confirmation.state !== 'not-due')
                .map((contract) => ({
                    contractId: contract.id,
                    concludedOn: dayInZone(new Date(contract.concludedAt), timeZone),
                    firstDay: contract.firstDay,
                    planTitle: contract.plan?.title ?? null,
                    archived: contract.confirmation.archivedAt !== null,
                })),
        };
    }

    /** The archived confirmation of a contract of `tenantId`'s subscriber; any other is not found. */
    async confirmationOf(tenantId: string, contractId: string): Promise<InvoiceDocument> {
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        const confirmations = this.confirmations;
        if (!subscriber || !confirmations) throw contractNotFound(contractId);
        const { contracts } = await confirmations.contractsOf(subscriber.id);
        if (!contracts.some((contract) => contract.id === contractId)) {
            throw contractNotFound(contractId);
        }
        return confirmations.confirmationOf(contractId);
    }

    /** Where each of `invoices` stands, and the subscriber's credits it was read from. */
    private async standingsOf(
        subscriber: SubscriberRecord,
        invoices: SubscriptionInvoiceRecord[],
    ): Promise<{
        standings: { invoice: SubscriptionInvoiceRecord; standing: InvoiceStanding }[];
        credits: SubscriberCreditStanding[];
    }> {
        const timeZone = installationZoneOf(this.settings);
        const payments = this.payments;
        const [settlements, credits] = payments
            ? await this.read(() =>
                  Promise.all([
                      payments.listSettlements(invoices.map((invoice) => invoice.id)),
                      payments.listCredits(subscriber.id),
                  ]),
              )
            : [[], []];
        const standings = invoiceStandingsOf(
            { invoices, settlements, credits },
            { today: dayInZone(new Date(), timeZone), timeZone },
        );
        return { standings, credits };
    }

    /** A read of the subscriber's own rows, lifted across the tenants joined into it. */
    private read<T>(work: () => Promise<T>): Promise<T> {
        return readAcrossTenants(this.rlsBypass, work);
    }
}

/** What the tenant's list shows of an invoice beside its standing. */
function tenantInvoiceOf(
    invoice: SubscriptionInvoiceRecord,
): Omit<TenantInvoice, 'cancelledBy' | 'replacedBy' | 'payment' | 'documentArchived'> {
    return {
        id: invoice.id,
        number: invoice.number,
        issueDate: invoice.issueDate,
        servicePeriod: { from: invoice.servicePeriodFrom, until: invoice.servicePeriodUntil },
        dueDate: invoice.dueDate,
        totalGross: invoice.totalGross,
        currency: invoice.currency,
        issuer: { legalName: invoice.issuer.legalName },
        correction: invoice.correction
            ? {
                  kind: invoice.correction.kind,
                  of: {
                      invoiceId: invoice.correction.of.invoiceId,
                      number: invoice.correction.of.number,
                  },
              }
            : null,
    };
}
