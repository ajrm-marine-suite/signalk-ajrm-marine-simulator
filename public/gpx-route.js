/**
 * Defines API routes and access helpers for GPX in the AJRM Marine Simulator browser application.
 */

(function initialiseGpxRouteHelpers(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.AjrmSimulatorGpx = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function createGpxRouteHelpers() {
  function selectGpxPointNodes({ routeGroups = [], trackGroups = [], waypoints = [] } = {}) {
    const route = firstNonEmptyGroup(routeGroups)
    if (route) return route
    const track = firstNonEmptyGroup(trackGroups)
    if (track) return track
    return Array.from(waypoints || [])
  }

  function firstNonEmptyGroup(groups) {
    for (const group of groups || []) {
      const points = Array.from(group || [])
      if (points.length > 0) return points
    }
    return null
  }

  return { selectGpxPointNodes }
})
