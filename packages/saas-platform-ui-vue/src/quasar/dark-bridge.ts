// The half of the theme switch that touches the DOM and Quasar.
//
// Two things have to agree, or the screen ends up half-dark:
//
//   `data-sa-theme` on <html>   drives the platform's own role tokens
//   Quasar's `Dark.set()`       drives q-card, q-table, q-menu, q-dialog …
//
// The stylesheet already accepts Quasar's `body--dark` as a dark trigger, so an
// app that only calls `$q.dark.set(true)` is complete without this module. This
// is the other direction — an operator switching the theme in the admin's own
// header — and it exists so there is exactly one switch either way.

import { Dark } from 'quasar';
import { watch, type WatchStopHandle } from 'vue';

import type { SaTheme } from '../vue/use-sa-theme.js';

/**
 * Mirrors a theme context onto the document and Quasar. Returns the stop
 * handle; `createSuperAdminApp()` wires this up for you.
 *
 * `immediate` is not optional: at bootstrap the stored pick is already resolved
 * and nothing has painted yet, so a first-change-only watcher would render one
 * frame in the wrong theme on every reload.
 *
 * That first tick MIRRORS, it does not negotiate — whatever `theme.resolved`
 * says is written to Quasar, including `Dark.set(false)`. So a caller that
 * bootstraps with Quasar already dark has to say so when it builds the theme,
 * or its own choice is erased one line after it was applied.
 * `createSuperAdminApp` does exactly that, seeding from `Dark.isActive`.
 */
export function bindSaThemeToDocument(theme: SaTheme): WatchStopHandle {
    return watch(
        theme.resolved,
        (resolved) => {
            if (typeof document !== 'undefined') {
                document.documentElement.setAttribute('data-sa-theme', resolved);
            }
            Dark.set(resolved === 'dark');
        },
        { immediate: true },
    );
}
