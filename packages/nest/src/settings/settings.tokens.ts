// DI tokens of the settings record.
//
// `Symbol.for`, because the port is bound by a persistence bundle a consumer
// wires through `@saasicat/nest/platform` and read by a module bundled into the
// same CJS file under another entry — a local `Symbol()` would be two tokens.

export const APPLIED_SETTINGS_PORT_TOKEN = Symbol.for('saasicat/nest/AppliedSettingsPort');

/**
 * Where the running settings came from, as a sentence for the record: the
 * absolute path of the file, or the phrase saying they were handed in as code.
 */
export const SETTINGS_SOURCE_TOKEN = Symbol.for('saasicat/nest/SettingsSource');
