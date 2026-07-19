// PlansService — CRUD für `plans` (SPEC_V2 §11.1 M6, Pack 1).
//
// Pack 1 deckt nur Plan-Stamm-Operationen ab. PlanVersion-Lifecycle
// (Draft → Publish → Supersede) folgt mit Pack 2 (Importer-Cutover) —
// dann lösen ein eigener `PlanVersionsService` und ein erweitertes
// Repository-Port die Lücke.

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
     * Plattformweite Zählung aktiver (ACTIVE/TRIAL) Subscriptions je `planKey`,
     * versionsübergreifend und über alle Tenants (RLS-exempt). Pläne ohne Abo
     * fehlen in der Map. Liefert `{}`, wenn kein `SubscriptionRepository`
     * registriert ist oder es `countActiveByPlanKey` nicht implementiert.
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

        // Plan-Schutzregel: ein Plan, der jemals published wurde (live ODER
        // superseded), darf nicht gelöscht werden — Bestand-Subscriptions
        // referenzieren die published Versionen (Vertragsschutz P1) und
        // Audit-Trails brauchen einen stabilen Plan-Stamm.
        await this.assertNoPublishedVersions(existing.planKey, 'soft-delete');
        await this.repo.softDelete(planId);
    }

    /**
     * Hartes Löschen des Plan-Stamms. Nur erlaubt für Pläne ohne
     * `PlanVersion`-Einträge — published Versionen sind durch
     * Vertragsschutz P1 unveränderlich (Bestand-Subscriptions referenzieren
     * sie). Drafts muss der Caller vorher via `DELETE plan-versions/:id`
     * verwerfen.
     *
     * Wenn das Repository `hardDelete` nicht implementiert, antwortet der
     * Endpoint mit 422 `PLAN_HARD_DELETE_NOT_IMPLEMENTED` — Konsumenten
     * können dann auf `softDelete` zurückfallen.
     */
    async hardDeletePlan(planId: string): Promise<void> {
        const existing = await this.repo.findById(planId);
        if (!existing) throw new NotFoundException(`Plan '${planId}' nicht gefunden`);

        // Strenge Schutzregel: published Versionen blockieren jegliches Löschen
        // (Vertragsschutz P1). Drafts blockieren Hard-Delete zusätzlich —
        // Caller muss sie erst über die Discard-Route verwerfen.
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
     * Plattform-Invariante (Vertragsschutz P1): wenn ein Plan jemals eine
     * published Version hatte, bleibt sein Plan-Stamm erhalten — egal ob
     * die Version mittlerweile superseded ist. Subscriptions referenzieren
     * weiter über die Version, und das Audit-Log muss den Plan auflösen
     * können.
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
