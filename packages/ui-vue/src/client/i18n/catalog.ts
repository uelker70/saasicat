// Resolves a locale to the three things the shell needs from it: the catalog to
// render, the tag `Intl` formats with, and the name the switcher shows.
//
// The platform ships German and English and stops there. Which of them an app
// offers, which languages it adds, and what wording it prefers is the app's
// decision — this module is the single place all three are applied.

import { mergeMessages } from './define.js';
import {
    DEFAULT_SA_LOCALE,
    SA_INTL_LOCALES,
    SA_LOCALES,
    SA_LOCALE_LABELS,
    isSaBuiltinLocale,
    type SaBuiltinLocale,
    type SaLocale,
} from './locale.js';
import { SA_MESSAGES, type SaMessages, type SaMessagesOverrides } from './messages.js';

/** A language an app brings along, on top of the two the platform ships. */
export interface SaLocaleDefinition {
    /**
     * Name for the switcher, written in the language itself (`'Français'`) —
     * that way the entry stays readable whatever locale is currently active.
     */
    label: string;
    /** BCP-47 tag for `Intl`/`toLocaleString`, e.g. `'fr-FR'`. */
    intlLocale: string;
    /**
     * Built-in catalog that fills whatever `messages` leaves out, default
     * `'en'`. A partial translation therefore renders — untranslated keys fall
     * back instead of showing blanks.
     */
    basedOn?: SaBuiltinLocale;
    /** The translation. Every key is optional; see `basedOn`. */
    messages: SaMessagesOverrides;
}

export interface SaCatalogOptions {
    /**
     * Locales offered in the switcher, in the order given. Default: the
     * built-ins plus everything in `additionalLocales`. Narrow it to ship a
     * single language; entries without a catalog are ignored.
     */
    locales?: readonly SaLocale[];
    /** Languages the app adds, keyed by locale code (`'fr'`, `'pt-BR'`, …). */
    additionalLocales?: Readonly<Record<string, SaLocaleDefinition>>;
    /** Per-locale wording changes layered on top of whatever catalog applies. */
    overrides?: Readonly<Partial<Record<SaLocale, SaMessagesOverrides>>>;
}

/** One entry of the switcher. */
export interface SaLocaleOption {
    code: SaLocale;
    label: string;
}

export interface SaCatalog {
    /** Locales to offer, in switcher order. Never empty. */
    readonly locales: readonly SaLocaleOption[];
    /**
     * Whether the app offers this locale. Deliberately not "can it be
     * rendered": an app that narrowed to English must not be pushed back into
     * German by a stored pick from before, even though German is still shipped.
     */
    has(locale: SaLocale): boolean;
    /** Locale to start from when nothing else is known. */
    readonly defaultLocale: SaLocale;
    messagesFor(locale: SaLocale): SaMessages;
    intlLocaleFor(locale: SaLocale): string;
    labelFor(locale: SaLocale): string;
}

/**
 * Builds the catalog an app runs on. Resolution is cached per locale, so
 * switching back and forth does not re-merge the message tree.
 */
export function createSaCatalog(options: SaCatalogOptions = {}): SaCatalog {
    const additional = options.additionalLocales ?? {};
    const known = new Set<string>([...SA_LOCALES, ...Object.keys(additional)]);

    // An app that lists an unknown code would otherwise get a switcher entry
    // that renders nothing; dropping it here keeps the failure visible in one
    // place instead of at every call site.
    const requested = options.locales?.filter((code) => known.has(code));
    const offered: readonly SaLocale[] =
        requested && requested.length > 0 ? requested : [...SA_LOCALES, ...Object.keys(additional)];

    const labelFor = (locale: SaLocale): string =>
        additional[locale]?.label ??
        (isSaBuiltinLocale(locale) ? SA_LOCALE_LABELS[locale] : locale);

    const cache = new Map<SaLocale, SaMessages>();
    const messagesFor = (locale: SaLocale): SaMessages => {
        const hit = cache.get(locale);
        if (hit) return hit;
        const definition = additional[locale];
        const base =
            SA_MESSAGES[definition?.basedOn ?? (isSaBuiltinLocale(locale) ? locale : 'en')];
        const translated = definition ? mergeMessages(base, definition.messages) : base;
        const resolved = mergeMessages(translated, options.overrides?.[locale]);
        cache.set(locale, resolved);
        return resolved;
    };

    const offeredSet = new Set<string>(offered);

    return {
        locales: offered.map((code) => ({ code, label: labelFor(code) })),
        has: (locale) => offeredSet.has(locale),
        // The app's first offered locale beats the platform default: an app
        // shipping English only must not start in German.
        defaultLocale: offered.includes(DEFAULT_SA_LOCALE) ? DEFAULT_SA_LOCALE : offered[0],
        messagesFor,
        intlLocaleFor: (locale) =>
            additional[locale]?.intlLocale ??
            (isSaBuiltinLocale(locale) ? SA_INTL_LOCALES[locale] : locale),
        labelFor,
    };
}
