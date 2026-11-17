// The words for a line of what a tenant keeps (`SC-PRIV-022`), in the
// reader's language (`SC-LANG-005`). The application words each line by locale
// and always in English, so a reader whose locale it does not name reads the
// language of that locale (`de` for `de-AT`), and else English.
//
// Framework-free, so it is tested without a browser.

import type { TenantKeepLine } from '@saasicat/core';

/** The label `labels` holds for `locale` itself, or undefined. */
function labelFor(labels: TenantKeepLine['labels'], locale: string): string | undefined {
    // Own keys only: a locale named like a property every object inherits
    // (`constructor`, `__proto__`) is not a label the application gave.
    if (!Object.prototype.hasOwnProperty.call(labels, locale)) return undefined;
    const label: unknown = labels[locale];
    return typeof label === 'string' && label.trim() !== '' ? label : undefined;
}

/** The label of a line for a reader in `locale`: that locale's, its language's, or English. */
export function keepLineLabel(labels: TenantKeepLine['labels'], locale: string): string {
    const language = locale.split('-')[0] ?? locale;
    return labelFor(labels, locale) ?? labelFor(labels, language) ?? labels.en;
}
