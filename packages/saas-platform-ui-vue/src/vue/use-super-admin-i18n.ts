// Reactive i18n context for the SuperAdmin shell. `createSuperAdminApp()`
// provides one instance; pages, components and composables read it via
// `useSuperAdminI18n()` or the namespace-focused `useSaMessages()`.
//
// Design: no vue-i18n dependency. The platform ships two complete typed
// catalogs (German reference + English translation) and nothing beyond that —
// which of them an app offers, which languages it adds and what wording it
// prefers is decided through the bootstrap option and resolved in `SaCatalog`.
// Without a provider the composables fall back to a shared default instance, so
// isolated mounts and unit tests need no setup.

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

import {
    createSaCatalog,
    type SaCatalog,
    type SaLocale,
    type SaLocaleDefinition,
    type SaLocaleOption,
    type SaMessages,
    type SaMessagesOverrides,
} from '../client/i18n/index.js';
import { defaultKvStore, type KvStore } from '../client/types.js';

export interface SuperAdminI18n {
    /** Active UI locale — mutable; switching re-renders all catalog texts. */
    locale: Ref<SaLocale>;
    /** Resolved catalog for the active locale (platform + app overrides). */
    messages: ComputedRef<SaMessages>;
    /** BCP-47 tag for `Intl`/`toLocaleString` formatting in the active locale. */
    intlLocale: ComputedRef<string>;
    /**
     * Whether the shell renders its language switcher. `false` when the app
     * opted out, when `locale` cannot be written to, or when only one language
     * is on offer — a switcher that cannot change anything is worse than none.
     */
    switcherEnabled: boolean;
    /** Locales the switcher offers, in order, with their display names. */
    availableLocales: readonly SaLocaleOption[];
}

export interface SuperAdminI18nOptions {
    /**
     * Starting UI locale — the shell's switcher lets the user pick another one,
     * and a stored pick outranks this. Defaults to `'de'` when offered,
     * otherwise to the first entry of `locales`. Pass a `Ref` when the app wants
     * to keep control (e.g. a user-profile setting).
     */
    locale?: SaLocale | Ref<SaLocale>;
    /**
     * Languages to offer, in switcher order. Default: German, English and
     * everything in `additionalLocales`. Narrow it to ship a single language —
     * the switcher then hides itself.
     */
    locales?: readonly SaLocale[];
    /**
     * Languages the app adds on top of the two the platform ships, keyed by
     * locale code. Untranslated keys fall back to `basedOn`, so a partial
     * catalog is usable from the first key onwards.
     */
    additionalLocales?: Readonly<Record<string, SaLocaleDefinition>>;
    /** Per-locale string overrides layered over whatever catalog applies. */
    overrides?: Partial<Record<SaLocale, SaMessagesOverrides>>;
    /**
     * Remembers the locale picked in the header switcher across reloads,
     * default `true`. Ignored when `locale` is a `Ref`: the app owns that value
     * and persists it wherever it belongs (user profile, its own store).
     */
    persist?: boolean;
    /**
     * Storage adapter for `persist`. Defaults to `defaultKvStore()`.
     */
    storage?: KvStore;
    /**
     * Prefix for the persisted key, mirroring `createPlatformLoaders`. Set it
     * when several apps share one origin and must not inherit each other's
     * language pick.
     */
    storageKeyPrefix?: string;
    /**
     * Renders the language switcher in the shell chrome, default `true`. Set
     * `false` for a deployment that ships one language. A readonly `locale`
     * ref disables it on its own — no need to set this as well.
     */
    switcher?: boolean;
}

/** `KvStore` key holding the locale the user picked in the switcher. */
export const SA_LOCALE_STORAGE_KEY = 'sa:locale';

// `Symbol.for` — see super-admin-context.ts: dist- and src-imported module
// instances must resolve to the same injection key.
export const SUPER_ADMIN_I18N_KEY: InjectionKey<SuperAdminI18n> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_I18N',
);

export function createSuperAdminI18n(options: SuperAdminI18nOptions = {}): SuperAdminI18n {
    const catalog = createSaCatalog(options);
    const locale = isRef(options.locale) ? options.locale : createOwnedLocale(options, catalog);
    // An unknown locale would otherwise render an empty shell. Falling back
    // keeps the UI usable and makes the app's mistake visible as "wrong
    // language" rather than "blank page".
    const active = computed(() =>
        catalog.has(locale.value) ? locale.value : catalog.defaultLocale,
    );
    const messages = computed(() => catalog.messagesFor(active.value));
    const intlLocale = computed(() => catalog.intlLocaleFor(active.value));
    // A readonly ref (typically a `computed` derived from a profile setting)
    // silently swallows writes, so the switcher would be a dead control. The
    // type system permits it — TypeScript ignores `readonly` when checking
    // assignability — so the guard has to be a runtime one.
    const writable = !isReadonly(locale);
    return {
        locale,
        messages,
        intlLocale,
        switcherEnabled: (options.switcher ?? true) && writable && catalog.locales.length > 1,
        availableLocales: catalog.locales,
    };
}

/**
 * Builds the locale ref the platform owns. A stored choice outranks the
 * `locale` option, because that option is the app's default while the stored
 * value is the user's explicit pick in the switcher.
 */
function createOwnedLocale(options: SuperAdminI18nOptions, catalog: SaCatalog): Ref<SaLocale> {
    const initial = options.locale ?? catalog.defaultLocale;
    if (options.persist === false) return ref(initial);

    const storage = options.storage ?? defaultKvStore();
    const key = `${options.storageKeyPrefix ?? ''}${SA_LOCALE_STORAGE_KEY}`;
    const stored = storage.get(key);
    // The stored value is checked against what this app offers, not against the
    // built-ins: an app that dropped a language must not be pushed back into it
    // by a pick from before.
    const locale = ref(stored && catalog.has(stored) ? stored : initial);
    watch(locale, (next) => storage.set(key, next));
    return locale;
}

let fallbackI18n: SuperAdminI18n | null = null;

/**
 * Returns the i18n context provided by `createSuperAdminApp()`. Outside a
 * shell (isolated mounts, tests) a shared German default instance is returned
 * so callers never have to guard for a missing context.
 */
export function useSuperAdminI18n(): SuperAdminI18n {
    const injected = inject(SUPER_ADMIN_I18N_KEY, null);
    if (injected) return injected;
    // Deliberately not persisted: this instance exists for mounts outside a
    // shell, and a shared singleton that reads and writes real storage would
    // make test outcomes depend on their order.
    fallbackI18n ??= createSuperAdminI18n({ persist: false });
    return fallbackI18n;
}

/**
 * Focused accessor for one catalog namespace:
 * `const msg = useSaMessages('plans')` → `msg.value.title` /
 * template `msg.title`.
 */
export function useSaMessages<K extends keyof SaMessages>(
    namespace: K,
): ComputedRef<SaMessages[K]> {
    const { messages } = useSuperAdminI18n();
    return computed(() => messages.value[namespace]);
}
