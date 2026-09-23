// Refusals a new contract can meet, shared by `create` and by the paths that
// close the previous contract first.
//
// Every contract is held to them where it is created. A path that closes the
// previous contract before it creates the next checks them before it closes
// anything: a contract is append-only and a termination has no inverse, so a
// refusal that came after it would leave the tenant with no contract at all.

import { UnprocessableEntityException } from '@nestjs/common';
import type {
    CreateSubscriptionContractData,
    NewContractLineItemData,
    SubscriptionContractPriceSnapshot,
} from '@saasicat/core';
import { CONTRACT_ERROR_CODES } from '@saasicat/core';

import { isTaxRatePercent } from '../promo/math.js';
import { contractTotalsOf } from './contract-line-item-money.js';

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

const ADDED_UP_TOTALS = ['subtotalNet', 'discountNet', 'totalNet', 'totalGross'] as const;

/**
 * Throws unless the lines add up to every total the contract states, each line
 * counted as often as it falls due in one period of the contract.
 *
 * The tax needs no check of its own: every line's tax is the gap between its
 * net and gross, so lines that add up in net and gross add up in tax as well.
 */
export function assertLinesAddUp(
    lineItems: readonly Pick<
        NewContractLineItemData,
        'kind' | 'priceNet' | 'priceGross' | 'billingCycle'
    >[],
    priceSnapshot: SubscriptionContractPriceSnapshot,
): void {
    const lines = contractTotalsOf(lineItems, priceSnapshot.billingCycle);
    const field = ADDED_UP_TOTALS.find(
        (total) => Math.round(lines[total] * 100) !== Math.round(priceSnapshot[total] * 100),
    );
    if (!field) return;
    throw new UnprocessableEntityException({
        code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP,
        message:
            `The line items of a subscription contract add up to ${lines[field]} for ` +
            `priceSnapshot.${field}, but the contract states ${priceSnapshot[field]}.`,
        params: {
            field: `priceSnapshot.${field}`,
            lines: lines[field],
            stated: priceSnapshot[field],
        },
    });
}

/**
 * Throws when anything that takes money off states a negative amount: the
 * contract's discount, or the amount a promotion or promo code snapshot
 * resolved to. A negative discount is a surcharge nobody agreed to under that
 * name, and a contract is append-only.
 */
export function assertNoNegativeDiscount(
    data: Pick<
        CreateSubscriptionContractData,
        'priceSnapshot' | 'promotionSnapshots' | 'promoCodeSnapshots'
    >,
): void {
    const negative =
        (data.priceSnapshot.discountNet < 0
            ? { field: 'priceSnapshot.discountNet', amount: data.priceSnapshot.discountNet }
            : null) ??
        negativeResolvedAmount('promotionSnapshots', data.promotionSnapshots) ??
        negativeResolvedAmount('promoCodeSnapshots', data.promoCodeSnapshots);
    if (!negative) return;
    throw new UnprocessableEntityException({
        code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_DISCOUNT_NEGATIVE,
        message:
            `A subscription contract states a discount of ${negative.amount} at ` +
            `${negative.field}; a discount takes money off and is never negative.`,
        params: { field: negative.field, amount: negative.amount },
    });
}

function negativeResolvedAmount(
    list: string,
    snapshots: readonly unknown[] | undefined,
): { field: string; amount: number } | null {
    for (const [index, snapshot] of (snapshots ?? []).entries()) {
        const amount = (snapshot as { resolvedAmountNet?: unknown } | null)?.resolvedAmountNet;
        if (typeof amount === 'number' && amount < 0) {
            return { field: `${list}[${index}].resolvedAmountNet`, amount };
        }
    }
    return null;
}
