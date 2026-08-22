// DI tokens for the first-run SetupModule. Own symbols (not shared with the
// CLI tokens) — each module `forRoot` binds its own port.

export const SETUP_PROVISIONING_PORT_TOKEN = Symbol.for('saas-platform/SetupProvisioningPort');
export const SETUP_CONFIG_TOKEN = Symbol.for('saas-platform/SetupConfig');

export interface SetupConfig {
    /** Env-var name of the setup token. Without the var set, setup is disabled. */
    setupTokenEnvVar: string;
    /** Authenticator issuer for the MFA enrollment in the wizard. */
    mfaIssuer: string;
}
