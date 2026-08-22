// WhoAmIFlow — `<app> admin whoami`.
//
// Provides a diagnostic overview of the active CLI identity, MFA setup
// status and production detection. Read-only, no audit log, no MFA.
//
// Spec: packages/spec/cli-conventions.md §1.

import { Inject, Injectable } from '@nestjs/common';
import { MfaService } from '@saasicat/nest';
import { CliContextService, type CliContextConfig } from './cli-context.service.js';
import { CLI_CONTEXT_CONFIG_TOKEN } from './cli.tokens.js';

export interface WhoAmIResult {
    email: string;
    host: string;
    actor: string;
    userId: string | null;
    isSuperAdmin: boolean;
    mfaEnabled: boolean;
    isProduction: boolean;
    mfaSkipActive: boolean;
}

@Injectable()
export class WhoAmIFlow {
    constructor(
        @Inject(CLI_CONTEXT_CONFIG_TOKEN) private readonly config: CliContextConfig,
        private readonly ctx: CliContextService,
        private readonly mfa: MfaService,
    ) {}

    async run(asFlag?: string): Promise<WhoAmIResult> {
        const identity = this.ctx.resolveIdentity(asFlag);
        const isProduction = this.config.isProductionEnvironment();
        const mfaSkipActive = !isProduction && process.env[this.config.mfaSkipEnvVar] === '1';

        let userId: string | null = null;
        let isSuperAdmin = false;
        let mfaEnabled = false;

        try {
            const user = await this.ctx.ensureSuperAdmin(identity);
            userId = user.id;
            isSuperAdmin = true;
            mfaEnabled = await this.mfa.isEnabled(user.id);
        } catch {
            // User not found / not SUPER_ADMIN — surfaced in the output
            // line; whoami should still provide diagnostics even when the
            // identity does not exist at all.
        }

        return {
            email: identity.email,
            host: identity.host,
            actor: identity.actor,
            userId,
            isSuperAdmin,
            mfaEnabled,
            isProduction,
            mfaSkipActive,
        };
    }

    formatResult(r: WhoAmIResult): string {
        const lines = [
            `Identity:         ${r.email}`,
            `Host:             ${r.host}`,
            `Actor-Tag:        ${r.actor}`,
            `User ID:          ${r.userId ?? '— (user not found)'}`,
            `Platform role:    ${r.isSuperAdmin ? 'SUPER_ADMIN ✓' : '— (not a SUPER_ADMIN!)'}`,
            `MFA configured:   ${r.mfaEnabled ? '✓' : '✗ — run `admin mfa-setup`'}`,
            `Environment:      ${r.isProduction ? 'PRODUCTION' : 'non-production'}`,
        ];
        if (r.mfaSkipActive) {
            lines.push('⚠  MFA bypass active (SKIP env var set, non-prod)');
        }
        return lines.join('\n');
    }
}
