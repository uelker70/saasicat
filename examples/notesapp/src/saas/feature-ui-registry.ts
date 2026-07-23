import type { FeatureUiRegistry } from '@saasicat/types';

/**
 * UI metadata (label/description/icon) for this app's discovered feature and
 * quota keys. The discovery auto-sync seeds EMPTY FeatureCatalogEntry fields
 * from it at boot, so the SuperAdmin discovery-review and catalog pages show
 * real names/icons instead of the raw keys (SPEC_V2 §6.3). It is not the
 * source of feature existence — Discovery decides that; this only decorates
 * the keys the scanner already found.
 */
export const NOTES_FEATURE_UI_REGISTRY: FeatureUiRegistry = {
    NOTES: {
        label: 'Notes',
        description: 'Create and manage notes.',
        icon: 'sticky_note_2',
    },
    NOTES_EXPORT: {
        label: 'Notes Export',
        description: 'Export notes to an external file.',
        icon: 'file_download',
    },
    notesMax: {
        label: 'Notes limit',
        description: 'Maximum number of notes per tenant.',
        icon: 'tag',
    },
};
