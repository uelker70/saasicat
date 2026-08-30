// What `saasicat init` says about the settings it just wrote.
//
// The settings in `config/saas.yaml` are required and have no defaults, so the
// first thing a new integrator has to learn is that the file is where they
// live. Discovering it later — when a cancellation lands a period late, or a
// plan a customer should never have reached is suddenly reachable — is the
// expensive way to find out.
//
// Read off the rendered document rather than listed here. A list beside the
// template is the same defect one level up: the day the template gains a
// setting, the list is silently short.

import { loadPlanCatalogFromString } from '@saasicat/nest/billing';

export interface WrittenSetting {
    /** Dotted path as it reads in the file, e.g. `tenantBilling.cancellationNoticeDays.monthly`. */
    key: string;
    /** The value as JSON — `0`, `[]`, `"EUR"` — so an empty list is visible as one. */
    value: string;
}

function flatten(prefix: string, value: unknown, into: WrittenSetting[]): void {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value)) {
            flatten(`${prefix}.${key}`, child, into);
        }
        return;
    }
    into.push({ key: prefix, value: JSON.stringify(value) });
}

/**
 * The settings a generated `config/saas.yaml` carries.
 *
 * Loaded with the platform's own loader, not a YAML parse: a document `init`
 * writes that the platform would refuse is a bug worth failing the generation
 * for, rather than one the first boot reports after every file exists.
 */
export function settingsWrittenTo(
    catalogYaml: string,
    source = 'config/saas.yaml',
): WrittenSetting[] {
    const catalog = loadPlanCatalogFromString(catalogYaml, { source });
    const settings: WrittenSetting[] = [];
    flatten('tenantBilling', catalog.tenantBilling, settings);
    return settings;
}
