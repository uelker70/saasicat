// The field paths a version diff reports, and how to read one back.
//
// `classifyPlanDiff` and `classifyBundleVersionDiff` name a quota change
// `quotas.<key>`, where the key is the installation's own — it comes from an
// `@DefinesQuota` declaration in the app, not from anything the platform
// knows. So no shipped catalog can carry a label for it, and every screen that
// renders a change has to fall back to the key itself. This is where that
// convention lives, rather than in each of them.

const QUOTA_FIELD_PREFIX = 'quotas.';

/** The quota key a field path names, or `null` when it names something else. */
export function quotaKeyOfField(field: string): string | null {
    if (!field.startsWith(QUOTA_FIELD_PREFIX)) return null;
    const key = field.slice(QUOTA_FIELD_PREFIX.length);
    return key.length > 0 ? key : null;
}
