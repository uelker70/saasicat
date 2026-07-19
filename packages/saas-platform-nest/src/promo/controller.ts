import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Inject,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import type { BillingCycle } from '@saasicat/types';
import { PromoCodesService, type PreviewResult } from './service.js';
import { PromoCodeRateLimitGuard, hashIp } from './rate-limit.guard.js';
import { PreviewPromoCodeDto } from './dto/promo-public.dto.js';

// PromoCodePublicController — öffentlicher REST-Aufruf für `Preview-Validierung`.
//
// Zweck: Die Konfigurator-/Onboarding-UI prüft live, ob ein Promo-Code für
// den gewählten Plan + Billing-Cycle gültig ist, und zeigt das berechnete
// Preis-Delta.
//
// Auth-Stack: bewusst KEIN App-Auth-Guard (Marketing-/Onboarding-UI ruft
// das ohne Tenant-Kontext auf). Schutz allein über `PromoCodeRateLimitGuard`
// (20 Requests / IP / Minute, 50 / Session / Stunde — siehe Spec).
//
// Eingelöst wird der Code separat: entweder atomar im
// `POST /billing/onboarding/initial-subscription` (TenantBillingController),
// oder per `POST /billing/promo/redeem` (Tenant-authenticated; Issue-Pfad
// für nachträgliches Anwenden auf bestehende Subscriptions).

interface RequestLike {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
    user?: { id?: string; sub?: string };
}

@Controller('billing/promo')
export class PromoCodePublicController {
    constructor(@Inject(PromoCodesService) private readonly promo: PromoCodesService) {}

    @Post('preview')
    @HttpCode(HttpStatus.OK)
    @UseGuards(PromoCodeRateLimitGuard)
    async preview(
        @Body() dto: PreviewPromoCodeDto,
        @Req() req: RequestLike,
    ): Promise<PreviewResult> {
        return this.promo.preview({
            code: dto.code,
            planId: dto.plan,
            billingCycle: dto.billingCycle as BillingCycle,
            email: dto.email,
            ipHash: hashIp(req),
            sessionId: req.user?.id ?? req.user?.sub,
        });
    }
}
