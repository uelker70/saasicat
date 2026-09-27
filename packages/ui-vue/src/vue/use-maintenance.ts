// The maintenance page's state: the open window and the ones before it, and
// the five things an operator does to them.
//
// A composable rather than page script, so the SFC arranges and binds while
// the sequences — confirm, second factor, write, reload — and their failure
// states can be checked with `node --test` against `dist/`. The resource, the
// notify and confirm ports and the second-factor prompt are handed in: this
// layer knows no Quasar, and the page renders the prompt's dialog.
//
// Locking and unlocking ask for a confirmation that says what happens to every
// tenant, then for the second factor (`SC-ADM-029`); cancelling asks for the
// confirmation only. Announcing and moving go through a form dialog, whose
// submit is the confirmation.

import { computed, type ComputedRef, type Ref } from 'vue';
import type { MaintenanceOverview, MaintenanceWindowView } from '@saasicat/core';

import { adminErrorMessage, type AdminError } from '../client/admin-error.js';
import { formatMessage } from '../client/i18n/format.js';
import type { Bound } from '../client/resources/define-resource.js';
import type {
    MaintenanceAnnouncementInput,
    MaintenanceLockInput,
    MaintenanceRevisionInput,
    maintenanceResource,
} from '../client/resources/maintenance.resource.js';
import type { UiConfirm } from './ui-confirm.js';
import type { UiNotify } from './ui-notify.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useAsyncData } from './use-async-data.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The operations the page calls, already bound to the shell's client. */
export type MaintenanceResource = Bound<(typeof maintenanceResource)['ops']>;

/** What became of a lock or an unlock the operator asked for. */
export type MaintenanceActionOutcome = 'done' | 'unchanged' | 'cancelled' | 'failed';

export interface MaintenanceState {
    /** What the endpoint answered; null before the first load and after a failed one. */
    overview: Ref<MaintenanceOverview | null>;
    loading: Ref<boolean>;
    /** The last load's failure, or null. */
    error: Ref<AdminError | null>;
    /** The open window, announced or locked. */
    open: ComputedRef<MaintenanceWindowView | null>;
    reload(): Promise<void>;
    /** For a form dialog's `submit`: rejects, so the dialog keeps the form and shows why. */
    announce(input: MaintenanceAnnouncementInput): Promise<void>;
    reschedule(id: string, input: MaintenanceRevisionInput): Promise<void>;
    /** Behind a confirmation; reports its outcome itself. */
    cancel(id: string): Promise<MaintenanceActionOutcome>;
    /** Behind a confirmation and the second factor; reports its outcome itself. */
    lock(input: MaintenanceLockInput): Promise<MaintenanceActionOutcome>;
    unlock(windowId: string | undefined): Promise<MaintenanceActionOutcome>;
}

export function useMaintenance(
    maintenance: MaintenanceResource,
    notify: UiNotify,
    confirm: UiConfirm,
    mfa: MfaPrompt,
): MaintenanceState {
    const msg = useSaMessages('maintenance');
    const errors = useSaMessages('errors');
    const shell = useSaMessages('shell');
    const common = useSaMessages('common');
    const {
        data: overview,
        pending: loading,
        error,
        reload,
    } = useAsyncData<MaintenanceOverview | null>(() => maintenance.overview(), {
        initial: null,
    });
    const open = computed(() => overview.value?.open ?? null);

    async function announce(input: MaintenanceAnnouncementInput): Promise<void> {
        await maintenance.announce(input);
        await reload();
    }

    async function reschedule(id: string, input: MaintenanceRevisionInput): Promise<void> {
        await maintenance.reschedule(id, input);
        await reload();
    }

    /** Asks the operator; `true` once they agreed. */
    async function agreed(title: string, message: string, confirmLabel: string): Promise<boolean> {
        const answer = await confirm({
            title,
            message,
            confirmLabel,
            cancelLabel: common.value.cancel,
            tone: 'negative',
        });
        return answer.ok;
    }

    async function cancel(id: string): Promise<MaintenanceActionOutcome> {
        const c = msg.value.confirm;
        if (!(await agreed(c.cancelTitle, c.cancelMessage, c.cancelConfirm))) return 'cancelled';
        try {
            await maintenance.cancel(id);
        } catch (err) {
            notify('negative', adminErrorMessage(err, errors.value));
            return 'failed';
        }
        notify('positive', c.cancelled);
        await reload();
        return 'done';
    }

    /** Runs a write behind the second factor and says what became of it. */
    async function behindSecondFactor<T>(
        description: string,
        write: (code: string) => Promise<T>,
    ): Promise<{ outcome: 'cancelled' | 'failed' } | { outcome: 'done'; value: T }> {
        try {
            const result = await mfa.run(description, shell.value.mfa.invalidCode, write);
            if (!result.done) return { outcome: 'cancelled' };
            return { outcome: 'done', value: result.value };
        } catch (err) {
            notify('negative', adminErrorMessage(err, errors.value));
            return { outcome: 'failed' };
        }
    }

    async function lock(input: MaintenanceLockInput): Promise<MaintenanceActionOutcome> {
        const c = msg.value.confirm;
        if (!(await agreed(c.lockTitle, c.lockMessage, c.lockConfirm))) return 'cancelled';
        const result = await behindSecondFactor(msg.value.confirm.mfaLock, (code) =>
            maintenance.lock(input, code),
        );
        if (result.outcome !== 'done') return result.outcome;
        const { alreadyLocked, takesEffectWithinSeconds } = result.value;
        notify(
            alreadyLocked ? 'info' : 'positive',
            alreadyLocked
                ? msg.value.confirm.alreadyLocked
                : formatMessage(msg.value.confirm.locked, { seconds: takesEffectWithinSeconds }),
        );
        await reload();
        return alreadyLocked ? 'unchanged' : 'done';
    }

    async function unlock(windowId: string | undefined): Promise<MaintenanceActionOutcome> {
        const c = msg.value.confirm;
        if (!(await agreed(c.unlockTitle, c.unlockMessage, c.unlockConfirm))) return 'cancelled';
        const result = await behindSecondFactor(msg.value.confirm.mfaUnlock, (code) =>
            maintenance.unlock({ windowId }, code),
        );
        if (result.outcome !== 'done') return result.outcome;
        const { wasLocked } = result.value;
        notify(
            wasLocked ? 'positive' : 'info',
            wasLocked ? msg.value.confirm.unlocked : msg.value.confirm.nothingLocked,
        );
        await reload();
        return wasLocked ? 'done' : 'unchanged';
    }

    return { overview, loading, error, open, reload, announce, reschedule, cancel, lock, unlock };
}
