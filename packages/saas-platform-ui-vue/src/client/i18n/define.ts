// Typed message-catalog helpers. Every namespace is defined once in German —
// the reference locale that fixes the key structure — and the English variant
// must mirror that structure exactly, enforced at compile time via
// `TranslationOf`.

import type { SaLocale } from './locale.js';

/** Nested string map — the shape of every message namespace. */
export interface MessageTree {
    readonly [key: string]: string | MessageTree;
}

/** Maps a reference namespace to "same keys, any string values". */
export type TranslationOf<T> = {
    readonly [K in keyof T]: T[K] extends string ? string : TranslationOf<T[K]>;
};

/** Deep partial of a namespace — the shape consumers pass as overrides. */
export type PartialMessages<T> = {
    readonly [K in keyof T]?: T[K] extends string ? string : PartialMessages<T[K]>;
};

/**
 * Couples the German reference catalog with its English translation. Missing
 * or extra keys in the English object are compile errors.
 */
export function defineMessages<T extends MessageTree>(
    de: T,
    en: TranslationOf<T>,
): Record<SaLocale, T> {
    // `TranslationOf<T>` and `T` are structurally identical for string-valued
    // trees; the cast only erases the mapped-type wrapper.
    return { de, en: en as T };
}

/**
 * Recursively overlays `overrides` onto `base` without mutating either side.
 * Only string leaves are replaced; keys not present in `base` are ignored —
 * the catalog structure is fixed by the platform.
 */
export function mergeMessages<T extends MessageTree>(
    base: T,
    overrides: PartialMessages<T> | undefined,
): T {
    if (!overrides) return base;
    const result: Record<string, string | MessageTree> = {};
    for (const [key, baseValue] of Object.entries(base)) {
        const override = (overrides as Record<string, unknown>)[key];
        if (typeof baseValue === 'string') {
            result[key] = typeof override === 'string' ? override : baseValue;
        } else {
            result[key] = mergeMessages(
                baseValue,
                override as PartialMessages<MessageTree> | undefined,
            );
        }
    }
    return result as T;
}
