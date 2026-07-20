// Platform FeatureGuard — checks `@RequireFeature(...)` annotations against
// the active EntitlementSet (plan + add-ons + custom overrides).
//
// Consumer hooks run through `FEATURE_GUARD_CONFIG_TOKEN` — see
// feature-guard.tokens.ts. Without config the guard behaves like a plain
// Reflector + EntitlementService lookup without RLS wrapping.

import {
    CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    FEATURE_NOT_LICENSED,
    type FeatureNotLicensedBody,
    type UpsellOffer,
    type UpsellOfferResolver,
} from '@saasicat/types';
import { EntitlementService } from '../entitlement/service.js';
import { FEATURE_GUARD_CONFIG_TOKEN, type FeatureGuardConfig } from './feature-guard.tokens.js';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator.js';
import { UPSELL_OFFER_RESOLVER_TOKEN } from './upsell.tokens.js';

interface RequestWithUser {
    user?: { role?: string; platformRole?: string; tenantId?: string };
    tenantId?: string;
}

// Constructor parameters are annotated with explicit @Inject(...) because
// `tsup` without `@swc/core` skips `emitDecoratorMetadata` — then NestJS DI
// doesn't know the constructor types and fails at bootstrap with
// "Nest can't resolve dependencies of FeatureGuard (?, …)". Explicit tokens
// are independent of the build pipeline.

@Injectable()
export class FeatureGuard implements CanActivate {
    private readonly logger = new Logger(FeatureGuard.name);

    constructor(
        @Inject(Reflector) private readonly reflector: Reflector,
        @Inject(EntitlementService) private readonly entitlements: EntitlementService,
        @Optional()
        @Inject(FEATURE_GUARD_CONFIG_TOKEN)
        private readonly config: FeatureGuardConfig | null = null,
        @Optional()
        @Inject(UPSELL_OFFER_RESOLVER_TOKEN)
        private readonly upsellResolver: UpsellOfferResolver | null = null,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const required = this.reflector.getAllAndOverride<string[] | undefined>(
            REQUIRE_FEATURE_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (!required || required.length === 0) return true;

        const request = context.switchToHttp().getRequest<RequestWithUser>();
        const user = request.user;
        if (!user) throw new ForbiddenException('Nicht authentifiziert');

        // SUPER_ADMIN bypass — platform support may help a tenant even when
        // a feature isn't booked.
        const role = this.config?.userRoleResolver
            ? this.config.userRoleResolver(user)
            : (user.role ?? user.platformRole);
        if (role === 'SUPER_ADMIN') return true;

        const tenantId = this.config?.tenantIdResolver
            ? this.config.tenantIdResolver(request)
            : (request.tenantId ?? user.tenantId);
        if (!tenantId) throw new ForbiddenException('Kein Mandant zugeordnet');

        const compute = () => this.entitlements.computeLimits(tenantId);
        const limits = this.config?.tenantContextRunner
            ? await this.config.tenantContextRunner(tenantId, compute)
            : await compute();

        const allowed = required.some((f) => limits.features.has(f));
        if (!allowed) {
            throw await this.buildNotLicensedException(required, tenantId);
        }
        return true;
    }

    /**
     * Upsell response (#36): with a registered `UpsellOfferResolver` the 403
     * becomes machine-readable (`FeatureNotLicensedBody`), so consumer UIs can
     * render a purchase offer. Without a resolver the previous plain 403
     * remains — no breaking change.
     *
     * Deliberately 403 + `code` field instead of 402 — rationale in
     * `@saasicat/types` upsell.types.ts (402 is reserved / inconsistently
     * supported; SPA interceptors must not treat the 403 as an auth error, the
     * distinction runs through `code`).
     */
    private async buildNotLicensedException(
        required: string[],
        tenantId: string,
    ): Promise<ForbiddenException> {
        const message = `Feature ${required.join(' / ')} nicht im aktuellen Paket enthalten.`;
        if (!this.upsellResolver) return new ForbiddenException(message);

        const body: FeatureNotLicensedBody = {
            code: FEATURE_NOT_LICENSED,
            featureKey: required[0],
            featureKeys: required,
            offers: await this.resolveOffersSafe(required, tenantId),
            message,
        };
        return new ForbiddenException(body);
    }

    /**
     * A resolver error must not turn the semantically correct 403 into a 500 —
     * degrade to empty offers and log.
     */
    private async resolveOffersSafe(required: string[], tenantId: string): Promise<UpsellOffer[]> {
        try {
            return await (this.upsellResolver as UpsellOfferResolver).resolveOffers(
                required,
                tenantId,
            );
        } catch (error) {
            this.logger.warn(
                `UpsellOfferResolver fehlgeschlagen für [${required.join(', ')}]: ${String(error)}`,
            );
            return [];
        }
    }
}
