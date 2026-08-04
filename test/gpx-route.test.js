const assert = require('node:assert/strict')
const test = require('node:test')

const { selectGpxPointNodes } = require('../public/gpx-route.js')

test('OpenCPN waypoint catalogues are not appended to an ordered GPX route', () => {
  const waypoints = ['W1', 'W2', 'W3']
  const route = ['R1', 'R2', 'R3']
  assert.deepEqual(selectGpxPointNodes({ routeGroups: [route], waypoints }), route)
})

test('GPX point selection falls back from routes to tracks and then waypoints', () => {
  const track = ['T1', 'T2']
  const waypoints = ['W1', 'W2']
  assert.deepEqual(selectGpxPointNodes({ routeGroups: [[]], trackGroups: [track], waypoints }), track)
  assert.deepEqual(selectGpxPointNodes({ routeGroups: [], trackGroups: [[]], waypoints }), waypoints)
})

test('only the first non-empty ordered route is selected from a multi-route GPX file', () => {
  assert.deepEqual(
    selectGpxPointNodes({ routeGroups: [[], ['R1', 'R2'], ['OTHER1', 'OTHER2']] }),
    ['R1', 'R2']
  )
})
