// Retiring a plan version for the subscriptions on it, as the plan cockpit
// offers it: choose the plan they continue on, read whom the retirement reaches
// and when, and announce it behind the second factor.
//
// Offered only where the manifest announces it, which the platform does where it
// keeps announcements and the operator's terms are confirmed to allow one;
// elsewhere both routes refuse.

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
    VERSION_RETIREMENT_CAPABILITY,
    type AdminManifest,
    type PlanRow,
    type PlanVersionRow,
    type RetirementAnnounced,
    type RetirementPreview,
    type VersionRetirementView,
} from '@saasicat/core';

import { adminErrorMessage, toAdminError } from '../client/admin-error.js';
import { formatMessage } from '../client/i18n/format.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { planVersionsResource, plansResource } from '../client/resources/plans.resource.js';
import type { versionRetirementsResource } from '../client/resources/version-retirements.resource.js';
import { isRetirable, retirementOf } from '../client/version-retirement.js';
import { versionOnSale } from '../client/version-sale.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useSaMessages } from './use-super-admin-i18n.js';

type PlanOps = Pick<Bound<(typeof plansResource)['ops']>, 'list'>;
type VersionOps = Pick<Bound<(typeof planVersionsResource)['ops']>, 'listForPlan'>;
type RetirementOps = Bound<(typeof versionRetirementsResource)['ops']>;

export interface VersionRetirementFlow {
    /** Whether the platform serves retiring; the action is not offered without it. */
    readonly available: ComputedRef<boolean>;
    /** Whether `version` is offered for retiring now. */
    canRetire: (version: PlanVersionRow) => boolean;
    /** The most recent announcement that retired `version`, or null. */
    retirementOf: (version: PlanVersionRow) => VersionRetirementView | null;
    /** Why the announcements could not be read, or null. */
    readonly recordsError: Ref<string | null>;
    /** The version being retired while the dialog is open. */
    readonly target: Ref<PlanVersionRow | null>;
    /** The plans the subscriptions may continue on. */
    readonly plans: Ref<PlanRow[]>;
    /** The plan chosen, whose version on sale is the replacement. */
    readonly replacementPlanId: Ref<string | null>;
    /** The chosen plan's version on sale, or null where it has none. */
    readonly replacement: Ref<PlanVersionRow | null>;
    readonly preview: Ref<RetirementPreview | null>;
    readonly loading: Ref<boolean>;
    readonly announcing: Ref<boolean>;
    readonly error: Ref<string | null>;
    /** What the announcement did, once it is made. */
    readonly result: Ref<RetirementAnnounced | null>;
    open: (version: PlanVersionRow) => Promise<void>;
    close: () => void;
    choosePlan: (planId: string | null) => Promise<void>;
    announce: () => Promise<void>;
}

export function useVersionRetirement(options: {
    plan: Ref<PlanRow | null>;
    manifest: Ref<AdminManifest | null>;
    plans: PlanOps;
    versions: VersionOps;
    retirements: RetirementOps;
    /** The page's second-factor prompt; the announcement asks it for a code. */
    mfa: Pick<MfaPrompt, 'run'>;
}): VersionRetirementFlow {
    const msg = useSaMessages('planDetail');
    const shell = useSaMessages('shell');
    const errors = useSaMessages('errors');

    const available = computed(
        () => options.manifest.value?.capabilities?.[VERSION_RETIREMENT_CAPABILITY] === true,
    );
    const target = ref<PlanVersionRow | null>(null);
    const plans = ref<PlanRow[]>([]);
    const replacementPlanId = ref<string | null>(null);
    const replacement = ref<PlanVersionRow | null>(null);
    const preview = ref<RetirementPreview | null>(null);
    const loading = ref(false);
    const announcing = ref(false);
    const error = ref<string | null>(null);
    const result = ref<RetirementAnnounced | null>(null);
    const records = ref<VersionRetirementView[]>([]);
    const recordsError = ref<string | null>(null);

    // Read where a plan's cockpit is open, which is the only place they show.
    async function loadRecords(): Promise<void> {
        if (!available.value || !options.plan.value) {
            records.value = [];
            return;
        }
        try {
            records.value = await options.retirements.list();
            recordsError.value = null;
        } catch (err) {
            recordsError.value = adminErrorMessage(err, errors.value);
        }
    }
    watch([available, () => options.plan.value?.id], () => void loadRecords(), {
        immediate: true,
    });

    function showError(err: unknown): void {
        error.value = adminErrorMessage(err, errors.value);
    }

    async function open(version: PlanVersionRow): Promise<void> {
        target.value = version;
        replacementPlanId.value = null;
        replacement.value = null;
        preview.value = null;
        error.value = null;
        result.value = null;
        loading.value = true;
        try {
            plans.value = await options.plans.list();
            await choosePlan(options.plan.value?.id ?? null);
        } catch (err) {
            showError(err);
        } finally {
            loading.value = false;
        }
    }

    function close(): void {
        target.value = null;
    }

    async function choosePlan(planId: string | null): Promise<void> {
        replacementPlanId.value = planId;
        replacement.value = null;
        preview.value = null;
        error.value = null;
        const retired = target.value;
        if (!planId || !retired) return;
        loading.value = true;
        try {
            const onSale = versionOnSale(await options.versions.listForPlan(planId), new Date());
            // Read again before it is kept: another choice may have been made meanwhile.
            if (replacementPlanId.value !== planId) return;
            replacement.value = onSale;
            if (!onSale) return;
            preview.value = await options.retirements.preview(retired.id, onSale.id);
        } catch (err) {
            showError(err);
        } finally {
            loading.value = false;
        }
    }

    async function announce(): Promise<void> {
        const retired = target.value;
        const shown = preview.value;
        if (!retired || !shown || shown.blockers.length > 0) return;
        announcing.value = true;
        error.value = null;
        try {
            const outcome = await options.mfa.run(
                formatMessage(msg.value.retireDialog.mfa, {
                    planKey: shown.retired.planKey,
                    version: shown.retired.version,
                }),
                shell.value.mfa.invalidCode,
                (code) =>
                    options.retirements.announce(
                        retired.id,
                        {
                            replacementPlanVersionId: shown.replacement.planVersionId,
                            subscriptionIds: shown.reached.map((row) => row.subscriptionId),
                        },
                        code,
                    ),
            );
            if (!outcome.done) return;
            result.value = outcome.value;
            await loadRecords();
        } catch (err) {
            const failure = toAdminError(err);
            const changed = (failure.body as { preview?: RetirementPreview } | undefined)?.preview;
            if (failure.status === 409 && changed) {
                // What it reaches now is shown in place of what it reached, so
                // the operator confirms what is true rather than what was.
                preview.value = changed;
                error.value = msg.value.retireDialog.previewChanged;
                return;
            }
            showError(err);
        } finally {
            announcing.value = false;
        }
    }

    return {
        available,
        canRetire: (version) => available.value && isRetirable(version, new Date()),
        retirementOf: (version) => retirementOf(records.value, version.id),
        recordsError,
        target,
        plans,
        replacementPlanId,
        replacement,
        preview,
        loading,
        announcing,
        error,
        result,
        open,
        close,
        choosePlan,
        announce,
    };
}
