// Puts the reductions of a feature withdrawal into a subscription's contract.
//
// The announcement writes them at once, into a successor of the contract in
// force: the same contract, line for line, with the reduction lines added and
// the parties kept — what was agreed does not change, a reduction is added to
// it. A contract written afterwards for another reason — a trial converting, a
// booking, a plan change — carries the reductions no contract records yet,
// which is how a subscription reached in its trial gets them. And the journal,
// before it charges, writes any the announcement could not, so a reduction is
// charged however late its contract is written.

import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    ContractLineItemRecord,
    FeatureWithdrawalRepository,
    FeatureWithdrawnNotice,
    NewContractLineItemData,
    SubscriptionBundleRepository,
    SubscriptionContractRecord,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
} from '@saasicat/core';

import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import {
    contractTotalsOf,
    recordContractLinesMoney,
    type PricedContractLineItem,
} from '../subscription-contract/contract-line-item-money.js';
import {
    SUCCESSOR_ATTEMPTS,
    SubscriptionContractService,
} from '../subscription-contract/subscription-contract.service.js';
import { contractTaxPeriod } from '../tax/tax-treatments.js';
import { withdrawalReductionLines, type WithdrawalTold } from './feature-withdrawal-lines.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import {
    FEATURE_WITHDRAWAL_REPOSITORY_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from './tenant-billing.tokens.js';

/** What writing the reductions into the contract in force did. */
export type ReductionsRecorded =
    /** A successor carrying them was written. */
    | 'written'
    /** Nothing to write: no contract in force, no reduction, or every one recorded already. */
    | 'nothing'
    /** The contract in force moved on every attempt; the next caller tries again. */
    | 'moved';

/** The line a contract writes, without the money the installation puts on it. */
type LineWithoutMoney = PricedContractLineItem;

@Injectable()
export class FeatureWithdrawalContractService {
    constructor(
        @Inject(FEATURE_WITHDRAWAL_REPOSITORY_TOKEN)
        private readonly withdrawals: FeatureWithdrawalRepository,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SubscriptionContractService)
        private readonly contracts: SubscriptionContractService,
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        // Optional: without bookings there is no add-on line to reduce.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository | null = null,
    ) {}

    /**
     * The reduction lines a contract of the tenant written with `lines` adds:
     * for each line its subscription was told of with a reduction, that the
     * contract still carries and that no contract of the tenant records yet.
     */
    async linesFor(
        tenantId: string,
        lines: readonly Pick<
            NewContractLineItemData,
            'kind' | 'sourceKey' | 'sourceVersionId' | 'billingCycle' | 'priceNet'
        >[],
    ): Promise<PricedContractLineItem[]> {
        const subscription = await this.subscriptions.findForTenant(tenantId);
        if (!subscription?.id) return [];
        const told = await this.toldOf(subscription.id);
        if (told.length === 0) return [];
        const [recorded, bookingVersions] = await Promise.all([
            this.recordedKeysOf(tenantId),
            this.bookingVersionsOf(subscription.id),
        ]);
        return withdrawalReductionLines(lines, told, recorded, bookingVersions);
    }

    /**
     * Writes the reductions the contract in force at `now` lacks into a
     * successor of it from `now`: a copy of it, line for line, with the
     * reduction lines added and its money recorded at the rate decided for the
     * subscriber now, between the same parties.
     */
    async recordReductions(tenantId: string, now: Date): Promise<ReductionsRecorded> {
        for (let attempt = 0; attempt < SUCCESSOR_ATTEMPTS; attempt++) {
            const inForce = await this.contracts.findActiveByTenantId(tenantId, now);
            if (!inForce) return 'nothing';
            const added = await this.linesFor(tenantId, inForce.lineItems);
            if (added.length === 0) return 'nothing';
            const successor = await this.successorOf(inForce, added, now);
            const written = await this.contracts.writeSuccessor(inForce, successor, now, {
                keepParties: true,
            });
            if (written) {
                this.entitlements.invalidateTenant(tenantId);
                return 'written';
            }
        }
        return 'moved';
    }

    /** The withdrawals the subscription was told of, and whether each ever took anything away. */
    private async toldOf(subscriptionId: string): Promise<WithdrawalTold[]> {
        const notices = (await this.notices.listForSubscription(subscriptionId))
            .filter((record) => record.kind === 'feature-withdrawn')
            .map((record) => record.content as FeatureWithdrawnNotice);
        if (notices.length === 0) return [];
        const withdrawals = new Map(
            (await this.withdrawals.list()).map((withdrawal) => [withdrawal.id, withdrawal]),
        );
        return notices.flatMap((notice) => {
            const withdrawal = withdrawals.get(notice.withdrawalId);
            if (!withdrawal) return [];
            const everInEffect =
                withdrawal.liftedFrom === null || withdrawal.effectiveFrom < withdrawal.liftedFrom;
            return [{ notice, everInEffect }];
        });
    }

    /** The source keys every contract of the tenant records, superseded ones included. */
    private async recordedKeysOf(tenantId: string): Promise<Set<string>> {
        const contracts = await this.contracts.list({ tenantId });
        return new Set(
            contracts.flatMap((contract) => contract.lineItems.map((line) => line.sourceKey)),
        );
    }

    /** The version each booking of the subscription is on, by booking. */
    private async bookingVersionsOf(subscriptionId: string): Promise<Map<string, string>> {
        if (!this.bookings) return new Map();
        const bookings = await this.bookings.listBySubscription(subscriptionId);
        return new Map(bookings.map((booking) => [booking.id, booking.bundleVersionId]));
    }

    private async successorOf(
        inForce: SubscriptionContractRecord,
        added: readonly PricedContractLineItem[],
        now: Date,
    ) {
        const data = this.contracts.dataOf(inForce);
        const cycle = inForce.priceSnapshot.billingCycle;
        const taxRate =
            (await this.contracts.contractTaxRateFor(
                { tenantId: inForce.tenantId },
                contractTaxPeriod({
                    effectiveFrom: now,
                    effectiveUntil: inForce.effectiveUntil,
                    billingCycle: cycle,
                }),
            )) ?? inForce.priceSnapshot.vatRate;
        const lineItems = recordContractLinesMoney(
            [...inForce.lineItems.map(withoutMoney), ...added],
            { currency: inForce.priceSnapshot.currency, taxRate },
        );
        return {
            ...data,
            status: 'active' as const,
            effectiveFrom: now,
            lineItems,
            priceSnapshot: {
                ...data.priceSnapshot,
                ...contractTotalsOf(lineItems, cycle),
                vatRate: taxRate,
            },
        };
    }
}

/** A recorded line as the line it was before the installation's money was put on it. */
function withoutMoney(line: ContractLineItemRecord): LineWithoutMoney {
    const {
        id: _id,
        contractId: _contractId,
        createdAt: _createdAt,
        priceGross: _gross,
        currency: _currency,
        taxRate: _rate,
        taxAmount: _tax,
        ...rest
    } = line;
    return rest;
}
