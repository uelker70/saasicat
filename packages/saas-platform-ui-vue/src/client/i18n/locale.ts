// Supported display locales of the SuperAdmin UI. The platform ships a German
// (reference) and an English catalog; consumers pick the locale per app or per
// user via `createSuperAdminApp({ i18n })`.

export type SaLocale = 'de' | 'en';

export const SA_LOCALES: readonly SaLocale[] = ['de', 'en'];

export const DEFAULT_SA_LOCALE: SaLocale = 'de';

/** BCP-47 tags used for `Intl`/`toLocaleString` formatting per UI locale. */
export const SA_INTL_LOCALES: Record<SaLocale, string> = {
    de: 'de-DE',
    en: 'en-US',
};

/**
 * Names for the language switcher. Endonyms — a language is listed in its own
 * language, so the entries stay readable no matter which locale is active and
 * never need translating.
 */
export const SA_LOCALE_LABELS: Record<SaLocale, string> = {
    de: 'Deutsch',
    en: 'English',
};

/** Narrows untrusted input (persisted preference, query parameter) to a locale. */
export function isSaLocale(value: unknown): value is SaLocale {
    return typeof value === 'string' && (SA_LOCALES as readonly string[]).includes(value);
}
