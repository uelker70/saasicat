// Single source of truth for the notesapp feature/quota keys and their English
// labels — shared by the notes page (gating + usage) and the plan page
// (TenantPlanSection label hooks).

export const FEATURE_NOTES = 'NOTES';
export const FEATURE_NOTES_EXPORT = 'NOTES_EXPORT';
export const QUOTA_NOTES_MAX = 'notesMax';

const FEATURE_LABELS: Record<string, string> = {
    [FEATURE_NOTES]: 'Notes',
    [FEATURE_NOTES_EXPORT]: 'Notes export',
};

const QUOTA_LABELS: Record<string, string> = {
    [QUOTA_NOTES_MAX]: 'Notes',
};

export function featureLabel(key: string): string {
    return FEATURE_LABELS[key] ?? key;
}

export function quotaLabel(key: string): string {
    return QUOTA_LABELS[key] ?? key;
}
