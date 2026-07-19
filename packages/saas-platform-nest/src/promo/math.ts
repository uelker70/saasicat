// Pure-Math-Helper für Brutto/Netto-Berechnung. Müssen Bit-identisch zu den
// Konsumenten-Implementierungen sein, damit Backend, Tenant-Frontend und
// Admin-UI konsistente Ergebnisse liefern.

export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Brutto = Netto * (1 + vatRate/100). */
export function grossFromNet(net: number, vatRate: number): number {
    return round2(net * (1 + vatRate / 100));
}

/** Im Brutto enthaltene USt: gross * (vatRate / (100 + vatRate)). */
export function computeIncludedVat(grossAmount: number, vatRate: number): number {
    return round2((grossAmount * vatRate) / (100 + vatRate));
}
