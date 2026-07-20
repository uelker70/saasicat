// MFA-Helpers — TOTP-Setup + -Verify auf Basis von `otplib`.
//
// Der `MfaService` ist ein dünner Wrapper, der den `MfaPort` (Konsumenten-
// Persistenz) mit der TOTP-Verifikation kombiniert. Konsument implementiert
// nur `MfaPort.{getSecret,setSecret,isEnabled}`; das Plattform-Service-Layer
// kümmert sich um Secret-Generierung, otpauth-URI und Code-Verifikation.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { generateSecret, generateURI, verify as verifyTotpCode } from 'otplib';
import type { MfaPort } from '@saasicat/types';
import { MFA_PORT_TOKEN } from './tokens.js';

/**
 * Erlaubt eine 30-Sekunden-Toleranz vor und nach dem aktuellen Zeitfenster
 * (= ±1 TOTP-Zeitschritt) — robust gegen Clock-Drift, ohne Sicherheits-
 * Risiko (Token bleibt 90s gültig statt 30s).
 */
const CLOCK_DRIFT_TOLERANCE_SECONDS = 30;

/**
 * Fehlerklassen, die otplib bei formal ungültigen Tokens wirft (falsche
 * Länge, Nicht-Ziffern). Match über `error.name`, weil die Klassen im
 * transitiven `@otplib/core` leben und hier nicht direkt importierbar sind.
 */
const OTPLIB_TOKEN_ERROR_NAMES = new Set(['TokenError', 'TokenFormatError', 'TokenLengthError']);

function isOtplibTokenError(error: unknown): boolean {
    return error instanceof Error && OTPLIB_TOKEN_ERROR_NAMES.has(error.name);
}

export interface TotpSetupResult {
    /** Base32-encoded TOTP-Secret (im MfaPort persistiert). */
    secret: string;
    /** otpauth://-URI für QR-Code-Generator (Authenticator-App). */
    otpauthUri: string;
}

export interface VerifyTotpInput {
    userId: string;
    code: string;
}

@Injectable()
export class MfaService {
    private readonly logger = new Logger(MfaService.name);

    constructor(@Inject(MFA_PORT_TOKEN) private readonly mfa: MfaPort) {}

    /**
     * Generiert ein neues TOTP-Secret, persistiert es via `MfaPort.setSecret`
     * und liefert das Secret + die otpauth-URI für den QR-Code zurück.
     *
     * `issuer` und `label` formen die Anzeige im Authenticator (z. B.
     * "DemoApp:taci@example.com").
     */
    async setup(userId: string, label: string, issuer: string): Promise<TotpSetupResult> {
        const secret = generateSecret();
        const otpauthUri = generateURI({ issuer, label, secret });
        await this.mfa.setSecret(userId, secret);
        return { secret, otpauthUri };
    }

    /**
     * Prüft den eingegebenen Code gegen das gespeicherte Secret,
     * clock-drift-tolerant um ±1 Zeitschritt.
     */
    async verify(input: VerifyTotpInput): Promise<boolean> {
        const secret = await this.mfa.getSecret(input.userId);
        if (!secret) return false;
        try {
            const result = await verifyTotpCode({
                secret,
                token: input.code.trim(),
                epochTolerance: CLOCK_DRIFT_TOLERANCE_SECONDS,
            });
            return result.valid;
        } catch (error) {
            // otplib wirft bei formal ungültigen Tokens statt `valid: false`
            // zu liefern — für Aufrufer ist beides gleichbedeutend mit
            // "Code ungültig" (fail closed).
            if (isOtplibTokenError(error)) {
                return false;
            }
            // Unerwarteter Fehler (z. B. korruptes gespeichertes Secret):
            // ebenfalls fail closed, aber sichtbar machen — sonst sieht der
            // User nur endlos "Code ungültig" ohne diagnostizierbare Ursache.
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(
                `TOTP-Verify für User ${input.userId} unerwartet fehlgeschlagen: ${message}`,
            );
            return false;
        }
    }

    /**
     * Löscht das Secret eines Users — verwendet von `ahp admin mfa-reset`.
     */
    async disable(userId: string): Promise<void> {
        await this.mfa.setSecret(userId, null);
    }

    /** Delegate auf `MfaPort.isEnabled`. */
    async isEnabled(userId: string): Promise<boolean> {
        return this.mfa.isEnabled(userId);
    }
}
