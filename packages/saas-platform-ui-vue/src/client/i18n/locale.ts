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

/**
 * The locale the shell falls back to when an app names none.
 *
 * English, because the project is open source and a developer who does not
 * configure a locale is far more likely to read English than German. German
 * remains a first-class catalog — it is the reference that fixes the key
 * structure — and an app that wants it says so through
 * `createSuperAdminApp({ i18n: { locale: 'de' } })`.
 *
 * This is also the fallback for `Intl` formatting, so an unconfigured app
 * formats dates and currency the English way; see `SA_INTL_LOCALES`.
 */
export const DEFAULT_SA_LOCALE: SaBuiltinLocale = 'en';

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
