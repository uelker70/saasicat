// PlanCatalogImporterService — One-Shot-Import `saas.yaml → DB`
// (SPEC_V2 §11.1 M6 Pack 2c).
//
// Liest eine `saas.yaml` (als String oder via Loader-File), validiert sie
// gegen das Plattform-Schema und ruft den App-spezifischen
// `PlanCatalogImportSink` für jeden Eintrag auf. Idempotent: bei
// existierenden Rows zählt der Sink "skipped", der Service einfach durch.
//
// Mapping YAML → DB:
//  - `plans[]`    → `Plan` (Stamm) + `PlanVersion` v1 (published)
//  - `features[]` → `FeatureCatalogEntry`
//
// App-globale Settings (`projectKey`, `currency`, `vatRate`, `quotaKeys`)
// werden NICHT importiert — die bleiben als statische `forRoot()`-Optionen
// im AppModule (Build-Time-Identity, gehört nicht ins runtime-DB).

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
     * Import direkt aus YAML-String. Apps reichen den Inhalt der
     * `saas.yaml` per HTTP-Body durch; CLI-Tools können den File-Inhalt
     * vorher selber lesen.
     *
     * @throws beim Schema-Failure des YAML (vorher Validate-Aufruf via Loader).
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

        // ─── Plans + erste PlanVersion v1 ───
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
