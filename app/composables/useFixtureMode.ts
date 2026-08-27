export type FixtureMode = 'off' | 'data' | 'empty'

/** Dev-only, so a `?fixture=` in a deployed URL cannot swap real data for props. */
export function useFixtureMode() {
  const route = useRoute()
  return computed<FixtureMode>(() => {
    if (!import.meta.dev || route.query.fixture === undefined) return 'off'
    return route.query.fixture === 'empty' ? 'empty' : 'data'
  })
}
