// Retiring an add-on version for the bookings on it, as the add-on page offers
// it: the replacement is the add-on's version on sale, so there is nothing to
// choose — read which bookings the retirement reaches and when, and announce it
// behind the second factor.
//
// Offered only where the manifest announces it, which the platform does where
// it keeps add-on announcements and the operator's terms are confirmed to
// allow one; elsewhere the routes refuse. The page creates the flow and
// provides it; the status of a version, three components down, asks for it
// rather than having it handed through each.

import {
    computed,
    inject,
    provide,
    ref,
    watch,
    type ComputedRef,
    type InjectionKey,
    type Ref,
} from 'vue';
import {
    BUNDLE_VERSION_RETIREMENT_CAPABILITY,
    type AdminManifest,
    type BundleRetirementAnnounced,
    type BundleRetirementPreview,
    type BundleVersionRetirementView,
    type BundleVersionRow,
} from '@saasicat/core';

import { adminErrorMessage, toAdminError } from '../client/admin-error.js';
import { formatMessage } from '../client/i18n/format.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { bundleVersionRetirementsResource } from '../client/resources/bundle-version-retirements.resource.js';
import { bundleRetirementOf, isRetirable } from '../client/version-retirement.js';
import { versionOnSale } from '../client/version-sale.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useSaMessages } from './use-super-admin-i18n.js';

type RetirementOps = Bound<(typeof bundleVersionRetirementsResource)['ops']>;

export interface BundleVersionRetirementFlow {
    /** Whether the platform serves retiring add-on versions; the action is not offered without it. */
    readonly available: ComputedRef<boolean>;
    /** Whether `version` is offered for retiring now. */
    canRetire: (version: BundleVersionRow) => boolean;
    /** The most recent announcement that retired `version`, or null. */
    retirementOf: (version: BundleVersionRow) => BundleVersionRetirementView | null;
    /** Why the announcements could not be read, or null. */
    readonly recordsError: Ref<string | null>;
    /** The version being retired while the dialog is open. */
    readonly target: Ref<BundleVersionRow | null>;
    /** The add-on's version on sale, which the bookings continue on; null where it has none. */
    readonly replacement: Ref<BundleVersionRow | null>;
    readonly preview: Ref<BundleRetirementPreview | null>;
    readonly loading: Ref<boolean>;
    readonly announcing: Ref<boolean>;
    readonly error: Ref<string | null>;
    /** What the announcement did, once it is made. */
    readonly result: Ref<BundleRetirementAnnounced | null>;
    open: (version: BundleVersionRow) => Promise<void>;
    close: () => void;
    announce: () => Promise<void>;
}

const FLOW_KEY: InjectionKey<BundleVersionRetirementFlow> = Symbol.for(
    'saasicat/ui-vue/BundleVersionRetirementFlow',
);

export function useBundleVersionRetirement(options: {
    /** The versions of the add-on whose detail is open. */
    versions: Ref<readonly BundleVersionRow[]>;
    manifest: Ref<AdminManifest | null>;
    retirements: RetirementOps;
    /** The page's second-factor prompt; the announcement asks it for a code. */
    mfa: Pick<MfaPrompt, 'run'>;
}): BundleVersionRetirementFlow {
    const msg = useSaMessages('bundles');
    const shell = useSaMessages('shell');
    const errors = useSaMessages('errors');

    const available = computed(
        () => options.manifest.value?.capabilities?.[BUNDLE_VERSION_RETIREMENT_CAPABILITY] === true,
    );
    const target = ref<BundleVersionRow | null>(null);
    const replacement = ref<BundleVersionRow | null>(null);
    const preview = ref<BundleRetirementPreview | null>(null);
    const loading = ref(false);
    const announcing = ref(false);
    const error = ref<string | null>(null);
    const result = ref<BundleRetirementAnnounced | null>(null);
    const records = ref<BundleVersionRetirementView[]>([]);
    const recordsError = ref<string | null>(null);

    async function loadRecords(): Promise<void> {
        if (!available.value) {
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
    watch(available, () => void loadRecords(), { immediate: true });

    async function open(version: BundleVersionRow): Promise<void> {
        target.value = version;
        replacement.value = versionOnSale(options.versions.value, new Date());
        preview.value = null;
        error.value = null;
        result.value = null;
        const onSale = replacement.value;
        if (!onSale) return;
        loading.value = true;
        try {
            preview.value = await options.retirements.preview(version.id, onSale.id);
        } catch (err) {
            error.value = adminErrorMessage(err, errors.value);
        } finally {
            loading.value = false;
        }
    }

    function close(): void {
        target.value = null;
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
                    bundleKey: shown.retired.bundleKey,
                    version: shown.retired.version,
                }),
                shell.value.mfa.invalidCode,
                (code) =>
                    options.retirements.announce(
                        retired.id,
                        {
                            replacementBundleVersionId: shown.replacement.bundleVersionId,
                            subscriptionBundleIds: shown.reached.map(
                                (row) => row.subscriptionBundleId,
                            ),
                        },
                        code,
                    ),
            );
            if (!outcome.done) return;
            result.value = outcome.value;
            await loadRecords();
        } catch (err) {
            const failure = toAdminError(err);
            const changed = (failure.body as { preview?: BundleRetirementPreview } | undefined)
                ?.preview;
            if (failure.status === 409 && changed) {
                // What it reaches now is shown in place of what it reached, so
                // the operator confirms what is true rather than what was.
                preview.value = changed;
                error.value = msg.value.retireDialog.previewChanged;
                return;
            }
            error.value = adminErrorMessage(err, errors.value);
        } finally {
            announcing.value = false;
        }
    }

    return {
        available,
        canRetire: (version) => available.value && isRetirable(version, new Date()),
        retirementOf: (version) => bundleRetirementOf(records.value, version.id),
        recordsError,
        target,
        replacement,
        preview,
        loading,
        announcing,
        error,
        result,
        open,
        close,
        announce,
    };
}

/** Makes `flow` the add-on retirement the components below the page ask for. */
export function provideBundleVersionRetirement(flow: BundleVersionRetirementFlow): void {
    provide(FLOW_KEY, flow);
}

/** The add-on retirement the page provided, or null where none did — then nothing is offered. */
export function injectBundleVersionRetirement(): BundleVersionRetirementFlow | null {
    return inject(FLOW_KEY, null);
}
