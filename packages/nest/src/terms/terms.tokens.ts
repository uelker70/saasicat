// DI token of the archive of the operator's terms.
//
// `Symbol.for`, because the port is bound by a persistence bundle a consumer
// wires through `@saasicat/nest/platform` and read by modules bundled under
// other entries — a local `Symbol()` would be two tokens.

export const TERMS_ARCHIVE_TOKEN = Symbol.for('saasicat/nest/TermsArchivePort');
