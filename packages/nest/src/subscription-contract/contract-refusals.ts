// Refusals a new contract can meet, shared by `create` and by the paths that
// close the previous contract first.
//
// Every contract is held to them where it is created. A path that closes the
// previous contract before it creates the next checks them before it closes
// anything: a contract is append-only and a termination has no inverse, so a
// refusal that came after it would leave the tenant with no contract at all.

import { UnprocessableEntityException } from '@nestjs/common';
import { CONTRACT_ERROR_CODES } from '@saasicat/core';

import { isTaxRatePercent } from '../promo/math.js';

/** Throws unless `taxRate` is a percentage; `field` names where it is stated. */
export function assertTaxRatePercent(field: string, taxRate: number): void {
    if (isTaxRatePercent(taxRate)) return;
    throw new UnprocessableEntityException({
        code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_PERCENT,
        message:
            `A subscription contract states a tax rate of ${taxRate} at ${field}, which is not a ` +
            'percentage: a rate lies from 0 to 100, and a value between 0 and 1 is refused as a ' +
            'fraction.',
        params: { field, taxRate },
    });
}

/** Throws unless a contract that ends ends after it starts. */
export function assertContractWindow(effectiveFrom: Date, effectiveUntil: Date | null): void {
    if (!effectiveUntil || effectiveUntil > effectiveFrom) return;
    throw new UnprocessableEntityException({
        code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_INVALID_WINDOW,
        message: 'effectiveUntil must be after effectiveFrom.',
    });
}

/** Throws unless exactly one of the lines is the plan's base line. */
export function assertOnePlanLine(lineItems: readonly { kind: string }[]): void {
    if (lineItems.filter((item) => item.kind === 'plan').length === 1) return;
    throw new UnprocessableEntityException({
        code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED,
        message: 'A subscription contract requires exactly one plan base item.',
    });
}
