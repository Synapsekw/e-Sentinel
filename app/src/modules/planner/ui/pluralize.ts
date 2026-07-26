// Import-message pluralisation, split out of Planner.tsx rather than exported
// from it: eslint's react-refresh/only-export-components rule (error at
// --max-warnings 0) fires on a component module that also exports a plain
// function, because mixing the two breaks Fast Refresh. suggestOutcome.ts and
// aoiGeometry.ts are the existing precedent for a pure helper module beside
// the components in this directory.

// Found in browser verification, not by any test: Planner.tsx handled the
// singular only on its no-skips branch, so an import that skipped anything
// always read plural. The repo's own simple.kml fixture is exactly the case
// that exposes it -- one area, one skipped feature -- which rendered as
// "1 AREAS IMPORTED · 1 FEATURES SKIPPED". The two counts vary independently,
// so each needs its own plural rather than one shared branch.
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 'S'}`
}
