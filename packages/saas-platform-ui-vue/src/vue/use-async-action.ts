// One async mutation, with the state a page otherwise writes by hand.
//
// The pages hold this shape 20-odd times: a `ref(false)` set true before the
// call and false in `finally`, an error ref cleared before and written in
// `catch`, and a toast raised on one or both outcomes. Written out each time,
// the parts drift — some clear the error first and some do not, some toast on
// failure and some only render it, and each one re-derives its message from a
// raw `unknown`.
//
// `run` does not re-throw. A wrapper that recorded the failure and then threw
// it again would leave every call site with the `try`/`catch` this exists to
// remove, so the return type says what actually happens: `undefined` means the
// call failed, and `error` says why.

import { inject, ref, type Ref } from 'vue';

import { adminErrorMessage, toAdminError, type AdminError } from '../client/admin-error.js';
import { useSaMessages } from './use-super-admin-i18n.js';
import { SUPER_ADMIN_NOTIFY_KEY, type UiNotify } from './ui-notify.js';

export interface AsyncAction<A extends unknown[], T> {
    /** Runs the action. Resolves `undefined` when it failed. */
    run: (...args: A) => Promise<T | undefined>;
    /** True while the call is in flight — what a submit button disables on. */
    pending: Ref<boolean>;
    /** The last failure, or `null`. Cleared at the start of every run. */
    error: Ref<AdminError | null>;
    /** Clears `error` without running anything. */
    reset: () => void;
}

export interface UseAsyncActionOptions<T> {
    /**
     * Which outcomes raise a toast. Default `'error'` — a success that changed
     * something visible needs no announcement, a failure always does.
     */
    notifyOn?: 'error' | 'both' | 'none';
    /** Text for the success toast. Required for `notifyOn: 'both'` to say anything. */
    successMessage?: string | (() => string);
    /**
     * Overrides how a failure is worded.
     *
     * Not decoration: several pages map a status and an error code to a
     * specific sentence — a 422 carrying `STRICT_MODE_VIOLATIONS` reads out the
     * violations, a 401 says the session expired. `AdminError` carries
     * `status`, `code` and `body`, so that mapping is a pure function of the
     * error, and this is where it attaches.
     */
    errorMessage?: (error: AdminError) => string;
    /** Runs after a successful call, before `run` resolves. */
    onSuccess?: (result: T) => void | Promise<void>;
    /**
     * Notify port to report through. Defaults to the injected one.
     *
     * There is no fallback beyond that: this layer must not import Quasar, so
     * it cannot reach `quasarNotify` the way a page can. Without a bootstrap
     * and without this option, failures are reported through `error` alone.
     */
    notify?: UiNotify;
}

export function useAsyncAction<A extends unknown[], T>(
    fn: (...args: A) => Promise<T>,
    options: UseAsyncActionOptions<T> = {},
): AsyncAction<A, T> {
    const pending = ref(false);
    const error = ref<AdminError | null>(null);
    const notify = options.notify ?? inject(SUPER_ADMIN_NOTIFY_KEY, undefined);
    const messages = useSaMessages('errors');
    const notifyOn = options.notifyOn ?? 'error';

    async function run(...args: A): Promise<T | undefined> {
        pending.value = true;
        error.value = null;
        try {
            const result = await fn(...args);
            if (notifyOn === 'both') {
                const message =
                    typeof options.successMessage === 'function'
                        ? options.successMessage()
                        : options.successMessage;
                if (message) notify?.('positive', message);
            }
            await options.onSuccess?.(result);
            return result;
        } catch (err: unknown) {
            const adminError = toAdminError(err);
            error.value = adminError;
            if (notifyOn !== 'none') {
                notify?.(
                    'negative',
                    options.errorMessage?.(adminError) ??
                        adminErrorMessage(adminError, messages.value),
                );
            }
            return undefined;
        } finally {
            pending.value = false;
        }
    }

    return {
        run,
        pending,
        error,
        reset: () => {
            error.value = null;
        },
    };
}
