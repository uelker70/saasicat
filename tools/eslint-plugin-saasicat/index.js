// The four rules that do not exist off the shelf.
//
// Each of them is the machine form of a decision this repository would
// otherwise repeat in review, and AP6 puts them here rather than in a test for
// one reason: ESLint sees a file and answers in the editor, while a repo-wide
// test sees the tree and answers in CI. Both are wanted; neither replaces the
// other, and each rule's header says which half it cannot see.
//
// The package is private. It is workspace tooling, not something the fixed
// group publishes.

import maxProps from './rules/max-props.js';
import noFunctionProps from './rules/no-function-props.js';
import noHandBuiltControls from './rules/no-hand-built-controls.js';
import noRawHttp from './rules/no-raw-http.js';
import noRestrictedComponents from './rules/no-restricted-components.js';

export const rules = {
    'max-props': maxProps,
    'no-function-props': noFunctionProps,
    'no-hand-built-controls': noHandBuiltControls,
    'no-raw-http': noRawHttp,
    'no-restricted-components': noRestrictedComponents,
};

export default { rules };
