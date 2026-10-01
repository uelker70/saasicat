import { describeVersionSale, versionSale, type VersionSaleDates } from '../client/version-sale.js';
import { useSaMessages, useSuperAdminI18n } from './use-super-admin-i18n.js';

/**
 * Where a plan or add-on version stands, in the reader's language and with its
 * day — the words every version surface of the admin uses. Read at render
 * time, so a language switch re-renders it.
 */
export function useVersionSaleText(): (version: VersionSaleDates) => string {
    const common = useSaMessages('common');
    const { intlLocale } = useSuperAdminI18n();
    return (version) =>
        describeVersionSale(
            versionSale(version, new Date()),
            common.value.versionSale,
            intlLocale.value,
        );
}
