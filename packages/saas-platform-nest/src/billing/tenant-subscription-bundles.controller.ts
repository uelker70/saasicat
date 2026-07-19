// TenantSubscriptionBundlesController — Tenant-Self-Service-Endpunkte für
// die `subscription_bundles`-Junction (SPEC_V2 §11.1 M6 Pack 2e, P11.7.3).
//
// Routen unter `/billing/subscription-bundles`:
//   - `GET    /` → Liste der eigenen Bundle-Buchungen (alle, inkl. gekündigter)
//   - `POST   /` → neue Bundle-Buchung (Body: { bundleVersionId, minimumTermMonths? })
//   - `POST   /preview` → Add-/Cancel-Vorschau mit Proration, Redundanz-
//     Hinweis und requires-Check (#37) — genau eines von bundleVersionId
//     (add) oder subscriptionBundleId (cancel) im Body
//   - `DELETE /:id` → Kündigung mit Effektiv-Datum = max(currentPeriodEnd, minimumTermEndsAt)
//
// Resolve-Schritte:
//   1. `tenantId` aus dem Request (über TenantIdResolver — wird vom Konsumenten
//      registriert wie bei `TenantBillingController`).
//   2. `SubscriptionUsagePort.findForTenant(tenantId)` liefert currentPlanKey
//      (`planVersion.planId`) + `currentPeriodEnd` — beides braucht der
//      Service für Plan-Kompat-Check und Kündigungs-Effektiv-Datum.
//
// Auth: `ComposedTenantAuthGuard` (analog TenantBillingController) +
// optional zusätzliche Class-Level-Guards aus dem Modul.
//
// Contract-Fortschreibung (#37/#61): Konsumenten mit V3-Contract-Freeze
// (`CONTRACT_FREEZE_PORT_TOKEN` im DI-Scope, typisch via importiertem
// `TenantBillingModule.forRoot({ contractFreeze })`) bekommen nach Add/Cancel
// automatisch ein Re-Freeze mit unverändertem Plan (= Amendment als neuer
// Contract-Stand) — sonst läse der EntitlementService den alten eingefrorenen
// Snapshot zurück und das Bundle wäre trotz Buchung nicht aktiv. Non-fatal
// analog zum Plan-Wechsel-Pfad: die Mutation ist bereits persistiert.

import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Logger,
    NotFoundException,
    Optional,
    Param,
    ParseUUIDPipe,
    Post,
    Req,
    type CanActivate,
    type Type,
    UseGuards,
} from '@nestjs/common';
import type {
    BillingCycle,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
} from '@saasicat/types';

import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import {
    AddSubscriptionBundleDto,
    CancelSubscriptionBundleDto,
    PreviewSubscriptionBundleDto,
} from './dto/subscription-bundles.dto.js';
import {
    SubscriptionBundlePreviewService,
    type SubscriptionBundlePreviewContext,
} from './subscription-bundle-preview.service.js';
import { SubscriptionBundlesService } from './subscription-bundles.service.js';
import {
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    type TenantIdResolver,
} from './tenant-billing.tokens.js';

interface RequestLike {
    user?: { tenantId?: string | null } | null;
}

/**
 * Factory analog `buildBundlesController` etc. — Konsument kann zusätzliche
 * Guards (z. B. RoleGuard) zusätzlich zum Plattform-Default
 * `ComposedTenantAuthGuard` mitgeben.
 */
export function buildTenantSubscriptionBundlesController(
    extraGuards: Array<Type<CanActivate>> = [],
): Type {
    @Controller('billing/subscription-bundles')
    @UseGuards(ComposedTenantAuthGuard, ...extraGuards)
    class GeneratedTenantSubscriptionBundlesController {
        private readonly logger = new Logger('TenantSubscriptionBundlesController');

        constructor(
            @Inject(SubscriptionBundlesService)
            private readonly service: SubscriptionBundlesService,
            @Inject(SubscriptionBundlePreviewService)
            private readonly previewService: SubscriptionBundlePreviewService,
            @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
            private readonly subscriptionUsage: SubscriptionUsagePort,
            @Inject(TENANT_ID_RESOLVER_TOKEN)
            private readonly tenantIdResolver: TenantIdResolver,
            @Optional()
            @Inject(CONTRACT_FREEZE_PORT_TOKEN)
            private readonly contractFreeze: ContractFreezePort | null = null,
        ) {}

        @Get()
        async list(@Req() req: RequestLike) {
            const sub = await this.requireSubscription(this.requireTenantId(req));
            return this.service.listForSubscription(this.requireSubscriptionPk(sub));
        }

        @Post()
        async add(@Req() req: RequestLike, @Body() dto: AddSubscriptionBundleDto) {
            const tenantId = this.requireTenantId(req);
            const sub = await this.requireSubscription(tenantId);
            const result = await this.service.addBundleToSubscription({
                subscriptionId: this.requireSubscriptionPk(sub),
                bundleVersionId: dto.bundleVersionId,
                // Plan-KEY (compatibility.planIds ist key-basiert) — nicht die planVersion-UUID.
                currentPlanKey: sub.plan,
                minimumTermMonths: dto.minimumTermMonths,
            });
            await this.refreezeContract(tenantId, sub);
            return result;
        }

        @Post('preview')
        @HttpCode(HttpStatus.OK)
        async preview(@Req() req: RequestLike, @Body() dto: PreviewSubscriptionBundleDto) {
            const hasAdd = Boolean(dto.bundleVersionId);
            const hasCancel = Boolean(dto.subscriptionBundleId);
            if (hasAdd === hasCancel) {
                throw new BadRequestException(
                    'Genau eines von bundleVersionId (Add-Preview) oder ' +
                        'subscriptionBundleId (Cancel-Preview) angeben.',
                );
            }
            const sub = await this.requireSubscription(this.requireTenantId(req));
            const ctx: SubscriptionBundlePreviewContext = {
                subscriptionId: this.requireSubscriptionPk(sub),
                // Plan-KEY (compatibility.planIds ist key-basiert) — nicht die planVersion-UUID.
                currentPlanKey: sub.plan,
                billingCycle: sub.billingCycle,
                status: sub.status,
                startedAt: sub.startedAt,
                currentPeriodStart: sub.currentPeriodStart,
                currentPeriodEnd: sub.currentPeriodEnd,
            };
            return hasAdd
                ? this.previewService.previewAdd(ctx, {
                      bundleVersionId: dto.bundleVersionId!,
                      minimumTermMonths: dto.minimumTermMonths,
                  })
                : this.previewService.previewCancel(ctx, {
                      subscriptionBundleId: dto.subscriptionBundleId!,
                  });
        }

        @Delete(':id')
        @HttpCode(HttpStatus.OK)
        async cancel(
            @Req() req: RequestLike,
            @Param('id', new ParseUUIDPipe()) subscriptionBundleId: string,
            @Body() dto: CancelSubscriptionBundleDto = {} as CancelSubscriptionBundleDto,
        ) {
            const tenantId = this.requireTenantId(req);
            const sub = await this.requireSubscription(tenantId);
            const result = await this.service.cancelBundleFromSubscription({
                subscriptionBundleId,
                canceledAt: dto.canceledAt ? new Date(dto.canceledAt) : undefined,
                currentPeriodEnd: sub.currentPeriodEnd ?? undefined,
            });
            await this.refreezeContract(tenantId, sub);
            return result;
        }

        @Post(':id/reactivate')
        @HttpCode(HttpStatus.OK)
        async reactivate(
            @Req() req: RequestLike,
            @Param('id', new ParseUUIDPipe()) subscriptionBundleId: string,
        ) {
            const tenantId = this.requireTenantId(req);
            const sub = await this.requireSubscription(tenantId);
            const result = await this.service.reactivateBundle(subscriptionBundleId);
            await this.refreezeContract(tenantId, sub);
            return result;
        }

        private requireSubscriptionPk(sub: SubscriptionUsageRecord): string {
            if (!sub.id) {
                throw new NotFoundException(
                    'SubscriptionUsageRecord ohne `id` — Adapter muss die Subscription-PK durchreichen ' +
                        '(siehe SubscriptionUsageRecord.id).',
                );
            }
            return sub.id;
        }

        private requireTenantId(req: RequestLike): string {
            const tenantId = this.tenantIdResolver(req);
            if (!tenantId) {
                throw new NotFoundException('Tenant-ID nicht im Request gefunden');
            }
            return tenantId;
        }

        private async requireSubscription(tenantId: string): Promise<SubscriptionUsageRecord> {
            const sub = await this.subscriptionUsage.findForTenant(tenantId);
            if (!sub) {
                throw new NotFoundException(`Keine Subscription für Tenant ${tenantId}`);
            }
            return sub;
        }

        /**
         * Re-Freeze mit unverändertem Plan nach Bundle-Add/-Cancel (#61) —
         * nur wenn der Konsument den ContractFreezePort wired hat.
         */
        private async refreezeContract(
            tenantId: string,
            sub: SubscriptionUsageRecord,
        ): Promise<void> {
            if (!this.contractFreeze) return;
            try {
                await this.contractFreeze.freezeOnPlanChange(
                    tenantId,
                    sub.planVersion.planId,
                    sub.billingCycle as BillingCycle,
                    new Date(),
                );
            } catch (err) {
                this.logger.error(
                    `Contract-Freeze nach Bundle-Mutation fehlgeschlagen (tenant ${tenantId}): ${String(err)}`,
                );
            }
        }
    }

    return GeneratedTenantSubscriptionBundlesController;
}
