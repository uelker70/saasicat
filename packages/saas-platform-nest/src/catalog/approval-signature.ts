// Approval signature (#20) — freezes the code-derived actual state of a
// feature/quota at approval time. The auto-sync compares the persisted
// signature against the current snapshot: on a discrepancy (new/removed/
// deprecated capabilities or changed quota facts) `approved` flips to
// `outdated` (drift).
//
// Pure functions, no NestJS DI — testable in isolation; the same
// computation is used by the review path (approval) and the sync (drift diff).

import type { DiscoveredQuota, DiscoverySnapshot } from '@saasicat/types';

/**
 * Signature of a feature's capability set: `capabilityKey@codeStatus`,
 * sorted and `|`-separated. `internal` capabilities do not count (they also
 * do not appear in the catalog).
 *
 * `requires`/`replaces` (#35/#39) are only included when they are set —
 * this keeps existing signatures without that metadata byte-identical;
 * otherwise the platform upgrade would flip every approved entry to
 * `outdated` even though nothing in the code changed.
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
 * Signature of the code-derived quota facts:
 * `unit|enforcementMode|usageProvider|featureKey`. `enforcementMode` is the
 * catalog view of the policy (`hardCap` → `hard`, otherwise `soft`) —
 * identical to the derivation in the sync. `replaces` (#39) is only appended
 * when set (same stability rationale as `featureApprovalSignature`).
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
