// The settings page's state: the view, and the one action a person can take on it.
//
// A composable rather than page script, so the SFC arranges and binds while
// the load/acknowledge sequence — and its two failure states — can be checked
// with `node --test` against `dist/`, like the rest of this layer. Both seams
// are handed in rather than looked up: the bound resource, so a test drives it
// with two functions instead of a registry; and the notify port, because this
// layer knows no Quasar and the page hands it the one the shell provides.

import { onMounted, ref, type Ref } from 'vue';

import type { Bound } from '../client/resources/define-resource.js';
import type {
    AppliedSettingsView,
    settingsResource,
} from '../client/resources/settings.resource.js';
import type { UiNotify } from './ui-notify.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The two operations the page calls, already bound to the shell's client. */
export type AppliedSettingsResource = Bound<(typeof settingsResource)['ops']>;

export interface AppliedSettingsState {
    view: Ref<AppliedSettingsView | null>;
    loading: Ref<boolean>;
    /** Whatever the last load threw; null while the view is good. */
    error: Ref<unknown | null>;
    /** The id being acknowledged right now, so its button alone shows progress. */
    acknowledging: Ref<string | null>;
    reload(): Promise<void>;
    acknowledge(id: string): Promise<void>;
}

export function useAppliedSettings(
    settings: AppliedSettingsResource,
    notify: UiNotify,
): AppliedSettingsState {
    const msg = useSaMessages('settings');

    const view = ref<AppliedSettingsView | null>(null);
    const loading = ref(false);
    const error = ref<unknown | null>(null);
    const acknowledging = ref<string | null>(null);

    async function reload(): Promise<void> {
        loading.value = true;
        try {
            view.value = await settings.read();
            error.value = null;
        } catch (err) {
            error.value = err;
        } finally {
            loading.value = false;
        }
    }

    async function acknowledge(id: string): Promise<void> {
        acknowledging.value = id;
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
            acknowledging.value = null;
        }
    }

    onMounted(reload);

    return { view, loading, error, acknowledging, reload, acknowledge };
}
