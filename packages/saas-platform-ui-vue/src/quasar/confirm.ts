// Quasar implementation of the UI confirm port.
//
// The port is wired but not yet consumed by this package's own pages.
// `createSuperAdminApp()` provides it under `SUPER_ADMIN_CONFIRM_KEY` and
// `useSuperAdminConfirm()` below resolves it — but nothing under `src/` calls
// that hook. Its only call site in the repository is
// `tests-component/ui-confirm-port.test.ts`.
//
// The pages that do ask a yes/no question ask it in one of three other ways:
// Quasar's `q.dialog()`, `window.confirm()`, or a dialog the page mounts
// itself. Which page uses which shape moves as pages are reworked, so the
// pages are not listed here — grepping those three shapes under
// `src/pages-standard/` and `src/pages-tenant/` finds every one of them.
//
// An app that passes `createSuperAdminApp({ confirm })` therefore replaces the
// confirmations of its own pages and none of this package's. Moving them onto
// the hook is the page migration; the "Confirm port" section of this package's
// README carries the same caveat for integrators.
//
// The injection default keeps a page working that is mounted without
// `createSuperAdminApp()` — and it is only safe as a default because it still
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
