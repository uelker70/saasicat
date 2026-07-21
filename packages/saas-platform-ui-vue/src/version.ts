// Single Source of Truth for the version shown in the SuperAdmin UI (drawer
// brand tag). Deliberately kept in `src/` so the DEV source overlay always
// serves it fresh (the `file:` copy in the node_modules volume would otherwise
// go stale).
//
// Version scheme <major>.<minor>.<patch>:
//   - patch  : bug fix
//   - minor  : single new feature
//   - major  : fundamental change
export const ADMIN_UI_VERSION = '1.2.0';
