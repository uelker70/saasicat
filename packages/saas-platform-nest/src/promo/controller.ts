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

// PromoCodePublicController — public REST call for `preview validation`.
//
// Purpose: the configurator/onboarding UI checks live whether a promo code is
// valid for the selected plan + billing cycle, and displays the computed
// price delta.
//
// Auth stack: deliberately NO app auth guard (the marketing/onboarding UI
// calls this without tenant context). Protection solely via
// `PromoCodeRateLimitGuard` (20 requests / IP / minute, 50 / session / hour —
// see spec).
//
// The code is redeemed separately: either atomically in
// `POST /billing/onboarding/initial-subscription` (TenantBillingController),
// or via `POST /billing/promo/redeem` (tenant-authenticated; issue path for
// applying it retroactively to existing subscriptions).

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
