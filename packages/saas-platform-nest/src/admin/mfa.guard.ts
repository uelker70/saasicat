// MfaGuard — requires a TOTP code for routes marked with `@RequireMfa()`.
//
// The frontend must send the code in the `X-Mfa-Code` header. The auth
// pipeline (JwtAuthGuard + SuperAdminGuard) must run before this guard.
//
// Bypass mechanics: setting `SAAS_PLATFORM_SKIP_MFA=1` AND `NODE_ENV !=
// production` disables the guard for CI smoke tests. Consumers cannot add
// their own bypass switch beyond the environment variable — the guard is
// intentionally strict.

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
 * Marks an endpoint as MFA-required. The frontend sends the TOTP code
 * in the `X-Mfa-Code` header.
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
            // Permitted bypass for CI smoke tests (platform-wide; consumers
            // may not reconfigure it individually).
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
