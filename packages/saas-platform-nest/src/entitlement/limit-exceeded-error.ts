// LimitExceededError — wird vom EntitlementService (Slice B, Service-Layer)
// und von Konsumenten-Limit-Guards geworfen, wenn ein Anlage-Versuch das
// effektive Quota überschreiten würde.
//
// `dimension` ist der `quotaKey` aus dem PlanCatalog (z. B. "users",
// "vehicles", "storageGb"). Konsumenten können den Wert direkt in HTTP-402-
// Antworten und User-Messages einbetten.

export class LimitExceededError extends Error {
    constructor(
        public readonly dimension: string,
        public readonly max: number,
        public readonly used: number,
    ) {
        super(`Limit für ${dimension} erreicht: ${used}/${max}.`);
        this.name = 'LimitExceededError';
    }
}
