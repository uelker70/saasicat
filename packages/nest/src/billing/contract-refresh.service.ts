import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
    AdminActor,
    BillingCycle,
    CreateSubscriptionContractData,
    DiscoverySnapshot,
    PlanCatalog,
    RlsBypassPort,
    SubscriptionContractRecord,
    SubscriptionUsagePort,
} from '@saasicat/core';
import { ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES } from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { DISCOVERY_SNAPSHOT_TOKEN } from '../discovery/discovery.tokens.js';
import { contractBundleVersionIds, contractLimits } from '../entitlement/aggregation.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import type { EffectiveLimits } from '../entitlement/entitlement.types.js';
import { SubscriptionContractService } from '../subscription-contract/subscription-contract.service.js';
import {
    featureChangeOf,
    moneyChangesOf,
    quotaChangesOf,
    vocabularyOf,
    type ContractFeatureChange,
    type ContractMoneyChange,
    type ContractQuotaChange,
    type ContractRefreshMode,
    type ContractVocabulary,
    withAgreedTerms,
} from './contract-refresh.js';
import { PLAN_CATALOG_SOURCE_TOKEN } from './plan-catalog.module.js';
import type { PlanCatalogSource } from './plan-catalog-source.js';
import { SubscriptionContractFreezeService } from './subscription-contract-freeze.service.js';
import { SUBSCRIPTION_USAGE_PORT_TOKEN } from './tenant-billing.tokens.js';

/** Which contracts a refresh looks at. */
export interface ContractRefreshSelection {
    /** The contracts to look at; every contract in force where absent. */
    contractIds?: readonly string[];
}

/** Why a refresh leaves a contract as it is. */
export type ContractRefreshRefusal =
    /** Not found, or not in force: ended, superseded, or not begun. */
    | { code: 'NOT_IN_FORCE' }
    /** The tenant it was concluded for has no subscription to read today's versions from. */
    | { code: 'NO_SUBSCRIPTION' }
    /** The contract does not say which plan version it was frozen from. */
    | { code: 'PLAN_VERSION_NOT_RECORDED' }
    /**
     * The subscription is bound to another plan version than the one the
     * contract records. Replacing features alone would move the contract to
     * that version's features without its price; a full re-freeze is the way,
     * and weighs the price.
     */
    | { code: 'PLAN_VERSION_MOVED'; recorded: string; bound: string }
    /** A full re-freeze would charge differently; `money` says where. */
    | { code: 'MONEY_WOULD_CHANGE' }
    /** Composing or writing the successor was refused; `reason` is the refusal's message. */
    | { code: 'REFUSED'; reason: string };

/** What a refresh would change on one contract, or why it would not. */
export interface ContractRefreshPreview {
    contractId: string;
    /** `null` only for a contract named that does not exist. */
    tenantId: string | null;
    vocabulary: ContractVocabulary;
    features: ContractFeatureChange;
    quotas: ContractQuotaChange[];
    money: ContractMoneyChange[];
    /** Whether a successor would record anything differently from the contract. */
    changes: boolean;
    /** Why the contract is left as it is; `null` where a successor would be written. */
    refusal: ContractRefreshRefusal | null;
}

/** What a refresh did to one contract. */
export interface ContractRefreshOutcome extends ContractRefreshPreview {
    /** The successor written, or `null` where none was. */
    successorId: string | null;
    /**
     * The contract moved between the read and the write — a plan change or a
     * cancellation got there first — and nothing was written. Ask again.
     */
    moved: boolean;
}

/** The contracts in force whose frozen vocabulary has fallen behind. */
export interface ContractVocabularyReport {
    /** How many contracts in force were looked at. */
    inForce: number;
    stale: ContractRefreshPreview[];
    /**
     * The contracts today's features could not be read for — their tenant has
     * no subscription, or an add-on version they cover cannot be read — so
     * nothing is known about their vocabulary. Named rather than left out: left
     * out, they would read as up to date.
     */
    unreadable: ContractRefreshPreview[];
}

/** The refusals that mean a contract could not be compared at all. */
const UNREADABLE: readonly ContractRefreshRefusal['code'][] = ['NO_SUBSCRIPTION', 'REFUSED'];

interface Target {
    contractId: string;
    /** As read; `null` where no such contract exists. */
    found: SubscriptionContractRecord | null;
    /** `found`, where it is in force at the moment asked about. */
    contract: SubscriptionContractRecord | null;
}

interface Planned {
    preview: ContractRefreshPreview;
    successor: CreateSubscriptionContractData | null;
}

const NO_VOCABULARY: ContractVocabulary = { unknown: [], missing: [] };

/**
 * Carries a changed feature vocabulary into contracts in force, on the
 * operator's command (`SC-ENTL-023`), and says where it has fallen behind
 * (`SC-ENTL-022`).
 *
 * A contract keeps the feature keys it was frozen with, and that is the point
 * of freezing it (`SC-ENTL-021`). So nothing here runs by itself, and every
 * write is preceded by the preview it would show, worked out on the same path —
 * `apply` computes what `preview` shows and writes it, rather than trusting a
 * preview made earlier.
 *
 * It reads and writes across tenants, the way the administration does
 * (`SC-SEC-003`): the operator acts for the platform, and a policy scoping
 * reads to one tenant would make every other tenant's contracts look absent.
 */
@Injectable()
export class ContractRefreshService {
    private readonly logger = new Logger('SaaSiCat.ContractRefresh');

    constructor(
        @Inject(SubscriptionContractService)
        private readonly contracts: SubscriptionContractService,
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN) private readonly usage: SubscriptionUsagePort,
        @Inject(PLAN_CATALOG_SOURCE_TOKEN) private readonly catalogs: PlanCatalogSource,
        @Inject(SubscriptionContractFreezeService)
        private readonly freeze: SubscriptionContractFreezeService,
        @Optional()
        @Inject(DISCOVERY_SNAPSHOT_TOKEN)
        private readonly discovery: DiscoverySnapshot | null = null,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    /** The contracts in force whose frozen features hold unknown keys or lack granted ones. */
    inspect(asOf: Date = new Date()): Promise<ContractVocabularyReport> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const previews = await this.previewAll({}, 'features', asOf);
            return {
                inForce: previews.length,
                stale: previews.filter(
                    ({ vocabulary }) =>
                        vocabulary.unknown.length > 0 || vocabulary.missing.length > 0,
                ),
                unreadable: previews.filter(
                    ({ refusal }) => refusal !== null && UNREADABLE.includes(refusal.code),
                ),
            };
        });
    }

    /** What a refresh would change on each contract selected. Writes nothing. */
    preview(
        selection: ContractRefreshSelection,
        mode: ContractRefreshMode,
        asOf: Date = new Date(),
    ): Promise<ContractRefreshPreview[]> {
        return readAcrossTenants(this.rlsBypass, () => this.previewAll(selection, mode, asOf));
    }

    /**
     * Writes a successor for each contract selected that would change and is
     * not refused, and keeps the contract it replaces as superseded
     * (`SC-AUD-007`). What it writes is what `preview` shows at this moment.
     */
    apply(
        selection: ContractRefreshSelection,
        mode: ContractRefreshMode,
        actor: AdminActor,
        asOf: Date = new Date(),
    ): Promise<ContractRefreshOutcome[]> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const catalog = await this.catalogs.current();
            const outcomes: ContractRefreshOutcome[] = [];
            for (const target of await this.targets(selection, asOf)) {
                const planned = await this.plan(target, mode, catalog, asOf);
                outcomes.push(await this.write(target, planned, mode, actor, asOf));
            }
            return outcomes;
        });
    }

    // -----------------------------------------------------------------

    private async previewAll(
        selection: ContractRefreshSelection,
        mode: ContractRefreshMode,
        asOf: Date,
    ): Promise<ContractRefreshPreview[]> {
        const catalog = await this.catalogs.current();
        const previews: ContractRefreshPreview[] = [];
        for (const target of await this.targets(selection, asOf)) {
            previews.push((await this.plan(target, mode, catalog, asOf)).preview);
        }
        return previews;
    }

    private async write(
        target: Target,
        planned: Planned,
        mode: ContractRefreshMode,
        actor: AdminActor,
        asOf: Date,
    ): Promise<ContractRefreshOutcome> {
        const { preview, successor } = planned;
        const unwritten = { ...preview, successorId: null, moved: false };
        if (!target.contract || !successor || preview.refusal || !preview.changes) {
            return unwritten;
        }
        let written: SubscriptionContractRecord | null;
        try {
            written = await this.contracts.writeSuccessor(target.contract, successor, asOf, {
                keepParties: mode === 'features',
            });
        } catch (error) {
            return { ...unwritten, refusal: { code: 'REFUSED', reason: messageOf(error) } };
        }
        if (!written) return { ...unwritten, moved: true };
        this.entitlements.invalidateTenant(written.tenantId);
        await this.record(actor, target.contract, written, mode, preview);
        return { ...preview, successorId: written.id, moved: false };
    }

    private async plan(
        target: Target,
        mode: ContractRefreshMode,
        catalog: PlanCatalog,
        asOf: Date,
    ): Promise<Planned> {
        const contract = target.contract;
        if (!contract) {
            return refused(target.contractId, target.found?.tenantId ?? null, NO_VOCABULARY, {
                code: 'NOT_IN_FORCE',
            });
        }
        const frozen = contractLimits(contract);
        const known = this.knownFeatures(catalog);
        const unknownOnly = vocabularyOf({
            frozen: frozen.features,
            frozenWithReplacements: frozen.features,
            grantedToday: new Set(),
            known,
        });
        let today: { planVersionId: string; features: Set<string> } | null;
        try {
            today = await this.entitlements.contractFeaturesFor(
                contract.tenantId,
                contractBundleVersionIds(contract),
                catalog,
            );
        } catch (error) {
            return refused(contract.id, contract.tenantId, unknownOnly, {
                code: 'REFUSED',
                reason: messageOf(error),
            });
        }
        if (!today) {
            return refused(contract.id, contract.tenantId, unknownOnly, {
                code: 'NO_SUBSCRIPTION',
            });
        }
        const grantedToday = today.features;
        const vocabulary = vocabularyOf({
            frozen: frozen.features,
            frozenWithReplacements: this.entitlements.withReplacements(frozen.features),
            grantedToday,
            known,
        });

        if (mode === 'features') {
            const recorded = recordedPlanVersionOf(contract);
            if (!recorded) {
                return refused(contract.id, contract.tenantId, vocabulary, {
                    code: 'PLAN_VERSION_NOT_RECORDED',
                });
            }
            if (recorded !== today.planVersionId) {
                return refused(contract.id, contract.tenantId, vocabulary, {
                    code: 'PLAN_VERSION_MOVED',
                    recorded,
                    bound: today.planVersionId,
                });
            }
            const successor: CreateSubscriptionContractData = {
                ...this.contracts.dataOf(contract),
                status: 'active',
                effectiveFrom: asOf,
                entitlementSnapshot: {
                    plan: frozen.plan,
                    quotas: { ...frozen.quotas },
                    features: [...grantedToday].sort(),
                    ...leftOutOf(contract),
                },
            };
            // The successor keeps the contract's money, and the write refuses it
            // where a tax adapter now decides another rate for the subscriber:
            // asked here too, so the preview says what the run will do.
            try {
                await this.contracts.decidedTaxFor(successor, {
                    subscriberId: contract.subscriberId,
                });
            } catch (error) {
                return refused(contract.id, contract.tenantId, vocabulary, {
                    code: 'REFUSED',
                    reason: messageOf(error),
                });
            }
            return this.compared(contract, frozen, vocabulary, successor);
        }

        let successor: CreateSubscriptionContractData;
        try {
            successor = await this.refrozen(contract, asOf);
        } catch (error) {
            return refused(contract.id, contract.tenantId, vocabulary, {
                code: 'REFUSED',
                reason: messageOf(error),
            });
        }
        const planned = this.compared(contract, frozen, vocabulary, successor);
        if (planned.preview.money.length > 0) {
            planned.preview.refusal = { code: 'MONEY_WOULD_CHANGE' };
        }
        return planned;
    }

    /**
     * The contract `freezeOnPlanChange` would write for the tenant now, with
     * the terms the contract it replaces agreed.
     */
    private async refrozen(
        contract: SubscriptionContractRecord,
        asOf: Date,
    ): Promise<CreateSubscriptionContractData> {
        const subscription = await this.usage.findForTenant(contract.tenantId);
        if (!subscription) throw new Error(`Tenant '${contract.tenantId}' has no subscription.`);
        const composed = await this.freeze.composeOnPlanChange(
            contract.tenantId,
            subscription.plan,
            // The column behind it is the `BillingCycle` enum in the canonical
            // schema; the usage port types it as a string.
            subscription.billingCycle as BillingCycle,
            asOf,
            contract.effectiveUntil,
        );
        return withAgreedTerms(contract, composed);
    }

    private compared(
        contract: SubscriptionContractRecord,
        frozen: EffectiveLimits,
        vocabulary: ContractVocabulary,
        successor: CreateSubscriptionContractData,
    ): Planned {
        const snapshot = successor.entitlementSnapshot;
        const features = featureChangeOf(frozen.features, snapshot?.features ?? []);
        const quotas = quotaChangesOf(frozen.quotas, snapshot?.quotas ?? {});
        const money = moneyChangesOf(contract, successor);
        const leftOutMoved = !sameMembers(
            contract.entitlementSnapshot?.leftOutBundleVersionIds ?? [],
            snapshot?.leftOutBundleVersionIds ?? [],
        );
        return {
            preview: {
                contractId: contract.id,
                tenantId: contract.tenantId,
                vocabulary,
                features,
                quotas,
                money,
                changes:
                    features.added.length > 0 ||
                    features.removed.length > 0 ||
                    quotas.length > 0 ||
                    money.length > 0 ||
                    frozen.plan !== snapshot?.plan ||
                    leftOutMoved,
                refusal: null,
            },
            successor,
        };
    }

    /**
     * Every feature key the application knows: the ones its code declares, the
     * old keys those declarations say they replace, and the catalogue's.
     */
    private knownFeatures(catalog: PlanCatalog): Set<string> {
        const known = new Set<string>();
        for (const feature of this.discovery?.features ?? []) {
            known.add(feature.featureKey);
            for (const old of feature.replaces ?? []) known.add(old);
        }
        for (const feature of catalog.features ?? []) known.add(feature.key);
        return known;
    }

    /** The contracts selected, each read as it stands, or `null` where it is not in force. */
    private async targets(selection: ContractRefreshSelection, asOf: Date): Promise<Target[]> {
        if (selection.contractIds === undefined) {
            const inForce = await this.contracts.list({ asOf });
            return inForce
                .filter((contract) => isInForce(contract, asOf))
                .map((contract) => ({ contractId: contract.id, found: contract, contract }));
        }
        const targets: Target[] = [];
        for (const contractId of selection.contractIds) {
            const found = await this.contracts.findById(contractId);
            targets.push({
                contractId,
                found,
                contract: found && isInForce(found, asOf) ? found : null,
            });
        }
        return targets;
    }

    /** Best effort: the successor stands whether or not its record could be written (`SC-AUD-004`). */
    private async record(
        actor: AdminActor,
        previous: SubscriptionContractRecord,
        successor: SubscriptionContractRecord,
        mode: ContractRefreshMode,
        preview: ContractRefreshPreview,
    ): Promise<void> {
        if (!this.audit) return;
        try {
            await this.audit.log({
                actor,
                entity: 'SubscriptionContract',
                entityId: successor.id,
                action: 'SUBSCRIPTION_CONTRACT_REFRESH',
                changes: {
                    mode,
                    supersedes: previous.id,
                    tenantId: successor.tenantId,
                    features: preview.features,
                    quotas: preview.quotas,
                },
            });
        } catch (error) {
            this.logger.error(
                `The audit record of the refresh that wrote contract ${successor.id} could not be ` +
                    'written; the successor itself was.',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

function refused(
    contractId: string,
    tenantId: string | null,
    vocabulary: ContractVocabulary,
    refusal: ContractRefreshRefusal,
): Planned {
    return {
        preview: {
            contractId,
            tenantId,
            vocabulary,
            features: { added: [], removed: [] },
            quotas: [],
            money: [],
            changes: false,
            refusal,
        },
        successor: null,
    };
}

/** The add-ons the contract's snapshot names as left out, carried as they are. */
function leftOutOf(
    contract: SubscriptionContractRecord,
): { leftOutBundleVersionIds: string[] } | Record<string, never> {
    const leftOut = contract.entitlementSnapshot?.leftOutBundleVersionIds;
    return leftOut && leftOut.length > 0 ? { leftOutBundleVersionIds: [...leftOut] } : {};
}

/** The plan version a contract was frozen from, where it says. */
function recordedPlanVersionOf(contract: SubscriptionContractRecord): string | null {
    return (
        contract.originalPlanVersionId ??
        contract.lineItems.find((line) => line.kind === 'plan')?.sourceVersionId ??
        null
    );
}

function isInForce(contract: SubscriptionContractRecord, asOf: Date): boolean {
    return (
        ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES.includes(contract.status) &&
        contract.effectiveFrom.getTime() <= asOf.getTime() &&
        (contract.effectiveUntil === null || contract.effectiveUntil.getTime() > asOf.getTime())
    );
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((id) => right.has(id));
}

function messageOf(error: unknown): string {
    if (error && typeof error === 'object' && 'getResponse' in error) {
        const response = (error as { getResponse(): unknown }).getResponse();
        if (response && typeof response === 'object' && 'message' in response) {
            return String((response as { message: unknown }).message);
        }
    }
    return error instanceof Error ? error.message : String(error);
}
