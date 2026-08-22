// UI notify port — the single toast/snackbar seam between platform pages and
// the host app. Standard pages emit user feedback exclusively through this
// port; which component library renders it is the app's choice.
//
// `createSuperAdminApp()` (`@saasicat/ui-vue/quasar`) provides a
// Quasar-backed default; apps override it via
// `createSuperAdminApp({ notify })` or by providing the key themselves.

import type { InjectionKey } from 'vue';

/**
 * Feedback kind, aligned with the established page conventions
 * (`positive` = success, `negative` = error).
 */
export type UiNotifyKind = 'positive' | 'negative' | 'warning' | 'info';

export interface UiNotifyOptions {
    /** Secondary line below the message (e.g. changed fields, one-time password). */
    caption?: string;
    /** Display duration in ms; implementations fall back to their default when unset. */
    timeoutMs?: number;
}

/** Notify port. Compatible with the `(kind, message)` callbacks pages already accept. */
export type UiNotify = (kind: UiNotifyKind, message: string, options?: UiNotifyOptions) => void;

/** Vue inject key for the notify port (see `Symbol.for` note in super-admin-context.ts). */
export const SUPER_ADMIN_NOTIFY_KEY: InjectionKey<UiNotify> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_NOTIFY',
);
