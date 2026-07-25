// Vite's import.meta.env.BASE_URL always carries a trailing slash ('/' in dev,
// '/e-Sentinel/' in a Pages build). React Router's basename wants no trailing
// slash, and '' for the root. This bridges the two.
export function routerBasename(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '')
}
