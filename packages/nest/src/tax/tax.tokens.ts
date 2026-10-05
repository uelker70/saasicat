/**
 * The installation's `TaxTreatments`: the one place that answers which rate a
 * charge takes — the tax adapter's decision where `config/saas.yaml` names one,
 * the file's `vatRate` otherwise.
 */
export const TAX_TREATMENTS_TOKEN = Symbol.for('saasicat/nest/TaxTreatments');
