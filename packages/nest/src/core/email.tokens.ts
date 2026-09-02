// The DI token of the operator mail port.
//
// `Symbol.for`, like every token a consumer binds an adapter to: the binding
// happens through `SaaSiCatModule.forRoot({ adapters: { email } })` in one entry
// and is read by a module bundled under another.

export const EMAIL_PORT_TOKEN = Symbol.for('saasicat/nest/EmailPort');
