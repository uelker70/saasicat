import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    AdminSubscriberAttention,
    AdminTenantSubscriber,
    SubscriberRepository,
} from '@saasicat/core';
import { taxOriginOf } from '@saasicat/core';

import { TAX_TREATMENTS_TOKEN } from '../tax/tax.tokens.js';
import type { TaxTreatments } from '../tax/tax-treatments.js';
import { readinessOf, standingPeriod } from './subscriber-readiness.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from './subscriber.tokens.js';

/**
 * A tenant's subscriber as the operator sees it: its tax details beside the
 * tenant, and — where a tax adapter decides — which tenants of a list hold a
 * subscriber back from its next contract, and why (`SC-PRIC-070`). It reads
 * only, and computes the standing when it reads, from the record and the
 * adapter as they are then.
 */
@Injectable()
export class SubscriberStandingService {
    constructor(
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly repo: SubscriberRepository,
        @Optional()
        @Inject(TAX_TREATMENTS_TOKEN)
        private readonly taxes: TaxTreatments | null = null,
    ) {}

    /** The tenant's subscriber with its standing; `subscriber: null` where it has none. */
    async ofTenant(tenantId: string, asOf: Date = new Date()): Promise<AdminTenantSubscriber> {
        const subscriber = await this.repo.findByTenantId(tenantId);
        if (!subscriber) return { subscriber: null, readiness: null };
        const check = await this.repo.findCurrentVatIdCheck(subscriber.id);
        return {
            subscriber: {
                id: subscriber.id,
                customerNumber: subscriber.customerNumber,
                legalName: subscriber.legalName,
                addressLine1: subscriber.addressLine1,
                addressLine2: subscriber.addressLine2,
                postalCode: subscriber.postalCode,
                city: subscriber.city,
                country: subscriber.country,
                business: subscriber.business,
                vatId: subscriber.vatId,
                vatIdValidated: taxOriginOf(subscriber, check).validatedVatId !== null,
                taxNumber: subscriber.taxNumber,
                migrated: subscriber.migrated,
            },
            readiness: this.taxes?.adapter
                ? readinessOf(subscriber, check, this.taxes, standingPeriod(asOf))
                : null,
        };
    }

    /**
     * The tenants among `tenantIds` whose subscriber cannot be given its next
     * contract, and why, read in a few queries for a list the operator looks
     * at. Empty without a tax adapter, which holds no contract back.
     */
    async attentionAmong(
        tenantIds: readonly string[],
        asOf: Date = new Date(),
    ): Promise<AdminSubscriberAttention[]> {
        const taxes = this.taxes;
        if (!taxes?.adapter || tenantIds.length === 0) return [];
        const period = standingPeriod(asOf);
        const found = await this.repo.listForTenants(tenantIds);
        return found.flatMap(({ subscriber, currentVatIdCheck }) => {
            if (subscriber.tenantId === null) return [];
            const readiness = readinessOf(subscriber, currentVatIdCheck, taxes, period);
            return readiness.ready ? [] : [{ tenantId: subscriber.tenantId, readiness }];
        });
    }
}
