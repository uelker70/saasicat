// A stylesheet import carries no types. Vite, webpack and Rollup all resolve
// one; TypeScript only needs to be told the specifier is legal.
//
// This declaration ships with the source, because the source is what a consumer
// compiles. A Vite app already has it through `vite/client`; one that does not
// use Vite would otherwise see `import './ui/tenant-ui.css'` as a missing
// module in a file it never wrote.
declare module '*.css';
