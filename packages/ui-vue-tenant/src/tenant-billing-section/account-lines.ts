// The lines of the tenant's account card, framework-free: per currency what is
// open and of that overdue, and beside it the credit to be refunded — two
// lines, never one figure set off against the other (`SC-PRIC-049`). Each
// amount is handed to the app's formatter with its currency, which writes it;
// a code beside the amount would contradict a formatter that writes a symbol.

import type { TenantAccountBalance } from '@saasicat/core';

import type { TenantPlanSectionI18n } from '../default-i18n.js';

type AccountTexts = Pick<
    TenantPlanSectionI18n,
    'accountOwed' | 'accountOwedOverdue' | 'accountCredit'
>;

/** One line of the card. */
export interface AccountLine {
    key: string;
    text: string;
}

/** The lines `balances` read as, each amount written by `formatCurrency` in its currency. */
export function accountLinesOf(
    balances: readonly TenantAccountBalance[],
    i18n: AccountTexts,
    formatCurrency: (amount: number, currency: string) => string,
): AccountLine[] {
    return balances.flatMap(({ currency, owed, overdue, credit }) => {
        const money = (amount: number) => formatCurrency(amount, currency);
        const lines: AccountLine[] = [];
        if (owed > 0) {
            const text =
                overdue > 0
                    ? i18n.accountOwedOverdue
                          .replace('{amount}', money(owed))
                          .replace('{overdue}', money(overdue))
                    : i18n.accountOwed.replace('{amount}', money(owed));
            lines.push({ key: `${currency}:owed`, text });
        }
        if (credit > 0) {
            lines.push({
                key: `${currency}:credit`,
                text: i18n.accountCredit.replace('{amount}', money(credit)),
            });
        }
        return lines;
    });
}
