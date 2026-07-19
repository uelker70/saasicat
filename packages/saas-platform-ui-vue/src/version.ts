// Single Source of Truth für die im SuperAdmin-UI angezeigte Version (Drawer-
// Brand-Tag). Liegt bewusst in `src/`, damit das DEV-Source-Overlay sie immer
// frisch serviert (die `file:`-Kopie im node_modules-Volume bliebe sonst stale).
//
// Versionsschema <major>.<minor>.<patch>:
//   - patch  : Fehlerfix
//   - minor  : einzelne neue Funktion
//   - major  : grundlegende Änderung
export const ADMIN_UI_VERSION = '1.2.0';
