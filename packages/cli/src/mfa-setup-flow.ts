// MfaSetupFlow — interactive workflow for `<app> admin mfa-setup`.
//
// The platform `MfaService.setup` does the persistence; this flow orchestrates
// the CLI user path: identity resolution, setup call, output (otpauthUri as a
// copyable line + secret), audit log with the `MFA_SETUP_COMPLETED` action.
//
// Consumer CLIs wrap this class in a `nest-commander` command class — the flow
// itself is nest-commander-free and therefore unit-testable.

import { Injectable } from '@nestjs/common';
import { MfaService } from '@saasicat/nest';
import { CliContextService, CliError } from './cli-context.service.js';

export interface MfaSetupOptions {
    /** `--as <email>` override for the actor identity. */
    asFlag?: string;
    /**
     * Issuer string shown in the authenticator (e.g. "DemoApp SuperAdmin",
     * "ClubApp SuperAdmin"). Consumers set their own app name.
     */
    issuer: string;
    /**
     * Optional: confirms overwriting an existing secret. Default: the first
     * re-setup request must be confirmed interactively with `yes`, otherwise
     * it is aborted.
     */
    force?: boolean;
}

export interface MfaSetupResult {
    /** Base32-encoded TOTP secret. */
    secret: string;
    /** otpauth URI for a QR-code generator (authenticator app). */
    otpauthUri: string;
    /** Email + ID of the user whose secret was just created. */
    userId: string;
    userEmail: string;
}

@Injectable()
export class MfaSetupFlow {
    constructor(
        private readonly ctx: CliContextService,
        private readonly mfa: MfaService,
    ) {}

    /**
     * Runs the full setup flow. Throws `CliError` subclasses on
     * auth/identity/confirmation errors.
     */
    async run(options: MfaSetupOptions): Promise<MfaSetupResult> {
        const identity = this.ctx.resolveIdentity(options.asFlag);
        const user = await this.ctx.ensureSuperAdmin(identity);

        // Re-setup guard: don't overwrite an existing secret without explicit
        // confirmation.
        const alreadyEnabled = await this.mfa.isEnabled(user.id);
        if (alreadyEnabled && !options.force) {
            const answer = await this.ctx.prompt(
                'MFA is already configured. Type `yes` to overwrite the secret: ',
            );
            if (answer.trim().toLowerCase() !== 'yes') {
                throw new CliError(
                    'MFA_SETUP_ABORTED',
                    'Re-setup not confirmed — the existing secret stays active.',
                    1,
                );
            }
        }

        const setup = await this.mfa.setup(user.id, user.email, options.issuer);

        await this.ctx.log({
            identity,
            userId: user.id,
            entity: 'User',
            entityId: user.id,
            action: alreadyEnabled ? 'MFA_SETUP_RESET' : 'MFA_SETUP_COMPLETED',
            changes: { issuer: options.issuer },
        });

        return {
            secret: setup.secret,
            otpauthUri: setup.otpauthUri,
            userId: user.id,
            userEmail: user.email,
        };
    }

    /**
     * Helper: returns a human-readable output block with secret + otpauthUri
     * for `console.log` in the consumer command. Consumers may prepend their
     * own QR-code renderer (e.g. `qrcode-terminal`).
     */
    formatSetupResult(result: MfaSetupResult): string {
        return [
            `MFA setup for ${result.userEmail} completed.`,
            '',
            `Secret (Base32):  ${result.secret}`,
            `otpauth-URI:      ${result.otpauthUri}`,
            '',
            'Import the otpauth URI into your authenticator (Google Authenticator,',
            '1Password, …), or render it as a QR code in a QR generator',
            '. Then verify with the first TOTP code that login',
            'works — otherwise you will lock yourself out of the CLI.',
        ].join('\n');
    }
}
