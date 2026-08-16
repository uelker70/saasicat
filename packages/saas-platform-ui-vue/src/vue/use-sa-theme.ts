// The colour-scheme switch. Framework-neutral half: no Quasar import here, so
// the main entry stays free of an optional peer dependency (`src/quasar/
// dark-bridge.ts` is the half that talks to Quasar and the DOM).
//
// Three schemes, and `'system'` is the default because it is the only one that
// is right without being asked. `resolved` collapses it to the two the
// stylesheet knows about, so a caller never has to ask "and what does 'system'
// mean right now".
//
// Following the operating system lives HERE and not in the stylesheet, and
// that is load-bearing rather than tidy. The stylesheet paints the platform's
// surfaces; Quasar paints its own cards, dialogs and steppers, and follows only
// `body--dark`. A media query in the stylesheet moves one of them — measured on
// an embedded page with the OS set to dark, that meant a white Quasar card
// carrying near-white platform text. Only the application can move both, so
// only the application decides, and this is where it does.

import {
    computed,
    inject,
    isReadonly,
    isRef,
    ref,
    watch,
    type ComputedRef,
    type InjectionKey,
    type Ref,
} from 'vue';

import { defaultKvStore, type KvStore } from '../client/types.js';

export type SaColorScheme = 'light' | 'dark' | 'system';
export type SaResolvedScheme = 'light' | 'dark';

/** The schemes the switcher offers, in the order it lists them. */
export const SA_COLOR_SCHEMES: readonly SaColorScheme[] = ['light', 'dark', 'system'];

/** `KvStore` key holding the scheme the operator picked in the switcher. */
export const SA_THEME_STORAGE_KEY = 'saasicat.theme.scheme';

export interface SaTheme {
    /** What the operator picked. Writable — assigning switches the theme. */
    scheme: Ref<SaColorScheme>;
    /** What that means right now: `'system'` resolved against the OS. */
    resolved: ComputedRef<SaResolvedScheme>;
    /**
     * Whether the shell renders its theme switcher. `false` when the app opted
     * out or when `scheme` cannot be written to — a switcher that cannot change
     * anything is worse than none.
     */
    switcherEnabled: boolean;
    /**
     * Releases the `prefers-color-scheme` subscription and the persistence
     * watcher. Idempotent.
     *
     * Needed because this context outlives no component — nothing unmounts it.
     * A second shell in the same document (hot reload, a micro-frontend, a
     * second test file) would otherwise leave the first one subscribed, and the
     * next change of the operating system's theme would drive TWO bridges, both
     * writing `data-sa-theme` and Quasar's `Dark` onto the one document. The
     * stale one can win, and then the new shell's explicit scheme is overruled
     * by a context nobody holds a reference to any more.
     */
    dispose: () => void;
}

export interface SaThemeOptions {
    /** Starting scheme. Pass a `Ref` to keep the value in your own store. */
    scheme?: SaColorScheme | Ref<SaColorScheme>;
    /**
     * Remember the operator's pick across reloads, default `true`. Ignored when
     * `scheme` is a `Ref`: the app owns that value and persists it where it
     * belongs. Same rule as the locale in `createSuperAdminI18n`.
     */
    persist?: boolean;
    /** Injection seam for tests. */
    storage?: KvStore;
    /**
     * Prefix for the persisted key, mirroring `createSuperAdminI18n`. Set it
     * when several admin apps share one origin and must not inherit each
     * other's colour scheme.
     */
    storageKeyPrefix?: string;
    /**
     * Renders the theme switcher in the shell chrome, default `true`. Set
     * `false` for a deployment that ships one appearance. A readonly `scheme`
     * ref disables it on its own — no need to set this as well.
     */
    switcher?: boolean;
}

function isScheme(value: unknown): value is SaColorScheme {
    return typeof value === 'string' && SA_COLOR_SCHEMES.includes(value as SaColorScheme);
}

/**
 * Live `prefers-color-scheme`, as a ref that updates when the OS setting does,
 * plus the handle that unsubscribes it.
 *
 * A one-time read would leave every open tab on the old theme when somebody
 * flips their system to dark at sunset — which is exactly when they flip it.
 * Returns a constant `'light'` where `matchMedia` does not exist (SSR, jsdom
 * without a stub), because guessing dark for a missing API is worse than
 * matching the CSS default.
 */
function systemScheme(): { value: Ref<SaResolvedScheme>; unsubscribe: () => void } {
    const value = ref<SaResolvedScheme>('light');
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return { value, unsubscribe: () => {} };
    }

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    value.value = query.matches ? 'dark' : 'light';
    const onChange = (event: MediaQueryListEvent) => {
        value.value = event.matches ? 'dark' : 'light';
    };
    // `addEventListener` since Safari 14; no fallback to the deprecated
    // `addListener`, because the package's Quasar peer needs a newer browser
    // than that anyway.
    query.addEventListener('change', onChange);
    return { value, unsubscribe: () => query.removeEventListener('change', onChange) };
}

/**
 * Creates the theme context. `createSuperAdminApp()` makes one and the Quasar
 * bridge mirrors it onto the document; call it directly only when bootstrapping
 * by hand.
 */
export function createSaTheme(options: SaThemeOptions = {}): SaTheme {
    const storage = options.storage ?? defaultKvStore();
    const persist = options.persist !== false;
    // `isRef`, like `createSuperAdminI18n` next door. Branched inline rather
    // than through a boolean, because a boolean does not narrow the union and
    // the version that went through one needed three casts to compile.
    const provided = options.scheme;
    const appOwnsIt = isRef(provided);

    const key = `${options.storageKeyPrefix ?? ''}${SA_THEME_STORAGE_KEY}`;

    const stored = persist && !appOwnsIt ? storage.get(key) : null;
    const scheme = isRef(provided)
        ? provided
        : ref<SaColorScheme>(isScheme(stored) ? stored : (provided ?? 'system'));
    const { value: system, unsubscribe } = systemScheme();

    const stopPersisting =
        persist && !appOwnsIt ? watch(scheme, (next) => storage.set(key, next)) : null;

    return {
        scheme,
        resolved: computed(() => (scheme.value === 'system' ? system.value : scheme.value)),
        // A readonly ref (typically a `computed` derived from a profile
        // setting) silently swallows writes, so the switcher would be a dead
        // control. TypeScript ignores `readonly` when checking assignability,
        // so the guard has to be a runtime one — same as the locale next door.
        switcherEnabled: (options.switcher ?? true) && !isReadonly(scheme),
        dispose: () => {
            unsubscribe();
            stopPersisting?.();
        },
    };
}

// `Symbol.for` — see super-admin-context.ts: dist- and src-imported module
// instances must resolve to the same injection key.
export const SA_THEME_KEY: InjectionKey<SaTheme> = Symbol.for('@saasicat/ui-vue/SA_THEME');

let fallbackTheme: SaTheme | null = null;

/**
 * The shell's theme context, or a shared unpersisted one outside a shell.
 *
 * Same shape as `useSuperAdminI18n()`, and for the same reason: a component
 * mounted in isolation must render rather than throw, and the fallback must not
 * write to real storage or two tests in one process would decide each other's
 * outcome.
 */
export function useSaTheme(): SaTheme {
    const injected = inject(SA_THEME_KEY, null);
    if (injected) return injected;
    fallbackTheme ??= createSaTheme({ persist: false });
    return fallbackTheme;
}
