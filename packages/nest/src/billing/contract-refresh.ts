// What an operator's refresh would change on a contract in force, worked out
// from the contract and the successor that would replace it. Pure: the service
// reads the records, this compares them.

import type {
    ContractLineItemRecord,
    CreateSubscriptionContractData,
    NewContractLineItemData,
    SubscriptionContractPriceSnapshot,
    SubscriptionContractRecord,
} from '@saasicat/core';

/**
 * `features` replaces the frozen features alone and copies everything else;
 * `full` re-freezes the contract the way a plan change does.
 */
export type ContractRefreshMode = 'features' | 'full';

export interface ContractFeatureChange {
    added: string[];
    removed: string[];
}

/** A quota the successor records differently; `null` where one side has none. */
export interface ContractQuotaChange {
    key: string;
    before: number | null;
    after: number | null;
}

/**
 * Something the successor would charge differently: a member of the price
 * snapshot (`priceSnapshot.totalNet`), or a line (`line plan:PRO`), with its net
 * price where the line is on one side only.
 */
export interface ContractMoneyChange {
    field: string;
    before: string | number | null;
    after: string | number | null;
}

/** The feature keys that tell a contract's vocabulary has fallen behind. */
export interface ContractVocabulary {
    /** Frozen keys nothing in the application knows any more. */
    unknown: string[];
    /** Keys granted today that the contract lacks, and no `replaces` carries it to. */
    missing: string[];
}

const PRICE_FIELDS: readonly (keyof SubscriptionContractPriceSnapshot)[] = [
    'currency',
    'billingCycle',
    'vatRate',
    'subtotalNet',
    'discountNet',
    'totalNet',
    'totalGross',
];

const LINE_MONEY_FIELDS = [
    'quantity',
    'billingCycle',
    'currency',
    'taxRate',
    'priceNet',
    'priceGross',
    'taxAmount',
] as const satisfies readonly (keyof NewContractLineItemData)[];

type LineForMoney = Pick<
    NewContractLineItemData,
    'kind' | 'sourceKey' | (typeof LINE_MONEY_FIELDS)[number]
>;

export function featureChangeOf(
    before: Iterable<string>,
    after: Iterable<string>,
): ContractFeatureChange {
    const was = new Set(before);
    const is = new Set(after);
    return {
        added: [...is].filter((key) => !was.has(key)).sort(),
        removed: [...was].filter((key) => !is.has(key)).sort(),
    };
}

export function quotaChangesOf(
    before: Readonly<Record<string, number>>,
    after: Readonly<Record<string, number>>,
): ContractQuotaChange[] {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys
        .map((key) => ({ key, before: before[key] ?? null, after: after[key] ?? null }))
        .filter((change) => change.before !== change.after);
}

/**
 * Where the successor would charge anything differently from the contract:
 * its price snapshot member by member, and its lines, each matched to the line
 * of the same kind and key. A line whose version alone moved is not a change of
 * money, and is not reported.
 */
export function moneyChangesOf(
    contract: Pick<SubscriptionContractRecord, 'priceSnapshot' | 'lineItems'>,
    successor: Pick<CreateSubscriptionContractData, 'priceSnapshot' | 'lineItems'>,
): ContractMoneyChange[] {
    const changes: ContractMoneyChange[] = [];
    for (const field of PRICE_FIELDS) {
        const before = contract.priceSnapshot[field];
        const after = successor.priceSnapshot[field];
        if (before !== after) changes.push({ field: `priceSnapshot.${field}`, before, after });
    }
    const unmatched = [...successor.lineItems];
    for (const line of contract.lineItems) {
        const index = unmatched.findIndex((other) => lineKeyOf(other) === lineKeyOf(line));
        if (index === -1) {
            changes.push({ field: `line ${lineKeyOf(line)}`, before: line.priceNet, after: null });
            continue;
        }
        const [other] = unmatched.splice(index, 1);
        changes.push(...lineMoneyChangesOf(line, other));
    }
    for (const other of unmatched) {
        changes.push({ field: `line ${lineKeyOf(other)}`, before: null, after: other.priceNet });
    }
    return changes;
}

function lineMoneyChangesOf(before: LineForMoney, after: LineForMoney): ContractMoneyChange[] {
    return LINE_MONEY_FIELDS.filter((field) => before[field] !== after[field]).map((field) => ({
        field: `line ${lineKeyOf(before)} ${field}`,
        before: before[field],
        after: after[field],
    }));
}

function lineKeyOf(line: Pick<ContractLineItemRecord, 'kind' | 'sourceKey'>): string {
    return `${line.kind}:${line.sourceKey}`;
}

/**
 * A re-frozen successor, with what the contract it replaces agreed beyond
 * money carried over: its terms, the offer it came from, the promotions and
 * codes it records, and each line's minimum term. A plan change composes a new
 * agreement and records none of these; an operator's refresh is not one, and
 * the money comparison does not look at them.
 */
export function withAgreedTerms(
    contract: Pick<
        SubscriptionContractRecord,
        | 'originalOfferId'
        | 'termsSnapshot'
        | 'promotionSnapshots'
        | 'promoCodeSnapshots'
        | 'lineItems'
    >,
    successor: CreateSubscriptionContractData,
): CreateSubscriptionContractData {
    const unmatched = [...contract.lineItems];
    return {
        ...successor,
        originalOfferId: contract.originalOfferId,
        termsSnapshot: contract.termsSnapshot ? { ...contract.termsSnapshot } : null,
        promotionSnapshots: [...contract.promotionSnapshots],
        promoCodeSnapshots: [...contract.promoCodeSnapshots],
        lineItems: successor.lineItems.map((line) => {
            const index = unmatched.findIndex((agreed) => lineKeyOf(agreed) === lineKeyOf(line));
            if (index === -1) return line;
            const [agreed] = unmatched.splice(index, 1);
            return { ...line, minimumTermUntil: agreed.minimumTermUntil };
        }),
    };
}

/**
 * The frozen keys nothing knows, and the granted keys the contract lacks.
 *
 * `known` is the application's whole vocabulary: the features its code
 * declares, the ones the catalogue lists, and the old keys a `replaces`
 * declaration names — those are carried, not dead. `frozenWithReplacements` is
 * the frozen set with what those declarations grant beyond it, so a renamed
 * key covered by one is not missing.
 */
export function vocabularyOf(input: {
    frozen: ReadonlySet<string>;
    frozenWithReplacements: ReadonlySet<string>;
    grantedToday: ReadonlySet<string>;
    known: ReadonlySet<string>;
}): ContractVocabulary {
    return {
        unknown: [...input.frozen].filter((key) => !input.known.has(key)).sort(),
        missing: [...input.grantedToday]
            .filter((key) => !input.frozenWithReplacements.has(key))
            .sort(),
    };
}
