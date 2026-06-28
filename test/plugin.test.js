const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const createPlugin = require('../plugin')
const {
  DEFAULT_BASE,
  GPS_FAULT_MODES,
  KNOTS_TO_MPS,
  gnssSatelliteState,
  groundMotionForHeading,
  movePoint,
  offsetMeters,
  trueWindFromApparent
} = createPlugin._test

const runtimeSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajrm-simulator-test-'))
const runtimeSettingsFile = path.join(runtimeSettingsDir, 'runtime.json')
process.env.AJRM_MARINE_SIMULATOR_SETTINGS_FILE = runtimeSettingsFile

test.afterEach(() => {
  fs.rmSync(runtimeSettingsFile, { force: true })
})

test.after(() => {
  fs.rmSync(runtimeSettingsDir, { recursive: true, force: true })
  delete process.env.AJRM_MARINE_SIMULATOR_SETTINGS_FILE
})

test('movement helpers use metre scale', () => {
  const moved = movePoint(DEFAULT_BASE.latitude, DEFAULT_BASE.longitude, 90, 100)
  assert.ok(moved.longitude > DEFAULT_BASE.longitude)
  assert.ok(Math.abs(moved.latitude - DEFAULT_BASE.latitude) < 0.0001)
  const offset = offsetMeters(DEFAULT_BASE.latitude, DEFAULT_BASE.longitude, 100, 0)
  assert.ok(offset.latitude > DEFAULT_BASE.latitude)
})

test('GNSS modes include unavailable modes for DR testing', () => {
  assert.ok(GPS_FAULT_MODES.includes('lost'))
  assert.ok(GPS_FAULT_MODES.includes('intermittent'))
  const normal = gnssSatelliteState('normal', 0)
  const degraded = gnssSatelliteState('degraded', 0)
  assert.ok(normal.used > degraded.used)
  assert.ok(normal.constellations.some((item) => item.id === 'glonass'))
})

test('true wind derives from apparent wind and own speed', () => {
  const wind = trueWindFromApparent({
    courseDeg: 0,
    speedKn: 10,
    apparentWindAngleDeg: 0,
    apparentWindSpeedKn: 30
  })
  assert.ok(Math.abs(wind.speedTrue / KNOTS_TO_MPS - 20) < 0.000001)
})

test('own boat COG and SOG drift away from heading and STW in cross tide', () => {
  const motion = groundMotionForHeading({
    headingDeg: 0,
    speedThroughWaterKn: 5,
    currentSetDeg: 90,
    currentDriftKn: 1
  })

  assert.equal(motion.headingDeg, 0)
  assert.ok(motion.courseDeg > 11)
  assert.ok(motion.courseDeg < 12)
  assert.ok(Math.abs(motion.speedOverGroundMps / KNOTS_TO_MPS - Math.sqrt(26)) < 0.001)
})

test('own boat drifts with tide when through-water speed is zero', () => {
  const motion = groundMotionForHeading({
    headingDeg: 245,
    speedThroughWaterKn: 0,
    currentSetDeg: 90,
    currentDriftKn: 1.2
  })

  assert.equal(motion.headingDeg, 245)
  assert.equal(motion.courseDeg, 90)
  assert.ok(Math.abs(motion.speedOverGroundMps / KNOTS_TO_MPS - 1.2) < 0.001)
})

test('plugin publishes nothing while master output is off, then publishes own and targets when enabled', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter({
    get(path, handler) {
      routes.set(`GET ${path}`, handler)
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler)
    }
  })
  plugin.start({ outputEnabled: false })
  assert.equal(messages.length, 0)

  const state = invoke(routes, 'POST', '/output', { enabled: true })
  assert.equal(state.outputEnabled, true)
  assert.ok(messages.some((message) => message.delta.context === 'vessels.self'))
  assert.ok(messages.some((message) => String(message.delta.context).includes('235900001')))
  plugin.stop()
})

test('turning master output off publishes a final quiet sample', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 90, initialSpeedKn: 8 },
      environment: { currentSetDeg: 45, currentDriftKn: 2, currentVarying: false },
      targets: [
        {
          id: 'test-target',
          mmsi: '235900999',
          name: 'TEST TARGET',
          startPosition: { latitude: 56.16, longitude: -5.55 },
          initialCourseDeg: 270,
          speedKn: 4
        }
      ],
      fixedStations: []
    })
    invoke(routes, 'POST', '/output', { enabled: true })
    invoke(routes, 'POST', '/output', { enabled: false })

    const ownValues = latestValuesByPath(messages, 'vessels.self')
    assert.equal(ownValues['navigation.speedOverGround'], 0)
    assert.equal(ownValues['navigation.speedThroughWater'], 0)
    assert.equal(ownValues['environment.current.drift'], 0)
    assert.equal(ownValues['environment.tide.drift'], 0)
    assert.equal(ownValues['navigation.state'], 'stopped')

    const targetValues = latestValuesByPath(messages, '235900999')
    assert.equal(targetValues['navigation.position'], null)
    assert.equal(targetValues['navigation.speedOverGround'], 0)
    assert.equal(targetValues['navigation.state'], 'stopped')
  } finally {
    plugin.stop()
  }
})

test('plugin schema exposes editable AIS target and fixed station fleets', () => {
  const plugin = createPlugin({ setPluginStatus() {}, handleMessage() {} })
  const targetDefaults = plugin.schema.properties.targets.default
  const stationDefaults = plugin.schema.properties.fixedStations.default

  assert.equal(plugin.schema.properties.targets.type, 'array')
  assert.equal(plugin.schema.properties.targets.items.properties.mmsi.title, 'MMSI')
  assert.equal(targetDefaults[0].name, 'NORTH CHANNEL')
  assert.equal(targetDefaults[0].startPosition.latitude, 56.1625)
  assert.equal(plugin.schema.properties.fixedStations.type, 'array')
  assert.equal(stationDefaults[0].name, 'Craobh AIS Base')
})

test('configured AIS target fleet is used at startup', () => {
  const messages = []
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const routes = new Map()
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      targets: [
        {
          id: 'custom-ship',
          enabled: true,
          autopilotEnabled: false,
          name: 'CUSTOM TRADER',
          mmsi: '235901234',
          callsign: 'CUS123',
          grossTonnage: 1500,
          aisShipType: 70,
          aisClass: 'A',
          length: 42,
          width: 9,
          aisFromBow: 30,
          aisFromCenter: -1,
          startPosition: { latitude: 56.25, longitude: -5.6 },
          initialCourseDeg: 123,
          speedKn: 6.5,
          legDuration: 99
        }
      ],
      fixedStations: [
        {
          id: 'custom-base',
          enabled: true,
          name: 'CUSTOM BASE',
          mmsi: '002351234',
          startPosition: { latitude: 56.3, longitude: -5.7 }
        }
      ]
    })
    invoke(routes, 'POST', '/output', { enabled: true })

    const targetValues = allValuesByPath(messages, '235901234')
    assert.deepEqual(targetValues[''], {
      name: 'CUSTOM TRADER',
      communication: { callsignVhf: 'CUS123' }
    })
    assert.deepEqual(targetValues['navigation.position'], { latitude: 56.25, longitude: -5.6 })
    assert.equal(targetValues['navigation.speedOverGround'], 6.5 * KNOTS_TO_MPS)
    assert.equal(targetValues['sensors.ais.fromBow'], 30)
    assert.equal(targetValues['sensors.ais.fromCenter'], -1)

    const stationValues = allValuesByPath(messages, '002351234')
    assert.deepEqual(stationValues[''], { name: 'CUSTOM BASE' })
    assert.deepEqual(stationValues['navigation.position'], { latitude: 56.3, longitude: -5.7 })
    assert.equal(stationValues['navigation.state'], 'baseStation')
  } finally {
    plugin.stop()
  }
})

test('target automatic turns can be toggled from the web route', () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({ targetAutopilotEnabled: true })
    let state = invoke(routes, 'GET', '/state')
    assert.equal(state.targetAutopilotEnabled, true)

    state = invoke(routes, 'POST', '/targets/autopilot', { enabled: false })
    assert.equal(state.targetAutopilotEnabled, false)

    state = invoke(routes, 'POST', '/targets/autopilot', { enabled: true })
    assert.equal(state.targetAutopilotEnabled, true)
  } finally {
    plugin.stop()
  }
})

test('saved enabled config still starts with simulator output off', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({ outputEnabled: true })
    const state = invoke(routes, 'GET', '/state')
    assert.equal(state.outputEnabled, false)
    assert.equal(messages.length, 0)
  } finally {
    plugin.stop()
  }
})

test('own boat stays at the default start while master output is off', async () => {
  const routes = new Map()
  const plugin = createPlugin({
    setPluginStatus() {},
    handleMessage() {}
  })
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      outputPeriod: 0.2,
      own: { initialHeadingDeg: 90, initialSpeedKn: 10 },
      environment: { currentSetDeg: 90, currentDriftKn: 2, currentVarying: false }
    })
    await delay(450)
    const state = invoke(routes, 'GET', '/state')
    assert.equal(state.outputEnabled, false)
    assert.equal(state.own.latitude, Number(DEFAULT_BASE.latitude.toFixed(6)))
    assert.equal(state.own.longitude, Number(DEFAULT_BASE.longitude.toFixed(6)))
  } finally {
    plugin.stop()
  }
})

test('configured own boat start position is used by default', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: {
        startPosition: { latitude: 56.308558, longitude: -5.638818 }
      }
    })
    let state = invoke(routes, 'GET', '/state')
    assert.equal(state.own.latitude, 56.308558)
    assert.equal(state.own.longitude, -5.638818)
    assert.deepEqual(state.own.startPosition, { latitude: 56.308558, longitude: -5.638818 })

    state = invoke(routes, 'POST', '/own/reset', {})
    assert.equal(state.own.latitude, 56.308558)
    assert.equal(state.own.longitude, -5.638818)
    assert.deepEqual(state.own.startPosition, { latitude: 56.308558, longitude: -5.638818 })
  } finally {
    plugin.stop()
  }
})

test('web start position control persists and keeps output off after restart', () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 90, initialSpeedKn: 0 }
    })
    let state = invoke(routes, 'POST', '/own/start-position', {
      latitude: 56.300123,
      longitude: -5.700456
    })
    assert.equal(state.outputEnabled, false)
    assert.equal(state.own.latitude, 56.300123)
    assert.equal(state.own.longitude, -5.700456)
    assert.deepEqual(state.own.startPosition, { latitude: 56.300123, longitude: -5.700456 })

    plugin.stop()
    plugin.start({
      own: { initialHeadingDeg: 90, initialSpeedKn: 0 }
    })
    state = invoke(routes, 'GET', '/state')
    assert.equal(state.outputEnabled, false)
    assert.equal(state.own.latitude, 56.300123)
    assert.equal(state.own.longitude, -5.700456)
    assert.deepEqual(state.own.startPosition, { latitude: 56.300123, longitude: -5.700456 })

    state = invoke(routes, 'POST', '/own/reset', {})
    assert.equal(state.outputEnabled, false)
    assert.equal(state.own.latitude, Number(DEFAULT_BASE.latitude.toFixed(6)))
    assert.equal(state.own.longitude, Number(DEFAULT_BASE.longitude.toFixed(6)))
  } finally {
    plugin.stop()
  }
})

test('loaded GPX route starts own boat at first point and steers toward next point', async () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      outputPeriod: 0.2,
      own: { initialHeadingDeg: 90, initialSpeedKn: 5 },
      environment: { currentDriftKn: 0, currentVarying: false }
    })
    let state = invoke(routes, 'POST', '/own/gpx-route', {
      name: 'Test route',
      points: [
        { latitude: 56.300000, longitude: -5.700000 },
        { latitude: 56.301000, longitude: -5.700000 }
      ]
    })
    assert.equal(state.outputEnabled, false)
    assert.equal(state.own.latitude, 56.3)
    assert.equal(state.own.longitude, -5.7)
    assert.equal(state.own.gpxRoute.enabled, false)
    assert.equal(state.own.gpxRoute.playState, 'stopped')
    assert.equal(state.own.gpxRoute.pointCount, 2)
    assert.equal(state.own.gpxRoute.index, 1)

    state = invoke(routes, 'POST', '/own/gpx-route/playback', { action: 'play' })
    assert.equal(state.own.gpxRoute.enabled, true)
    assert.equal(state.own.gpxRoute.playState, 'playing')

    invoke(routes, 'POST', '/output', { enabled: true })
    await delay(260)
    state = invoke(routes, 'GET', '/state')
    assert.ok(state.own.headingDeg < 5 || state.own.headingDeg > 355)

    state = invoke(routes, 'POST', '/own/gpx-route/clear', {})
    assert.equal(state.own.gpxRoute.pointCount, 0)
    assert.equal(state.own.gpxRoute.enabled, false)
  } finally {
    plugin.stop()
  }
})

test('GPX route following does not bounce around waypoints at high speed', async () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      outputPeriod: 0.2,
      own: { initialHeadingDeg: 180, initialSpeedKn: 999 },
      environment: { currentDriftKn: 0, currentVarying: false }
    })
    invoke(routes, 'POST', '/own/gpx-route', {
      name: 'High speed route',
      points: [
        { latitude: 56.300000, longitude: -5.700000 },
        { latitude: 56.301000, longitude: -5.700000 },
        { latitude: 56.302000, longitude: -5.700000 }
      ]
    })
    invoke(routes, 'POST', '/own/gpx-route/playback', { action: 'play' })

    invoke(routes, 'POST', '/output', { enabled: true })
    await delay(700)
    const state = invoke(routes, 'GET', '/state')
    assert.equal(state.own.gpxRoute.completed, true)
    assert.equal(state.own.gpxRoute.playState, 'stopped')
    assert.equal(state.own.gpxRoute.index, 2)
    assert.equal(state.own.speedKn, 0)
    assert.ok(Math.abs(state.own.latitude - 56.302) < 0.0002)
    assert.ok(Math.abs(state.own.longitude + 5.7) < 0.0002)
  } finally {
    plugin.stop()
  }
})

test('own boat speed controls allow high-speed testing up to 999 knots', () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 90, initialSpeedKn: 1200 }
    })
    let state = invoke(routes, 'GET', '/state')
    assert.equal(state.own.speedKn, 999)

    state = invoke(routes, 'POST', '/own/controls', { speedKn: 250 })
    assert.equal(state.own.speedKn, 250)

    state = invoke(routes, 'POST', '/own/controls', { speedKn: 1200 })
    assert.equal(state.own.speedKn, 999)
  } finally {
    plugin.stop()
  }
})

test('own boat speed buttons step by one knot and preserve GPX route mode', () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 90, initialSpeedKn: 4.2 }
    })
    let state = invoke(routes, 'POST', '/own/speed', { direction: 'up' })
    assert.equal(state.own.speedKn, 5.2)
    state = invoke(routes, 'POST', '/own/speed', { direction: 'down' })
    assert.equal(state.own.speedKn, 4.2)

    state = invoke(routes, 'POST', '/own/motion-mode', { mode: 'route' })
    assert.equal(state.own.motionMode, 'route')
    state = invoke(routes, 'POST', '/own/speed', { direction: 'up' })
    assert.equal(state.own.motionMode, 'route')
    assert.equal(state.own.speedKn, 5.2)
    state = invoke(routes, 'POST', '/own/controls', { speedKn: 3.7 })
    assert.equal(state.own.motionMode, 'route')
    assert.equal(state.own.speedKn, 3.7)
  } finally {
    plugin.stop()
  }
})

test('own vessel motion mode route switches stationary, self steering and GPX route following', () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 90, initialSpeedKn: 4 }
    })
    let state = invoke(routes, 'GET', '/state')
    assert.equal(state.own.motionMode, 'self')

    state = invoke(routes, 'POST', '/own/motion-mode', { mode: 'stationary' })
    assert.equal(state.own.motionMode, 'stationary')
    assert.equal(state.own.speedKn, 0)
    assert.equal(state.own.autopilotEnabled, false)

    state = invoke(routes, 'POST', '/own/controls', { speedKn: 5 })
    state = invoke(routes, 'POST', '/own/motion-mode', { mode: 'self' })
    assert.equal(state.own.motionMode, 'self')

    state = invoke(routes, 'POST', '/own/motion-mode', { mode: 'route' })
    assert.equal(state.own.motionMode, 'route')
    assert.equal(state.own.gpxRoute.pointCount, 0)
    assert.equal(state.own.gpxRoute.enabled, false)

    state = invoke(routes, 'POST', '/own/gpx-route', {
      name: 'Remembered route',
      points: [
        { latitude: 56.300000, longitude: -5.700000 },
        { latitude: 56.301000, longitude: -5.700000 }
      ]
    })
    assert.equal(state.own.gpxRoute.name, 'Remembered route')
    assert.equal(state.own.motionMode, 'route')
    assert.equal(state.own.gpxRoute.playState, 'stopped')

    state = invoke(routes, 'POST', '/own/motion-mode', { mode: 'self' })
    assert.equal(state.own.motionMode, 'self')
    assert.equal(state.own.gpxRoute.enabled, false)

    state = invoke(routes, 'POST', '/own/motion-mode', { mode: 'route' })
    assert.equal(state.own.motionMode, 'route')
    assert.equal(state.own.gpxRoute.enabled, false)
    assert.equal(state.own.gpxRoute.playState, 'stopped')

    state = invoke(routes, 'POST', '/own/gpx-route/playback', { action: 'play' })
    assert.equal(state.own.motionMode, 'route')
    assert.equal(state.own.gpxRoute.enabled, true)
    assert.equal(state.own.gpxRoute.playState, 'playing')

    state = invoke(routes, 'POST', '/own/gpx-route/playback', { action: 'pause' })
    assert.equal(state.own.motionMode, 'route')
    assert.equal(state.own.gpxRoute.enabled, false)
    assert.equal(state.own.gpxRoute.playState, 'paused')

    state = invoke(routes, 'POST', '/own/gpx-route/playback', { action: 'stop' })
    assert.equal(state.own.motionMode, 'route')
    assert.equal(state.own.gpxRoute.enabled, false)
    assert.equal(state.own.gpxRoute.playState, 'stopped')
    assert.equal(state.own.gpxRoute.index, 1)

    state = invoke(routes, 'POST', '/own/gpx-route/playback', { action: 'restart' })
    assert.equal(state.own.motionMode, 'route')
    assert.equal(state.own.gpxRoute.enabled, true)
    assert.equal(state.own.gpxRoute.playState, 'playing')
    assert.equal(state.own.gpxRoute.index, 1)
    assert.equal(state.own.latitude, 56.3)
    assert.equal(state.own.longitude, -5.7)
  } finally {
    plugin.stop()
  }
})

test('own reset works from every own vessel motion mode', () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 123, initialSpeedKn: 3.5 }
    })
    invoke(routes, 'POST', '/own/gpx-route', {
      name: 'Reset route',
      points: [
        { latitude: 56.300000, longitude: -5.700000 },
        { latitude: 56.301000, longitude: -5.700000 }
      ]
    })

    for (const mode of ['stationary', 'self', 'route']) {
      invoke(routes, 'POST', '/own/motion-mode', { mode })
      invoke(routes, 'POST', '/own/controls', { headingDeg: 270, speedKn: 9, gpsFaultMode: 'lost' })
      const state = invoke(routes, 'POST', '/own/reset', {})
      assert.equal(state.own.headingDeg, 123)
      assert.equal(state.own.speedKn, 3.5)
      assert.equal(state.own.gpsFaultMode, 'normal')
      assert.equal(state.own.motionMode, 'self')
    }
  } finally {
    plugin.stop()
  }
})

test('web control settings survive plugin restart while simulator output stays off', () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 90, initialSpeedKn: 0 },
      environment: { currentDriftKn: 1, currentSetDeg: 270, currentVarying: false }
    })
    invoke(routes, 'POST', '/output', { enabled: true })
    invoke(routes, 'POST', '/own/controls', {
      headingDeg: 245,
      speedKn: 6.5,
      headingEnabled: false,
      gpsFaultMode: 'intermittent',
      legDuration: 600
    })
    invoke(routes, 'POST', '/own/start-position', {
      latitude: 56.222222,
      longitude: -5.555555
    })
    invoke(routes, 'POST', '/own/autopilot', { enabled: true })
    invoke(routes, 'POST', '/environment', {
      currentDriftKn: 2.4,
      currentSetDeg: 112,
      windVarying: false
    })
    invoke(routes, 'POST', '/targets/:id/control', {
      enabled: false,
      autopilotEnabled: false,
      speedDirection: 'up',
      rudderDirection: 'right',
      gpsFaultMode: 'degraded'
    }, { id: 'sim-1' })

    plugin.stop()
    plugin.start({
      own: { initialHeadingDeg: 90, initialSpeedKn: 0 },
      environment: { currentDriftKn: 1, currentSetDeg: 270, currentVarying: false }
    })

    const state = invoke(routes, 'GET', '/state')
    const target = state.targets.find((item) => item.id === 'sim-1')
    assert.equal(state.outputEnabled, false)
    assert.equal(state.own.headingDeg, 245)
    assert.equal(state.own.speedKn, 6.5)
    assert.equal(state.own.headingEnabled, false)
    assert.equal(state.own.gpsFaultMode, 'intermittent')
    assert.equal(state.own.autopilotEnabled, true)
    assert.equal(state.own.legDuration, 600)
    assert.deepEqual(state.own.startPosition, { latitude: 56.222222, longitude: -5.555555 })
    assert.equal(state.environment.currentDriftKn, 2.4)
    assert.equal(state.environment.currentSetDeg, 112)
    assert.equal(state.environment.windVarying, false)
    assert.equal(target.enabled, false)
    assert.equal(target.autopilotEnabled, false)
    assert.equal(target.speedKn, 6.4)
    assert.equal(target.courseDeg, 355)
    assert.equal(target.gpsFaultMode, 'degraded')
  } finally {
    plugin.stop()
  }
})

test('reset clears saved simulator settings and restores configured defaults', () => {
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  const props = {
    own: { initialHeadingDeg: 123, initialSpeedKn: 3.5, gpsFaultMode: 'normal' },
    environment: { currentDriftKn: 0.4, currentSetDeg: 45, currentVarying: false },
    targets: [
      {
        id: 'custom-ship',
        enabled: true,
        autopilotEnabled: true,
        name: 'CUSTOM SHIP',
        mmsi: '235900888',
        startPosition: { latitude: 56.2, longitude: -5.6 },
        initialCourseDeg: 80,
        speedKn: 5,
        legDuration: 300,
        gpsFaultMode: 'normal'
      }
    ]
  }
  try {
    plugin.start(props)
    invoke(routes, 'POST', '/own/controls', { headingDeg: 270, speedKn: 9, gpsFaultMode: 'lost' })
    invoke(routes, 'POST', '/environment', { currentDriftKn: 3.1, currentSetDeg: 180 })
    invoke(routes, 'POST', '/targets/:id/control', {
      enabled: false,
      speedDirection: 'up',
      rudderDirection: 'left',
      gpsFaultMode: 'spoof'
    }, { id: 'custom-ship' })
    assert.equal(fs.existsSync(runtimeSettingsFile), true)

    const reset = invoke(routes, 'POST', '/own/reset', {})
    const target = reset.targets.find((item) => item.id === 'custom-ship')
    assert.equal(reset.own.headingDeg, 123)
    assert.equal(reset.own.speedKn, 3.5)
    assert.equal(reset.own.gpsFaultMode, 'normal')
    assert.equal(reset.environment.currentDriftKn, 0.4)
    assert.equal(reset.environment.currentSetDeg, 45)
    assert.equal(target.enabled, true)
    assert.equal(target.speedKn, 5)
    assert.equal(target.courseDeg, 80)
    assert.equal(target.gpsFaultMode, 'normal')
    assert.equal(fs.existsSync(runtimeSettingsFile), false)

    plugin.stop()
    plugin.start(props)
    const restarted = invoke(routes, 'GET', '/state')
    assert.equal(restarted.own.headingDeg, 123)
    assert.equal(restarted.environment.currentDriftKn, 0.4)
  } finally {
    plugin.stop()
  }
})

test('own GPS lost publishes null position', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter({
    get(path, handler) {
      routes.set(`GET ${path}`, handler)
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler)
    }
  })
  plugin.start()
  invoke(routes, 'POST', '/output', { enabled: true })
  invoke(routes, 'POST', '/own/controls', { gpsFaultMode: 'lost' })
  const self = messages.filter((message) => message.delta.context === 'vessels.self').at(-1)
  const byPath = Object.fromEntries(self.delta.updates[0].values.map((item) => [item.path, item.value]))
  assert.equal(byPath['navigation.position'], null)
  assert.equal(byPath['navigation.speedOverGround'], null)
  assert.equal(byPath['navigation.courseOverGroundTrue'], null)
  assert.ok(byPath['navigation.speedThroughWater'] >= 0)
  assert.equal(Object.prototype.hasOwnProperty.call(byPath, 'environment.current.drift'), true)
  plugin.stop()
})

test('rapid own controls do not publish extra position samples', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start()
    invoke(routes, 'POST', '/output', { enabled: true })
    messages.length = 0

    invoke(routes, 'POST', '/own/speed', { direction: 'up' })
    const self = messages.filter((message) => message.delta.context === 'vessels.self').at(-1)
    const byPath = Object.fromEntries(self.delta.updates[0].values.map((item) => [item.path, item.value]))
    assert.ok(byPath['navigation.speedThroughWater'] > 0)
    assert.equal(Object.prototype.hasOwnProperty.call(byPath, 'navigation.position'), false)
  } finally {
    plugin.stop()
  }
})

test('own output publishes crabbing heading separately from COG', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 0, initialSpeedKn: 5 },
      environment: { currentSetDeg: 90, currentDriftKn: 1, currentVarying: false }
    })
    invoke(routes, 'POST', '/output', { enabled: true })
    const self = messages.filter((message) => message.delta.context === 'vessels.self').at(-1)
    const byPath = Object.fromEntries(self.delta.updates[0].values.map((item) => [item.path, item.value]))
    assert.equal(byPath['navigation.headingTrue'], 0)
    assert.ok(byPath['navigation.courseOverGroundTrue'] > 0.19)
    assert.ok(byPath['navigation.courseOverGroundTrue'] < 0.21)
    assert.ok(byPath['navigation.speedOverGround'] > byPath['navigation.speedThroughWater'])
  } finally {
    plugin.stop()
  }
})

test('disabled environment clears simulated environment values and removes current from own motion', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 0, initialSpeedKn: 5 },
      environment: { currentSetDeg: 90, currentDriftKn: 1, currentVarying: false }
    })
    invoke(routes, 'POST', '/environment', { enabled: false })
    invoke(routes, 'POST', '/output', { enabled: true })
    const self = messages.filter((message) => message.delta.context === 'vessels.self').at(-1)
    const byPath = Object.fromEntries(self.delta.updates[0].values.map((item) => [item.path, item.value]))
    assert.equal(byPath['environment.depth.belowTransducer'], null)
    assert.equal(byPath['environment.wind.speedApparent'], null)
    assert.equal(byPath['environment.current.drift'], null)
    assert.equal(byPath['navigation.headingTrue'], 0)
    assert.equal(byPath['navigation.courseOverGroundTrue'], 0)
    assert.equal(byPath['navigation.speedOverGround'], byPath['navigation.speedThroughWater'])
    assert.equal(invoke(routes, 'GET', '/state').environment.enabled, false)
  } finally {
    plugin.stop()
  }
})

test('own heading output can be disabled while COG remains available', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  try {
    plugin.start({
      own: { initialHeadingDeg: 0, initialSpeedKn: 5 },
      environment: { currentSetDeg: 90, currentDriftKn: 1, currentVarying: false }
    })
    invoke(routes, 'POST', '/output', { enabled: true })
    invoke(routes, 'POST', '/own/controls', { headingEnabled: false })
    const self = messages.filter((message) => message.delta.context === 'vessels.self').at(-1)
    const byPath = Object.fromEntries(self.delta.updates[0].values.map((item) => [item.path, item.value]))
    assert.equal(Object.prototype.hasOwnProperty.call(byPath, 'navigation.headingTrue'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(byPath, 'navigation.courseOverGroundTrue'), true)
    assert.equal(invoke(routes, 'GET', '/state').own.headingEnabled, false)
  } finally {
    plugin.stop()
  }
})

test('signed target rudder angles are published without compass wrapping', () => {
  const messages = []
  const routes = new Map()
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(routerMap(routes))
  plugin.start()
  invoke(routes, 'POST', '/output', { enabled: true })
  invoke(routes, 'POST', '/targets/:id/control', { rudderDirection: 'left' }, { id: 'sim-9' })
  const byPath = latestValuesByPath(messages, '235900009')
  assert.ok(byPath['steering.rudderAngle'] < 0)
  assert.ok(byPath['steering.rudderAngle'] > -Math.PI)
  plugin.stop()
})

test('automatic left turns publish negative rate of turn', () => {
  const messages = []
  const routes = new Map()
  const realDateNow = Date.now
  const realSetInterval = global.setInterval
  const realClearInterval = global.clearInterval
  let now = Date.parse('2026-06-24T12:00:00.000Z')
  let tick = null
  Date.now = () => now
  global.setInterval = (handler) => {
    tick = handler
    return 1
  }
  global.clearInterval = () => {}
  const app = {
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta })
    }
  }
  let plugin
  try {
    plugin = createPlugin(app)
    plugin.registerWithRouter(routerMap(routes))
    plugin.start()
    invoke(routes, 'POST', '/output', { enabled: true })
    now += 121000
    tick()
    const byPath = latestValuesByPath(messages, '235900009')
    assert.ok(byPath['navigation.rateOfTurn'] < 0)
    assert.ok(byPath['navigation.rateOfTurn'] > -Math.PI)
  } finally {
    plugin?.stop()
    Date.now = realDateNow
    global.setInterval = realSetInterval
    global.clearInterval = realClearInterval
  }
})

test('autopilot leg timers start when simulator output is enabled', () => {
  const routes = new Map()
  const realDateNow = Date.now
  const realSetInterval = global.setInterval
  const realClearInterval = global.clearInterval
  let now = Date.parse('2026-06-25T12:00:00.000Z')
  let tick = null
  Date.now = () => now
  global.setInterval = (handler) => {
    tick = handler
    return 1
  }
  global.clearInterval = () => {}
  const app = {
    setPluginStatus() {},
    handleMessage() {}
  }
  let plugin
  try {
    plugin = createPlugin(app)
    plugin.registerWithRouter(routerMap(routes))
    plugin.start({
      own: {
        autopilotEnabled: true,
        legDuration: 300
      },
      targets: [
        {
          id: 'test-target',
          mmsi: '235900999',
          name: 'TEST TARGET',
          startPosition: { latitude: 56.16, longitude: -5.55 },
          courseDeg: 90,
          speedKn: 5,
          legDuration: 300,
          autopilotEnabled: true
        }
      ]
    })
    now += 301000
    tick()
    const state = invoke(routes, 'POST', '/output', { enabled: true })
    assert.equal(state.own.routeTurning, false)
    assert.equal(state.targets.find((target) => target.id === 'test-target').routeTurning, false)
    tick()
    const afterFirstEnabledTick = invoke(routes, 'GET', '/state')
    assert.equal(afterFirstEnabledTick.own.routeTurning, false)
    assert.equal(
      afterFirstEnabledTick.targets.find((target) => target.id === 'test-target').routeTurning,
      false
    )
    now += 300000
    tick()
    const afterLeg = invoke(routes, 'GET', '/state')
    assert.equal(afterLeg.own.routeTurning, true)
    assert.equal(afterLeg.targets.find((target) => target.id === 'test-target').routeTurning, true)
  } finally {
    plugin?.stop()
    Date.now = realDateNow
    global.setInterval = realSetInterval
    global.clearInterval = realClearInterval
  }
})

function invoke(routes, method, path, body = {}, params = {}) {
  return invokeWithParams(routes, method, path, body, params)
}

function invokeWithParams(routes, method, path, body = {}, params = {}) {
  let payload
  const response = {
    status() { return response },
    json(value) { payload = value }
  }
  routes.get(`${method} ${path}`)({ body, params }, response)
  return payload
}

function routerMap(routes) {
  return {
    get(path, handler) {
      routes.set(`GET ${path}`, handler)
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler)
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function latestValuesByPath(messages, mmsi) {
  const message = messages
    .filter((entry) => String(entry.delta.context).includes(mmsi))
    .at(-1)
  assert.ok(message, `expected message for ${mmsi}`)
  return Object.fromEntries(message.delta.updates[0].values.map((item) => [item.path, item.value]))
}

function allValuesByPath(messages, mmsi) {
  const matching = messages.filter((entry) => String(entry.delta.context).includes(mmsi))
  assert.ok(matching.length > 0, `expected message for ${mmsi}`)
  return Object.fromEntries(
    matching.flatMap((message) => message.delta.updates[0].values.map((item) => [item.path, item.value]))
  )
}
