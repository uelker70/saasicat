// Telling a subscriber, once per booking, that a newer version of an add-on
// they have booked is offered to them (`SC-BUN-060`).
//
// As for a plan (`VersionNoticeService`), the notice goes out when the offer
// appears beside the booking, not when the version is published: a version
// whose window opens later is not offered yet, and a booking that could not
// take it now is told once it could. The offer decides, so the notice and the
// offer say the same thing. Each notice is recorded before it is sent and
// confirmed after (`SC-SUB-023`), keyed by the subscription and the version
// offered — a subscription holds one booking of an add-on — which is what
// makes it once rather than once a run.

import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import type {
    BundleRepository,
    BundleVersionOfferedNotice,
    RlsBypassPort,
    SubscriptionBundleRepository,
    SubscriptionNoticePort,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { bookingsOfVersion } from './bundle-bookings-of-version.js';
import { BundleVersionOfferService } from './bundle-version-offer.service.js';
import { NOTICE_DELIVERY_TIMEOUT_MS, NoticeSender } from './notice-sender.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import {
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import type { VersionNoticeRun } from './version-notice.service.js';

const KIND = 'bundle-version-offered';

@Injectable()
export class BundleVersionNoticeService implements OnModuleInit {
    private readonly deliveryTimeoutMs = NOTICE_DELIVERY_TIMEOUT_MS;
    private readonly sender: NoticeSender;

    constructor(
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_NOTICE_PORT_TOKEN)
        port: SubscriptionNoticePort,
        @Inject(BundleVersionOfferService)
        private readonly offers: BundleVersionOfferService,
        // The run is the installation's, not a tenant's: under a row policy it
        // would otherwise find no booking and report that it told nobody.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {
        this.sender = new NoticeSender(notices, port);
    }

    /**
     * Refuses a wiring that could never send a notice: every run would find
     * no booking to tell, which reads exactly like none being due.
     */
    onModuleInit(): void {
        if (!this.bookings.listOfVersion || !this.subscriptions.listByIds) {
            throw new Error(
                'Version notices are turned on with add-on bookings, but the ' +
                    'SubscriptionBundleRepository has no `listOfVersion` or the ' +
                    'SubscriptionUsagePort no `listByIds`: the platform cannot find the bookings a ' +
                    'newer add-on version is offered to. Both shipped adapters have them; ports of ' +
                    'your own add them, or leave `tenantBilling.versionNotices` out.',
            );
        }
    }

    /**
     * Tells every booking of the add-on version now offered to it, where its
     * subscription has not been told of that version yet.
     */
    async sendDue(now: Date): Promise<VersionNoticeRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            let told = 0;
            let failed = 0;
            for (const bundle of await this.bundles.list({ excludeDeleted: true })) {
                for (const notice of await this.dueFor(bundle.id, now)) {
                    const outcome = await this.sender.tell(
                        notice,
                        notice.offer.offered.bundleVersionId,
                        this.deliveryTimeoutMs,
                    );
                    if (outcome === 'told') told += 1;
                    if (outcome === 'failed') failed += 1;
                }
            }
            return { told, failed };
        });
    }

    /** The notices due for one add-on: an offer of the version on sale, not yet told. */
    private async dueFor(bundleId: string, now: Date): Promise<BundleVersionOfferedNotice[]> {
        const onSale = await this.bundles.findActiveBundleVersion(bundleId, now);
        if (!onSale) return [];
        const earlier = (await this.bundles.listVersions(bundleId)).filter(
            (version) => version.publishedAt !== null && version.version < onSale.version,
        );
        if (earlier.length === 0) return [];
        const told = new Set(await this.notices.listDeliveredSubscriptionIds(KIND, onSale.id));
        const due: BundleVersionOfferedNotice[] = [];
        for (const version of earlier) {
            const { bookings, owners } = await bookingsOfVersion(
                this.bookings,
                this.subscriptions,
                version.id,
            );
            for (const booking of bookings.values()) {
                const owner = owners.get(booking.subscriptionId);
                if (!owner || told.has(booking.subscriptionId)) continue;
                // An ended booking is offered nothing; asked here first, it
                // costs no read of the plans ahead.
                if (cancellationHasLanded(booking, now)) continue;
                // The offer decides, not this loop: a booking that could not
                // take the version now is told when it can.
                const offer = await this.offers.offerFor(owner.subscription, booking, now);
                if (offer?.offered.bundleVersionId !== onSale.id) continue;
                due.push({
                    kind: KIND,
                    tenantId: owner.tenantId,
                    subscriptionId: booking.subscriptionId,
                    subscriptionBundleId: booking.id,
                    offer,
                });
            }
        }
        return due;
    }
}
