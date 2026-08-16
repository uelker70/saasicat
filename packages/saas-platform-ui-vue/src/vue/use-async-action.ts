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
// remove, so the outcome is in the return value instead.
//
// It is a discriminated result rather than `T | undefined`, because the second
// shape cannot answer the question for the actions this package has most of.
// `softDelete`, `discardDraft`, `remove` and their siblings resolve
// `Promise<void>`: a successful call already produces `undefined`, so
// "`undefined` means it failed" was a signal that did not exist there — and
// TypeScript narrows the success branch of `void | undefined` to `never`, so
// the wrong call site compiles, lints clean, and silently never runs its
// follow-up.

import { inject, ref, type Ref } from 'vue';

import { adminErrorMessage, toAdminError, type AdminError } from '../client/admin-error.js';
import { useSaMessages } from './use-super-admin-i18n.js';
import { SUPER_ADMIN_NOTIFY_KEY, type UiNotify } from './ui-notify.js';

/**
 * What an action did. `ok` is the branch to read — it answers for a
 * `Promise<void>` action exactly as well as for one that returns a row.
 */
export type AsyncActionResult<T> = { ok: true; value: T } | { ok: false; error: AdminError };

export interface AsyncAction<A extends unknown[], T> {
    /** Runs the action. Never throws; the outcome is in the result. */
    run: (...args: A) => Promise<AsyncActionResult<T>>;
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
    // How many invocations are in flight. A second `run` before the first
    // settles would otherwise let the first one's `finally` clear `pending`,
    // and a button disabled from that ref becomes clickable again while the
    // mutation it belongs to is still running — which is how a double submit
    // happens.
    let inFlight = 0;

    async function run(...args: A): Promise<AsyncActionResult<T>> {
        inFlight++;
        pending.value = true;
        error.value = null;
        try {
            const result = await fn(...args);
            // The continuation runs BEFORE the success toast. It is part of
            // the action — a reload, a navigation — and when it fails the
            // action failed. Announcing success first produced both toasts:
            // "Saved" and then "reload failed", in that order.
            await options.onSuccess?.(result);
            if (notifyOn === 'both') {
                const message =
                    typeof options.successMessage === 'function'
                        ? options.successMessage()
                        : options.successMessage;
                if (message) notify?.('positive', message);
            }
            return { ok: true, value: result };
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
            return { ok: false, error: adminError };
        } finally {
            if (--inFlight === 0) pending.value = false;
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
