// What the operator reads of a subscriber's contracts: each as it was frozen,
// and what each changed against the one before it for the same tenant
// (`SC-ADM-041`).
//
// Read from the contracts alone. Today's catalogue cannot say what was agreed,
// only where a line came from, so it is asked that one question and by the
// caller, which hands its answer in. Pure, so every rule here is checked
// without a store.

import type {
    AdminContractChange,
    AdminContractIntegrity,
    AdminContractInvoice,
    AdminContractLine,
    AdminContractSource,
    AdminContractSourceState,
    AdminSubscriberContract,
    AdminSubscriberContractDossier,
    ContractConfirmationStanding,
} from './contract-confirmation.types.js';
import { confirmationStateOf } from './contract-confirmation-mapping.js';
import type {
    ContractLineItemKind,
    ContractLineItemRecord,
    SubscriptionContractRecord,
} from './subscription-contract.types.js';
import type { SubscriptionInvoiceRecord } from './subscription-invoice.types.js';
import { dayInZone, lastDayInZone } from './zoned-day.js';

const MONTHS_PER_YEAR = 12;
const CENTS = 100;

/** The order a contract's lines are read in: the plan, then the add-ons, then the discounts. */
const KIND_ORDER: Readonly<Record<ContractLineItemKind, number>> = {
    plan: 0,
    bundle: 1,
    discount: 2,
};

/**
 * Whether a contract never came into force: superseded before it began, as a
 * scheduled change is when another change replaces it first. It stays in the
 * subscriber's history, and is not what the contract after it changed.
 */
export function neverInForce(contract: SubscriptionContractRecord): boolean {
    return (
        contract.effectiveUntil !== null &&
        contract.effectiveUntil.getTime() <= contract.effectiveFrom.getTime()
    );
}

/**
 * What each contract changed against the one before it for the same tenant,
 * keyed by contract id.
 *
 * A tenant's contracts follow one another by their start, then by when each
 * was written. A contract that never came into force is compared with the one
 * in force before it, and is skipped as the one before the next. Whether the
 * tenant's contracts ended is read off the last one that was in force: a
 * cancellation that lands where a scheduled change was to begin ends that
 * change before it begins, and the contract it ended is the one before it.
 */
export function contractChangesOf(
    contracts: readonly SubscriptionContractRecord[],
): Map<string, AdminContractChange> {
    const byTenant = new Map<string, SubscriptionContractRecord[]>();
    for (const contract of contracts) {
        const chain = byTenant.get(contract.tenantId) ?? [];
        chain.push(contract);
        byTenant.set(contract.tenantId, chain);
    }
    const changes = new Map<string, AdminContractChange>();
    for (const chain of byTenant.values()) {
        const ordered = [...chain].sort(inSequence);
        const inForce = ordered.filter((contract) => !neverInForce(contract));
        const lastInForce = inForce[inForce.length - 1] ?? null;
        let before: SubscriptionContractRecord | null = null;
        for (const contract of ordered) {
            changes.set(contract.id, changeOf(before, contract, contract === lastInForce));
            if (!neverInForce(contract)) before = contract;
        }
    }
    return changes;
}

/**
 * A subscriber's contracts as the operator's list shows them, the one written
 * last first, each with what it changed against the one before it for its
 * tenant and where its confirmation stands.
 */
export function adminSubscriberContractsOf(
    contracts: readonly SubscriptionContractRecord[],
    standings: readonly ContractConfirmationStanding[],
    timeZone: string,
): AdminSubscriberContract[] {
    const changes = contractChangesOf(contracts);
    const byContract = new Map(standings.map((standing) => [standing.contractId, standing]));
    return [...contracts].sort(writtenLastFirst).flatMap((contract) => {
        const change = changes.get(contract.id);
        return change
            ? [adminSubscriberContractOf(contract, byContract.get(contract.id), change, timeZone)]
            : [];
    });
}

/** The invoices issued under `contractId`, the latest issue day first. */
export function adminContractInvoicesOf(
    invoices: readonly SubscriptionInvoiceRecord[],
    contractId: string,
): AdminContractInvoice[] {
    return invoices
        .filter((invoice) => invoice.contractId === contractId)
        .sort(
            (a, b) =>
                b.issueDate.localeCompare(a.issueDate) ||
                b.numberYear - a.numberYear ||
                b.numberSequence - a.numberSequence,
        )
        .map((invoice) => ({
            id: invoice.id,
            number: invoice.number,
            issueDate: invoice.issueDate,
            currency: invoice.currency,
            totalGross: invoice.totalGross,
        }));
}

/** A contract's dossier, from the contract, its row in the list and what was read beside it. */
export function adminContractDossierOf(input: {
    contract: SubscriptionContractRecord;
    view: AdminSubscriberContract;
    lines: AdminContractLine[];
    invoices: AdminContractInvoice[];
    integrity: AdminContractIntegrity;
}): AdminSubscriberContractDossier {
    const { contract } = input;
    return {
        contract: input.view,
        agreedAt: contract.agreedAt.toISOString(),
        originalOfferId: contract.originalOfferId,
        originalPlanVersionId: contract.originalPlanVersionId,
        originalBundleVersionIds: [...contract.originalBundleVersionIds],
        partiesMigrated: contract.partiesMigrated,
        subtotalNet: contract.priceSnapshot.subtotalNet,
        discountNet: contract.priceSnapshot.discountNet,
        totalNet: contract.priceSnapshot.totalNet,
        lines: input.lines,
        invoices: input.invoices,
        integrity: input.integrity,
    };
}

/**
 * A contract as the operator's list shows it. `change` comes from
 * `contractChangesOf` over all of the subscriber's contracts; the days are read
 * in the installation's zone.
 */
export function adminSubscriberContractOf(
    contract: SubscriptionContractRecord,
    standing: ContractConfirmationStanding | undefined,
    change: AdminContractChange,
    timeZone: string,
): AdminSubscriberContract {
    // A contract the store answers without a standing is one it did not find a
    // moment later, which is no confirmation either.
    const known = standing ?? { contractId: contract.id, due: false, confirmation: null };
    const { confirmation } = known;
    const plan = planLineOf(contract);
    const never = neverInForce(contract);
    return {
        id: contract.id,
        tenantId: contract.tenantId,
        status: contract.status,
        concludedAt: contract.createdAt.toISOString(),
        effectiveFrom: contract.effectiveFrom.toISOString(),
        effectiveUntil: contract.effectiveUntil?.toISOString() ?? null,
        firstDay: dayInZone(contract.effectiveFrom, timeZone),
        lastDay:
            contract.effectiveUntil && !never
                ? lastDayInZone(
                      { from: contract.effectiveFrom, until: contract.effectiveUntil },
                      timeZone,
                  )
                : null,
        neverInForce: never,
        billingCycle: contract.priceSnapshot.billingCycle,
        currency: contract.priceSnapshot.currency,
        totalGross: contract.priceSnapshot.totalGross,
        termsVersion: contract.termsVersion,
        cancellationNoticeDays: contract.cancellationNoticeDays,
        plan: plan ? sourceOf(plan) : null,
        bundles: bundleLinesOf(contract).map(sourceOf),
        minimumTermUntil: latestMinimumTermOf(contract)?.toISOString() ?? null,
        change,
        confirmation: {
            state: confirmationStateOf(known),
            archivedAt: confirmation?.archivedAt?.toISOString() ?? null,
            deliveredAt: confirmation?.deliveredAt?.toISOString() ?? null,
            deliveredTo: confirmation?.deliveredTo ?? null,
        },
    };
}

/**
 * The contract's lines as it froze them, the plan first, then the add-ons,
 * then the discounts. `sourceStateOf` answers where a plan's or an add-on's
 * source stands in today's catalogue; it is not asked about a discount.
 */
export function adminContractLinesOf(
    contract: SubscriptionContractRecord,
    sourceStateOf: (line: ContractLineItemRecord) => AdminContractSourceState | null,
): AdminContractLine[] {
    return contract.lineItems
        .map((line, index) => ({ line, index }))
        .sort((a, b) => KIND_ORDER[a.line.kind] - KIND_ORDER[b.line.kind] || a.index - b.index)
        .map(({ line }) => ({
            id: line.id,
            kind: line.kind,
            key: line.sourceKey,
            versionId: line.sourceVersionId,
            title: line.titleSnapshot,
            description: line.descriptionSnapshot,
            quantity: line.quantity,
            unit: line.unit,
            priceNet: line.priceNet,
            priceGross: line.priceGross,
            taxRate: line.taxRate,
            taxAmount: line.taxAmount,
            billingCycle: line.billingCycle,
            currency: line.currency,
            minimumTermUntil: line.minimumTermUntil?.toISOString() ?? null,
            features: [...line.featuresSnapshot],
            quotas: { ...line.quotaEffectsSnapshot },
            source: line.kind === 'discount' ? null : sourceStateOf(line),
        }));
}

/**
 * Where a plan or an add-on stands in today's catalogue, from the row the
 * catalogue answers for its key — a soft-deleted one included, which both
 * repositories return (`findByKey`) — or `null` where it answers none.
 */
export function contractSourceStateOf(
    row: { deletedAt: Date | string | null } | null,
): AdminContractSourceState {
    if (!row) return 'deleted';
    return row.deletedAt ? 'removed' : 'in-catalog';
}

/** `lastInForce`: the contract is the last of its tenant that came into force. */
function changeOf(
    before: SubscriptionContractRecord | null,
    contract: SubscriptionContractRecord,
    lastInForce: boolean,
): AdminContractChange {
    const cancelled =
        lastInForce && (contract.status === 'terminated' || contract.effectiveUntil !== null);
    if (!before) {
        return {
            concluded: true,
            plan: null,
            bundlesAdded: [],
            bundlesRemoved: [],
            frozenAnew: false,
            priceChanged: false,
            cancelled,
        };
    }
    const plan = planChangeOf(planLineOf(before), planLineOf(contract));
    const had = new Set(bundleLinesOf(before).map((line) => line.sourceKey));
    const has = new Set(bundleLinesOf(contract).map((line) => line.sourceKey));
    const bundlesAdded = bundleLinesOf(contract)
        .filter((line) => !had.has(line.sourceKey))
        .map(sourceOf);
    const bundlesRemoved = bundleLinesOf(before)
        .filter((line) => !has.has(line.sourceKey))
        .map(sourceOf);
    return {
        concluded: false,
        plan,
        bundlesAdded,
        bundlesRemoved,
        frozenAnew: plan === null && bundlesAdded.length === 0 && bundlesRemoved.length === 0,
        priceChanged: grossCentsPerYear(before) !== grossCentsPerYear(contract),
        cancelled,
    };
}

/** Another plan, judged by its net price over a year; `null` for the same plan or none on either side. */
function planChangeOf(
    before: ContractLineItemRecord | undefined,
    after: ContractLineItemRecord | undefined,
): AdminContractChange['plan'] {
    if (!before && !after) return null;
    if (before && after && before.sourceKey === after.sourceKey) return null;
    if (!before || !after || before.currency !== after.currency) return 'changed';
    const was = netCentsPerYear(before);
    const is = netCentsPerYear(after);
    if (is > was) return 'upgraded';
    if (is < was) return 'downgraded';
    return 'changed';
}

/**
 * A line's net price over a year, in cents: comparing a year rather than a
 * month keeps a yearly price from being divided, and its rounding from
 * deciding an upgrade.
 */
function netCentsPerYear(line: ContractLineItemRecord): number {
    return Math.round(line.priceNet * CENTS) * periodsPerYear(line.billingCycle);
}

/** What the contract costs over a year, in cents, its currency named beside it. */
function grossCentsPerYear(contract: SubscriptionContractRecord): string {
    const { totalGross, billingCycle, currency } = contract.priceSnapshot;
    return `${Math.round(totalGross * CENTS) * periodsPerYear(billingCycle)} ${currency}`;
}

function periodsPerYear(cycle: 'monthly' | 'yearly'): number {
    return cycle === 'monthly' ? MONTHS_PER_YEAR : 1;
}

/** The contract written last first; of two written at once, the larger id first. */
function writtenLastFirst(a: SubscriptionContractRecord, b: SubscriptionContractRecord): number {
    return (
        b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    );
}

function inSequence(a: SubscriptionContractRecord, b: SubscriptionContractRecord): number {
    return (
        a.effectiveFrom.getTime() - b.effectiveFrom.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
}

function planLineOf(contract: SubscriptionContractRecord): ContractLineItemRecord | undefined {
    return contract.lineItems.find((line) => line.kind === 'plan');
}

function bundleLinesOf(contract: SubscriptionContractRecord): ContractLineItemRecord[] {
    return contract.lineItems.filter((line) => line.kind === 'bundle');
}

function sourceOf(line: ContractLineItemRecord): AdminContractSource {
    return { key: line.sourceKey, title: line.titleSnapshot };
}

function latestMinimumTermOf(contract: SubscriptionContractRecord): Date | null {
    return contract.lineItems.reduce<Date | null>((latest, line) => {
        const term = line.minimumTermUntil;
        return term && (!latest || term.getTime() > latest.getTime()) ? term : latest;
    }, null);
}
