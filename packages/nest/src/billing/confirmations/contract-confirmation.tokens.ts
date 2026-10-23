/** Adapter token: what renders a contract into its confirmation (`chargeJournal.invoices.confirmations.renderer`). */
export const CONTRACT_CONFIRMATION_RENDERER_TOKEN = Symbol.for(
    'saasicat/nest/ContractConfirmationRenderer',
);

/** Adapter token: where each contract's confirmation stands (`chargeJournal.invoices.confirmations.repository`). */
export const CONTRACT_CONFIRMATION_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/ContractConfirmationRepository',
);

/** Adapter token: where the confirmations are kept (`chargeJournal.invoices.confirmations.archive`). */
export const CONTRACT_CONFIRMATION_ARCHIVE_TOKEN = Symbol.for(
    'saasicat/nest/ContractConfirmationArchivePort',
);
