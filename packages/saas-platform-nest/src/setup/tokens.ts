// DI-Tokens für das First-Run-SetupModule. Eigene Symbole (nicht mit den
// CLI-Tokens geteilt) — jeder Modul-`forRoot` bindet seinen Port selbst.

export const SETUP_PROVISIONING_PORT_TOKEN = Symbol.for('saas-platform/SetupProvisioningPort');
export const SETUP_CONFIG_TOKEN = Symbol.for('saas-platform/SetupConfig');

export interface SetupConfig {
    /** Env-Var-Name des Setup-Tokens. Ohne gesetzte Var ist Setup deaktiviert. */
    setupTokenEnvVar: string;
    /** Authenticator-Issuer für das MFA-Enrollment im Wizard. */
    mfaIssuer: string;
}
