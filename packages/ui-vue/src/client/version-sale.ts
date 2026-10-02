// Whether a plan or add-on version is on sale, as the admin says it.
//
// The state is the platform's (`versionSale` in `@saasicat/core`), the one
// the catalogue, checkout and every booking follow; this adds the words. Every
// admin surface that shows a version's state reads it through here.

import type { VersionSale } from '@saasicat/core';

import { formatDay, formatMessage } from './i18n/format.js';
import type { SaMessages } from './i18n/messages.js';

export {
    versionOnSale,
    versionOnSaleOrNext,
    versionSale,
    type VersionSale,
    type VersionSaleDates,
    type VersionSaleKind,
} from '@saasicat/core';

/** The state in the reader's words, with its day where it has one. */
export function describeVersionSale(
    sale: VersionSale,
    texts: SaMessages['common']['versionSale'],
    intlLocale: string,
): string {
    const on = (day: string): { date: string } => ({ date: formatDay(day, intlLocale) });
    switch (sale.kind) {
        case 'draft':
            return texts.draft;
        case 'scheduled':
            return formatMessage(texts.scheduled, on(sale.from));
        case 'on-sale':
            return sale.until ? formatMessage(texts.onSaleUntil, on(sale.until)) : texts.onSale;
        case 'off-sale':
            return sale.since ? formatMessage(texts.offSaleSince, on(sale.since)) : texts.offSale;
    }
}
