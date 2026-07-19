// CliContextService — Cross-Cutting-Helpers für Konsumenten-CLIs (AutohausPro `ahp`,
// vereinsfux `vf`, Dagitto `dg`). Folgt den Konventionen aus
// `@saasicat/spec/cli-conventions.md`:
//
//   - Identitäts-Pflicht via Env-Var (`<APP>_ADMIN_EMAIL`) oder `--as`-Flag
//   - MFA-Pflicht für kritische Befehle (TOTP via Plattform-MfaService)
//   - Production-Confirmation via Env-Var-Detection
//   - AuditLog mit `actor=cli:<email>:<host>` via AdminAuditService
//
// Konsumenten konfigurieren das Service via `forRoot({...})` mit ihren
// projektspezifischen Env-Var-Namen und Adapter-Implementierungen.

import * as os from 'node:os';
import * as readline from 'node:readline';
import { Inject, Injectable } from '@nestjs/common';
import { AdminAuditService, MfaService } from '@saasicat/nest';
import type { AdminActor, PlatformUserDto, UserPort } from '@saasicat/types';
import { CLI_CONTEXT_CONFIG_TOKEN, USER_PORT_TOKEN } from './tokens.js';

export interface CliContextConfig {
    /**
     * Env-Var-Name für die Admin-Email (z. B. `AHP_ADMIN_EMAIL`,
     * `VF_ADMIN_EMAIL`). Plattform-Default: `SAAS_ADMIN_EMAIL`.
     */
    adminEmailEnvVar: string;
    /**
     * Funktion, die `true` liefert, wenn das CLI gegen eine Production-
     * Umgebung läuft. Konsument prüft eigene Env-Vars (z. B.
     * `AUTOHAUSPRO_ENV === 'production'`, `DATABASE_URL`-Host etc.).
     */
    isProductionEnvironment: () => boolean;
    /**
     * Env-Var-Name für den MFA-Bypass-Schalter (z. B. `AHP_SKIP_MFA`).
     * Plattform-Default: `SAAS_PLATFORM_SKIP_MFA`. Bypass greift nur,
     * wenn `isProductionEnvironment()` `false` ist.
     */
    mfaSkipEnvVar: string;
    /**
     * Anzeige-Issuer für `<app> admin mfa-setup` im Authenticator
     * (z. B. "vereinsfux SuperAdmin", "AutohausPro SuperAdmin").
     * Default: `"SuperAdmin"`.
     */
    mfaIssuer?: string;
}

export interface CliIdentity {
    email: string;
    host: string;
    /** "cli:<email>:<host>" — kanonischer Audit-Actor-Tag. */
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
    // §1 Identität
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
     * Lädt + validiert den User für eine CLI-Identität:
     *   - User existiert + aktiv
     *   - User hat Plattform-Rolle SUPER_ADMIN
     *
     * Wirft `CliError(NOT_SUPER_ADMIN, exit=2)` sonst.
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
    // §2 MFA — TOTP-Pflicht
    // ---------------------------------------------------------------------

    /**
     * Fordert einen TOTP-Code vom Benutzer und prüft ihn gegen das gespeicherte
     * Secret (via Plattform-`MfaService` → `MfaPort`).
     *
     * Bypass: `process.env[mfaSkipEnvVar] === '1'` UND `!isProductionEnvironment()`.
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
    // §3 Production-Confirmation
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
     * Schreibt einen Audit-Log-Eintrag mit dem CLI-Actor-Tag. Wrapper über
     * `AdminAuditService.log` mit automatischer `fromCli`-Konstruktion.
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
    // Output-Helpers (§4)
    // ---------------------------------------------------------------------

    table(rows: Record<string, unknown>[]): void {
        if (rows.length === 0) {
            console.log('— keine Einträge —');
            return;
        }
        console.table(rows);
    }

    /**
     * Liest eine Zeile von stdin. Override-Hook für Tests: setze
     * `process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY` auf eine Antwort, dann
     * wird die Methode ohne Interaktion erfolgreich.
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
 * Strukturierter CLI-Fehler mit `exitCode`-Mapping nach
 * `cli-conventions.md` §6:
 *
 *   1 = User-Error, 2 = Auth, 3 = MFA, 4 = Connectivity,
 *   5 = Permission, 6 = Conflict, 7 = Drift, 99 = Internal.
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
