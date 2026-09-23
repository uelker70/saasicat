import {
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
    UnprocessableEntityException,
} from '@nestjs/common';
import type {
    NewSubscriberDetails,
    PlanCatalogSettings,
    SubscriberContactChange,
    SubscriberCorrectionRecord,
    SubscriberIdentityCorrection,
    SubscriberRecord,
    SubscriberRepository,
    SubscriptionContractParties,
    TransactionContext,
} from '@saasicat/core';
import { SUBSCRIBER_ERROR_CODES, contractPartiesOf } from '@saasicat/core';

import { PLAN_CATALOG_SETTINGS_TOKEN } from '../billing/plan-catalog.module.js';
import { codedError } from '../errors/coded-error.js';
import {
    INVOICE_ADDRESS_FIELDS,
    settleContactChange,
    settleIdentityCorrection,
    settleNewSubscriberDetails,
} from './subscriber-details.js';

/**
 * What a tenant may change but not clear: the address an invoice names, and
 * the email it is sent to.
 */
const KEPT_BY_A_TENANT = [...INVOICE_ADDRESS_FIELDS, 'invoiceEmail'] as const;
import { SUBSCRIBER_REPOSITORY_TOKEN } from './subscriber.tokens.js';

/**
 * The parties contracts are concluded with.
 *
 * SaaSiCat creates no tenants, so it cannot create their subscribers on its
 * own: wherever an application creates a tenant that will hold a subscription,
 * it calls `createForTenant` in the same transaction. Every way a contract
 * arises then finds the party it is concluded with, and refuses without one.
 */
@Injectable()
export class SubscriberService {
    constructor(
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly repo: SubscriberRepository,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
    ) {}

    /**
     * Creates the tenant's subscriber and assigns its customer number, behind
     * the prefix `config/saas.yaml` names. With `tx` it is written on that
     * transaction and undone with it — pass the one the tenant is created on.
     *
     * Refused with `SUBSCRIBER_ALREADY_EXISTS` when the tenant has one: a second
     * party for the same tenant is not a correction of the first.
     */
    async createForTenant(
        tenantId: string,
        details: NewSubscriberDetails,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord> {
        const settled = settleNewSubscriberDetails(details);
        const created = await this.repo.createForTenant(
            {
                ...settled,
                tenantId,
                customerNumberPrefix: this.settings.subscribers?.customerNumberPrefix ?? '',
            },
            tx,
        );
        if (!created) {
            throw new ConflictException(
                codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_ALREADY_EXISTS, { tenantId }),
            );
        }
        return created;
    }

    /** The tenant's subscriber, or `null` when it has none. */
    findByTenantId(tenantId: string, tx?: TransactionContext): Promise<SubscriberRecord | null> {
        return this.repo.findByTenantId(tenantId, tx);
    }

    /** The tenant's subscriber, refused with `SUBSCRIBER_REQUIRED` when it has none. */
    async requireForTenant(tenantId: string, tx?: TransactionContext): Promise<SubscriberRecord> {
        const subscriber = await this.repo.findByTenantId(tenantId, tx);
        if (!subscriber) throw subscriberRequired(tenantId);
        return subscriber;
    }

    /**
     * Who a contract concluded for this tenant now is between: its subscriber
     * as the record stands, and the issuer as the running configuration names
     * it. Refused with `SUBSCRIBER_REQUIRED` when the tenant has no subscriber.
     */
    async contractPartiesFor(
        tenantId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractParties> {
        const subscriber = await this.requireForTenant(tenantId, tx);
        return contractPartiesOf(subscriber, this.settings.issuer);
    }

    async getById(subscriberId: string): Promise<SubscriberRecord> {
        const subscriber = await this.repo.findById(subscriberId);
        if (!subscriber) throw subscriberNotFound(subscriberId);
        return subscriber;
    }

    /**
     * Changes how the subscriber is reached — the address, the country, the
     * invoice email — at any time. A contract keeps the copy it was concluded
     * with; what comes later reads the new details. The legal name and the tax
     * identifiers are refused here: they change by `correctIdentity`.
     */
    async changeContact(
        subscriberId: string,
        change: SubscriberContactChange,
    ): Promise<SubscriberRecord> {
        const updated = await this.repo.updateContact(subscriberId, settleContactChange(change));
        if (!updated) throw subscriberNotFound(subscriberId);
        return updated;
    }

    /**
     * A tenant's own change of how its subscriber is reached, from its billing
     * area. The address and the invoice email can be changed but not cleared —
     * `SUBSCRIBER_DETAIL_INVALID` names the field — since without them nothing
     * can be invoiced. The legal name and the tax identifiers are refused as
     * with `changeContact`: they are the party, and only the operator corrects
     * them.
     */
    async changeContactOfTenant(
        tenantId: string,
        change: SubscriberContactChange,
    ): Promise<SubscriberRecord> {
        const subscriber = await this.requireForTenant(tenantId);
        const settled = settleContactChange(change);
        const cleared = KEPT_BY_A_TENANT.find((field) => settled[field] === null);
        if (cleared) {
            throw new UnprocessableEntityException(
                codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_DETAIL_INVALID, { field: cleared }),
            );
        }
        return this.changeContact(subscriber.id, settled);
    }

    /**
     * Corrects the legal identity of the same legal entity — a misspelt name, a
     * wrong tax identifier, a change of name that entity went through — and
     * records the values it replaced, the reason and who made it. A contract
     * keeps the copy it was concluded with.
     *
     * The operator declares what the change is, because nothing here can tell:
     * another legal entity taking over is a transfer, and is refused with
     * `SUBSCRIBER_TAKEOVER_IS_A_TRANSFER` rather than recorded as an edit.
     */
    async correctIdentity(
        subscriberId: string,
        correction: SubscriberIdentityCorrection,
    ): Promise<SubscriberCorrectionRecord> {
        if (correction.kind !== 'correction') {
            throw new UnprocessableEntityException(
                codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_TAKEOVER_IS_A_TRANSFER),
            );
        }
        const reason = typeof correction.reason === 'string' ? correction.reason.trim() : '';
        if (reason === '') {
            throw new UnprocessableEntityException(
                codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_CORRECTION_REASON_REQUIRED),
            );
        }
        const correctedBy =
            typeof correction.correctedBy === 'string' ? correction.correctedBy.trim() : '';
        if (correctedBy === '') {
            throw new UnprocessableEntityException(
                codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_CORRECTION_ACTOR_REQUIRED),
            );
        }
        const result = await this.repo.correctIdentity(subscriberId, {
            corrected: settleIdentityCorrection(correction),
            reason,
            correctedBy,
            correctedAt: new Date(),
        });
        if (!result) throw subscriberNotFound(subscriberId);
        if (!result.correction) {
            throw new UnprocessableEntityException(
                codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_CORRECTION_CHANGES_NOTHING),
            );
        }
        return result.correction;
    }

    /** Every correction of the subscriber's legal identity, the latest first. */
    listCorrections(subscriberId: string): Promise<SubscriberCorrectionRecord[]> {
        return this.repo.listCorrections(subscriberId);
    }
}

/** The refusal every way a contract arises gives a tenant without its party. */
export function subscriberRequired(tenantId: string): ConflictException {
    return new ConflictException(
        codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_REQUIRED, { tenantId }),
    );
}

function subscriberNotFound(subscriberId: string): NotFoundException {
    return new NotFoundException(
        codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_NOT_FOUND, { subscriberId }),
    );
}
