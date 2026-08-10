// Display locales of the SuperAdmin UI.
//
// The platform ships two complete catalogs — German (the reference that fixes
// the key structure) and English — and nothing beyond that. Which of them an
// app offers, whether it adds languages of its own, and what vocabulary it
// prefers is the app's call, made through `createSuperAdminApp({ i18n })`.

/** Locales the platform itself ships a catalog for. */
export type SaBuiltinLocale = 'de' | 'en';

/**
 * Any locale the shell can run in: the built-ins plus whatever an app adds via
 * `i18n.additionalLocales`. The `string & {}` arm keeps autocompletion for the
 * built-ins while leaving the set open.
 */
export type SaLocale = SaBuiltinLocale | (string & {});

/** The locales the platform ships. Apps narrow or extend this, see `i18n`. */
export const SA_LOCALES: readonly SaBuiltinLocale[] = ['de', 'en'];

export const DEFAULT_SA_LOCALE: SaBuiltinLocale = 'de';

/** BCP-47 tags used for `Intl`/`toLocaleString` formatting per built-in locale. */
export const SA_INTL_LOCALES: Record<SaBuiltinLocale, string> = {
    de: 'de-DE',
    en: 'en-US',
};

/**
 * Names for the language switcher. Endonyms — a language is listed in its own
 * language, so the entries stay readable no matter which locale is active and
 * never need translating.
 */
export const SA_LOCALE_LABELS: Record<SaBuiltinLocale, string> = {
    de: 'Deutsch',
    en: 'English',
};

/** Narrows untrusted input to a locale the platform ships a catalog for. */
export function isSaBuiltinLocale(value: unknown): value is SaBuiltinLocale {
    return typeof value === 'string' && (SA_LOCALES as readonly string[]).includes(value);
}
