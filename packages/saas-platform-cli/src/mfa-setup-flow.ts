// MfaSetupFlow — interaktiver Workflow für `<app> admin mfa-setup`.
//
// Plattform-`MfaService.setup` macht die Persistenz; dieser Flow orchestriert
// den CLI-User-Pfad: Identitäts-Auflösung, Setup-Aufruf, Output (otpauthUri
// als kopierbare Zeile + Secret), Audit-Log mit `MFA_SETUP_COMPLETED`-Action.
//
// Konsumenten-CLIs wrappen diese Klasse in einer `nest-commander`-Command-
// Klasse — der Flow selbst ist nest-commander-frei und damit unit-testbar.

import { Injectable } from '@nestjs/common';
import { MfaService } from '@saasicat/nest';
import { CliContextService, CliError } from './cli-context.service.js';

export interface MfaSetupOptions {
    /** `--as <email>` Override für die Akteur-Identität. */
    asFlag?: string;
    /**
     * Issuer-String, der im Authenticator angezeigt wird (z. B. "DemoApp
     * SuperAdmin", "ClubApp SuperAdmin"). Konsumenten setzen ihren
     * eigenen App-Namen.
     */
    issuer: string;
    /**
     * Optional: bestätigt das Überschreiben eines existierenden Secrets.
     * Default: erste Re-Setup-Anfrage muss interaktiv mit `yes` bestätigt
     * werden, sonst Abbruch.
     */
    force?: boolean;
}

export interface MfaSetupResult {
    /** Base32-encoded TOTP-Secret. */
    secret: string;
    /** otpauth-URI für QR-Code-Generator (Authenticator-App). */
    otpauthUri: string;
    /** Email + ID des Users, dessen Secret gerade angelegt wurde. */
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
     * Führt den vollständigen Setup-Flow aus. Wirft `CliError`-Subclasses
     * bei Auth-/Identitäts-/Bestätigungs-Fehlern.
     */
    async run(options: MfaSetupOptions): Promise<MfaSetupResult> {
        const identity = this.ctx.resolveIdentity(options.asFlag);
        const user = await this.ctx.ensureSuperAdmin(identity);

        // Re-Setup-Schutz: existierendes Secret nicht ohne explizite
        // Bestätigung überschreiben.
        const alreadyEnabled = await this.mfa.isEnabled(user.id);
        if (alreadyEnabled && !options.force) {
            const answer = await this.ctx.prompt(
                'MFA ist bereits konfiguriert. Tippe `yes`, um das Secret zu überschreiben: ',
            );
            if (answer.trim().toLowerCase() !== 'yes') {
                throw new CliError(
                    'MFA_SETUP_ABORTED',
                    'Re-Setup nicht bestätigt — bestehendes Secret bleibt aktiv.',
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
     * Hilfsfunktion: liefert eine human-readable Output-Zeile mit
     * Secret + otpauthUri für `console.log` im Konsumenten-Command.
     * Konsumenten dürfen eigene QR-Code-Renderer (z. B. `qrcode-terminal`)
     * davor einfügen.
     */
    formatSetupResult(result: MfaSetupResult): string {
        return [
            `MFA-Setup für ${result.userEmail} abgeschlossen.`,
            '',
            `Secret (Base32):  ${result.secret}`,
            `otpauth-URI:      ${result.otpauthUri}`,
            '',
            'Bitte den otpauth-URI in den Authenticator (Google Authenticator,',
            '1Password, …) importieren oder als QR-Code in einem QR-Generator',
            'rendern. Danach mit dem ersten TOTP-Code testen, dass der Login',
            'funktioniert — sonst kommst du nicht mehr ans CLI.',
        ].join('\n');
    }
}
