// The withdrawn-features page's list: every withdrawal with how far it has
// come, and lifting one.
//
// A composable rather than page script, so the SFC arranges and binds while
// the sequence — second factor, write, reload — and its failure states can be
// checked with `node --test` against `dist/`. The resource and the
// second-factor prompt are handed in: this layer knows no Quasar, and the page
// renders the prompt's dialog.
//
// Lifting goes through a form dialog, whose submit is the confirmation, and
// then asks for the second factor: from the date, every subscription the
// withdrawal reached is granted the feature again and charged in full.

import type { Ref } from 'vue';
import type { FeatureWithdrawalLifted, FeatureWithdrawalView } from '@saasicat/core';

import type { AdminError } from '../client/admin-error.js';
import { formatMessage } from '../client/i18n/format.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { featureWithdrawalsResource } from '../client/resources/feature-withdrawals.resource.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useAsyncData } from './use-async-data.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The operations the page calls, already bound to the shell's client. */
export type FeatureWithdrawalsResource = Bound<(typeof featureWithdrawalsResource)['ops']>;

export interface FeatureWithdrawalsState {
    /** Every withdrawal, the most recently announced first; empty before the first load. */
    rows: Ref<FeatureWithdrawalView[]>;
    loading: Ref<boolean>;
    /** The last load's failure, or null. */
    error: Ref<AdminError | null>;
    reload(): Promise<void>;
    /**
     * Lifts `row` from `liftedFrom` — ISO 8601, or null for now — behind the
     * second factor, for a form dialog's `submit`: rejects with the refusal, so
     * the dialog keeps the form and shows why, and resolves `null` where the
     * operator stepped back from the second factor.
     */
    lift(
        row: FeatureWithdrawalView,
        liftedFrom: string | null,
    ): Promise<FeatureWithdrawalLifted | null>;
}

export function useFeatureWithdrawals(
    withdrawals: Pick<FeatureWithdrawalsResource, 'list' | 'lift'>,
    mfa: Pick<MfaPrompt, 'run'>,
): FeatureWithdrawalsState {
    const msg = useSaMessages('featureWithdrawals');
    const shell = useSaMessages('shell');
    const {
        data: rows,
        pending: loading,
        error,
        reload,
    } = useAsyncData<FeatureWithdrawalView[]>(() => withdrawals.list(), { initial: [] });

    async function lift(
        row: FeatureWithdrawalView,
        liftedFrom: string | null,
    ): Promise<FeatureWithdrawalLifted | null> {
        const outcome = await mfa.run(
            formatMessage(msg.value.liftDialog.mfa, { feature: row.featureLabel }),
            shell.value.mfa.invalidCode,
            (code) => withdrawals.lift(row.id, liftedFrom, code),
        );
        if (!outcome.done) return null;
        await reload();
        return outcome.value;
    }

    return { rows, loading, error, reload, lift };
}
