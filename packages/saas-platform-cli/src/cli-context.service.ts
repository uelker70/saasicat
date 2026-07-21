// CliContextService — cross-cutting helpers for consumer CLIs (each app
// ships its own `<app>` binary). Follows the conventions from
// `@saasicat/spec/cli-conventions.md`:
//
//   - Mandatory identity via env var (`<APP>_ADMIN_EMAIL`) or `--as` flag
//   - Mandatory MFA for critical commands (TOTP via the platform MfaService)
//   - Production confirmation via env-var detection
//   - AuditLog with `actor=cli:<email>:<host>` via AdminAuditService
//
// Consumers configure the service via `forRoot({...})` with their
// project-specific env-var names and adapter implementations.

import * as os from 'node:os';
import * as readline from 'node:readline';
import { Inject, Injectable } from '@nestjs/common';
import { AdminAuditService, MfaService } from '@saasicat/nest';
import type { AdminActor, PlatformUserDto, UserPort } from '@saasicat/types';
import { CLI_CONTEXT_CONFIG_TOKEN, USER_PORT_TOKEN } from './tokens.js';

export interface CliContextConfig {
    /**
     * Env-var name for the admin email (e.g. `MYAPP_ADMIN_EMAIL`).
     * Platform default: `SAAS_ADMIN_EMAIL`.
     */
    adminEmailEnvVar: string;
    /**
     * Function that returns `true` when the CLI runs against a production
     * environment. The consumer checks its own env vars (e.g.
     * `MYAPP_ENV === 'production'`, `DATABASE_URL` host, etc.).
     */
    isProductionEnvironment: () => boolean;
    /**
     * Env-var name for the MFA-bypass switch (e.g. `MYAPP_SKIP_MFA`).
     * Platform default: `SAAS_PLATFORM_SKIP_MFA`. The bypass only takes
     * effect when `isProductionEnvironment()` is `false`.
     */
    mfaSkipEnvVar: string;
    /**
     * Display issuer for `<app> admin mfa-setup` in the authenticator
     * (e.g. "DemoApp SuperAdmin", "ClubApp SuperAdmin").
     * Default: `"SuperAdmin"`.
     */
    mfaIssuer?: string;
}

export interface CliIdentity {
    email: string;
    host: string;
    /** "cli:<email>:<host>" — canonical audit actor tag. */
    actor: string;
}

@Injectable()
export class CliContextService {
    constructor(
        @Inject(CLI_CONTEXT_CONFIG_TOKEN) private readonly config: CliContextConfig,
        @Inject(USER_PORT_TOKEN) private readonly users: UserPort,
        private readonly mfa: MfaService,
        private readonly audit: AdminAuditService,
    ) {}

    // ---------------------------------------------------------------------
    // §1 Identity
    // ---------------------------------------------------------------------

    resolveIdentity(asFlag?: string): CliIdentity {
        const fromEnv = process.env[this.config.adminEmailEnvVar] ?? '';
        const email = (asFlag ?? fromEnv).trim().toLowerCase();
        if (!email) {
            throw new CliError(
                'NO_IDENTITY',
                `Keine Admin-Identität gesetzt. Bitte $${this.config.adminEmailEnvVar} setzen oder --as <email> übergeben.`,
                2,
            );
        }
        const host = os.hostname();
        return { email, host, actor: `cli:${email}:${host}` };
    }

    /**
     * Loads + validates the user for a CLI identity:
     *   - user exists + active
     *   - user has platform role SUPER_ADMIN
     *
     * Throws `CliError(NOT_SUPER_ADMIN, exit=2)` otherwise.
     */
    async ensureSuperAdmin(identity: CliIdentity): Promise<PlatformUserDto> {
        const user = await this.users.findByEmail(identity.email);
        if (!user || user.deletedAt || !user.isActive) {
            throw new CliError(
                'USER_NOT_FOUND',
                `SUPER_ADMIN-User ${identity.email} nicht gefunden oder inaktiv.`,
                2,
            );
        }
        if (user.platformRole !== 'SUPER_ADMIN') {
            throw new CliError(
                'NOT_SUPER_ADMIN',
                `User ${identity.email} hat Rolle ${user.platformRole} — nur SUPER_ADMIN darf das CLI nutzen.`,
                2,
            );
        }
        return user;
    }

    // ---------------------------------------------------------------------
    // §2 MFA — mandatory TOTP
    // ---------------------------------------------------------------------

    /**
     * Prompts the user for a TOTP code and verifies it against the stored
     * secret (via the platform `MfaService` → `MfaPort`).
     *
     * Bypass: `process.env[mfaSkipEnvVar] === '1'` AND `!isProductionEnvironment()`.
     */
    async requireMfa(userId: string): Promise<void> {
        if (
            process.env[this.config.mfaSkipEnvVar] === '1' &&
            !this.config.isProductionEnvironment()
        ) {
            return;
        }

        const enabled = await this.mfa.isEnabled(userId);
        if (!enabled) {
            throw new CliError(
                'MFA_NOT_SET_UP',
                "MFA ist nicht konfiguriert. Bitte zuerst 'admin mfa-setup' ausführen.",
                3,
            );
        }

        const code = await this.prompt('TOTP-Code: ');
        const ok = await this.mfa.verify({ userId, code });
        if (!ok) {
            throw new CliError('MFA_FAILED', 'TOTP-Code ungültig.', 3);
        }
    }

    // ---------------------------------------------------------------------
    // §3 Production confirmation
    // ---------------------------------------------------------------------

    async ensureProductionConfirmation(opts: { yes?: boolean } = {}): Promise<void> {
        if (!this.config.isProductionEnvironment()) return;
        if (opts.yes) return;
        const answer = await this.prompt('Tippe production zur Bestätigung: ');
        if (answer.trim().toLowerCase() !== 'production') {
            throw new CliError(
                'PRODUCTION_CONFIRM_ABORTED',
                'Production-Confirmation abgebrochen.',
                1,
            );
        }
    }

    // ---------------------------------------------------------------------
    // §5 Audit
    // ---------------------------------------------------------------------

    /**
     * Writes an audit-log entry with the CLI actor tag. Wrapper over
     * `AdminAuditService.log` with automatic `fromCli` construction.
     */
    async log(input: {
        identity: CliIdentity;
        userId: string;
        entity: string;
        entityId: string;
        action: string;
        changes?: Record<string, unknown>;
    }): Promise<void> {
        const actor: AdminActor = this.audit.fromCli({
            id: input.userId,
            email: input.identity.email,
        });
        await this.audit.log({
            actor,
            entity: input.entity,
            entityId: input.entityId,
            action: input.action,
            changes: input.changes,
        });
    }

    // ---------------------------------------------------------------------
    // Output helpers (§4)
    // ---------------------------------------------------------------------

    table(rows: Record<string, unknown>[]): void {
        if (rows.length === 0) {
            console.log('— keine Einträge —');
            return;
        }
        console.table(rows);
    }

    /**
     * Reads a line from stdin. Override hook for tests: set
     * `process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY` to a reply, then
     * the method succeeds without interaction.
     */
    async prompt(question: string): Promise<string> {
        const testReply = process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
        if (testReply !== undefined) return testReply;
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise((resolve) => {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        });
    }
}

/**
 * Structured CLI error with `exitCode` mapping per
 * `cli-conventions.md` §6:
 *
 *   1 = user error, 2 = auth, 3 = MFA, 4 = connectivity,
 *   5 = permission, 6 = conflict, 7 = drift, 99 = internal.
 */
export class CliError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly exitCode: number,
    ) {
        super(message);
        this.name = 'CliError';
    }
}
