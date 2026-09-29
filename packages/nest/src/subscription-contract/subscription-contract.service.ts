import {
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import type {
    CheckoutOfferLineItem,
    CheckoutOfferRow,
    ContractLineItemRecord,
    CreateSubscriptionContractData,
    SubscriptionContractParties,
    InvoiceLineItemSnapshot,
    NewContractLineItemData,
    SubscriptionContractInvoiceSnapshot,
    SubscriptionContractPriceSnapshot,
    SubscriptionContractRecord,
    SubscriptionContractRepository,
    TerminateSubscriptionContractData,
    TransactionContext,
    TransactionRunner,
} from '@saasicat/core';

import { appendImplicitDiscountLineItem } from '../checkout-offer/discount-line-items.js';
import { SubscriberService } from '../subscriber/subscriber.service.js';
import { answeringRefusals } from '../errors/answering-refusals.js';
import { round2 } from '../promo/math.js';
import {
    type PricedContractLineItem,
    recordContractLinesMoney,
} from './contract-line-item-money.js';
import {
    CONTRACT_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
} from './subscription-contract.tokens.js';
import {
    assertContractWindow,
    assertLinesAddUp,
    assertNoNegativeDiscount,
    assertOnePlanLine,
    assertTaxRatePercent,
} from './contract-refusals.js';
import { ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES, CONTRACT_ERROR_CODES } from '@saasicat/core';

/** What ending a contract asks of it, whoever's contract it is. */
type ContractTermination = Omit<TerminateSubscriptionContractData, 'tenantId'>;

/**
 * How often a successor is written against the contract in force read again,
 * after the first one moved in between. One race — a plan change beside an
 * operator's refresh — needs a second look; a third would be two writers
 * taking turns.
 */
export const SUCCESSOR_ATTEMPTS = 2;

/** The refusal after the contract in force moved on every attempt. */
export function contractChanged(tenantId: string): ConflictException {
    return new ConflictException({
        code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_CHANGED,
        message:
            `The contracts of tenant '${tenantId}' changed while a successor was being written, ` +
            'or one begins after the moment it would take effect, so it would run beside ' +
            'another. Nothing was written.',
        params: { tenantId },
    });
}

/** A recorded line as the data that writes it: everything but what the store assigned. */
function lineDataOf(line: ContractLineItemRecord): NewContractLineItemData {
    const { id: _id, contractId: _contractId, createdAt: _createdAt, ...data } = line;
    return data;
}

function partiesOf(contract: SubscriptionContractRecord): SubscriptionContractParties {
    return {
        subscriberId: contract.subscriberId,
        subscriber: { ...contract.subscriber },
        issuer: contract.issuer ? { ...contract.issuer } : null,
    };
}

export interface CreateContractFromOfferOptions {
    tenantId: string;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
    status?: CreateSubscriptionContractData['status'];
    entitlementSnapshot?: CreateSubscriptionContractData['entitlementSnapshot'];
    termsSnapshot?: Record<string, unknown> | null;
}

export interface SuccessorOptions {
    /**
     * Take the parties over from the contract replaced instead of copying them
     * afresh from the subscriber and `config/saas.yaml` — for a successor that
     * changes what the contract grants and not who it is between. A copy the
     * migration made stays marked as one.
     */
    keepParties?: boolean;
}

@Injectable()
export class SubscriptionContractService {
    constructor(
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly repo: SubscriptionContractRepository,
        // tsup build has no emitDecoratorMetadata — class type args explicitly @Inject.
        @Inject(SubscriberService)
        private readonly subscribers: SubscriberService,
        @Optional()
        @Inject(CONTRACT_TRANSACTION_RUNNER_TOKEN)
        private readonly transactions: TransactionRunner | null = null,
    ) {}

    list(filter: Parameters<SubscriptionContractRepository['list']>[0]) {
        return this.repo.list(filter);
    }

    async getById(contractId: string): Promise<SubscriptionContractRecord> {
        const row = await this.repo.findById(contractId);
        if (!row) throw contractNotFound(contractId);
        return row;
    }

    async findActiveByTenantId(
        tenantId: string,
        asOf = new Date(),
    ): Promise<SubscriptionContractRecord | null> {
        return this.repo.findActiveByTenantId(tenantId, asOf);
    }

    findById(contractId: string): Promise<SubscriptionContractRecord | null> {
        return this.repo.findById(contractId);
    }

    /**
     * The contract restated as the data that writes it — its lines, prices,
     * snapshots and window as they are. What a successor that changes one
     * thing starts from, so that everything else is copied rather than
     * recomposed.
     */
    dataOf(contract: SubscriptionContractRecord): CreateSubscriptionContractData {
        return this.cloneCreateData({
            tenantId: contract.tenantId,
            status: contract.status,
            effectiveFrom: contract.effectiveFrom,
            effectiveUntil: contract.effectiveUntil,
            originalOfferId: contract.originalOfferId,
            originalPlanVersionId: contract.originalPlanVersionId,
            originalBundleVersionIds: contract.originalBundleVersionIds,
            entitlementSnapshot: contract.entitlementSnapshot,
            priceSnapshot: { ...contract.priceSnapshot },
            promotionSnapshots: contract.promotionSnapshots,
            promoCodeSnapshots: contract.promoCodeSnapshots,
            termsSnapshot: contract.termsSnapshot,
            lineItems: contract.lineItems.map(lineDataOf),
        });
    }

    async getActiveInvoiceSnapshotForTenant(
        tenantId: string,
        asOf = new Date(),
    ): Promise<SubscriptionContractInvoiceSnapshot> {
        const contract = await this.repo.findActiveByTenantId(tenantId, asOf);
        if (!contract) {
            throw new NotFoundException({
                code: CONTRACT_ERROR_CODES.NO_ACTIVE_SUBSCRIPTION_CONTRACT,
                message: `No active subscription contract for tenant ${tenantId}`,
                params: { tenantId, asOf: asOf.toISOString() },
            });
        }
        return subscriptionContractToInvoiceSnapshot(contract);
    }

    /**
     * Writes the contract between the tenant's subscriber and the issuer
     * `config/saas.yaml` names, copying both as they stand. With `tx`, the
     * contract is written on that transaction and undone with it, and the
     * subscriber is read there too — so one created earlier on the same
     * transaction is found.
     *
     * Refused with `SUBSCRIBER_REQUIRED` for a tenant without a subscriber:
     * nothing is agreed without the party to it.
     */
    async create(
        data: CreateSubscriptionContractData,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord> {
        this.assertCreateData(data);
        const parties = await this.subscribers.contractPartiesFor(data.tenantId, tx);
        return this.repo.create({ ...this.cloneCreateData(data), parties }, tx);
    }

    /**
     * Refuses, with `SUBSCRIBER_REQUIRED`, a contract this tenant could not
     * have. For callers that change something before the contract is written —
     * closing the one in force, changing a plan — and must refuse before that
     * rather than after.
     */
    async assertPartyFor(tenantId: string, tx?: TransactionContext): Promise<void> {
        await this.subscribers.requireForTenant(tenantId, tx);
    }

    /** The contract concluded from a checkout offer, or `null` when none was. */
    findByOriginalOfferId(
        offerId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord | null> {
        return this.repo.findByOriginalOfferId(offerId, tx);
    }

    /**
     * Ends a contract of the tenant the caller acts for. Another tenant's
     * contract answers as one that does not exist — not the caller's to end,
     * nor to learn of — and the store draws the same line again in its write.
     */
    async terminate(
        contractId: string,
        data: TerminateSubscriptionContractData,
    ): Promise<SubscriptionContractRecord> {
        const existing = await this.getById(contractId);
        if (existing.tenantId !== data.tenantId) throw contractNotFound(contractId);
        this.assertTerminable(existing, data);
        return answeringRefusals(() => this.repo.terminate(contractId, data));
    }

    async replaceActiveContract(
        tenantId: string,
        data: CreateSubscriptionContractData,
        terminateAt: Date,
    ): Promise<{ previous: SubscriptionContractRecord | null; next: SubscriptionContractRecord }> {
        const nextData = { ...data, tenantId, effectiveFrom: data.effectiveFrom ?? terminateAt };
        for (let attempt = 0; attempt < SUCCESSOR_ATTEMPTS; attempt++) {
            const previous = await this.repo.findActiveByTenantId(tenantId, terminateAt);
            const next = await this.writeSuccessor(previous, nextData, terminateAt);
            if (next) return { previous, next };
        }
        throw contractChanged(tenantId);
    }

    /**
     * Writes `next` as the successor of `previous`, which ends at `at` as
     * `superseded` — both on one transaction where the installation binds a
     * runner, and only while `previous` is still as the caller read it. `null`,
     * with nothing written, where it moved in between: another successor took
     * its place, or a cancellation capped it. The caller reads again and
     * decides afresh, because what it composed was measured against a contract
     * that is no longer the one in force.
     *
     * With no contract to replace, it writes only where no contract of the
     * tenant runs from `at` on. Finding none in force at `at` is not the same
     * as finding none: another writer whose moment came a little later may
     * have superseded the contract and written its successor from that later
     * moment, and an open-ended successor from `at` would then run beside it.
     * That check sees the other writer's successor only where its two writes
     * land together, which takes the transaction runner; without one it can
     * look between them and find nothing.
     *
     * Everything that can refuse `next` is asked before either write, so a
     * refusal never lands after the contract it replaces has ended.
     */
    async writeSuccessor(
        previous: SubscriptionContractRecord | null,
        next: CreateSubscriptionContractData,
        at: Date,
        options: SuccessorOptions = {},
    ): Promise<SubscriptionContractRecord | null> {
        this.assertCreateData(next);
        if (previous && previous.tenantId !== next.tenantId) {
            throw new Error(
                `A successor for tenant '${next.tenantId}' cannot replace contract '${previous.id}', ` +
                    `which belongs to tenant '${previous.tenantId}'.`,
            );
        }
        if (previous) this.assertTerminable(previous, { effectiveUntil: at, status: 'superseded' });
        const kept = options.keepParties && previous ? previous : null;
        if (!kept) await this.assertPartyFor(next.tenantId);
        const write = async (
            tx?: TransactionContext,
        ): Promise<SubscriptionContractRecord | null> => {
            if (previous) {
                const superseded = await this.repo.supersede(
                    previous.id,
                    { tenantId: next.tenantId, at, readEffectiveUntil: previous.effectiveUntil },
                    tx,
                );
                if (!superseded) return null;
            } else if (await this.runsFrom(next.tenantId, at)) {
                return null;
            }
            const parties = kept
                ? partiesOf(kept)
                : await this.subscribers.contractPartiesFor(next.tenantId, tx);
            return this.repo.create(
                {
                    ...this.cloneCreateData(next),
                    parties,
                    ...(kept ? { partiesMigrated: kept.partiesMigrated } : {}),
                },
                tx,
            );
        };
        return this.transactions ? this.transactions.run(write) : write();
    }

    /** Whether a contract of the tenant is in force at `at` or begins after it. */
    private async runsFrom(tenantId: string, at: Date): Promise<boolean> {
        const contracts = await this.repo.list({ tenantId });
        return contracts.some(
            (contract) =>
                ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES.includes(contract.status) &&
                (contract.effectiveUntil === null || contract.effectiveUntil > at),
        );
    }

    createDataFromOffer(
        offer: CheckoutOfferRow,
        options: CreateContractFromOfferOptions,
    ): CreateSubscriptionContractData {
        if (offer.status !== 'consumed') {
            throw new ConflictException({
                code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_NOT_CONSUMED,
                message: `CheckoutOffer '${offer.id}' must be consumed before the contract is created`,
                params: { offerId: offer.id, status: offer.status },
            });
        }
        return this.dataFromOffer(offer, options);
    }

    /**
     * The contract an offer becomes, checked the way `create` checks it, before
     * anything is written. Unlike `createDataFromOffer` it takes an offer that
     * is still open: concluding an offer refuses a contract it could not create
     * before the offer is consumed, rather than after.
     */
    prepareFromOffer(
        offer: CheckoutOfferRow,
        options: CreateContractFromOfferOptions,
    ): CreateSubscriptionContractData {
        const data = this.dataFromOffer(offer, options);
        this.assertCreateData(data);
        return data;
    }

    private dataFromOffer(
        offer: CheckoutOfferRow,
        options: CreateContractFromOfferOptions,
    ): CreateSubscriptionContractData {
        const lineItems = this.lineItemsFromOffer(offer);
        return {
            tenantId: options.tenantId,
            status: options.status ?? 'active',
            effectiveFrom: options.effectiveFrom,
            effectiveUntil: options.effectiveUntil ?? null,
            originalOfferId: offer.id,
            originalPlanVersionId: offer.planVersionId,
            originalBundleVersionIds: [...(offer.bundleVersionIds ?? [])],
            entitlementSnapshot: options.entitlementSnapshot ?? null,
            priceSnapshot: this.priceSnapshotFromOffer(offer),
            promotionSnapshots: [...(offer.promotionSnapshots ?? [])],
            promoCodeSnapshots: offer.promoCodeSnapshot ? [offer.promoCodeSnapshot] : [],
            termsSnapshot: options.termsSnapshot ?? null,
            lineItems,
        };
    }

    async createFromOffer(
        offer: CheckoutOfferRow,
        options: CreateContractFromOfferOptions,
    ): Promise<SubscriptionContractRecord> {
        return this.create(this.createDataFromOffer(offer, options));
    }

    private lineItemsFromOffer(offer: CheckoutOfferRow): NewContractLineItemData[] {
        const source = offer.lineItems ?? [];
        if (source.length === 0) {
            throw new UnprocessableEntityException({
                code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_LINE_ITEMS_REQUIRED,
                message:
                    'A checkout offer can yield only one contract, and only once its line items are frozen.',
            });
        }
        const lines = appendImplicitDiscountLineItem({
            billingCycle: offer.billingCycle,
            priceBreakdown: offer.priceBreakdown,
            lineItems: source,
            promotionSnapshots: offer.promotionSnapshots ?? [],
            promoCodeSnapshot: offer.promoCodeSnapshot ?? null,
        }).map((item) => this.offerLineItemToContractLineItem(item));
        // From the offer's own breakdown rather than today's catalogue: the
        // offer froze the currency and the rate at the moment it was made, and
        // a contract concluded at 19 % is charged 19 % for its term whatever
        // the configured rate becomes afterwards.
        return recordContractLinesMoney(lines, {
            currency: offer.priceBreakdown.currency,
            taxRate: offer.priceBreakdown.vatRate,
        });
    }

    private offerLineItemToContractLineItem(item: CheckoutOfferLineItem): PricedContractLineItem {
        return {
            kind: item.kind,
            sourceKey: item.sourceKey,
            sourceVersionId: item.sourceVersionId ?? null,
            titleSnapshot: item.titleSnapshot,
            descriptionSnapshot: item.descriptionSnapshot ?? null,
            quantity: item.quantity,
            unit: item.unit ?? null,
            priceNet: item.priceNet,
            billingCycle: item.billingCycle,
            minimumTermUntil: this.parseOptionalDate(
                item.minimumTermUntil,
                'lineItems.minimumTermUntil',
            ),
            featuresSnapshot: [...(item.featuresSnapshot ?? [])],
            quotaEffectsSnapshot: { ...(item.quotaEffectsSnapshot ?? {}) },
            metadata: item.metadata ?? null,
        };
    }

    private parseOptionalDate(value: string | Date | null | undefined, field: string): Date | null {
        if (value === null || value === undefined) return null;
        const date = value instanceof Date ? new Date(value) : new Date(value);
        if (Number.isNaN(date.getTime())) {
            throw new UnprocessableEntityException({
                code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_INVALID_DATE,
                message: `${field} must be a valid date.`,
                params: { field },
            });
        }
        return date;
    }

    private priceSnapshotFromOffer(offer: CheckoutOfferRow): SubscriptionContractPriceSnapshot {
        const breakdown = offer.priceBreakdown;
        return {
            currency: breakdown.currency,
            billingCycle: breakdown.billingCycle,
            subtotalNet: breakdown.regularNet,
            discountNet: Math.max(0, round2(breakdown.regularNet - breakdown.effectiveNet)),
            totalNet: breakdown.effectiveNet,
            vatRate: breakdown.vatRate,
            totalGross: breakdown.effectiveGross,
        };
    }

    private assertCreateData(data: CreateSubscriptionContractData): void {
        if (data.lineItems.length === 0) {
            throw new UnprocessableEntityException({
                code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED,
                message: 'A subscription contract requires at least one line item.',
            });
        }
        assertContractWindow(data.effectiveFrom, data.effectiveUntil ?? null);
        assertOnePlanLine(data.lineItems);
        // Every tax rate is a percentage, the contract's and each line's. This is
        // the one door every contract goes through — frozen from the catalogue,
        // concluded from an offer, or handed over by a caller — so the rule is
        // held here rather than on each way in.
        assertTaxRatePercent('priceSnapshot.vatRate', data.priceSnapshot.vatRate);
        data.lineItems.forEach((item, index) =>
            assertTaxRatePercent(`lineItems[${index}].taxRate`, item.taxRate),
        );
        // The tax a line records has to close the gap between its own net and
        // gross. Both platform paths compute it that way, so this only ever
        // catches a caller supplying its own line items — but a contract is
        // append-only, so a line that disagrees with itself is a wrong number
        // nobody can correct afterwards, and the field says in as many words
        // that it cannot happen. An exact comparison rather than a tolerance:
        // both amounts are already held to two places, so the gap between them
        // is not an approximation of anything.
        // And in the currency the contract was priced in. An installation sells
        // in one currency, so a line in another is not a mixed-currency
        // contract — it is a contract whose header and lines disagree, and the
        // invoice projection would state one in its total and the other on
        // every line. Append-only, so neither can be corrected afterwards.
        const foreign = data.lineItems.find(
            (item) => item.currency !== data.priceSnapshot.currency,
        );
        if (foreign) {
            throw new UnprocessableEntityException({
                code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH,
                message: 'A line item must be booked in the currency its contract was priced in.',
                params: {
                    sourceKey: foreign.sourceKey,
                    currency: foreign.currency,
                    expected: data.priceSnapshot.currency,
                },
            });
        }
        const contradictory = data.lineItems.find(
            (item) => round2(item.priceGross - item.priceNet) !== round2(item.taxAmount),
        );
        if (contradictory) {
            throw new UnprocessableEntityException({
                code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH,
                message: "A line item's taxAmount must be exactly priceGross minus priceNet.",
                params: {
                    sourceKey: contradictory.sourceKey,
                    taxAmount: contradictory.taxAmount,
                    expected: round2(contradictory.priceGross - contradictory.priceNet),
                },
            });
        }
        // And the lines together have to be the contract: its totals are what
        // is charged, its lines are what an invoice itemises, and a document
        // whose lines come to a cent more or less than its total is one an
        // auditor cannot reconcile. Both platform paths share the tax out so
        // they always add up; a caller building its own lines does it with
        // `recordContractLinesMoney` and `contractTotalsOf`.
        assertLinesAddUp(data.lineItems, data.priceSnapshot);
        assertNoNegativeDiscount(data);
    }

    private assertTerminable(
        existing: SubscriptionContractRecord,
        data: ContractTermination,
    ): void {
        if (existing.status === 'terminated' || existing.status === 'superseded') {
            throw new ConflictException({
                code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_ALREADY_CLOSED,
                message: `SubscriptionContract '${existing.id}' is already closed`,
                params: { contractId: existing.id, status: existing.status },
            });
        }
        if (data.effectiveUntil <= existing.effectiveFrom) {
            throw new UnprocessableEntityException({
                code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START,
                message: 'effectiveUntil must be after the effectiveFrom of the contract.',
            });
        }
    }

    private cloneCreateData(data: CreateSubscriptionContractData): CreateSubscriptionContractData {
        return {
            ...data,
            originalBundleVersionIds: [...(data.originalBundleVersionIds ?? [])],
            promotionSnapshots: [...(data.promotionSnapshots ?? [])],
            promoCodeSnapshots: [...(data.promoCodeSnapshots ?? [])],
            termsSnapshot: data.termsSnapshot ? { ...data.termsSnapshot } : null,
            lineItems: data.lineItems.map((item) => this.cloneLineItemData(item)),
        };
    }

    private cloneLineItemData(item: NewContractLineItemData): NewContractLineItemData {
        return {
            ...item,
            featuresSnapshot: [...item.featuresSnapshot],
            quotaEffectsSnapshot: { ...item.quotaEffectsSnapshot },
            metadata: item.metadata ? { ...item.metadata } : null,
        };
    }
}

export function contractLineItemToInvoiceLineItem(
    item: ContractLineItemRecord,
): InvoiceLineItemSnapshot {
    return {
        sourceContractLineItemId: item.id,
        sourceKey: item.sourceKey,
        sourceVersionId: item.sourceVersionId,
        kind: item.kind,
        title: item.titleSnapshot,
        description: item.descriptionSnapshot,
        quantity: item.quantity,
        unit: item.unit,
        priceNet: item.priceNet,
        priceGross: item.priceGross,
        billingCycle: item.billingCycle,
        currency: item.currency,
        taxRate: item.taxRate,
        taxAmount: item.taxAmount,
        minimumTermUntil: item.minimumTermUntil,
        metadata: item.metadata,
    };
}

export function subscriptionContractToInvoiceSnapshot(
    contract: SubscriptionContractRecord,
): SubscriptionContractInvoiceSnapshot {
    return {
        contractId: contract.id,
        tenantId: contract.tenantId,
        originalOfferId: contract.originalOfferId,
        currency: contract.priceSnapshot.currency,
        billingCycle: contract.priceSnapshot.billingCycle,
        effectiveFrom: contract.effectiveFrom,
        effectiveUntil: contract.effectiveUntil,
        subtotalNet: contract.priceSnapshot.subtotalNet,
        discountNet: contract.priceSnapshot.discountNet,
        totalNet: contract.priceSnapshot.totalNet,
        vatRate: contract.priceSnapshot.vatRate,
        totalGross: contract.priceSnapshot.totalGross,
        lineItems: sortContractLineItemsForInvoice(contract.lineItems).map(
            contractLineItemToInvoiceLineItem,
        ),
    };
}

export function sortContractLineItemsForInvoice(
    lineItems: readonly ContractLineItemRecord[],
): ContractLineItemRecord[] {
    return [...lineItems].sort(
        (a, b) =>
            lineItemKindPriority(a.kind) - lineItemKindPriority(b.kind) ||
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
    );
}

function lineItemKindPriority(kind: ContractLineItemRecord['kind']): number {
    switch (kind) {
        case 'plan':
            return 10;
        case 'bundle':
            return 20;
        case 'discount':
            return 90;
    }
}

/** A contract that does not exist, or is not the caller's: the same answer for both. */
function contractNotFound(contractId: string): NotFoundException {
    return new NotFoundException({
        code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_NOT_FOUND,
        message: `SubscriptionContract '${contractId}' not found`,
        params: { contractId },
    });
}
