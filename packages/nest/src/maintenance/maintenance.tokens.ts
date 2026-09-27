// DI tokens of maintenance windows.
//
// `Symbol.for`, because both ports are bound by a persistence bundle or by the
// application through `SaaSiCatModule.forRoot` in one entry, and read by a
// module bundled into the same CJS file under another — a local `Symbol()`
// would be two tokens.

export const MAINTENANCE_WINDOW_PORT_TOKEN = Symbol.for('saasicat/nest/MaintenanceWindowPort');

export const MAINTENANCE_NOTIFICATION_PORT_TOKEN = Symbol.for(
    'saasicat/nest/MaintenanceNotificationPort',
);
