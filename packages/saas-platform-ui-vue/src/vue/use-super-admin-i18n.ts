// Reactive i18n context for the SuperAdmin shell. `createSuperAdminApp()`
// provides one instance; pages, components and composables read it via
// `useSuperAdminI18n()` or the namespace-focused `useSaMessages()`.
//
// Design: no vue-i18n dependency. The platform ships complete typed catalogs
// (`SA_MESSAGES`, German reference + English translation) and consumers switch
// the locale or override individual strings through the bootstrap option.
// Without a provider the composables fall back to a shared German instance, so
// isolated mounts and unit tests need no setup.

import {
    computed,
    inject,
    isRef,
    ref,
    watch,
    type ComputedRef,
    type InjectionKey,
    type Ref,
} from 'vue';

import {
    DEFAULT_SA_LOCALE,
    SA_INTL_LOCALES,
    isSaLocale,
    resolveMessages,
    type SaLocale,
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
}

export interface SuperAdminI18nOptions {
    /**
     * Starting UI locale, default `'de'` — the shell's switcher lets the user
     * pick another one, and a stored pick outranks this. Pass a `Ref` when the
     * app wants to keep control (e.g. a user-profile setting).
     */
    locale?: SaLocale | Ref<SaLocale>;
    /** Per-locale string overrides layered over the platform catalog. */
    overrides?: Partial<Record<SaLocale, SaMessagesOverrides>>;
    /**
     * Remembers the locale picked in the header switcher across reloads,
     * default `true`. Ignored when `locale` is a `Ref`: the app owns that value
     * and persists it wherever it belongs (user profile, its own store).
     */
    persist?: boolean;
    /** Storage adapter for `persist`. Defaults to `defaultKvStore()`. */
    storage?: KvStore;
}

/** `KvStore` key holding the locale the user picked in the switcher. */
export const SA_LOCALE_STORAGE_KEY = 'sa:locale';

// `Symbol.for` — see super-admin-context.ts: dist- and src-imported module
// instances must resolve to the same injection key.
export const SUPER_ADMIN_I18N_KEY: InjectionKey<SuperAdminI18n> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_I18N',
);

export function createSuperAdminI18n(options: SuperAdminI18nOptions = {}): SuperAdminI18n {
    const locale = isRef(options.locale) ? options.locale : createOwnedLocale(options);
    const messages = computed(() =>
        resolveMessages(locale.value, options.overrides?.[locale.value]),
    );
    const intlLocale = computed(() => SA_INTL_LOCALES[locale.value]);
    return { locale, messages, intlLocale };
}

/**
 * Builds the locale ref the platform owns. A stored choice outranks the
 * `locale` option, because that option is the app's default while the stored
 * value is the user's explicit pick in the switcher.
 */
function createOwnedLocale(options: SuperAdminI18nOptions): Ref<SaLocale> {
    if (options.persist === false) {
        return ref(options.locale ?? DEFAULT_SA_LOCALE);
    }
    const storage = options.storage ?? defaultKvStore();
    const stored = storage.get(SA_LOCALE_STORAGE_KEY);
    const locale = ref(isSaLocale(stored) ? stored : (options.locale ?? DEFAULT_SA_LOCALE));
    watch(locale, (next) => storage.set(SA_LOCALE_STORAGE_KEY, next));
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
    fallbackI18n ??= createSuperAdminI18n();
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
