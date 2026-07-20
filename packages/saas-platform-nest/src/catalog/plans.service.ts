// PlansService — CRUD for `plans` (SPEC_V2 §11.1 M6, Pack 1).
//
// Pack 1 only covers plan master operations. The PlanVersion lifecycle
// (Draft → Publish → Supersede) follows with Pack 2 (importer cutover) —
// at which point a dedicated `PlanVersionsService` and an extended
// repository port close the gap.

import {
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import type {
    CreatePlanData,
    PlanRepository,
    PlanRow,
    SubscriptionRepository,
    UpdatePlanData,
} from '@saasicat/types';

import { SUBSCRIPTION_REPOSITORY_TOKEN } from '../entitlement/tokens.js';
import { PLAN_REPOSITORY_TOKEN } from './tokens.js';

@Injectable()
export class PlansService {
    constructor(
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly repo: PlanRepository,
        @Optional()
        @Inject(SUBSCRIPTION_REPOSITORY_TOKEN)
        private readonly subscriptions: SubscriptionRepository | null = null,
    ) {}

    /**
     * Platform-wide count of active (ACTIVE/TRIAL) subscriptions per `planKey`,
     * across versions and across all tenants (RLS-exempt). Plans without a
     * subscription are absent from the map. Returns `{}` when no
     * `SubscriptionRepository` is registered or it does not implement
     * `countActiveByPlanKey`.
     */
    async getTenantCounts(projectKey: string): Promise<Record<string, number>> {
        return (await this.subscriptions?.countActiveByPlanKey?.(projectKey)) ?? {};
    }

    listPlans(projectKey: string, opts: { onlyPublished?: boolean } = {}): Promise<PlanRow[]> {
        return this.repo.list({
            projectKey,
            excludeDeleted: true,
            onlyPublished: opts.onlyPublished ?? false,
        });
    }

    async getPlan(planId: string): Promise<PlanRow> {
        const plan = await this.repo.findById(planId);
        if (!plan) throw new NotFoundException(`Plan '${planId}' nicht gefunden`);
        return plan;
    }

    async createPlan(data: CreatePlanData): Promise<PlanRow> {
        const existing = await this.repo.findByKey(data.projectKey, data.planKey);
        if (existing) {
            throw new UnprocessableEntityException(
                `Plan '${data.planKey}' existiert bereits in Projekt '${data.projectKey}'`,
            );
        }
        return this.repo.create(data);
    }

    async updatePlan(planId: string, data: UpdatePlanData): Promise<PlanRow> {
        const existing = await this.repo.findById(planId);
        if (!existing) throw new NotFoundException(`Plan '${planId}' nicht gefunden`);
        return this.repo.update(planId, data);
    }

    async softDeletePlan(planId: string): Promise<void> {
        const existing = await this.repo.findById(planId);
        if (!existing) throw new NotFoundException(`Plan '${planId}' nicht gefunden`);
        if (existing.deletedAt !== null) return; // idempotent

        // Plan protection rule: a plan that was ever published (live OR
        // superseded) must not be deleted — existing subscriptions
        // reference the published versions (contract protection P1) and
        // audit trails need a stable plan master record.
        await this.assertNoPublishedVersions(existing.planKey, 'soft-delete');
        await this.repo.softDelete(planId);
    }

    /**
     * Hard-deletes the plan master record. Only allowed for plans without
     * `PlanVersion` entries — published versions are immutable under
     * contract protection P1 (existing subscriptions reference them). The
     * caller must discard drafts beforehand via `DELETE plan-versions/:id`.
     *
     * If the repository does not implement `hardDelete`, the endpoint
     * responds with 422 `PLAN_HARD_DELETE_NOT_IMPLEMENTED` — consumers can
     * then fall back to `softDelete`.
     */
    async hardDeletePlan(planId: string): Promise<void> {
        const existing = await this.repo.findById(planId);
        if (!existing) throw new NotFoundException(`Plan '${planId}' nicht gefunden`);

        // Strict protection rule: published versions block any deletion
        // (contract protection P1). Drafts additionally block hard-delete —
        // the caller must first discard them via the discard route.
        await this.assertNoPublishedVersions(existing.planKey, 'hard-delete');
        await this.assertNoDrafts(existing.planKey);

        if (typeof this.repo.hardDelete !== 'function') {
            throw new UnprocessableEntityException({
                code: 'PLAN_HARD_DELETE_NOT_IMPLEMENTED',
                message:
                    'Hartes Löschen ist im aktuellen Repository nicht implementiert. ' +
                    'Implementiere PlanRepository.hardDelete.',
            });
        }
        await this.repo.hardDelete(planId);
    }

    /**
     * Platform invariant (contract protection P1): once a plan has ever had a
     * published version, its plan master record is retained — regardless of
     * whether the version has since been superseded. Subscriptions still
     * reference it via the version, and the audit log must be able to resolve
     * the plan.
     */
    private async assertNoPublishedVersions(planKey: string, op: string): Promise<void> {
        if (typeof this.repo.listVersions !== 'function') return;
        const versions = await this.repo.listVersions(planKey);
        const published = versions.filter((v) => v.publishedAt !== null);
        if (published.length === 0) return;
        const live = published.filter((v) => v.supersededAt === null).length;
        const superseded = published.length - live;
        throw new UnprocessableEntityException({
            code: 'PLAN_HAS_PUBLISHED_VERSIONS',
            message:
                `Plan '${planKey}' kann nicht ${op === 'hard-delete' ? 'gelöscht' : 'archiviert'} werden — ` +
                `der Plan hat ${published.length} published Version(en) (${live} live, ${superseded} superseded). ` +
                `Bestand-Subscriptions referenzieren diese Versionen (Vertragsschutz P1), ` +
                `der Plan-Stamm muss erhalten bleiben.`,
            publishedCount: published.length,
            liveCount: live,
            supersededCount: superseded,
        });
    }

    private async assertNoDrafts(planKey: string): Promise<void> {
        if (typeof this.repo.listVersions !== 'function') return;
        const versions = await this.repo.listVersions(planKey);
        const drafts = versions.filter((v) => v.publishedAt === null);
        if (drafts.length === 0) return;
        throw new UnprocessableEntityException({
            code: 'PLAN_HAS_DRAFTS',
            message:
                `Plan '${planKey}' hat noch ${drafts.length} offene Draft-Version(en). ` +
                `Verwerfe sie zuerst (DELETE /admin/catalog/plan-versions/:id) oder publishe sie.`,
            draftCount: drafts.length,
        });
    }
}
