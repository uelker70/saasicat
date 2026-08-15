// The half of the theme switch that touches the DOM and Quasar.
//
// Two things have to agree, or the screen ends up half-dark:
//
//   `data-sa-theme` on <html>   drives the platform's own role tokens
//   Quasar's `Dark.set()`       drives q-card, q-table, q-menu, q-dialog …
//
// The stylesheet already accepts Quasar's `body--dark` as a dark trigger, so an
// app that only calls `$q.dark.set(true)` is complete without this module. What
// the bridge adds is the other direction — an operator switching the theme in
// the admin's own header — and, once both exist, keeping them from disagreeing:
// it watches BOTH and writes each into the other.

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
    const toQuasar = watch(
        theme.resolved,
        (resolved) => {
            if (typeof document !== 'undefined') {
                document.documentElement.setAttribute('data-sa-theme', resolved);
            }
            Dark.set(resolved === 'dark');
        },
        { immediate: true },
    );

    // …and back. An app with its own toggle calls `$q.dark.set(false)`, which
    // this side of the bridge never hears: the theme has not changed, so
    // `data-sa-theme="dark"` stays on `<html>` while Quasar goes light. That is
    // the half-dark screen the bridge exists to prevent, arriving from the
    // other direction.
    //
    // `Dark.mode` rather than `Dark.isActive`, because the mode has the three
    // states the scheme has and the flag has two. `Dark.set('auto')` is
    // Quasar's spelling of 'system', and read through the flag it arrives as
    // whatever the machine happens to say at that moment — so an operator who
    // picked 'system' had it silently frozen into a hard 'light' or 'dark' by
    // an app doing nothing wrong, and the tab stopped following the OS. The
    // seed in `createSuperAdminApp` reads the same option for the same reason.
    //
    // No loop: a boolean mode is only written back when Quasar and the theme
    // actually disagree, and setting the scheme drives `resolved` to the value
    // Quasar already has, so the outbound watcher's `Dark.set` is a no-op. The
    // 'auto' branch settles the same way — `Dark.set(boolean)` leaves the mode
    // agreeing with a 'system' that already resolves to it.
    const fromQuasar = watch(
        () => Dark.mode,
        (mode) => {
            if (mode === 'auto') {
                theme.scheme.value = 'system';
                return;
            }
            const asScheme = mode === true ? 'dark' : 'light';
            if (theme.resolved.value !== asScheme) theme.scheme.value = asScheme;
        },
    );

    return () => {
        toQuasar();
        fromQuasar();
    };
}
