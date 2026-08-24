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

import { bindSaThemeAttribute, type SaColorScheme, type SaTheme } from '../vue/use-sa-theme.js';

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
 * `createSuperAdminApp` does exactly that, seeding the scheme from the
 * `quasarOptions.config.dark` it was handed.
 */
export function bindSaThemeToDocument(theme: SaTheme): WatchStopHandle {
    // Raised only while this bridge is inside `Dark.set()`. It is what the
    // write-back below reads to tell the bridge's own echo apart from a
    // decision the application made — see the comment on that watcher.
    let mirroring = false;

    // The platform half — `data-sa-theme` on <html> — is `bindSaThemeAttribute`,
    // in the framework-free layer, because an app that embeds only the tenant
    // components needs it and must not need Quasar to get it. What is left here
    // is the Quasar half and the two-way agreement between them.
    const stopAttribute = bindSaThemeAttribute(theme);

    const toQuasar = watch(
        theme.resolved,
        (resolved) => {
            mirroring = true;
            try {
                Dark.set(resolved === 'dark');
            } finally {
                mirroring = false;
            }
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
    // No loop, and the question that closes it is "who wrote this?", not "does
    // it look different?". The outbound leg mirrors 'system' into Quasar as the
    // colour it currently resolves to, so a colour comparison cannot tell that
    // echo apart from an application naming the same colour on purpose: moving
    // a control from `set('auto')` to `set(true)` on a dark machine changes
    // `Dark.mode` while the resolved colour stays 'dark'. Dropping that write
    // left the pick on 'system' with nothing visibly wrong — until the next OS
    // change moved a theme somebody had just fixed.
    //
    // `Dark.set()` assigns `Dark.mode` synchronously and this watcher runs on
    // the sync flush, so the flag is still raised when the bridge's own write
    // arrives here, and is down for every write that came from anywhere else.
    //
    // One case stays unanswerable, because Quasar leaves no trace of it: a
    // `set(true)` while the mode is already `true` — an operator on 'system'
    // and a dark machine, whose application then pins dark. Nothing in `Dark`
    // changes, so there is no event to read and the pick stays 'system'. An
    // application that wants that pick to stick sets `theme.scheme` instead.
    const fromQuasar = watch(
        () => Dark.mode,
        (mode) => {
            if (mirroring) return;
            const picked: SaColorScheme =
                mode === 'auto' ? 'system' : mode === true ? 'dark' : 'light';
            if (theme.scheme.value !== picked) theme.scheme.value = picked;
        },
        { flush: 'sync' },
    );

    return () => {
        stopAttribute();
        toQuasar();
        fromQuasar();
    };
}
