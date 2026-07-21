// PlanCatalogImporterService — one-shot import `saas.yaml → DB`
// (SPEC_V2 §11.1 M6 Pack 2c).
//
// Reads a `saas.yaml` (as a string or via a loader file), validates it
// against the platform schema and calls the app-specific
// `PlanCatalogImportSink` for each entry. Idempotent: for existing rows
// the sink counts "skipped" and the service simply moves on.
//
// Mapping YAML → DB:
//  - `plans[]`    → `Plan` (master) + `PlanVersion` v1 (published)
//  - `features[]` → `FeatureCatalogEntry`
//
// App-global settings (`projectKey`, `currency`, `vatRate`)
// are NOT imported — they stay as static `forRoot()` options
// in the AppModule (build-time identity, does not belong in the runtime DB).

import { Inject, Injectable } from '@nestjs/common';
import type {
    PlanCatalog,
    PlanCatalogImportReport,
    PlanCatalogImportSink,
} from '@saasicat/types';

import { loadPlanCatalogFromString } from './plan-catalog-loader.js';

export const PLAN_CATALOG_IMPORT_SINK_TOKEN = Symbol('PLAN_CATALOG_IMPORT_SINK');

const IMPORT_CHANGE_NOTE = 'Initial import from saas.yaml (SPEC_V2 §11.1 M6 Pack 2c)';

@Injectable()
export class PlanCatalogImporterService {
    constructor(
        @Inject(PLAN_CATALOG_IMPORT_SINK_TOKEN)
        private readonly sink: PlanCatalogImportSink,
    ) {}

    /**
     * Import directly from a YAML string. Apps pass the contents of the
     * `saas.yaml` through via the HTTP body; CLI tools can read the file
     * contents themselves beforehand.
     *
     * @throws on a schema failure of the YAML (validated first via the loader).
     */
    async importFromYaml(
        yamlContent: string,
        opts: { crossFieldChecks?: boolean; source?: string } = {},
    ): Promise<PlanCatalogImportReport> {
        const catalog = loadPlanCatalogFromString(yamlContent, {
            source: opts.source ?? 'http-import',
            crossFieldChecks: opts.crossFieldChecks ?? true,
        });
        return this.importCatalog(catalog);
    }

    async importCatalog(catalog: PlanCatalog): Promise<PlanCatalogImportReport> {
        const report: PlanCatalogImportReport = {
            plansCreated: 0,
            plansSkipped: 0,
            planVersionsCreated: 0,
            planVersionsSkipped: 0,
            featureEntriesCreated: 0,
            featureEntriesSkipped: 0,
            warnings: [],
        };

        // ─── Features ───
        for (const feature of catalog.features ?? []) {
            const result = await this.sink.upsertFeatureCatalogEntry({
                projectKey: catalog.projectKey,
                featureKey: feature.key,
                label: feature.label,
                icon: feature.icon,
                tier: feature.tier,
                plannedOnly: feature.plannedOnly,
            });
            if (result.created) report.featureEntriesCreated++;
            else report.featureEntriesSkipped++;
        }

        // ─── Plans + first PlanVersion v1 ───
        for (const plan of catalog.plans ?? []) {
            const planResult = await this.sink.upsertPlan({
                projectKey: catalog.projectKey,
                planKey: plan.id,
                label: plan.name ?? plan.id,
                description: plan.tagline ?? null,
            });
            if (planResult.created) report.plansCreated++;
            else report.plansSkipped++;

            if (plan.monthlyNet === null || plan.monthlyNet === undefined) {
                report.warnings.push(
                    `Plan '${plan.id}' hat keinen monthlyNet — übersprungen (auf-Anfrage-Plans brauchen manuelle PlanVersion).`,
                );
                continue;
            }
            const versionResult = await this.sink.upsertPlanVersion({
                planKey: plan.id,
                version: 1,
                features: plan.features,
                quotas: plan.quotas,
                monthlyNet: plan.monthlyNet.toFixed(2),
                yearlyNet: (plan.yearlyNet ?? plan.monthlyNet * 10).toFixed(2),
                marketed: plan.marketed ?? true,
                publish: true,
                changeNote: IMPORT_CHANGE_NOTE,
            });
            if (versionResult.created) report.planVersionsCreated++;
            else report.planVersionsSkipped++;
        }

        return report;
    }
}
