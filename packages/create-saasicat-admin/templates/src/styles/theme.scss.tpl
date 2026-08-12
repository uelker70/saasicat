// Quasar theme variables — override your branding here.
//
// `$primary` is the ONE place your admin's brand colour is decided. SaaSiCat has
// no palette of its own for it: `--sa-color-accent` reads Quasar's `--q-primary`,
// which Quasar publishes from this variable. Change it and the hero, the buttons,
// the focus ring, the tinted surfaces, Quasar's own components and the
// tenant-facing pages all follow — there is no second switch.
//
// The four status colours are NOT read from here, and that is deliberate: each
// SaaSiCat status tone is a family of six contrast-tuned values (solid, strong,
// text, two tints, border), and a single Quasar variable cannot say which rung it
// is — `$warning` is a bright graphic amber, while warning TEXT has to be dark
// enough to read on it. They are set below to the values the platform's own roles
// use, so Quasar's components and the admin pages agree out of the box. To change
// them, override the `--sa-color-<tone>*` roles as a set.
//
// The defaults are SaaSiCat's own, so a freshly scaffolded admin looks like the
// documentation until you decide otherwise.
$primary: #3f6bff;
$secondary: #475569;
$accent: #0ea5e9;

$positive: #047857;
$negative: #dc2626;
$warning: #f59e0b;
$info: #2563eb;
