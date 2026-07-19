// Approval-Signatur (#20) — friert den code-abgeleiteten Ist-Zustand eines
// Features/einer Quota zum Freigabe-Zeitpunkt ein. Der Auto-Sync vergleicht
// die persistierte Signatur gegen den aktuellen Snapshot: bei Abweichung
// (neue/entfernte/deprecated Capabilities bzw. geänderte Quota-Fakten)
// kippt `approved` → `outdated` (Drift).
//
// Pure Functions, keine NestJS-DI — testbar in Isolation; dieselbe
// Berechnung nutzt der Review-Pfad (Freigabe) und der Sync (Drift-Diff).

import type { DiscoveredQuota, DiscoverySnapshot } from '@saasicat/types';

/**
 * Signatur des Capability-Sets eines Features: `capabilityKey@codeStatus`,
 * sortiert und `|`-separiert. `internal`-Capabilities zählen nicht (sie
 * erscheinen auch nicht im Katalog).
 *
 * `requires`/`replaces` (#35/#39) gehen nur ein, wenn sie gesetzt sind —
 * Bestands-Signaturen ohne diese Metadaten bleiben dadurch byte-identisch,
 * sonst würde das Plattform-Upgrade alle approved-Einträge auf `outdated`
 * kippen, obwohl sich am Code nichts geändert hat.
 */
export function featureApprovalSignature(featureKey: string, snapshot: DiscoverySnapshot): string {
    return snapshot.capabilities
        .filter((c) => c.feature === featureKey && c.status !== 'internal')
        .map(
            (c) =>
                `${c.capabilityKey}@${c.status}` +
                keyListSegment('requires', c.requires) +
                keyListSegment('replaces', c.replaces),
        )
        .sort()
        .join('|');
}

/**
 * Signatur der code-abgeleiteten Quota-Fakten:
 * `unit|enforcementMode|usageProvider|featureKey`. `enforcementMode` ist die
 * Katalog-Sicht der Policy (`hardCap` → `hard`, sonst `soft`) — identisch
 * zur Ableitung im Sync. `replaces` (#39) hängt nur bei gesetztem Wert an
 * (gleiche Stabilitäts-Begründung wie bei `featureApprovalSignature`).
 */
export function quotaApprovalSignature(quota: DiscoveredQuota): string {
    return (
        [quota.unit, quota.policy === 'hardCap' ? 'hard' : 'soft', quota.declaredAt || '', quota.feature ?? ''].join(
            '|',
        ) + keyListSegment('replaces', quota.replaces)
    );
}

function keyListSegment(name: 'requires' | 'replaces', keys: string[] | null | undefined): string {
    if (!keys || keys.length === 0) return '';
    return `@${name}:${[...keys].sort().join(',')}`;
}
