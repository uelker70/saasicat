// What the operator does to join a returning customer's subscriber into the one
// it had (`SC-ADM-027`): find the earlier subscriber, read the preview, and
// join them behind the second factor.
//
// A composable rather than page script, so the sequence — second factor, join,
// announce, go to the earlier subscriber — can be checked with `node --test`
// against `dist/`. The resource, the notify port and the second-factor prompt
// are handed in: this layer knows no Quasar, and the page renders the dialogs.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_JOIN_CAPABILITY,
    type AdminManifest,
    type AdminSubscriberJoined,
    type AdminSubscriberJoinPreview,
    type AdminSubscriberRow,
} from '@saasicat/core';

import { formatMessage } from '../client/i18n/format.js';
import type { Bound } from '../client/resources/define-resource.js';
import type {
    SubscriberJoinInput,
    subscribersResource,
} from '../client/resources/subscribers.resource.js';
import { report } from './report.js';
import type { UiNotify } from './ui-notify.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The subscriber operations a join calls, already bound to the shell's client. */
export type SubscriberJoinResource = Pick<
    Bound<(typeof subscribersResource)['ops']>,
    'list' | 'previewJoin' | 'join'
>;

export interface SubscriberJoinPorts {
    notify: UiNotify;
    mfa: Pick<MfaPrompt, 'run'>;
    /** Called once the join stands, with the subscriber everything moved to. */
    onJoined: (joined: AdminSubscriberJoined) => void | Promise<void>;
}

export interface SubscriberJoin {
    /** Whether the platform serves joins; nothing is offered without it. */
    available: ComputedRef<boolean>;
    /**
     * The subscribers a join can go into: those the search matches whose every
     * link is closed, other than the one on screen.
     */
    candidates(query: string): Promise<AdminSubscriberRow[]>;
    /** What joining the subscriber on screen into `intoSubscriberId` would do. */
    preview(intoSubscriberId: string): Promise<AdminSubscriberJoinPreview>;
    /** For a form dialog's `submit`: rejects on a failure, `null` where the second factor was not given. */
    join(input: SubscriberJoinInput): Promise<AdminSubscriberJoined | null>;
}

export function useSubscriberJoin(
    subscriberId: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    subscribers: SubscriberJoinResource,
    ports: SubscriberJoinPorts,
): SubscriberJoin {
    const msg = useSaMessages('subscribers');
    const shell = useSaMessages('shell');
    const available = computed(
        () => manifest.value?.capabilities?.[SUBSCRIBER_JOIN_CAPABILITY] === true,
    );

    return {
        available,
        async candidates(query) {
            const page = await subscribers.list({ query, withoutLiveTenant: true });
            return page.subscribers.filter(
                (row) => row.id !== subscriberId.value && !row.joinedInto,
            );
        },
        preview: (intoSubscriberId) =>
            subscribers.previewJoin(subscriberId.value, intoSubscriberId),
        async join(input) {
            // The subscriber is taken before the prompt opens: the page may
            // move to another one while it is open, and what the operator
            // confirmed belongs to the one they confirmed it on.
            const subscriber = subscriberId.value;
            const outcome = await ports.mfa.run(
                msg.value.join.mfa,
                shell.value.mfa.invalidCode,
                (code) => subscribers.join(subscriber, input, code),
            );
            if (!outcome.done) return null;
            const joined = outcome.value;
            // The announcement cannot fail what it announces: the join stands.
            report(() =>
                ports.notify(
                    'positive',
                    formatMessage(msg.value.join.joined, {
                        customerNumber: joined.joinedInto.customerNumber,
                    }),
                ),
            );
            await ports.onJoined(joined);
            return joined;
        },
    };
}
