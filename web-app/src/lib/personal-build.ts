/** Personal builds may check official releases, but must never install them over fork changes. */
export function isPersonalBuild(): boolean {
  return import.meta.env.VITE_PERSONAL_BUILD === 'true'
}
