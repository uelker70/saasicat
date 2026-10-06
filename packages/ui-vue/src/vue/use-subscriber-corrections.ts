// What the operator does to a tenant's subscriber beside its view: corrects its
// legal identity, changes whether it acts as a business, checks its VAT number
// again — and reads the history of all three.
//
// A composable rather than page script, so the sequences — second factor,
// write, announce, reload — can be checked with `node --test` against `dist/`.
// The resource, the notify port and the second-factor prompt are handed in:
// this layer knows no Quasar, and the page renders the prompt's dialog.
//
// The two corrections are a form dialog's `submit`: they reject on a failure,
// so the dialog keeps the form and shows why, and resolve `null` where the
// operator stepped back from the second factor, so the dialog stays as it was.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_ATTENTION_CAPABILITY,
    SUBSCRIBER_CORRECTION_CAPABILITY,
    type AdminManifest,
    type AdminSubscriberCorrected,
    type AdminSubscriberHistoryEntry,
    type AdminVatIdCheckOutcome,
} from '@saasicat/core';

import { adminErrorMessage } from '../client/admin-error.js';
import { formatMessage } from '../client/i18n/format.js';
import type { Bound } from '../client/resources/define-resource.js';
import type {
    SubscriberBusinessStatusInput,
    SubscriberIdentityCorrectionInput,
    tenantsResource,
} from '../client/resources/tenants.resource.js';
import type { UiNotify, UiNotifyKind } from './ui-notify.js';
import { report } from './report.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The tenant operations the corrections call, already bound to the shell's client. */
export type SubscriberCorrectionsResource = Pick<
    Bound<(typeof tenantsResource)['ops']>,
    | 'subscriberHistory'
    | 'correctSubscriberIdentity'
    | 'changeSubscriberBusinessStatus'
    | 'checkSubscriberVatId'
>;

export interface SubscriberCorrectionsPorts {
    notify: UiNotify;
    mfa: Pick<MfaPrompt, 'run'>;
    /** Called once a correction or a check has changed the subscriber, to read it again. */
    onChanged: () => void | Promise<void>;
}

export interface SubscriberCorrections {
    /** Whether the platform serves the corrections; nothing is offered without it. */
    available: ComputedRef<boolean>;
    /** Whether a tax adapter names a service to check VAT numbers with. */
    canCheckVatId: ComputedRef<boolean>;
    /** The subscriber's history, the latest first; empty where it is not served. */
    history: AsyncData<AdminSubscriberHistoryEntry[]>;
    /** For a form dialog's `submit`: rejects on a failure, `null` where the second factor was not given. */
    correctIdentity(
        input: SubscriberIdentityCorrectionInput,
    ): Promise<AdminSubscriberCorrected | null>;
    changeBusinessStatus(
        input: SubscriberBusinessStatusInput,
    ): Promise<AdminSubscriberCorrected | null>;
    /** Checks the number held again; reports its outcome itself. */
    checkVatId(): Promise<void>;
}

export function useSubscriberCorrections(
    slug: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    tenants: SubscriberCorrectionsResource,
    ports: SubscriberCorrectionsPorts,
): SubscriberCorrections {
    const msg = useSaMessages('tenants');
    const shell = useSaMessages('shell');
    const errors = useSaMessages('errors');

    const available = computed(
        () => manifest.value?.capabilities?.[SUBSCRIBER_CORRECTION_CAPABILITY] === true,
    );
    const canCheckVatId = computed(
        () =>
            available.value &&
            manifest.value?.capabilities?.[SUBSCRIBER_ATTENTION_CAPABILITY] === true,
    );
    const history = useAsyncData<AdminSubscriberHistoryEntry[]>(
        async () => (available.value && slug.value ? tenants.subscriberHistory(slug.value) : []),
        { initial: [], watch: [available], subject: slug },
    );

    /**
     * Announces what a correction or a check found — what the service answered
     * where a number was checked, with the correction's own line beneath it —
     * and reads the subscriber and its history again. The announcement cannot
     * fail what it announces: the write has happened by then, and a dialog
     * told otherwise would invite a second one.
     */
    async function changed(result: AdminSubscriberCorrected, done: string | null): Promise<void> {
        const check = result.vatIdCheck;
        report(() => {
            if (check) {
                const [kind, message] = checkAnnouncement(check);
                ports.notify(kind, message, done ? { caption: done } : undefined);
            } else if (done) {
                ports.notify('positive', done);
            }
        });
        await Promise.all([history.reload(), ports.onChanged()]);
    }

    /**
     * What the service found — or, where the check no longer describes the
     * number held because it changed meanwhile, only that it does not count:
     * its "invalid" would announce a hold a later valid check already lifted.
     */
    function checkAnnouncement(check: AdminVatIdCheckOutcome): [UiNotifyKind, string] {
        const m = msg.value.subscriber;
        if (!check.completed) {
            return ['warning', formatMessage(m.vatIdNotChecked, { reason: check.reason })];
        }
        if (!check.counts) return ['info', m.vatIdCheckNotCounting];
        return check.valid
            ? ['positive', formatMessage(m.vatIdValid, { service: check.service })]
            : ['warning', formatMessage(m.vatIdInvalid, { service: check.service })];
    }

    /**
     * Runs a correction of the tenant on screen behind the second factor;
     * `null` where the operator stepped back. The tenant is taken before the
     * prompt opens: the page may move to another tenant while it is open, and
     * what the operator confirmed belongs to the one they confirmed it on.
     */
    async function behindSecondFactor(
        description: string,
        write: (tenant: string, code: string) => Promise<AdminSubscriberCorrected>,
        done: string,
    ): Promise<AdminSubscriberCorrected | null> {
        const tenant = slug.value;
        const outcome = await ports.mfa.run(description, shell.value.mfa.invalidCode, (code) =>
            write(tenant, code),
        );
        if (!outcome.done) return null;
        await changed(outcome.value, done);
        return outcome.value;
    }

    return {
        available,
        canCheckVatId,
        history,
        correctIdentity: (input) =>
            behindSecondFactor(
                msg.value.subscriber.mfaIdentity,
                (tenant, code) => tenants.correctSubscriberIdentity(tenant, input, code),
                msg.value.subscriber.corrected,
            ),
        changeBusinessStatus: (input) =>
            behindSecondFactor(
                msg.value.subscriber.mfaBusiness,
                (tenant, code) => tenants.changeSubscriberBusinessStatus(tenant, input, code),
                msg.value.subscriber.businessChanged,
            ),
        async checkVatId() {
            let result: AdminSubscriberCorrected;
            try {
                result = await tenants.checkSubscriberVatId(slug.value);
            } catch (err) {
                report(() => ports.notify('negative', adminErrorMessage(err, errors.value)));
                return;
            }
            await changed(result, null);
        },
    };
}
