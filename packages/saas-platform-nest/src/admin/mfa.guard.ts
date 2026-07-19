// MfaGuard — fordert TOTP-Code für `@RequireMfa()`-markierte Routen.
//
// Frontend muss den Code im Header `X-Mfa-Code` mitsenden. Auth-Pipeline
// (JwtAuthGuard + SuperAdminGuard) muss vor diesem Guard laufen.
//
// Bypass-Mechanik: Setzen von `SAAS_PLATFORM_SKIP_MFA=1` UND `NODE_ENV !=
// production` schaltet den Guard für CI-Smoke-Tests aus. Konsumenten
// können einen eigenen Bypass-Schalter über die Umgebungsvariable hinaus
// nicht hinzufügen — der Guard ist absichtlich strikt.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.3 (2.2).

import {
    type CanActivate,
    type ExecutionContext,
    Inject,
    Injectable,
    Logger,
    SetMetadata,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MfaService } from './mfa.js';

export const REQUIRE_MFA_KEY = 'saas-platform/require-mfa';

/**
 * Markiert einen Endpunkt als MFA-pflichtig. Frontend sendet den TOTP-Code
 * im Header `X-Mfa-Code`. Spec: yada-services/handoff/superadmin/SPEC.md §10.
 */
export const RequireMfa = (): MethodDecorator & ClassDecorator =>
    SetMetadata(REQUIRE_MFA_KEY, true);

interface RequestWithMfa {
    user?: { id: string };
    headers?: Record<string, string | string[] | undefined>;
}

@Injectable()
export class MfaGuard implements CanActivate {
    private readonly logger = new Logger(MfaGuard.name);

    constructor(
        @Inject(Reflector) private readonly reflector: Reflector,
        private readonly mfaService: MfaService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_MFA_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!required) return true;

        if (process.env.SAAS_PLATFORM_SKIP_MFA === '1' && process.env.NODE_ENV !== 'production') {
            // Erlaubter Bypass für CI-Smoke-Tests (Plattform-weit; Konsumenten
            // dürfen das nicht einzeln umkonfigurieren).
            return true;
        }

        const request = context.switchToHttp().getRequest<RequestWithMfa>();
        const user = request.user;
        if (!user) throw new UnauthorizedException({ reason: 'NOT_AUTHENTICATED' });

        const enabled = await this.mfaService.isEnabled(user.id);
        if (!enabled) {
            throw new UnauthorizedException({
                reason: 'MFA_NOT_SET_UP',
                message: 'Bitte zuerst MFA-Setup über das CLI ausführen.',
            });
        }

        const headerVal = request.headers?.['x-mfa-code'];
        const code = Array.isArray(headerVal) ? headerVal[0] : headerVal;
        if (!code) {
            throw new UnauthorizedException({
                reason: 'MFA_REQUIRED',
                message: 'TOTP-Code im Header X-Mfa-Code erforderlich.',
            });
        }

        const valid = await this.mfaService.verify({ userId: user.id, code: String(code) });
        if (!valid) {
            throw new UnauthorizedException({
                reason: 'MFA_FAILED',
                message: 'TOTP-Code ungültig.',
            });
        }
        return true;
    }
}
