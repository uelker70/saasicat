// MFA helpers — TOTP setup + verify based on `otplib`.
//
// The `MfaService` is a thin wrapper that combines the `MfaPort` (consumer
// persistence) with the TOTP verification. The consumer implements
// only `MfaPort.{getSecret,setSecret,isEnabled}`; the platform service layer
// takes care of secret generation, otpauth URI and code verification.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { generateSecret, generateURI, verify as verifyTotpCode } from 'otplib';
import type { MfaPort } from '@saasicat/types';
import { MFA_PORT_TOKEN } from './tokens.js';

/**
 * Allows a 30-second tolerance before and after the current time window
 * (= ±1 TOTP time step) — robust against clock drift, without a security
 * risk (token stays valid for 90s instead of 30s).
 */
const CLOCK_DRIFT_TOLERANCE_SECONDS = 30;

/**
 * Error classes that otplib throws for formally invalid tokens (wrong
 * length, non-digits). Matched via `error.name`, because the classes live
 * in the transitive `@otplib/core` and are not directly importable here.
 */
const OTPLIB_TOKEN_ERROR_NAMES = new Set(['TokenError', 'TokenFormatError', 'TokenLengthError']);

function isOtplibTokenError(error: unknown): boolean {
    return error instanceof Error && OTPLIB_TOKEN_ERROR_NAMES.has(error.name);
}

export interface TotpSetupResult {
    /** Base32-encoded TOTP secret (persisted in the MfaPort). */
    secret: string;
    /** otpauth:// URI for the QR code generator (authenticator app). */
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
     * Generates a new TOTP secret, persists it via `MfaPort.setSecret`
     * and returns the secret + the otpauth URI for the QR code.
     *
     * `issuer` and `label` shape the display in the authenticator (e.g.
     * "DemoApp:taci@example.com").
     */
    async setup(userId: string, label: string, issuer: string): Promise<TotpSetupResult> {
        const secret = generateSecret();
        const otpauthUri = generateURI({ issuer, label, secret });
        await this.mfa.setSecret(userId, secret);
        return { secret, otpauthUri };
    }

    /**
     * Verifies the entered code against the stored secret,
     * clock-drift-tolerant by ±1 time step.
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
            // otplib throws for formally invalid tokens instead of returning
            // `valid: false` — for callers both are equivalent to
            // "code invalid" (fail closed).
            if (isOtplibTokenError(error)) {
                return false;
            }
            // Unexpected error (e.g. corrupt stored secret):
            // also fail closed, but make it visible — otherwise the
            // user only sees endless "code invalid" without a diagnosable cause.
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(
                `TOTP-Verify für User ${input.userId} unerwartet fehlgeschlagen: ${message}`,
            );
            return false;
        }
    }

    /**
     * Deletes a user's secret — used by `ahp admin mfa-reset`.
     */
    async disable(userId: string): Promise<void> {
        await this.mfa.setSecret(userId, null);
    }

    /** Delegates to `MfaPort.isEnabled`. */
    async isEnabled(userId: string): Promise<boolean> {
        return this.mfa.isEnabled(userId);
    }
}
