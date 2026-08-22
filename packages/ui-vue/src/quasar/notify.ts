// Quasar implementation of the UI notify port.
//
// Standard pages resolve the port via `useSuperAdminNotify()`: the app-provided
// port wins, otherwise the Quasar default below. The fallback keeps apps
// working that mount the standard pages without `createSuperAdminApp()`
// (their own `main.ts` installs the Quasar Notify plugin, as before).

import { inject } from 'vue';
import { Notify } from 'quasar';

import { SUPER_ADMIN_NOTIFY_KEY, type UiNotify } from '../vue/ui-notify.js';

/**
 * Quasar-backed notify port: `position: 'top'` matches the convention the
 * standard pages used with their previous direct `$q.notify` calls.
 */
export const quasarNotify: UiNotify = (kind, message, options) => {
    Notify.create({
        type: kind,
        message,
        position: 'top',
        caption: options?.caption,
        timeout: options?.timeoutMs,
    });
};

/** Returns the app-provided notify port, falling back to the Quasar default. */
export function useSuperAdminNotify(): UiNotify {
    return inject(SUPER_ADMIN_NOTIFY_KEY, quasarNotify);
}
