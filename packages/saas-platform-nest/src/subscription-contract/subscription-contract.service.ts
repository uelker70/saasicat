import {
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
    UnprocessableEntityException,
} from '@nestjs/common';
import type {
    CheckoutOfferLineItem,
    CheckoutOfferRow,
    ContractLineItemRecord,
    CreateSubscriptionContractData,
    InvoiceLineItemSnapshot,
    NewContractLineItemData,
    SubscriptionContractInvoiceSnapshot,
    SubscriptionContractPriceSnapshot,
    SubscriptionContractRecord,
    SubscriptionContractRepository,
    TerminateSubscriptionContractData,
} from '@saasicat/types';

import { appendImplicitDiscountLineItem } from '../checkout-offer/discount-line-items.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from './tokens.js';

export interface CreateContractFromOfferOptions {
    tenantId: string;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
    status?: CreateSubscriptionContractData['status'];
    entitlementSnapshot?: CreateSubscriptionContractData['entitlementSnapshot'];
    termsSnapshot?: Record<string, unknown> | null;
}

@Injectable()
export class SubscriptionContractService {
    constructor(
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly repo: SubscriptionContractRepository,
    ) {}

    list(filter: Parameters<SubscriptionContractRepository['list']>[0]) {
        return this.repo.list(filter);
    }

    async getById(contractId: string): Promise<SubscriptionContractRecord> {
        const row = await this.repo.findById(contractId);
        if (!row) {
            throw new NotFoundException(`SubscriptionContract '${contractId}' nicht gefunden`);
        }
        return row;
    }

    async findActiveByTenantId(
        tenantId: string,
        asOf = new Date(),
    ): Promise<SubscriptionContractRecord | null> {
        return this.repo.findActiveByTenantId(tenantId, asOf);
    }

    async getActiveInvoiceSnapshotForTenant(
        tenantId: string,
        asOf = new Date(),
    ): Promise<SubscriptionContractInvoiceSnapshot> {
        const contract = await this.repo.findActiveByTenantId(tenantId, asOf);
        if (!contract) {
            throw new NotFoundException(`Kein aktiver SubscriptionContract für Tenant ${tenantId}`);
        }
        return subscriptionContractToInvoiceSnapshot(contract);
    }

    async create(data: CreateSubscriptionContractData): Promise<SubscriptionContractRecord> {
        this.assertCreateData(data);
        return this.repo.create(this.cloneCreateData(data));
    }

    async terminate(
        contractId: string,
        data: TerminateSubscriptionContractData,
    ): Promise<SubscriptionContractRecord> {
        const existing = await this.getById(contractId);
        this.assertTerminable(existing, data);
        return this.repo.terminate(contractId, data);
    }

    async replaceActiveContract(
        tenantId: string,
        data: CreateSubscriptionContractData,
        terminateAt: Date,
    ): Promise<{ previous: SubscriptionContractRecord | null; next: SubscriptionContractRecord }> {
        const previous = await this.repo.findActiveByTenantId(tenantId, terminateAt);
        if (previous) {
            await this.terminate(previous.id, {
                effectiveUntil: terminateAt,
                status: 'superseded',
            });
        }
        const next = await this.create({
            ...data,
            tenantId,
            effectiveFrom: data.effectiveFrom ?? terminateAt,
        });
        return { previous, next };
    }

    createDataFromOffer(
        offer: CheckoutOfferRow,
        options: CreateContractFromOfferOptions,
    ): CreateSubscriptionContractData {
        if (offer.status !== 'consumed') {
            throw new ConflictException(
                `CheckoutOffer '${offer.id}' muss vor Contract-Erstellung consumed sein`,
            );
        }
        const lineItems = this.lineItemsFromOffer(offer);
        return {
            projectKey: offer.projectKey,
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
                code: 'CHECKOUT_OFFER_LINE_ITEMS_REQUIRED',
                message:
                    'Aus einem CheckoutOffer kann nur ein Contract entstehen, wenn LineItems eingefroren sind.',
            });
        }
        return appendImplicitDiscountLineItem({
            billingCycle: offer.billingCycle,
            priceBreakdown: offer.priceBreakdown,
            lineItems: source,
            promotionSnapshots: offer.promotionSnapshots ?? [],
            promoCodeSnapshot: offer.promoCodeSnapshot ?? null,
        }).map((item) => this.offerLineItemToContractLineItem(item));
    }

    private offerLineItemToContractLineItem(item: CheckoutOfferLineItem): NewContractLineItemData {
        return {
            kind: item.kind,
            sourceKey: item.sourceKey,
            sourceVersionId: item.sourceVersionId ?? null,
            titleSnapshot: item.titleSnapshot,
            descriptionSnapshot: item.descriptionSnapshot ?? null,
            quantity: item.quantity,
            unit: item.unit ?? null,
            priceNet: item.priceNet,
            priceGross: item.priceGross,
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
                code: 'SUBSCRIPTION_CONTRACT_INVALID_DATE',
                message: `${field} muss ein gültiges Datum sein.`,
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
            discountNet: Math.max(0, breakdown.regularNet - breakdown.effectiveNet),
            totalNet: breakdown.effectiveNet,
            vatRate: breakdown.vatRate,
            totalGross: breakdown.effectiveGross,
        };
    }

    private assertCreateData(data: CreateSubscriptionContractData): void {
        if (data.lineItems.length === 0) {
            throw new UnprocessableEntityException({
                code: 'SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED',
                message: 'SubscriptionContract benötigt mindestens eine LineItem.',
            });
        }
        if (data.effectiveUntil && data.effectiveUntil <= data.effectiveFrom) {
            throw new UnprocessableEntityException({
                code: 'SUBSCRIPTION_CONTRACT_INVALID_WINDOW',
                message: 'effectiveUntil muss nach effectiveFrom liegen.',
            });
        }
        const planLineItems = data.lineItems.filter((item) => item.kind === 'plan');
        if (planLineItems.length !== 1) {
            throw new UnprocessableEntityException({
                code: 'SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED',
                message: 'SubscriptionContract benötigt genau eine Plan-Grundposition.',
            });
        }
    }

    private assertTerminable(
        existing: SubscriptionContractRecord,
        data: TerminateSubscriptionContractData,
    ): void {
        if (existing.status === 'terminated' || existing.status === 'superseded') {
            throw new ConflictException(
                `SubscriptionContract '${existing.id}' ist bereits geschlossen`,
            );
        }
        if (data.effectiveUntil <= existing.effectiveFrom) {
            throw new UnprocessableEntityException({
                code: 'SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START',
                message: 'effectiveUntil muss nach effectiveFrom des Contracts liegen.',
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
        minimumTermUntil: item.minimumTermUntil,
        metadata: item.metadata,
    };
}

export function subscriptionContractToInvoiceSnapshot(
    contract: SubscriptionContractRecord,
): SubscriptionContractInvoiceSnapshot {
    return {
        contractId: contract.id,
        projectKey: contract.projectKey,
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
