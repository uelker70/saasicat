// The lines of the tenant's account card, framework-free: per currency what is
// open and of that overdue, and beside it the credit to be refunded — two
// lines, never one figure set off against the other (`SC-PRIC-049`). The
// currency is named only where the account holds more than one: the app's
// money formatter writes an amount, not which currency it is in.

import type { TenantAccountBalance } from '@saasicat/core';

import type { TenantPlanSectionI18n } from '../default-i18n.js';

type AccountTexts = Pick<
    TenantPlanSectionI18n,
    'accountOwed' | 'accountOwedOverdue' | 'accountCredit' | 'accountInCurrency'
>;

/** One line of the card. */
export interface AccountLine {
    key: string;
    text: string;
}

/** The lines `balances` read as, each amount written by `formatCurrency`. */
export function accountLinesOf(
    balances: readonly TenantAccountBalance[],
    i18n: AccountTexts,
    formatCurrency: (amount: number) => string,
): AccountLine[] {
    const named = (currency: string, text: string) =>
        balances.length > 1
            ? i18n.accountInCurrency.replace('{currency}', currency).replace('{text}', text)
            : text;
    return balances.flatMap(({ currency, owed, overdue, credit }) => {
        const lines: AccountLine[] = [];
        if (owed > 0) {
            const text =
                overdue > 0
                    ? i18n.accountOwedOverdue
                          .replace('{amount}', formatCurrency(owed))
                          .replace('{overdue}', formatCurrency(overdue))
                    : i18n.accountOwed.replace('{amount}', formatCurrency(owed));
            lines.push({ key: `${currency}:owed`, text: named(currency, text) });
        }
        if (credit > 0) {
            const text = i18n.accountCredit.replace('{amount}', formatCurrency(credit));
            lines.push({ key: `${currency}:credit`, text: named(currency, text) });
        }
        return lines;
    });
}
