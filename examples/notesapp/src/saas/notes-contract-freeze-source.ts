import { Injectable } from '@nestjs/common';
import {
    toPlanVersionRow,
    type BundleRepository,
    type PlanVersionRow,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
} from '@saasicat/core';
import {
    resolveBundlePriceNet,
    type ContractFreezeBundleSnapshot,
    type ContractFreezeSourcePort,
} from '@saasicat/nest/billing';
import { PrismaService } from '../prisma/prisma.service';

type ContractCycle = 'monthly' | 'yearly';
type ContractLine = ContractFreezeBundleSnapshot['lineItems'][number];

/** The rhythm as the catalogue prices a bundle in it. */
const CATALOGUE_CYCLE = { monthly: 'MONTHLY', yearly: 'YEARLY' } as const;

/**
 * What a contract is frozen from, read from the notes app's subscriptions:
 * the plan version a tenant's subscription is bound to, and the add-ons it has
 * booked, each priced as the tenant pays for it. The platform does the rest —
 * the plan's line, the tax, the snapshot of what the contract grants — and
 * ships no source of its own, because only the application knows where its
 * subscriptions live. The notes app keeps them in the platform's tables, so
 * it reads the bookings and the bundle versions through the platform's own
 * repositories: which booking still counts, and what a version costs a plan,
 * is decided there once.
 */
@Injectable()
export class NotesContractFreezeSource implements ContractFreezeSourcePort {
    constructor(
        private readonly prisma: PrismaService,
        private readonly bookings: Pick<SubscriptionBundleRepository, 'listActiveBySubscription'>,
        private readonly bundles: Pick<BundleRepository, 'findVersionById'>,
    ) {}

    /**
     * The version the subscription's `planVersionId` points at, not the one on
     * sale now: a tenant who books an add-on after a newer version came out
     * keeps the version it bought.
     */
    async findBoundPlanVersion(tenantId: string): Promise<PlanVersionRow | null> {
        const subscription = await this.prisma.subscription.findUnique({
            where: { tenantId },
            include: { planVersion: true },
        });
        if (!subscription) return null;
        return toPlanVersionRow(subscription.planVersion, subscription.plan);
    }

    /**
     * Every booking still running — a cancelled one too, until the day its
     * cancellation takes effect, because it is billed until then — as a line
     * of the contract, in the rhythm it was booked in. A yearly plan may carry
     * a monthly add-on, and a contract naming the yearly price of a monthly
     * booking would name a figure nobody is charged.
     */
    async loadBookedBundles(
        tenantId: string,
        cycle: ContractCycle,
    ): Promise<ContractFreezeBundleSnapshot> {
        const subscription = await this.prisma.subscription.findUnique({
            where: { tenantId },
            select: { id: true, plan: true },
        });
        if (!subscription) return { lineItems: [], bundleVersionIds: [] };
        const booked = await this.bookings.listActiveBySubscription(subscription.id);
        const lineItems = await Promise.all(
            booked.map((booking) => this.lineOf(booking, subscription.plan, cycle)),
        );
        return { lineItems, bundleVersionIds: booked.map((booking) => booking.bundleVersionId) };
    }

    /**
     * A booking's line. A version that cannot be found, or that has no price
     * for the plan in the booking's rhythm, refuses the freeze rather than
     * leaving the booking out or charging nothing for it: either would write
     * a contract that does not say what was agreed. The platform logs a
     * refused freeze and keeps the contract in force.
     */
    private async lineOf(
        booking: SubscriptionBundleRecord,
        planKey: string,
        planCycle: ContractCycle,
    ): Promise<ContractLine> {
        const version = await this.bundles.findVersionById(booking.bundleVersionId);
        if (!version) {
            throw new Error(
                `Booking ${booking.id} names bundle version ${booking.bundleVersionId}, which does not exist.`,
            );
        }
        const rhythm = cycleOf(booking, planCycle);
        const priceNet = resolveBundlePriceNet(version, planKey, CATALOGUE_CYCLE[rhythm]);
        if (priceNet === null) {
            throw new Error(
                `Booking ${booking.id} has no ${rhythm} price for plan ${planKey} on bundle version ${version.id}.`,
            );
        }
        return {
            kind: 'bundle',
            sourceKey: version.bundleKey,
            // The charge journal finds the booking's line by it.
            sourceVersionId: version.id,
            titleSnapshot: version.label,
            descriptionSnapshot: null,
            quantity: 1,
            unit: null,
            priceNet,
            billingCycle: rhythm,
            minimumTermUntil: booking.minimumTermEndsAt,
            featuresSnapshot: version.features,
            quotaEffectsSnapshot: version.quotas,
            metadata: null,
        };
    }
}

/** The booking's own rhythm, or its plan's where it names none. */
function cycleOf(booking: SubscriptionBundleRecord, planCycle: ContractCycle): ContractCycle {
    if (booking.billingCycle === null) return planCycle;
    return booking.billingCycle === 'YEARLY' ? 'yearly' : 'monthly';
}
