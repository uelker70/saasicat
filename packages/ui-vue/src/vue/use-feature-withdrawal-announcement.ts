// Withdrawing a feature, as the withdrawn-features page offers it: choose the
// feature and the date, read whom it reaches with which lines, name a
// reduction per plan and add-on in each rhythm, give the reason the
// subscribers read, and announce it behind the second factor.
//
// The dialog is a form dialog, and `submit` keeps its contract: a refusal
// rejects, so the dialog keeps the form and says why; stepping back from the
// second factor resolves `null`, and nothing is announced or said.
//
// The preview is read again whenever the feature or the date changes, and only
// the answer to the latest question is kept: an operator who picks two
// features in a row must not be shown the first one's reach under the second
// one's name. What is announced is what the preview showed — the subscriptions
// named are the ones it reached — and the server refuses it where they are no
// longer, answering with the preview as it stands.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type {
    FeatureCatalogEntryRow,
    FeatureWithdrawalAnnounced,
    FeatureWithdrawalPreview,
} from '@saasicat/core';

import { adminErrorMessage, toAdminError } from '../client/admin-error.js';
import { attachCause } from '../client/attach-cause.js';
import {
    reductionsOf,
    type ReductionAmountInput,
    type ReductionsRead,
} from '../client/feature-withdrawal.js';
import { formatMessage } from '../client/i18n/format.js';
import { instantOfLocalInput } from '../client/maintenance-times.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { catalogResource } from '../client/resources/catalog.resource.js';
import type { FeatureWithdrawalsResource } from './use-feature-withdrawals.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useSaMessages } from './use-super-admin-i18n.js';

type CatalogOps = Pick<Bound<(typeof catalogResource)['ops']>, 'features'>;

export interface FeatureWithdrawalAnnouncementFlow {
    /** Whether the dialog is open. */
    readonly isOpen: Readonly<Ref<boolean>>;
    /** The features of the catalogue, any of which may be withdrawn. */
    readonly features: Readonly<Ref<readonly FeatureCatalogEntryRow[]>>;
    readonly featureKey: Readonly<Ref<string | null>>;
    /** The date as a `datetime-local` input holds it; empty for at once. */
    readonly effectiveFrom: Readonly<Ref<string>>;
    /** Why, as the subscribers read it. */
    readonly reason: Readonly<Ref<string>>;
    /** The amount typed per target, by `featureWithdrawalTargetKeyOf`. */
    readonly amounts: Readonly<Ref<Readonly<Record<string, ReductionAmountInput>>>>;
    /** The preview for the feature and date chosen, once it is read. */
    readonly preview: Readonly<Ref<FeatureWithdrawalPreview | null>>;
    /** The reductions the amounts name, and what is wrong with any of them. */
    readonly read: ComputedRef<ReductionsRead>;
    readonly loading: Readonly<Ref<boolean>>;
    readonly announcing: Readonly<Ref<boolean>>;
    /** Why the features or the preview could not be read, or null. */
    readonly error: Readonly<Ref<string | null>>;
    readonly canAnnounce: ComputedRef<boolean>;
    open(): Promise<void>;
    close(): void;
    chooseFeature(featureKey: string | null): Promise<void>;
    chooseDate(value: string): Promise<void>;
    setReason(value: string): void;
    setAmount(targetKey: string, value: ReductionAmountInput): void;
    /**
     * Announces what the preview shows, behind the second factor. Rejects with
     * the refusal — where the subscriptions it reaches changed, with the
     * preview as it stands put in place of the one shown — and resolves `null`
     * where the operator stepped back.
     */
    submit(): Promise<FeatureWithdrawalAnnounced | null>;
}

export function useFeatureWithdrawalAnnouncement(options: {
    withdrawals: Pick<FeatureWithdrawalsResource, 'preview' | 'announce'>;
    catalog: CatalogOps;
    /** The page's second-factor prompt; the announcement asks it for a code. */
    mfa: Pick<MfaPrompt, 'run'>;
    /** Called once a withdrawal is announced, so the page reads its list again. */
    onAnnounced: () => Promise<void>;
}): FeatureWithdrawalAnnouncementFlow {
    const msg = useSaMessages('featureWithdrawals');
    const shell = useSaMessages('shell');
    const errors = useSaMessages('errors');

    const isOpen = ref(false);
    const features = ref<readonly FeatureCatalogEntryRow[]>([]);
    const featureKey = ref<string | null>(null);
    const effectiveFrom = ref('');
    const reason = ref('');
    const amounts = ref<Record<string, ReductionAmountInput>>({});
    const preview = ref<FeatureWithdrawalPreview | null>(null);
    const loading = ref(false);
    const announcing = ref(false);
    const error = ref<string | null>(null);

    const read = computed(() => reductionsOf(preview.value?.targets ?? [], amounts.value));
    const canAnnounce = computed(
        () =>
            !loading.value &&
            !announcing.value &&
            preview.value !== null &&
            preview.value.blockers.length === 0 &&
            reason.value.trim() !== '' &&
            Object.keys(read.value.problems).length === 0,
    );

    // Which preview question is the latest; an answer to an older one is dropped.
    let asked = 0;

    async function readPreview(): Promise<void> {
        const ticket = ++asked;
        preview.value = null;
        error.value = null;
        const key = featureKey.value;
        const from = instantOfLocalInput(effectiveFrom.value);
        // Nothing to ask while no feature is chosen or the date is half typed.
        if (!key || (effectiveFrom.value !== '' && from === null)) {
            loading.value = false;
            return;
        }
        loading.value = true;
        try {
            const answer = await options.withdrawals.preview(key, from);
            if (ticket === asked) preview.value = answer;
        } catch (err) {
            if (ticket === asked) error.value = adminErrorMessage(err, errors.value);
        } finally {
            if (ticket === asked) loading.value = false;
        }
    }

    async function open(): Promise<void> {
        isOpen.value = true;
        featureKey.value = null;
        effectiveFrom.value = '';
        reason.value = '';
        amounts.value = {};
        preview.value = null;
        error.value = null;
        asked += 1;
        loading.value = true;
        try {
            const entries = await options.catalog.features();
            features.value = entries.filter((entry) => entry.deletedAt === null);
        } catch (err) {
            error.value = adminErrorMessage(err, errors.value);
        } finally {
            loading.value = false;
        }
    }

    function close(): void {
        isOpen.value = false;
        asked += 1;
    }

    async function chooseFeature(key: string | null): Promise<void> {
        featureKey.value = key;
        await readPreview();
    }

    async function chooseDate(value: string): Promise<void> {
        effectiveFrom.value = value;
        await readPreview();
    }

    function setReason(value: string): void {
        reason.value = value;
    }

    function setAmount(targetKey: string, value: ReductionAmountInput): void {
        amounts.value = { ...amounts.value, [targetKey]: value };
    }

    async function submit(): Promise<FeatureWithdrawalAnnounced | null> {
        const shown = preview.value;
        if (!canAnnounce.value || !shown) return null;
        const from = instantOfLocalInput(effectiveFrom.value);
        announcing.value = true;
        try {
            const outcome = await options.mfa.run(
                formatMessage(msg.value.dialog.mfa, { feature: shown.feature.label }),
                shell.value.mfa.invalidCode,
                (code) =>
                    options.withdrawals.announce(
                        {
                            featureKey: shown.feature.key,
                            reason: reason.value.trim(),
                            // Left out for at once: the moment the preview was
                            // read for is past by the time it is confirmed.
                            ...(from ? { effectiveFrom: from } : {}),
                            reductions: read.value.reductions,
                            subscriptionIds: shown.reached.map((row) => row.subscriptionId),
                        },
                        code,
                    ),
            );
            if (!outcome.done) return null;
            await options.onAnnounced();
            return outcome.value;
        } catch (err) {
            const failure = toAdminError(err);
            const changed = (failure.body as { preview?: FeatureWithdrawalPreview } | undefined)
                ?.preview;
            if (failure.status === 409 && changed) {
                // What it reaches now is shown in place of what it reached, so
                // the operator confirms what is true rather than what was.
                preview.value = changed;
                throw attachCause(new Error(msg.value.dialog.previewChanged), err);
            }
            throw err;
        } finally {
            announcing.value = false;
        }
    }

    return {
        isOpen,
        features,
        featureKey,
        effectiveFrom,
        reason,
        amounts,
        preview,
        read,
        loading,
        announcing,
        error,
        canAnnounce,
        open,
        close,
        chooseFeature,
        chooseDate,
        setReason,
        setAmount,
        submit,
    };
}
