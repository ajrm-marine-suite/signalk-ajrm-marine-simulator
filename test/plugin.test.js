const assert = require('node:assert/strict')
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

test('old configured start position is ignored unless explicitly enabled', () => {
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
    assert.equal(state.own.latitude, Number(DEFAULT_BASE.latitude.toFixed(6)))
    assert.equal(state.own.longitude, Number(DEFAULT_BASE.longitude.toFixed(6)))

    plugin.stop()
    plugin.start({
      own: {
        useConfiguredStartPosition: true,
        startPosition: { latitude: 56.308558, longitude: -5.638818 }
      }
    })
    state = invoke(routes, 'GET', '/state')
    assert.equal(state.own.latitude, 56.308558)
    assert.equal(state.own.longitude, -5.638818)

    state = invoke(routes, 'POST', '/own/reset', {})
    assert.equal(state.own.latitude, 56.308558)
    assert.equal(state.own.longitude, -5.638818)
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
