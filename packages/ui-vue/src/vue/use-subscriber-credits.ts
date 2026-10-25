// A subscriber's credits, as the operator reads them in the subscriber's
// record, and the payout the operator records against one.
//
// Asked for only where the manifest announces them: an installation that
// collects no invoices serves no such route. A payout is a form dialog's
// `submit`: it rejects on a failure, so the dialog keeps the form and shows
// why, and resolves `null` where the operator stepped back from the second
// factor, so the dialog stays as it was.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_CREDIT_CAPABILITY,
    SUBSCRIBER_PAYOUT_CAPABILITY,
    type AdminManifest,
    type AdminSubscriberCredits,
    type AdminSubscriberPayout,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import type { UiNotify } from './ui-notify.js';
import { report } from './report.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The subscriber operations the credits call, already bound to the shell's client. */
export type SubscriberCreditsResource = Pick<
    Bound<(typeof subscribersResource)['ops']>,
    'credits' | 'recordPayout'
>;

export interface SubscriberCreditsPorts {
    notify: UiNotify;
    mfa: Pick<MfaPrompt, 'run'>;
}

export interface SubscriberCredits extends AsyncData<AdminSubscriberCredits | null> {
    /** Whether the platform serves the credits; nothing is shown without it. */
    available: ComputedRef<boolean>;
    /** Whether the platform takes a payout; nothing is offered without it. */
    canPayOut: ComputedRef<boolean>;
    /** For a form dialog's `submit`: rejects on a failure, `null` where the second factor was not given. */
    payOut(creditId: string, payout: AdminSubscriberPayout): Promise<AdminSubscriberCredits | null>;
}

export function useSubscriberCredits(
    subscriberId: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    subscribers: SubscriberCreditsResource,
    ports: SubscriberCreditsPorts,
): SubscriberCredits {
    const msg = useSaMessages('subscribers');
    const shell = useSaMessages('shell');
    const capable = (capability: string) =>
        computed(() => manifest.value?.capabilities?.[capability] === true);
    const available = capable(SUBSCRIBER_CREDIT_CAPABILITY);
    const payable = capable(SUBSCRIBER_PAYOUT_CAPABILITY);
    const canPayOut = computed(() => available.value && payable.value);
    const credits = useAsyncData(
        async () =>
            available.value && subscriberId.value ? subscribers.credits(subscriberId.value) : null,
        { initial: null, watch: [available], subject: subscriberId },
    );

    /**
     * Records the payout behind the second factor, for the subscriber on
     * screen when it was asked for: the page may move to another subscriber
     * while the prompt is open, and what the operator confirmed belongs to the
     * one they confirmed it on. The credits are read again after it, for
     * whichever subscriber is on screen then.
     */
    async function payOut(
        creditId: string,
        payout: AdminSubscriberPayout,
    ): Promise<AdminSubscriberCredits | null> {
        const subscriber = subscriberId.value;
        const outcome = await ports.mfa.run(
            msg.value.credits.mfaPayout,
            shell.value.mfa.invalidCode,
            (code) => subscribers.recordPayout(subscriber, creditId, payout, code),
        );
        if (!outcome.done) return null;
        report(() => ports.notify('positive', msg.value.credits.paidOut));
        await credits.reload();
        return outcome.value;
    }

    return { ...credits, available, canPayOut, payOut };
}
