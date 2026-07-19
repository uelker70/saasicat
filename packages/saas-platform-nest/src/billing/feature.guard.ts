// Plattform-FeatureGuard — prüft `@RequireFeature(...)`-Annotationen gegen
// das aktive EntitlementSet (Plan + Add-ons + Custom-Overrides).
//
// Aus autohauspro/backend/src/billing/feature.guard.ts hochgezogen
// (yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.2).
//
// Konsumenten-Hooks laufen über `FEATURE_GUARD_CONFIG_TOKEN` — siehe
// feature-guard.tokens.ts. Ohne Config verhält sich der Guard wie ein
// schlichter Reflector + EntitlementService-Lookup ohne RLS-Wrapping.

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

// Constructor-Parameter werden mit explizitem @Inject(...) annotiert, weil
// `tsup` ohne `@swc/core` das `emitDecoratorMetadata` überspringt — dann
// kennt NestJS-DI die Konstruktor-Typen nicht und scheitert beim Bootstrap
// mit "Nest can't resolve dependencies of FeatureGuard (?, …)". Explizite
// Tokens sind unabhängig von der Build-Pipeline.

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

        // SUPER_ADMIN-Bypass — Plattform-Support darf einem Mandanten auch
        // bei nicht gebuchtem Feature helfen.
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
     * Upsell-Response (#36): mit registriertem `UpsellOfferResolver` wird der
     * 403 maschinenlesbar (`FeatureNotLicensedBody`), damit Konsumenten-UIs
     * ein Kaufangebot rendern können. Ohne Resolver bleibt der bisherige
     * plain-403 — kein Breaking Change.
     *
     * Bewusst 403 + `code`-Feld statt 402 — Begründung in
     * `@saasicat/types` upsell.types.ts (402 ist reserviert/
     * uneinheitlich unterstützt; SPA-Interceptoren dürfen den 403 nicht als
     * Auth-Fehler werten, die Unterscheidung läuft über `code`).
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
     * Ein Resolver-Fehler darf den fachlich korrekten 403 nicht in einen 500
     * verwandeln — degradieren auf leere Offers und loggen.
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
