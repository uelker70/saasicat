import { AUTH_ERROR_CODES } from '@saasicat/core';
import { ref, type Ref } from 'vue';

import { toAdminError } from '../client/admin-error.js';

/** The status a route answers with when it refuses the code: wrong, expired, or missing. */
const CODE_REFUSED = 401;

/**
 * The codes of a `401` that no other code can change: the second factor was
 * never set up, or nobody is signed in. Asking again would only repeat the
 * refusal under the wrong sentence.
 */
const NO_CODE_HELPS: ReadonlySet<string> = new Set([
    AUTH_ERROR_CODES.MFA_NOT_SET_UP,
    AUTH_ERROR_CODES.NOT_AUTHENTICATED,
]);

/** Whether the route refused the code itself, so another code may pass. */
function refusedTheCode(err: unknown): boolean {
    const error = toAdminError(err);
    if (error.status !== CODE_REFUSED) return false;
    return error.code === undefined || !NO_CODE_HELPS.has(error.code);
}

/** What became of an action taken behind the second factor. */
export type MfaOutcome<T> = { readonly done: true; readonly value: T } | { readonly done: false };

/**
 * Turns the MFA dialog into an awaitable step.
 *
 * A write flow that needs a second factor wants to read as one function:
 * ask for the code, then call the API with it. What that needs is a promise
 * the dialog resolves — and the plumbing for that (a visibility flag, an
 * error slot, a description, and a resolver held between two event handlers)
 * was spelled out identically on five standard pages.
 *
 * Cancelling resolves to `null` rather than rejecting: a user closing the
 * dialog is an outcome, not an error, and `if (!code) return` reads better at
 * the call site than a try/catch around the happy path.
 */
export interface MfaPrompt {
    /** Bind to the dialog's `model-value`. */
    readonly show: Ref<boolean>;
    /** Bind to the dialog's `description`. */
    readonly description: Ref<string>;
    /** Bind to the dialog's `error`; set it to keep the dialog open on a failed code. */
    readonly error: Ref<string>;
    /** Resolves with the entered code, or `null` when the user cancels. */
    prompt: (description: string) => Promise<string | null>;
    /** Bind to the dialog's `confirm` event. */
    onConfirm: (code: string) => void;
    /** Bind to the dialog's `update:model-value` event. */
    onVisibility: (open: boolean) => void;
    /** Closes the dialog and cancels a pending prompt. */
    close: () => void;
    /**
     * Asks for a code and runs `action` with it, until the server accepts the
     * code or the user cancels.
     *
     * A refused code keeps the dialog open with `invalidCode` and asks again,
     * because the operator can fix that without starting over. Any other
     * failure closes the dialog and is rethrown: it is the action's own error,
     * and the caller already knows how to show it. So is a `401` whose code
     * says no code helps — `MFA_NOT_SET_UP`, `NOT_AUTHENTICATED` — whose own
     * sentence the caller shows.
     */
    run: <T>(
        description: string,
        invalidCode: string,
        action: (code: string) => Promise<T>,
    ) => Promise<MfaOutcome<T>>;
}

export function useMfaPrompt(): MfaPrompt {
    const show = ref(false);
    const description = ref('');
    const error = ref('');
    let pendingResolve: ((code: string | null) => void) | null = null;

    function settle(code: string | null): void {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve?.(code);
    }

    function prompt(next: string): Promise<string | null> {
        // A prompt opening while another is pending would strand the first
        // caller's promise forever; cancel it rather than leak it.
        settle(null);
        description.value = next;
        error.value = '';
        show.value = true;
        return new Promise((resolve) => {
            pendingResolve = resolve;
        });
    }

    return {
        show,
        description,
        error,
        prompt,
        onConfirm(code: string): void {
            settle(code);
        },
        onVisibility(open: boolean): void {
            show.value = open;
            if (!open) settle(null);
        },
        close(): void {
            show.value = false;
            settle(null);
        },
        async run<T>(
            next: string,
            invalidCode: string,
            action: (code: string) => Promise<T>,
        ): Promise<MfaOutcome<T>> {
            let refused = false;
            for (;;) {
                const pending = prompt(next);
                // `prompt` opens with a clean slate, so a refused code is said
                // on the dialog it reopens rather than before it.
                if (refused) error.value = invalidCode;
                const code = await pending;
                if (code === null) return { done: false };
                try {
                    const value = await action(code);
                    show.value = false;
                    return { done: true, value };
                } catch (err) {
                    if (!refusedTheCode(err)) {
                        show.value = false;
                        throw err;
                    }
                    refused = true;
                }
            }
        },
    };
}
