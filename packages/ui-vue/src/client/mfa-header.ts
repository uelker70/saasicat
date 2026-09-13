// The header a route that requires the second factor reads its code from.
//
// Every request that carries a code builds the header here, because the rule
// for an absent code is part of it: an empty string is not a code. The flows
// pass `''` when MFA is off, and an empty `X-Mfa-Code` made a backend that
// checks for the header's presence reject a request that was never guarded.

/** The one-time code of the second factor, as the backend's `MfaGuard` reads it. */
export const MFA_CODE_HEADER = 'X-Mfa-Code';

/** The second-factor header, or nothing. */
export function mfaHeader(mfaCode?: string): Record<string, string> | undefined {
    return mfaCode ? { [MFA_CODE_HEADER]: mfaCode } : undefined;
}
