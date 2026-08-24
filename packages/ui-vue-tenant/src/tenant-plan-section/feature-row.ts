/**
 * One row of the feature matrix, as the `feature-icon` slot receives it.
 *
 * A named module rather than a type inside the SFC: the slot payload is part of
 * the component's public surface now, and a type declared in `<script setup>`
 * cannot be named from outside — `TenantPlanSection` forwarding the slot is
 * exactly the case that fails.
 */
export interface FeatureRow {
    key: string;
    active: boolean;
    label: string;
    description: string | null;
    /**
     * The icon name the platform's feature registry carries. This package does
     * not render it — it is a Quasar icon name, so drawing it would need the
     * host's icon font. It is handed to the slot so the host can draw its own.
     */
    icon: string | null;
}
