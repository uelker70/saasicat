// SetupService — First-Run-SuperAdmin-Bootstrap übers Admin-UI.
//
// Sicherheitsmodell (zwei Schranken, beide müssen erfüllt sein):
//   1. SELF-DISABLE: `setup` läuft nur, solange 0 SUPER_ADMIN existieren.
//   2. SETUP-TOKEN: ein operator-gesetztes Geheimnis (Env-Var) muss mitgegeben
//      werden. Ohne gesetzte Env-Var ist Setup komplett deaktiviert.
//
// `confirm-mfa` ist NUR token-geschützt (nicht self-disable-geschützt), weil der
// SUPER_ADMIN zu diesem Zeitpunkt bereits angelegt ist und das Fenster nach
// Schranke 1 sonst schon zu wäre — der Operator hält das Token aber weiterhin.

import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import {
    isPlatformUserExistsError,
    SETUP_ERROR_CODES,
    type SetupConfirmMfaRequest,
    type SetupConfirmMfaResponse,
    type SetupRequest,
    type SetupResult,
    type SetupStatusResponse,
    type SuperAdminProvisioningPort,
} from '@saasicat/types';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';

import { MfaService } from '../admin/mfa.js';
import { type SetupConfig, SETUP_CONFIG_TOKEN, SETUP_PROVISIONING_PORT_TOKEN } from './tokens.js';

const GENERATED_PASSWORD_BYTES = 12;

function timingSafeEqualStr(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

@Injectable()
export class SetupService {
    constructor(
        @Inject(SETUP_PROVISIONING_PORT_TOKEN) private readonly users: SuperAdminProvisioningPort,
        @Inject(SETUP_CONFIG_TOKEN) private readonly config: SetupConfig,
        private readonly mfa: MfaService,
    ) {}

    async status(): Promise<SetupStatusResponse> {
        return { needsSetup: (await this.users.countSuperAdmins()) === 0 };
    }

    async setup(req: SetupRequest): Promise<SetupResult> {
        this.assertToken(req.token);
        await this.assertNoSuperAdmin();

        const email = req.email.trim().toLowerCase();
        if (!email.includes('@')) {
            throw new BadRequestException({ code: SETUP_ERROR_CODES.INVALID_EMAIL });
        }

        const generated = !req.password;
        const password = req.password ?? randomBytes(GENERATED_PASSWORD_BYTES).toString('base64url');

        let user: Awaited<ReturnType<SuperAdminProvisioningPort['createSuperAdmin']>>;
        try {
            user = await this.users.createSuperAdmin({ email, password });
        } catch (err) {
            if (isPlatformUserExistsError(err)) {
                throw new ConflictException({
                    code: SETUP_ERROR_CODES.EMAIL_EXISTS,
                    message: err.message,
                });
            }
            throw err;
        }
        const totp = await this.mfa.setup(user.id, user.email, this.config.mfaIssuer);
        const qrDataUrl = await QRCode.toDataURL(totp.otpauthUri, { width: 220, margin: 1 });

        return {
            userId: user.id,
            email: user.email,
            otpauthUri: totp.otpauthUri,
            qrDataUrl,
            secret: totp.secret,
            ...(generated ? { generatedPassword: password } : {}),
        };
    }

    async confirmMfa(req: SetupConfirmMfaRequest): Promise<SetupConfirmMfaResponse> {
        this.assertToken(req.token);
        const ok = await this.mfa.verify({ userId: req.userId, code: req.code });
        return { ok };
    }

    private assertToken(token: string): void {
        const expected = process.env[this.config.setupTokenEnvVar]?.trim();
        if (!expected) {
            throw new ForbiddenException({
                code: SETUP_ERROR_CODES.SETUP_DISABLED,
                message: `${this.config.setupTokenEnvVar} ist nicht gesetzt — Setup ist deaktiviert.`,
            });
        }
        if (!token || !timingSafeEqualStr(token, expected)) {
            throw new UnauthorizedException({ code: SETUP_ERROR_CODES.INVALID_SETUP_TOKEN });
        }
    }

    private async assertNoSuperAdmin(): Promise<void> {
        if ((await this.users.countSuperAdmins()) > 0) {
            throw new ConflictException({ code: SETUP_ERROR_CODES.SETUP_ALREADY_DONE });
        }
    }
}
