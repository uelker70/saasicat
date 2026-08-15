// Quasar implementation of the UI confirm port.
//
// Standard pages resolve the port via `useSuperAdminConfirm()`: the
// app-provided port wins, otherwise the Quasar default below. The fallback
// keeps apps working that mount the standard pages without
// `createSuperAdminApp()` — and it is only safe as a fallback because it still
// asks the operator. A default that resolved `{ ok: true }` would silently
// approve every delete, revoke and deactivation.

import { inject } from 'vue';
import { Dialog, type QDialogOptions } from 'quasar';

import {
    SUPER_ADMIN_CONFIRM_KEY,
    type UiConfirm,
    type UiConfirmRequest,
    type UiConfirmResult,
} from '../vue/ui-confirm.js';

/**
 * Translates a request into Quasar's dialog options.
 *
 * Exported because it is the whole of the mapping and the only part of this
 * file that can be checked without driving a real dialog.
 */
export function quasarConfirmOptions(request: UiConfirmRequest): QDialogOptions {
    return {
        title: request.title,
        message: request.message,
        cancel: request.cancelLabel,
        ok: { label: request.confirmLabel, color: request.tone ?? 'primary' },
        ...(request.prompt
            ? {
                  prompt: {
                      model: request.prompt.initial ?? '',
                      type: request.prompt.type ?? 'text',
                  },
              }
            : {}),
    };
}

/**
 * Quasar-backed confirm port.
 *
 * `onOk` and `onCancel` are mutually exclusive and one of them always runs —
 * dismissing with Escape or a backdrop click reaches `onCancel` — so the
 * promise cannot be left hanging.
 */
export const quasarConfirm: UiConfirm = (request) =>
    new Promise<UiConfirmResult>((resolve) => {
        Dialog.create(quasarConfirmOptions(request))
            .onOk((value: unknown) => {
                // Without a `prompt` Quasar calls back with no argument at all.
                resolve({ ok: true, value: typeof value === 'string' ? value : undefined });
            })
            .onCancel(() => resolve({ ok: false }));
    });

/** Returns the app-provided confirm port, falling back to the Quasar default. */
export function useSuperAdminConfirm(): UiConfirm {
    return inject(SUPER_ADMIN_CONFIRM_KEY, quasarConfirm);
}
