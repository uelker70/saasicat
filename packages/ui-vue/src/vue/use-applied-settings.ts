// The settings page's state: the view, and the one action a person can take on it.
//
// A composable rather than page script, so the SFC arranges and binds while
// the load/acknowledge sequence — and its failure states — can be checked with
// `node --test` against `dist/`, like the rest of this layer. Both seams are
// handed in rather than looked up: the bound resource, so a test drives it with
// two functions instead of a registry; and the notify port, because this layer
// knows no Quasar and the page hands it the one the shell provides.
//
// The read half is `useAsyncData`: it owns the ordering of overlapping loads
// and puts the view back to null when one fails, so last visit's facts never
// sit under an error banner as if they were current — on the page whose whole
// point is telling an operator whether their edit has landed.

import { ref, type Ref } from 'vue';

import type { AdminError } from '../client/admin-error.js';
import type { Bound } from '../client/resources/define-resource.js';
import type {
    AppliedSettingsView,
    settingsResource,
} from '../client/resources/settings.resource.js';
import type { UiNotify } from './ui-notify.js';
import { useAsyncData } from './use-async-data.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The two operations the page calls, already bound to the shell's client. */
export type AppliedSettingsResource = Bound<(typeof settingsResource)['ops']>;

export interface AppliedSettingsState {
    /** What the endpoint answered; null before the first load and after a failed one. */
    view: Ref<AppliedSettingsView | null>;
    loading: Ref<boolean>;
    /** The last load's failure, or null. */
    error: Ref<AdminError | null>;
    /** The ids being acknowledged right now, so each button reports its own request. */
    acknowledging: Ref<ReadonlySet<string>>;
    reload(): Promise<void>;
    acknowledge(id: string): Promise<void>;
}

export function useAppliedSettings(
    settings: AppliedSettingsResource,
    notify: UiNotify,
): AppliedSettingsState {
    const msg = useSaMessages('settings');
    const {
        data: view,
        pending: loading,
        error,
        reload,
    } = useAsyncData<AppliedSettingsView | null>(() => settings.read(), { initial: null });
    const acknowledging = ref(new Set<string>());

    async function acknowledge(id: string): Promise<void> {
        acknowledging.value.add(id);
        try {
            const acknowledged = await settings.acknowledgeChange(id);
            // What the server answered, in place: the first author stands,
            // whatever this click was.
            if (view.value) {
                view.value = {
                    ...view.value,
                    changes: view.value.changes.map((change) =>
                        change.id === id ? acknowledged : change,
                    ),
                };
            }
        } catch {
            // Reported where the person is looking; the change stays open, so
            // nothing else needs to hear about it.
            notify('negative', msg.value.acknowledgeFailed);
        } finally {
            acknowledging.value.delete(id);
        }
    }

    return { view, loading, error, acknowledging, reload, acknowledge };
}
