// UI confirm port — the seam a page asks a question through before doing
// something it cannot undo. The counterpart to the notify port next door:
// pages state what they need answered, the host app decides what that looks
// like.
//
// `createSuperAdminApp()` (`@saasicat/ui-vue/quasar`) provides a Quasar-backed
// default; apps override it via `createSuperAdminApp({ confirm })` or by
// providing the key themselves.
//
// The shape is taken from the six confirmations the standard pages actually
// raise, not from what a confirm dialog could be in general. Three of them ask
// a yes/no question; three also need a value back — an audit reason the backend
// requires before it will reset a password or deactivate a user, and a date a
// pilot is extended to. A port returning a bare boolean would leave those three
// on a direct Quasar call, which is the thing this port exists to remove.
//
// One dialog in the pages is deliberately NOT modelled here: `UsersPage` shows
// a generated one-time password with a single acknowledge button. It asks
// nothing, and giving it a cancel button would let an operator dismiss a
// password that cannot be retrieved again.

import type { InjectionKey } from 'vue';

/**
 * How the confirming button is coloured. `negative` marks an action that
 * destroys or revokes something; `primary` marks one that does not.
 */
export type UiConfirmTone = 'primary' | 'negative';

/** Asks for a value along with the confirmation. */
export interface UiConfirmPrompt {
    /** Pre-filled value, e.g. the date a pilot currently ends on. */
    initial?: string;
    /** Input kind. Only the two the standard pages need. */
    type?: 'text' | 'date';
}

export interface UiConfirmRequest {
    /** What is about to happen, naming the subject. */
    title: string;
    /**
     * The consequence, in a sentence. For an action that cannot be reversed,
     * say so here rather than asking "are you sure".
     */
    message: string;
    /** Label of the confirming button — a verb, not "OK". */
    confirmLabel: string;
    /** Label of the dismissing button. */
    cancelLabel: string;
    /** Default `primary`. Destructive actions pass `negative`. */
    tone?: UiConfirmTone;
    /** When set, the operator is asked for a value as well. */
    prompt?: UiConfirmPrompt;
}

export interface UiConfirmResult {
    /** Whether the operator confirmed. Dismissing counts as `false`. */
    ok: boolean;
    /**
     * What the operator entered, when the request carried a `prompt`.
     * `undefined` otherwise, and whenever `ok` is `false`.
     */
    value?: string;
}

/**
 * Confirm port. Resolves once the operator has answered — an implementation
 * that resolves `{ ok: true }` without asking would turn every guarded action
 * into an unguarded one, so there is no such default.
 */
export type UiConfirm = (request: UiConfirmRequest) => Promise<UiConfirmResult>;

/** Vue inject key for the confirm port (see `Symbol.for` note in super-admin-context.ts). */
export const SUPER_ADMIN_CONFIRM_KEY: InjectionKey<UiConfirm> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_CONFIRM',
);
