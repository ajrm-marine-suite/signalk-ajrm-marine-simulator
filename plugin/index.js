/*
 * AJRM Marine Simulator
 *
 * Unified own-vessel, environment, GNSS, and AIS target simulator. This plugin
 * deliberately uses one Signal K source so its simulated values do not fight
 * each other the way separate own-track and target simulators can.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const packageInfo = require('../package.json')

const EARTH_RADIUS_M = 6371000
const KNOTS_TO_MPS = 0.514444
const MPS_TO_KNOTS = 1.9438444924406046
const DEFAULT_BASE = { latitude: 56.211222, longitude: -5.557556 }
const DEFAULT_PERIOD_SECONDS = 1
const DEFAULT_LEG_SECONDS = 300
const MAX_RUDDER_DEG = 35
const DEFAULT_ROUTE_RUDDER_DEG = 30
const DEFAULT_GPX_ARRIVAL_RADIUS_M = 25
const MAX_GPX_ROUTE_POINTS = 2000
const RUNTIME_SETTINGS_VERSION = 1
const RUNTIME_SETTINGS_FILE_ENV = 'AJRM_MARINE_SIMULATOR_SETTINGS_FILE'
const TURN_RATE_PER_RUDDER_DEG_PER_SECOND = 0.08
const AIS_NAV_STATUS_ACTIVE_SART = 14
const GPS_FAULT_MODES = ['normal', 'degraded', 'lost', 'jump', 'spoof', 'intermittent']
const CONSTELLATIONS = ['gps', 'glonass', 'galileo', 'beidou']
const AIS_TYPES = {
  30: 'Fishing',
  36: 'Sailing',
  37: 'Pleasure Craft',
  52: 'Tug',
  60: 'Passenger',
  70: 'Cargo'
}
const EMERGENCY_MODES = {
  none: { id: 'none', label: 'Normal', prefix: '', name: '', stateName: '' },
  sart: { id: 'sart', label: 'AIS-SART', prefix: '970', name: 'ACTIVE SART', stateName: 'AIS-SART active' },
  mob: { id: 'mob', label: 'MOB-AIS', prefix: '972', name: 'MOB ACTIVE', stateName: 'MOB-AIS active' },
  epirb: { id: 'epirb', label: 'EPIRB-AIS', prefix: '974', name: 'EPIRB ACTIVE', stateName: 'EPIRB-AIS active' }
}

const DEFAULT_TARGETS = [
  ['sim-1', 'NORTH CHANNEL', '235900001', 'VSA001', 35000, 70, 340, 56, 56.1625, -5.69, 345, 5.4, 360, 300, -8],
  ['sim-2', 'IRISH SEA TRADER', '235900002', 'VSA002', 12000, 70, 180, 28, 56.255, -5.6665, 165, 4.8, 420, 158, 5],
  ['sim-3', 'FAST FERRY ONE', '235900003', 'VSA003', 6500, 60, 96, 27, 56.22, -5.625, 30, 7, 240, 24, -6],
  ['sim-4', 'COASTAL SUPPLY', '235900004', 'VSA004', 900, 70, 54, 11, 56.239, -5.59, 50, 3.8, 300, 44, 2],
  ['sim-5', 'HARBOUR TUG', '235900005', 'VSA005', 420, 52, 28, 9, 56.213, -5.565, 95, 2.2, 180, 17, -2],
  ['sim-6', 'SEA OTTER', '235900006', 'VSB006', 18, 36, 13, 4, 56.232, -5.565, 20, 2.8, 360, 10.4, 0.3],
  ['sim-7', '', '235900007', 'VSB007', 9, 36, 9, 3, 56.2595, -5.552, 215, 2, 300, 7.2, -0.5],
  ['sim-8', 'MISTY DAWN', '235900008', 'VSB008', 22, 36, 14, 4, 56.1965, -5.585, 145, 2.2, 300, 11.9, 0.4],
  ['sim-9', 'RIB ALPHA', '235900009', 'VSB009', 4, 37, 7, 2.5, 56.2085, -5.5755, 310, 4.5, 120, 5.5, -0.6],
  ['sim-10', 'FISHER TWO', '235900010', 'VSB010', 75, 30, 18, 6, 56.176, -5.645, 340, 2.8, 360, 12.8, 1]
]

module.exports = function ajrmMarineSimulator(app) {
  const plugin = {}
  let cfg = null
  let own = null
  let env = null
  let targets = new Map()
  let timer = null
  let lastTickMs = null
  let startedAtMs = 0
  let startupProps = {}

  plugin.id = 'signalk-ajrm-marine-simulator'
  plugin.name = 'AJRM Marine Simulator'
  plugin.description = 'Unified own-vessel, environment, GNSS and AIS target simulator.'
  plugin.version = packageInfo.version

  plugin.schema = makeSchema()

  plugin.start = function start(props = {}) {
    plugin.stop()
    startupProps = props || {}
    cfg = normalizeConfig(mergeRuntimeSettings(startupProps, loadRuntimeSettings()))
    own = initialOwn(cfg)
    env = initialEnvironment(cfg)
    targets = new Map(initialTargets(cfg).map((target) => [target.id, target]))
    startedAtMs = Date.now()
    lastTickMs = startedAtMs
    publishSnapshot()
    timer = setInterval(tick, cfg.outputPeriod * 1000)
    setStatus()
  }

  plugin.stop = function stop() {
    if (timer) clearInterval(timer)
    timer = null
    cfg = null
    own = null
    env = null
    targets = new Map()
    lastTickMs = null
  }

  plugin.registerWithRouter = function registerWithRouter(router) {
    router.get('/state', (_req, res) => res.json(publicState()))

    router.post('/output', (req, res) => {
      if (!cfg) return res.status(409).json({ error: 'Simulator is not running' })
      const wasEnabled = cfg.outputEnabled
      const nextEnabled = req.body?.enabled === true
      if (wasEnabled && !nextEnabled) publishQuietSnapshot()
      cfg.outputEnabled = nextEnabled
      if (!wasEnabled && cfg.outputEnabled) {
        resetAutopilotLegTimers()
        publishSnapshot({ includeStatic: true })
      }
      setStatus()
      res.json(publicState())
    })

    router.post('/own/controls', (req, res) => {
      if (!own) return res.status(409).json({ error: 'Simulator is not running' })
      const values = req.body || {}
      updateOwnControls(values)
      saveRuntimeSettings()
      publishOwn({ includePosition: Object.prototype.hasOwnProperty.call(values, 'gpsFaultMode') })
      res.json(publicState())
    })

    router.post('/own/reset', (_req, res) => {
      if (!own) return res.status(409).json({ error: 'Simulator is not running' })
      resetSimulatorToDefaults()
      publishSnapshot({ includeStatic: true })
      res.json(publicState())
    })

    router.post('/own/start-position', (req, res) => {
      if (!own || !cfg) return res.status(409).json({ error: 'Simulator is not running' })
      const next = startPositionFromInput(req.body || {}, own.startPosition || DEFAULT_BASE)
      cfg.own = { ...(cfg.own || {}), startPosition: next }
      own.startPosition = next
      if (!cfg.outputEnabled) {
        own.latitude = next.latitude
        own.longitude = next.longitude
        own.gpsSpoofOffsetM = 0
        publishOwn({ includePosition: true })
      }
      saveRuntimeSettings()
      res.json(publicState())
    })

    router.post('/own/gpx-route', (req, res) => {
      if (!own || !cfg) return res.status(409).json({ error: 'Simulator is not running' })
      const route = gpxRouteFromInput(req.body || {})
      if (!route.points.length) return res.status(400).json({ error: 'GPX route needs at least one valid point' })
      own.gpxRoute = route
      own.gpxRouteIndex = route.points.length > 1 ? 1 : 0
      own.autopilotEnabled = false
      own.routeTurning = false
      own.routeTargetDeg = null
      const first = route.points[0]
      own.startPosition = { latitude: first.latitude, longitude: first.longitude }
      cfg.own = { ...(cfg.own || {}), startPosition: own.startPosition, gpxRoute: route, gpxRouteIndex: own.gpxRouteIndex }
      if (!cfg.outputEnabled) {
        own.latitude = first.latitude
        own.longitude = first.longitude
        own.gpsSpoofOffsetM = 0
        publishOwn({ includePosition: true })
      }
      saveRuntimeSettings()
      res.json(publicState())
    })

    router.post('/own/gpx-route/clear', (_req, res) => {
      if (!own || !cfg) return res.status(409).json({ error: 'Simulator is not running' })
      own.gpxRoute = emptyGpxRoute()
      own.gpxRouteIndex = 0
      cfg.own = { ...(cfg.own || {}), gpxRoute: own.gpxRoute, gpxRouteIndex: 0 }
      saveRuntimeSettings()
      res.json(publicState())
    })

    router.post('/own/heading', (req, res) => {
      if (!own) return res.status(409).json({ error: 'Simulator is not running' })
      own.headingDeg = normalizeDeg(own.headingDeg + (req.body?.direction === 'left' ? -5 : 5))
      own.gpxRoute = { ...(own.gpxRoute || emptyGpxRoute()), enabled: false }
      own.routeTurning = false
      saveRuntimeSettings()
      publishOwn({ includePosition: false })
      res.json(publicState())
    })

    router.post('/own/speed', (req, res) => {
      if (!own) return res.status(409).json({ error: 'Simulator is not running' })
      own.speedKn = clamp(own.speedKn + (req.body?.direction === 'down' ? -0.5 : 0.5), 0, 30, own.speedKn)
      saveRuntimeSettings()
      publishOwn({ includePosition: false })
      res.json(publicState())
    })

    router.post('/own/autopilot', (req, res) => {
      if (!own) return res.status(409).json({ error: 'Simulator is not running' })
      own.autopilotEnabled = req.body?.enabled === true
      if (own.autopilotEnabled) own.gpxRoute = { ...(own.gpxRoute || emptyGpxRoute()), enabled: false }
      own.routeTurning = false
      own.legStartMs = Date.now()
      saveRuntimeSettings()
      res.json(publicState())
    })

    router.post('/environment', (req, res) => {
      if (!env) return res.status(409).json({ error: 'Simulator is not running' })
      updateEnvironment(req.body || {})
      saveRuntimeSettings()
      publishOwn({ includePosition: false })
      res.json(publicState())
    })

    router.post('/targets/:id/control', (req, res) => {
      const target = updateTarget(req.params.id, req.body || {})
      if (!target) return res.status(404).json({ error: 'Unknown target' })
      saveRuntimeSettings()
      publishTarget(target, true)
      res.json(publicState())
    })
  }

  return plugin

  function tick() {
    if (!cfg || !own || !env) return
    const now = Date.now()
    const dt = Math.max(0, Math.min(10, (now - lastTickMs) / 1000))
    lastTickMs = now
    if (!cfg.outputEnabled) {
      setStatus()
      return
    }
    advanceOwn(dt)
    advanceEnvironment(now)
    for (const target of targets.values()) advanceTarget(target, dt)
    publishSnapshot()
    setStatus()
  }

  function publishSnapshot({ includeStatic = false } = {}) {
    publishOwn()
    for (const target of targets.values()) publishTarget(target, includeStatic)
  }

  function publishQuietSnapshot() {
    if (!cfg?.outputEnabled || !own) return false
    app.handleMessage(plugin.id, {
      context: 'vessels.self',
      updates: [
        {
          $source: cfg.sourceName,
          values: quietOwnValues()
        }
      ]
    })
    for (const target of targets.values()) publishQuietTarget(target)
    return true
  }

  function publishOwn({ includePosition = true } = {}) {
    if (!cfg?.outputEnabled || !own) return false
    app.handleMessage(plugin.id, {
      context: 'vessels.self',
      updates: [
        {
          $source: cfg.sourceName,
          values: ownValues({ includePosition })
        }
      ]
    })
    return true
  }

  function ownValues({ includePosition = true } = {}) {
    const gps = ownGpsValues({ includePosition })
    const gpsUnavailable = ownGpsUnavailable()
    const depthBelowKeelM = Math.max(0, env.depthM + env.transducerToKeelM)
    const motion = ownGroundMotion()
    const wind = trueWindFromApparent({
      courseDeg: own.headingDeg,
      speedKn: own.speedKn,
      apparentWindAngleDeg: env.apparentWindAngleDeg,
      apparentWindSpeedKn: env.apparentWindSpeedKn
    })
    const values = [
      {
        path: 'navigation.courseOverGroundTrue',
        value: gpsUnavailable ? null : degToRad(motion.courseDeg)
      },
      {
        path: 'navigation.speedOverGround',
        value: gpsUnavailable ? null : motion.speedOverGroundMps
      },
      { path: 'navigation.speedThroughWater', value: own.speedKn * KNOTS_TO_MPS },
      { path: 'navigation.rateOfTurn', value: rawDegToRad(own.rateOfTurnDegPerSecond || 0) },
      { path: 'steering.rudderAngle', value: rawDegToRad(own.rudderAngleDeg || 0) },
      { path: 'navigation.state', value: own.speedKn > 0 ? 'underWay' : 'stopped' },
      { path: 'environment.depth.belowTransducer', value: env.depthM },
      { path: 'environment.depth.transducerToKeel', value: env.transducerToKeelM },
      { path: 'environment.depth.belowKeel', value: depthBelowKeelM },
      { path: 'environment.wind.speedApparent', value: env.apparentWindSpeedKn * KNOTS_TO_MPS },
      { path: 'environment.wind.angleApparent', value: rawDegToRad(env.apparentWindAngleDeg) },
      { path: 'environment.wind.speedOverGround', value: wind.speedTrue },
      { path: 'environment.wind.speedTrue', value: wind.speedTrue },
      { path: 'environment.wind.directionTrue', value: degToRad(wind.directionTrue) },
      { path: 'environment.wind.angleTrueGround', value: wind.angleTrueGround },
      { path: 'environment.current.setTrue', value: degToRad(env.currentSetDeg) },
      { path: 'environment.current.drift', value: env.currentDriftKn * KNOTS_TO_MPS },
      { path: 'environment.tide.setTrue', value: degToRad(env.currentSetDeg) },
      { path: 'environment.tide.drift', value: env.currentDriftKn * KNOTS_TO_MPS },
      { path: 'environment.inside.engineRoom.temperature', value: env.engineRoomTemperatureC + 273.15 },
      { path: 'propulsion.main.temperature', value: env.exhaustWaterTemperatureC + 273.15 },
      { path: 'electrical.batteries.house.voltage', value: env.batteryVoltage },
      { path: 'electrical.batteries.house.current', value: env.batteryCurrent }
    ]
    if (own.headingEnabled !== false) values.splice(1, 0, { path: 'navigation.headingTrue', value: degToRad(own.headingDeg) })
    values.push(...gps)
    return values
  }

  function quietOwnValues() {
    const values = [
      { path: 'navigation.courseOverGroundTrue', value: degToRad(own.headingDeg) },
      { path: 'navigation.speedOverGround', value: 0 },
      { path: 'navigation.speedThroughWater', value: 0 },
      { path: 'navigation.rateOfTurn', value: 0 },
      { path: 'steering.rudderAngle', value: 0 },
      { path: 'navigation.state', value: 'stopped' },
      { path: 'environment.current.setTrue', value: degToRad(env.currentSetDeg) },
      { path: 'environment.current.drift', value: 0 },
      { path: 'environment.tide.setTrue', value: degToRad(env.currentSetDeg) },
      { path: 'environment.tide.drift', value: 0 },
      { path: 'navigation.gnss.methodQuality', value: 'GNSS fix' },
      { path: 'navigation.position', value: { latitude: own.latitude, longitude: own.longitude } }
    ]
    if (own.headingEnabled !== false) values.splice(1, 0, { path: 'navigation.headingTrue', value: degToRad(own.headingDeg) })
    return values
  }

  function ownGpsUnavailable() {
    const mode = GPS_FAULT_MODES.includes(own.gpsFaultMode) ? own.gpsFaultMode : 'normal'
    const seconds = (Date.now() - startedAtMs) / 1000
    return mode === 'lost' || (mode === 'intermittent' && Math.floor(seconds / 12) % 2 === 1)
  }

  function ownGroundMotion() {
    return groundMotionForHeading({
      headingDeg: own.headingDeg,
      speedThroughWaterKn: own.speedKn,
      currentSetDeg: env.currentSetDeg,
      currentDriftKn: env.currentDriftKn
    })
  }

  function ownGpsValues({ includePosition = true } = {}) {
    const mode = GPS_FAULT_MODES.includes(own.gpsFaultMode) ? own.gpsFaultMode : 'normal'
    const seconds = (Date.now() - startedAtMs) / 1000
    const intermittentOff = ownGpsUnavailable()
    const sats = gnssSatelliteState(mode, seconds)
    const values = [
      { path: 'navigation.gnss.methodQuality', value: mode === 'lost' || intermittentOff ? 'no GPS' : 'GNSS fix' },
      { path: 'navigation.gnss.horizontalDilution', value: sats.hdop },
      { path: 'navigation.gnss.verticalDilution', value: sats.vdop },
      { path: 'navigation.gnss.positionDilution', value: sats.pdop },
      { path: 'navigation.gnss.satellites', value: sats.used },
      { path: 'navigation.gnss.satellitesInView', value: sats.inView },
      { path: 'navigation.gnss.signalStrength', value: sats.signalStrength },
      { path: 'navigation.gnss.constellations', value: sats.constellations }
    ]
    if (!includePosition) return values
    if (mode === 'lost' || intermittentOff) {
      values.push({ path: 'navigation.position', value: null })
      return values
    }
    let position = { latitude: own.latitude, longitude: own.longitude }
    if (mode === 'jump') {
      position = offsetMeters(position.latitude, position.longitude, 500, 500)
    } else if (mode === 'spoof') {
      own.gpsSpoofOffsetM += cfg.outputPeriod * 1.5
      position = offsetMeters(position.latitude, position.longitude, own.gpsSpoofOffsetM, own.gpsSpoofOffsetM)
    }
    values.push({ path: 'navigation.position', value: position })
    return values
  }

  function publishTarget(target, includeStatic = false) {
    if (!cfg?.outputEnabled || !target.enabled) return false
    if (includeStatic) {
      app.handleMessage(plugin.id, {
        context: contextForTarget(target),
        updates: [{ $source: cfg.sourceName, values: targetStaticValues(target) }]
      })
    }
    app.handleMessage(plugin.id, {
      context: contextForTarget(target),
      updates: [{ $source: cfg.sourceName, values: targetDynamicValues(target) }]
    })
    return true
  }

  function publishQuietTarget(target) {
    if (!target.enabled) return false
    app.handleMessage(plugin.id, {
      context: contextForTarget(target),
      updates: [
        {
          $source: cfg.sourceName,
          values: [
            { path: 'navigation.position', value: null },
            { path: 'navigation.speedOverGround', value: 0 },
            { path: 'navigation.rateOfTurn', value: 0 },
            { path: 'steering.rudderAngle', value: 0 },
            { path: 'navigation.state', value: target.isFixedStation ? 'baseStation' : 'stopped' }
          ]
        }
      ]
    })
    return true
  }

  function targetStaticValues(target) {
    const rootValue = {}
    if (target.name) rootValue.name = transmittedName(target)
    if (target.callsign) rootValue.communication = { callsignVhf: target.callsign }
    const values = [
      { path: 'design.aisShipType', value: { id: target.aisShipType, name: AIS_TYPES[target.aisShipType] || 'Unknown' } },
      { path: 'design.length', value: { overall: target.length } },
      { path: 'design.beam', value: target.width },
      { path: 'design.draft', value: { current: target.draft } },
      { path: 'sensors.ais.fromBow', value: target.aisFromBow },
      { path: 'sensors.ais.fromCenter', value: target.aisFromCenter },
      { path: 'sensors.ais.class', value: target.aisClass }
    ]
    if (Object.keys(rootValue).length > 0) values.push({ path: '', value: rootValue })
    if (target.destination) values.push({ path: 'navigation.destination.commonName', value: target.destination })
    if (target.eta) values.push({ path: 'navigation.destination.eta', value: target.eta })
    if (target.imo) values.push({ path: 'registrations.imo', value: target.imo })
    return values
  }

  function targetDynamicValues(target) {
    const mode = GPS_FAULT_MODES.includes(target.gpsFaultMode) ? target.gpsFaultMode : 'normal'
    const values = [
      { path: 'navigation.courseOverGroundTrue', value: degToRad(target.courseDeg) },
      { path: 'navigation.speedOverGround', value: target.speedKn * KNOTS_TO_MPS },
      { path: 'navigation.headingTrue', value: degToRad(target.courseDeg) },
      { path: 'navigation.rateOfTurn', value: rawDegToRad(target.rateOfTurnDegPerSecond || 0) },
      { path: 'steering.rudderAngle', value: rawDegToRad(target.rudderAngleDeg || 0) },
      { path: 'navigation.state', value: navigationState(target) },
      { path: 'sensors.ais.class', value: target.aisClass }
    ]
    if (mode === 'lost') {
      values.push({ path: 'navigation.position', value: null })
    } else {
      let position = { latitude: target.latitude, longitude: target.longitude }
      if (mode === 'jump') position = offsetMeters(position.latitude, position.longitude, 300, -300)
      if (mode === 'spoof') {
        target.gpsSpoofOffsetM += cfg.outputPeriod
        position = offsetMeters(position.latitude, position.longitude, target.gpsSpoofOffsetM, -target.gpsSpoofOffsetM)
      }
      values.push({ path: 'navigation.position', value: position })
    }
    if (isEmergencyActive(target)) values.push({ path: '', value: { name: transmittedName(target) } })
    return values
  }

  function advanceOwn(dt) {
    own.rateOfTurnDegPerSecond = 0
    if (own.gpxRoute?.enabled && own.gpxRoute.points.length > 0) {
      steerOwnToGpxRoute()
    } else if (own.autopilotEnabled) {
      if (!own.routeTurning && (Date.now() - own.legStartMs) / 1000 >= own.legDuration) {
        own.routeTargetDeg = normalizeDeg(own.headingDeg + 180)
        own.routeTurning = true
      }
      if (own.routeTurning) applyRouteTurn(own, dt)
    }
    const motion = ownGroundMotion()
    const moved = movePoint(own.latitude, own.longitude, motion.courseDeg, motion.speedOverGroundMps * dt)
    own.latitude = moved.latitude
    own.longitude = moved.longitude
  }

  function steerOwnToGpxRoute() {
    const route = own.gpxRoute
    if (!route?.points.length) return
    let index = clampInteger(own.gpxRouteIndex, 0, route.points.length - 1, route.points.length > 1 ? 1 : 0)
    while (index < route.points.length) {
      const target = route.points[index]
      const distance = distanceMeters(own.latitude, own.longitude, target.latitude, target.longitude)
      if (distance > route.arrivalRadiusM || index >= route.points.length - 1) break
      index += 1
    }
    own.gpxRouteIndex = index
    const target = route.points[index]
    if (!target) return
    const remainingDistance = distanceMeters(own.latitude, own.longitude, target.latitude, target.longitude)
    if (index >= route.points.length - 1 && remainingDistance <= route.arrivalRadiusM) {
      own.gpxRoute = { ...route, enabled: false, completed: true }
      own.gpxRouteIndex = index
      own.speedKn = 0
      return
    }
    own.headingDeg = bearingDegrees(own.latitude, own.longitude, target.latitude, target.longitude)
    own.routeTurning = false
    own.routeTargetDeg = null
    own.rudderAngleDeg = 0
  }

  function advanceTarget(target, dt) {
    if (!target.enabled || target.isFixedStation) return
    target.rateOfTurnDegPerSecond = 0
    if (cfg.targetAutopilotEnabled && target.autopilotEnabled) {
      if (!target.routeTurning && (Date.now() - target.legStartMs) / 1000 >= target.legDuration) {
        target.routeTargetDeg = normalizeDeg(target.courseDeg + 180)
        target.routeTurning = true
      }
      if (target.routeTurning) applyRouteTurn(target, dt)
    }
    const moved = movePoint(target.latitude, target.longitude, target.courseDeg, target.speedKn * KNOTS_TO_MPS * dt)
    target.latitude = moved.latitude
    target.longitude = moved.longitude
  }

  function applyRouteTurn(item, dt) {
    const headingKey = Object.prototype.hasOwnProperty.call(item, 'headingDeg') ? 'headingDeg' : 'courseDeg'
    const targetCourse = item.routeTargetDeg
    const delta = shortestAngleDelta(item[headingKey], targetCourse)
    const rudder = delta < 0 ? -cfg.routeTurnRudderAngleDeg : cfg.routeTurnRudderAngleDeg
    const speedFactor = Math.min(1, Math.max(0, (item.speedKn || 0) / 5))
    const rate = rudder * TURN_RATE_PER_RUDDER_DEG_PER_SECOND * speedFactor
    const turn = rate * dt
    item.rudderAngleDeg = rudder
    item.rateOfTurnDegPerSecond = rate
    if (Math.abs(turn) >= Math.abs(delta)) {
      item[headingKey] = normalizeDeg(targetCourse)
      item.routeTurning = false
      item.routeTargetDeg = null
      item.rudderAngleDeg = 0
      item.rateOfTurnDegPerSecond = 0
      item.legStartMs = Date.now()
    } else {
      item[headingKey] = normalizeDeg(item[headingKey] + turn)
    }
  }

  function advanceEnvironment(nowMs) {
    const minutes = (nowMs - startedAtMs) / 60000
    if (env.depthVarying) env.depthM = clamp(env.baseDepthM + Math.sin(minutes / 4) * env.depthVariationM, 0, 250, env.depthM)
    if (env.windVarying) {
      env.apparentWindSpeedKn = clamp(env.baseApparentWindSpeedKn + Math.sin(minutes / 3) * env.windVariationKn, 0, 80, env.apparentWindSpeedKn)
      env.apparentWindAngleDeg = clamp(env.baseApparentWindAngleDeg + Math.sin(minutes / 5) * env.windShiftDeg, -180, 180, env.apparentWindAngleDeg)
    }
    if (env.currentVarying) {
      env.currentDriftKn = clamp(env.baseCurrentDriftKn + Math.sin(minutes / 6) * env.currentVariationKn, 0, 8, env.currentDriftKn)
      env.currentSetDeg = normalizeDeg(env.baseCurrentSetDeg + Math.sin(minutes / 8) * env.currentShiftDeg)
    }
    env.engineRoomTemperatureC = clamp(env.baseEngineRoomTemperatureC + Math.sin(minutes / 10) * 3, -10, 120, env.engineRoomTemperatureC)
    env.exhaustWaterTemperatureC = clamp(env.baseExhaustWaterTemperatureC + Math.sin(minutes / 7) * 4, -10, 120, env.exhaustWaterTemperatureC)
  }

  function updateOwnControls(values) {
    if (values.headingDeg != null) own.headingDeg = normalizeDeg(Number(values.headingDeg))
    if (values.courseDeg != null) own.headingDeg = normalizeDeg(Number(values.courseDeg))
    if (values.speedKn != null) own.speedKn = clamp(values.speedKn, 0, 30, own.speedKn)
    if (values.headingEnabled != null) own.headingEnabled = values.headingEnabled === true
    if (values.gpsFaultMode != null && GPS_FAULT_MODES.includes(String(values.gpsFaultMode))) {
      own.gpsFaultMode = String(values.gpsFaultMode)
      if (own.gpsFaultMode !== 'spoof') own.gpsSpoofOffsetM = 0
    }
    if (values.legDuration != null) own.legDuration = clamp(values.legDuration, 10, 86400, own.legDuration)
  }

  function resetSimulatorToDefaults() {
    const wasOutputEnabled = cfg?.outputEnabled === true
    clearRuntimeSettings()
    cfg = normalizeConfig(startupProps)
    cfg.outputEnabled = wasOutputEnabled
    own = initialOwn(cfg)
    env = initialEnvironment(cfg)
    targets = new Map(initialTargets(cfg).map((target) => [target.id, target]))
    startedAtMs = Date.now()
    lastTickMs = startedAtMs
    resetAutopilotLegTimers()
    setStatus()
  }

  function resetAutopilotLegTimers() {
    const now = Date.now()
    if (own) resetRouteTimer(own, now)
    for (const target of targets.values()) resetRouteTimer(target, now)
  }

  function resetRouteTimer(item, now) {
    item.legStartMs = now
    item.routeTurning = false
    item.routeTargetDeg = null
    item.rudderAngleDeg = 0
    item.rateOfTurnDegPerSecond = 0
  }

  function updateEnvironment(values) {
    for (const [key, limits] of Object.entries({
      depthM: [0, 250],
      apparentWindSpeedKn: [0, 80],
      apparentWindAngleDeg: [-180, 180],
      currentDriftKn: [0, 8],
      currentSetDeg: [0, 360],
      engineRoomTemperatureC: [-10, 120],
      exhaustWaterTemperatureC: [-10, 120]
    })) {
      if (values[key] != null) env[key] = clamp(values[key], limits[0], limits[1], env[key])
    }
    for (const key of ['depthVarying', 'windVarying', 'currentVarying']) {
      if (values[key] != null) env[key] = values[key] === true
    }
    env.baseDepthM = env.depthM
    env.baseApparentWindSpeedKn = env.apparentWindSpeedKn
    env.baseApparentWindAngleDeg = env.apparentWindAngleDeg
    env.baseCurrentDriftKn = env.currentDriftKn
    env.baseCurrentSetDeg = env.currentSetDeg
  }

  function updateTarget(id, values) {
    const target = targets.get(id)
    if (!target) return null
    if (values.enabled != null) target.enabled = values.enabled === true
    if (values.autopilotEnabled != null && !target.isFixedStation) target.autopilotEnabled = values.autopilotEnabled === true
    if (values.speedDirection) target.speedKn = clamp(target.speedKn + (values.speedDirection === 'down' ? -1 : 1), 0, 40, target.speedKn)
    if (values.rudderDirection && !target.isFixedStation) {
      target.rudderAngleDeg = clamp(target.rudderAngleDeg + (values.rudderDirection === 'left' ? -5 : 5), -MAX_RUDDER_DEG, MAX_RUDDER_DEG, target.rudderAngleDeg)
      target.courseDeg = normalizeDeg(target.courseDeg + (values.rudderDirection === 'left' ? -10 : 10))
      target.routeTurning = false
    }
    if (values.emergencyMode != null && !target.isFixedStation) target.emergencyMode = emergencyModeFor(values.emergencyMode)
    if (values.gpsFaultMode != null && GPS_FAULT_MODES.includes(String(values.gpsFaultMode))) {
      target.gpsFaultMode = String(values.gpsFaultMode)
      if (target.gpsFaultMode !== 'spoof') target.gpsSpoofOffsetM = 0
    }
    return target
  }

  function publicState() {
    return {
      ok: true,
      plugin: plugin.id,
      version: packageInfo.version,
      running: Boolean(cfg),
      outputEnabled: cfg?.outputEnabled === true,
      targetAutopilotEnabled: cfg?.targetAutopilotEnabled === true,
      gpsFaultModes: GPS_FAULT_MODES,
      own: own ? {
        latitude: round(own.latitude, 6),
        longitude: round(own.longitude, 6),
        startPosition: {
          latitude: round(own.startPosition?.latitude ?? DEFAULT_BASE.latitude, 6),
          longitude: round(own.startPosition?.longitude ?? DEFAULT_BASE.longitude, 6)
        },
        headingDeg: round(own.headingDeg, 0),
        speedKn: round(own.speedKn, 1),
        headingEnabled: own.headingEnabled !== false,
        autopilotEnabled: own.autopilotEnabled,
        routeTurning: own.routeTurning,
        gpsFaultMode: own.gpsFaultMode,
        legDuration: own.legDuration,
        gpxRoute: publicGpxRoute(own.gpxRoute, own.gpxRouteIndex)
      } : null,
      environment: env ? {
        depthM: round(env.depthM, 1),
        depthBelowKeelM: round(Math.max(0, env.depthM + env.transducerToKeelM), 1),
        apparentWindSpeedKn: round(env.apparentWindSpeedKn, 1),
        apparentWindAngleDeg: round(env.apparentWindAngleDeg, 0),
        currentDriftKn: round(env.currentDriftKn, 1),
        currentSetDeg: round(env.currentSetDeg, 0),
        engineRoomTemperatureC: round(env.engineRoomTemperatureC, 1),
        exhaustWaterTemperatureC: round(env.exhaustWaterTemperatureC, 1),
        batteryVoltage: round(env.batteryVoltage, 1),
        batteryCurrent: round(env.batteryCurrent, 1),
        depthVarying: env.depthVarying,
        windVarying: env.windVarying,
        currentVarying: env.currentVarying
      } : null,
      targets: [...targets.values()].map((target) => ({
        id: target.id,
        label: target.name || target.mmsi,
        mmsi: transmittedMmsi(target),
        normalMmsi: target.mmsi,
        enabled: target.enabled,
        autopilotEnabled: target.autopilotEnabled,
        isFixedStation: target.isFixedStation,
        emergencyMode: target.emergencyMode,
        gpsFaultMode: target.gpsFaultMode,
        aisClass: target.aisClass,
        speedKn: round(target.speedKn, 1),
        courseDeg: round(target.courseDeg, 0),
        routeTurning: target.routeTurning
      }))
    }
  }

  function setStatus() {
    if (!cfg?.outputEnabled) {
      app.setPluginStatus?.(`v${packageInfo.version} - all simulation output OFF`)
      return
    }
    const activeTargets = [...targets.values()].filter((target) => target.enabled).length
    app.setPluginStatus?.(`v${packageInfo.version} - own boat + ${activeTargets} AIS targets/stations`)
  }

  function normalizeConfig(props = {}) {
    return {
      sourceName: String(props.sourceName || 'ajrm-marine-simulator'),
      outputEnabled: false,
      targetAutopilotEnabled: props.targetAutopilotEnabled !== false,
      outputPeriod: clamp(props.outputPeriod, 0.2, 10, DEFAULT_PERIOD_SECONDS),
      routeTurnRudderAngleDeg: clamp(props.routeTurnRudderAngleDeg, 1, MAX_RUDDER_DEG, DEFAULT_ROUTE_RUDDER_DEG),
      own: props.own || {},
      environment: props.environment || {},
      targets: Array.isArray(props.targets) ? props.targets : defaultTargetConfig(),
      fixedStations: Array.isArray(props.fixedStations) ? props.fixedStations : defaultFixedStationConfig()
    }
  }

  function mergeRuntimeSettings(baseProps = {}, saved = null) {
    if (!saved || saved.version !== RUNTIME_SETTINGS_VERSION) return baseProps
    const merged = {
      ...baseProps,
      own: { ...(baseProps.own || {}), ...(saved.own || {}) },
      environment: { ...(baseProps.environment || {}), ...(saved.environment || {}) }
    }
    if (saved.targetAutopilotEnabled != null) merged.targetAutopilotEnabled = saved.targetAutopilotEnabled === true
    if (Array.isArray(saved.targets)) {
      const baseTargets = Array.isArray(baseProps.targets) ? baseProps.targets : defaultTargetConfig()
      merged.targets = mergeRuntimeTargetSettings(baseTargets, saved.targets)
    }
    if (Array.isArray(saved.fixedStations)) {
      const baseStations = Array.isArray(baseProps.fixedStations) ? baseProps.fixedStations : defaultFixedStationConfig()
      merged.fixedStations = mergeRuntimeTargetSettings(baseStations, saved.fixedStations)
    }
    return merged
  }

  function mergeRuntimeTargetSettings(baseTargets, savedTargets) {
    const savedById = new Map(savedTargets.map((target) => [String(target.id || ''), target]))
    return baseTargets.map((target) => {
      const saved = savedById.get(String(target.id || ''))
      return saved ? { ...target, ...saved } : target
    })
  }

  function loadRuntimeSettings() {
    const file = runtimeSettingsFile()
    try {
      if (!fs.existsSync(file)) return null
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      app.debug?.(`Ignoring simulator runtime settings: ${error.message}`)
      return null
    }
  }

  function saveRuntimeSettings() {
    if (!cfg || !own || !env) return
    const file = runtimeSettingsFile()
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, `${JSON.stringify(runtimeSettingsFromState(), null, 2)}\n`)
    } catch (error) {
      app.setPluginError?.(`Unable to save simulator runtime settings: ${error.message}`)
    }
  }

  function clearRuntimeSettings() {
    try {
      fs.rmSync(runtimeSettingsFile(), { force: true })
    } catch (error) {
      app.debug?.(`Unable to clear simulator runtime settings: ${error.message}`)
    }
  }

  function runtimeSettingsFile() {
    return process.env[RUNTIME_SETTINGS_FILE_ENV] ||
      path.join(os.homedir(), '.signalk', 'plugin-config-data', `${plugin.id}-runtime.json`)
  }

  function runtimeSettingsFromState() {
    const movingTargets = []
    const fixedStations = []
    for (const target of targets.values()) {
      const targetSettings = {
        id: target.id,
        enabled: target.enabled,
        gpsFaultMode: target.gpsFaultMode
      }
      if (target.isFixedStation) {
        fixedStations.push(targetSettings)
      } else {
        movingTargets.push({
          ...targetSettings,
          autopilotEnabled: target.autopilotEnabled,
          initialCourseDeg: round(target.courseDeg, 0),
          speedKn: round(target.speedKn, 1),
          legDuration: target.legDuration,
          emergencyMode: target.emergencyMode?.id || target.emergencyMode || 'none'
        })
      }
    }
    return {
      version: RUNTIME_SETTINGS_VERSION,
      savedAt: new Date().toISOString(),
      targetAutopilotEnabled: cfg.targetAutopilotEnabled === true,
      own: {
        startPosition: {
          latitude: round(own.startPosition?.latitude ?? DEFAULT_BASE.latitude, 6),
          longitude: round(own.startPosition?.longitude ?? DEFAULT_BASE.longitude, 6)
        },
        initialHeadingDeg: round(own.headingDeg, 0),
        initialSpeedKn: round(own.speedKn, 1),
        headingEnabled: own.headingEnabled !== false,
        autopilotEnabled: own.autopilotEnabled === true,
        legDuration: own.legDuration,
        gpsFaultMode: own.gpsFaultMode,
        gpxRoute: own.gpxRoute || emptyGpxRoute(),
        gpxRouteIndex: clampInteger(own.gpxRouteIndex, 0, Math.max(0, (own.gpxRoute?.points.length || 1) - 1), 0)
      },
      environment: {
        depthM: round(env.depthM, 1),
        apparentWindSpeedKn: round(env.apparentWindSpeedKn, 1),
        apparentWindAngleDeg: round(env.apparentWindAngleDeg, 0),
        currentDriftKn: round(env.currentDriftKn, 1),
        currentSetDeg: round(env.currentSetDeg, 0),
        engineRoomTemperatureC: round(env.engineRoomTemperatureC, 1),
        exhaustWaterTemperatureC: round(env.exhaustWaterTemperatureC, 1),
        depthVarying: env.depthVarying,
        windVarying: env.windVarying,
        currentVarying: env.currentVarying
      },
      targets: movingTargets,
      fixedStations
    }
  }

  function initialOwn(config) {
    const ownConfig = config.own || {}
    const start = ownStartPosition(config)
    const startPosition = startPositionFromInput(start, DEFAULT_BASE)
    const gpxRoute = gpxRouteFromInput(ownConfig.gpxRoute || {})
    return {
      latitude: startPosition.latitude,
      longitude: startPosition.longitude,
      startPosition,
      headingDeg: normalizeDeg(ownConfig.initialHeadingDeg ?? ownConfig.initialCourseDeg ?? 90),
      speedKn: clamp(ownConfig.initialSpeedKn, 0, 30, 0),
      headingEnabled: ownConfig.headingEnabled !== false,
      autopilotEnabled: ownConfig.autopilotEnabled === true,
      legDuration: clamp(ownConfig.legDuration, 10, 86400, DEFAULT_LEG_SECONDS),
      routeTurning: false,
      routeTargetDeg: null,
      legStartMs: Date.now(),
      rudderAngleDeg: 0,
      rateOfTurnDegPerSecond: 0,
      gpsFaultMode: GPS_FAULT_MODES.includes(ownConfig.gpsFaultMode) ? ownConfig.gpsFaultMode : 'normal',
      gpsSpoofOffsetM: 0,
      gpxRoute,
      gpxRouteIndex: clampInteger(ownConfig.gpxRouteIndex, 0, Math.max(0, gpxRoute.points.length - 1), gpxRoute.points.length > 1 ? 1 : 0)
    }
  }

  function ownStartPosition(config) {
    const ownConfig = config?.own || {}
    return ownConfig.startPosition || DEFAULT_BASE
  }

  function startPositionFromInput(input = {}, fallback = DEFAULT_BASE) {
    return {
      latitude: clamp(input.latitude, -90, 90, fallback?.latitude),
      longitude: clamp(input.longitude, -180, 180, fallback?.longitude)
    }
  }

  function emptyGpxRoute() {
    return {
      enabled: false,
      completed: false,
      name: '',
      points: [],
      arrivalRadiusM: DEFAULT_GPX_ARRIVAL_RADIUS_M
    }
  }

  function gpxRouteFromInput(input = {}) {
    const points = Array.isArray(input.points)
      ? input.points
        .map((point) => startPositionFromInput(point, null))
        .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
        .slice(0, MAX_GPX_ROUTE_POINTS)
      : []
    return {
      enabled: points.length > 0 && input.enabled !== false,
      completed: input.completed === true && points.length > 0,
      name: String(input.name || '').trim().slice(0, 120),
      points,
      arrivalRadiusM: clamp(input.arrivalRadiusM, 5, 500, DEFAULT_GPX_ARRIVAL_RADIUS_M)
    }
  }

  function publicGpxRoute(route = emptyGpxRoute(), index = 0) {
    const points = Array.isArray(route.points) ? route.points : []
    const safeIndex = clampInteger(index, 0, Math.max(0, points.length - 1), 0)
    return {
      enabled: route.enabled === true,
      completed: route.completed === true,
      name: route.name || '',
      pointCount: points.length,
      index: safeIndex,
      arrivalRadiusM: route.arrivalRadiusM || DEFAULT_GPX_ARRIVAL_RADIUS_M,
      nextPoint: points[safeIndex]
        ? {
            latitude: round(points[safeIndex].latitude, 6),
            longitude: round(points[safeIndex].longitude, 6)
          }
        : null
    }
  }

  function initialEnvironment(config) {
    const input = config.environment || {}
    const state = {
      depthM: clamp(input.depthM, 0, 250, 8),
      transducerToKeelM: clamp(input.transducerToKeelM, -20, 20, -0.8),
      apparentWindSpeedKn: clamp(input.apparentWindSpeedKn, 0, 80, 12),
      apparentWindAngleDeg: clamp(input.apparentWindAngleDeg, -180, 180, -90),
      currentDriftKn: clamp(input.currentDriftKn, 0, 8, 1.2),
      currentSetDeg: normalizeDeg(input.currentSetDeg ?? 270),
      engineRoomTemperatureC: clamp(input.engineRoomTemperatureC, -10, 120, 24),
      exhaustWaterTemperatureC: clamp(input.exhaustWaterTemperatureC, -10, 120, 32),
      batteryVoltage: clamp(input.batteryVoltage, 9, 16, 12.7),
      batteryCurrent: clamp(input.batteryCurrent, -200, 200, -8),
      depthVarying: input.depthVarying !== false,
      windVarying: input.windVarying !== false,
      currentVarying: input.currentVarying !== false,
      depthVariationM: clamp(input.depthVariationM, 0, 50, 2),
      windVariationKn: clamp(input.windVariationKn, 0, 40, 4),
      windShiftDeg: clamp(input.windShiftDeg, 0, 90, 30),
      currentVariationKn: clamp(input.currentVariationKn, 0, 5, 0.6),
      currentShiftDeg: clamp(input.currentShiftDeg, 0, 180, 45)
    }
    state.baseDepthM = state.depthM
    state.baseApparentWindSpeedKn = state.apparentWindSpeedKn
    state.baseApparentWindAngleDeg = state.apparentWindAngleDeg
    state.baseCurrentDriftKn = state.currentDriftKn
    state.baseCurrentSetDeg = state.currentSetDeg
    state.baseEngineRoomTemperatureC = state.engineRoomTemperatureC
    state.baseExhaustWaterTemperatureC = state.exhaustWaterTemperatureC
    return state
  }

  function defaultTargetConfig() {
    return DEFAULT_TARGETS.map(([id, name, mmsi, callsign, grossTonnage, aisShipType, length, width, latitude, longitude, course, speed, legDuration, aisFromBow, aisFromCenter]) => ({
      id,
      enabled: true,
      autopilotEnabled: true,
      name,
      mmsi,
      callsign,
      grossTonnage,
      aisShipType,
      aisClass: grossTonnage > 300 ? 'A' : 'B',
      length,
      width,
      draft: Math.max(0.5, round(width * 0.18, 1)),
      destination: '',
      eta: '',
      imo: grossTonnage > 300 ? `IMO932${String(mmsi).slice(-4)}` : '',
      aisFromBow,
      aisFromCenter,
      startPosition: { latitude, longitude },
      initialCourseDeg: course,
      speedKn: speed,
      legDuration,
      emergencyMode: 'none',
      gpsFaultMode: 'normal'
    }))
  }

  function defaultFixedStationConfig() {
    return [
      {
        id: 'base-1',
        enabled: true,
        name: 'Craobh AIS Base',
        mmsi: '002350001',
        startPosition: { latitude: 56.211333, longitude: -5.559139 }
      },
      {
        id: 'base-2',
        enabled: true,
        name: 'Kilmelford AIS Base',
        mmsi: '002350002',
        startPosition: { latitude: 56.267286, longitude: -5.552714 }
      }
    ]
  }

  function initialTargets(config) {
    const moving = (config.targets || []).slice(0, 20).map((raw, index) => targetFromConfig(raw, index))
    const stations = (config.fixedStations || []).slice(0, 20).map((raw, index) => fixedStationFromConfig(raw, index))
    return [...moving, ...stations].filter(Boolean)
  }

  function targetFromConfig(raw = {}, index = 0) {
    const fallback = defaultTargetConfig()[index] || defaultTargetConfig()[0]
    const length = clamp(raw.length, 0, 500, fallback.length)
    const width = clamp(raw.width, 0, 100, fallback.width)
    const mmsi = String(raw.mmsi || fallback.mmsi || '').trim()
    if (!mmsi) return null
    const position = raw.startPosition || {}
    const latitude = clamp(position.latitude, -90, 90, fallback.startPosition.latitude)
    const longitude = clamp(position.longitude, -180, 180, fallback.startPosition.longitude)
    return {
      id: String(raw.id || fallback.id || mmsi),
      enabled: raw.enabled !== false,
      name: String(raw.name ?? fallback.name ?? ''),
      mmsi,
      callsign: String(raw.callsign ?? fallback.callsign ?? ''),
      grossTonnage: clamp(raw.grossTonnage, 0, 500000, fallback.grossTonnage || 0),
      aisShipType: Math.round(clamp(raw.aisShipType, 0, 99, fallback.aisShipType || 36)),
      aisClass: String(raw.aisClass || fallback.aisClass || ((Number(raw.grossTonnage || fallback.grossTonnage || 0) > 300) ? 'A' : 'B')).toUpperCase() === 'A' ? 'A' : 'B',
      length,
      width,
      draft: clamp(raw.draft, 0, 30, fallback.draft ?? Math.max(0.5, round(width * 0.18, 1))),
      destination: String(raw.destination ?? fallback.destination ?? ''),
      eta: String(raw.eta ?? fallback.eta ?? ''),
      imo: String(raw.imo ?? fallback.imo ?? ''),
      aisFromBow: clamp(raw.aisFromBow, 0, Math.max(0, length), fallback.aisFromBow ?? Math.max(0, round(length * 0.8, 1))),
      aisFromCenter: clamp(raw.aisFromCenter, -Math.max(0, width / 2), Math.max(0, width / 2), fallback.aisFromCenter ?? 0),
      latitude,
      longitude,
      courseDeg: normalizeDeg(raw.initialCourseDeg ?? raw.courseDeg ?? fallback.initialCourseDeg ?? 0),
      speedKn: clamp(raw.speedKn, 0, 40, fallback.speedKn ?? 0),
      legDuration: clamp(raw.legDuration, 10, 86400, fallback.legDuration ?? DEFAULT_LEG_SECONDS),
      autopilotEnabled: raw.autopilotEnabled !== false,
      routeTurning: false,
      routeTargetDeg: null,
      legStartMs: Date.now(),
      rudderAngleDeg: 0,
      rateOfTurnDegPerSecond: 0,
      emergencyMode: emergencyModeFor(raw.emergencyMode || fallback.emergencyMode || 'none'),
      gpsFaultMode: GPS_FAULT_MODES.includes(raw.gpsFaultMode) ? raw.gpsFaultMode : (fallback.gpsFaultMode || 'normal'),
      gpsSpoofOffsetM: 0,
      isFixedStation: false
    }
  }

  function fixedStationFromConfig(raw = {}, index = 0) {
    const fallback = defaultFixedStationConfig()[index] || defaultFixedStationConfig()[0]
    const mmsi = String(raw.mmsi || fallback.mmsi || '').trim()
    if (!mmsi) return null
    const position = raw.startPosition || {}
    const latitude = clamp(position.latitude, -90, 90, fallback.startPosition.latitude)
    const longitude = clamp(position.longitude, -180, 180, fallback.startPosition.longitude)
    return {
      id: String(raw.id || fallback.id || mmsi),
      name: String(raw.name ?? fallback.name ?? ''),
      mmsi,
      enabled: raw.enabled !== false,
      aisClass: 'BASE',
      isFixedStation: true,
      latitude,
      longitude,
      courseDeg: 0,
      speedKn: 0,
      length: 0,
      width: 0,
      aisShipType: 0,
      draft: 0,
      aisFromBow: 0,
      aisFromCenter: 0,
      autopilotEnabled: false,
      emergencyMode: 'none',
      gpsFaultMode: GPS_FAULT_MODES.includes(raw.gpsFaultMode) ? raw.gpsFaultMode : 'normal'
    }
  }

  function targetSchema() {
    return {
      type: 'object',
      title: 'AIS target',
      required: ['id', 'mmsi', 'startPosition'],
      properties: {
        id: { type: 'string', title: 'Internal id' },
        enabled: { type: 'boolean', title: 'Enabled', default: true },
        autopilotEnabled: { type: 'boolean', title: 'Autopilot enabled', default: true },
        name: { type: 'string', title: 'Vessel name' },
        mmsi: { type: 'string', title: 'MMSI' },
        callsign: { type: 'string', title: 'Call sign' },
        aisClass: { type: 'string', title: 'AIS class', enum: ['A', 'B'], default: 'B' },
        grossTonnage: { type: 'number', title: 'Gross tonnage', default: 12 },
        aisShipType: { type: 'number', title: 'AIS ship type id', default: 36 },
        length: { type: 'number', title: 'Length (m)', default: 10 },
        width: { type: 'number', title: 'Beam (m)', default: 3 },
        draft: { type: 'number', title: 'Draft (m)', default: 1 },
        aisFromBow: { type: 'number', title: 'AIS/GPS antenna from bow (m)', default: 8 },
        aisFromCenter: { type: 'number', title: 'AIS/GPS antenna from centreline (m)', default: 0 },
        destination: { type: 'string', title: 'Destination' },
        eta: { type: 'string', title: 'ETA' },
        imo: { type: 'string', title: 'IMO number' },
        startPosition: positionSchema('Start position'),
        initialCourseDeg: { type: 'number', title: 'Initial course over ground (deg true)', default: 90 },
        speedKn: { type: 'number', title: 'Speed over ground (kn)', default: 2 },
        legDuration: { type: 'number', title: 'Route leg seconds', default: DEFAULT_LEG_SECONDS },
        emergencyMode: { type: 'string', title: 'Startup emergency mode', enum: Object.keys(EMERGENCY_MODES), default: 'none' },
        gpsFaultMode: { type: 'string', title: 'GPS fault mode', enum: GPS_FAULT_MODES, default: 'normal' }
      }
    }
  }

  function fixedStationSchema() {
    return {
      type: 'object',
      title: 'Fixed AIS station',
      required: ['id', 'mmsi', 'startPosition'],
      properties: {
        id: { type: 'string', title: 'Internal id' },
        enabled: { type: 'boolean', title: 'Enabled', default: true },
        name: { type: 'string', title: 'Station name' },
        mmsi: { type: 'string', title: 'MMSI' },
        startPosition: positionSchema('Position')
      }
    }
  }

  function positionSchema(title) {
    return {
      type: 'object',
      title,
      required: ['latitude', 'longitude'],
      properties: {
        latitude: { type: 'number', title: 'Latitude', default: DEFAULT_BASE.latitude },
        longitude: { type: 'number', title: 'Longitude', default: DEFAULT_BASE.longitude }
      }
    }
  }

  function makeSchema() {
    return {
      title: 'AJRM Marine Simulator',
      type: 'object',
      properties: {
        outputEnabled: {
          type: 'boolean',
          title: 'Master simulation output',
          description: 'Leave OFF while sailing for real. When OFF no simulated Signal K deltas are published.',
          default: false
        },
        sourceName: { type: 'string', title: 'Signal K source name', default: 'ajrm-marine-simulator' },
        outputPeriod: { type: 'number', title: 'Simulation tick period (seconds)', default: DEFAULT_PERIOD_SECONDS },
        targetAutopilotEnabled: { type: 'boolean', title: 'Master AIS target autopilot routes', default: true },
        routeTurnRudderAngleDeg: { type: 'number', title: 'Route turn rudder angle', default: DEFAULT_ROUTE_RUDDER_DEG },
        own: {
          type: 'object',
          title: 'Own boat startup',
          properties: {
            startPosition: {
              type: 'object',
              title: 'Start position',
              properties: {
                latitude: { type: 'number', default: DEFAULT_BASE.latitude },
                longitude: { type: 'number', default: DEFAULT_BASE.longitude }
              },
              default: DEFAULT_BASE
            },
            initialHeadingDeg: { type: 'number', title: 'Initial heading', default: 90 },
            initialSpeedKn: { type: 'number', title: 'Initial speed knots', default: 0 },
            headingEnabled: { type: 'boolean', title: 'Publish own boat heading', default: true },
            autopilotEnabled: { type: 'boolean', title: 'Own boat autopilot enabled', default: false },
            legDuration: { type: 'number', title: 'Own boat route leg seconds', default: DEFAULT_LEG_SECONDS },
            gpsFaultMode: { type: 'string', title: 'Own boat GPS fault mode', enum: GPS_FAULT_MODES, default: 'normal' }
          }
        },
        environment: {
          type: 'object',
          title: 'Environment startup',
          properties: {
            depthM: { type: 'number', title: 'Depth below transducer', default: 8 },
            apparentWindSpeedKn: { type: 'number', title: 'Apparent wind speed', default: 12 },
            apparentWindAngleDeg: { type: 'number', title: 'Apparent wind angle', default: -90 },
            currentDriftKn: { type: 'number', title: 'Current/tide drift', default: 1.2 },
            currentSetDeg: { type: 'number', title: 'Current/tide set true', default: 270 },
            depthVarying: { type: 'boolean', title: 'Vary depth over time', default: true },
            windVarying: { type: 'boolean', title: 'Vary wind over time', default: true },
            currentVarying: { type: 'boolean', title: 'Vary current/tide over time', default: true }
          }
        },
        targets: {
          type: 'array',
          title: 'AIS targets',
          description: 'Moving simulated AIS vessels. Edit these to change the target fleet published by the simulator.',
          maxItems: 20,
          items: targetSchema(),
          default: defaultTargetConfig()
        },
        fixedStations: {
          type: 'array',
          title: 'Fixed AIS stations',
          description: 'Stationary AIS base stations published by the simulator.',
          maxItems: 20,
          items: fixedStationSchema(),
          default: defaultFixedStationConfig()
        }
      }
    }
  }
}

function gnssSatelliteState(mode, seconds) {
  const degraded = mode === 'degraded'
  const signal = degraded ? 0.42 + Math.sin(seconds / 9) * 0.08 : 0.86 + Math.sin(seconds / 14) * 0.05
  const used = degraded ? 4 : 13 + Math.round(Math.sin(seconds / 12) * 2)
  const inView = degraded ? 7 : 22 + Math.round(Math.sin(seconds / 18) * 3)
  return {
    hdop: degraded ? 5.5 + Math.abs(Math.sin(seconds / 8)) * 2 : 0.8 + Math.abs(Math.sin(seconds / 15)) * 0.4,
    vdop: degraded ? 8 : 1.3,
    pdop: degraded ? 9 : 1.7,
    used,
    inView,
    signalStrength: round(Math.max(0, Math.min(1, signal)), 2),
    constellations: CONSTELLATIONS.map((id, index) => ({
      id,
      satellitesInView: Math.max(0, Math.round(inView / CONSTELLATIONS.length + Math.sin(seconds / (8 + index)) * 2)),
      satellitesUsed: Math.max(0, Math.round(used / CONSTELLATIONS.length + Math.sin(seconds / (10 + index)))),
      signalStrength: round(Math.max(0, Math.min(1, signal - index * 0.03)), 2)
    }))
  }
}

function trueWindFromApparent({ apparentWindAngleDeg, apparentWindSpeedKn, courseDeg, speedKn }) {
  const courseRad = degToRad(normalizeDeg(courseDeg))
  const apparentFromRad = courseRad + degToRad(clamp(apparentWindAngleDeg, -180, 180, 0))
  const apparentSpeed = Math.max(0, Number(apparentWindSpeedKn) || 0) * KNOTS_TO_MPS
  const boatSpeed = Math.max(0, Number(speedKn) || 0) * KNOTS_TO_MPS
  const apparentNorth = -Math.cos(apparentFromRad) * apparentSpeed
  const apparentEast = -Math.sin(apparentFromRad) * apparentSpeed
  const boatNorth = Math.cos(courseRad) * boatSpeed
  const boatEast = Math.sin(courseRad) * boatSpeed
  const trueNorth = apparentNorth + boatNorth
  const trueEast = apparentEast + boatEast
  const speedTrue = Math.hypot(trueNorth, trueEast)
  const directionTrue = speedTrue > 0 ? Math.atan2(-trueEast, -trueNorth) : courseRad
  return {
    angleTrueGround: normalizeSignedRadians(directionTrue - courseRad),
    directionTrue: normalizeDeg(directionTrue * 180 / Math.PI),
    speedTrue
  }
}

function movePoint(latitude, longitude, courseDeg, distanceM) {
  const courseRad = degToRad(courseDeg)
  return offsetMeters(
    latitude,
    longitude,
    Math.cos(courseRad) * distanceM,
    Math.sin(courseRad) * distanceM
  )
}

function distanceMeters(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const lat1 = degToRad(fromLatitude)
  const lat2 = degToRad(toLatitude)
  const deltaLat = degToRad(toLatitude - fromLatitude)
  const deltaLon = degToRad(toLongitude - fromLongitude)
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function bearingDegrees(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const lat1 = degToRad(fromLatitude)
  const lat2 = degToRad(toLatitude)
  const deltaLon = degToRad(toLongitude - fromLongitude)
  const y = Math.sin(deltaLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
  return normalizeDeg(Math.atan2(y, x) * 180 / Math.PI)
}

function groundMotionForHeading({ headingDeg, speedThroughWaterKn, currentSetDeg, currentDriftKn }) {
  const heading = normalizeDeg(headingDeg)
  const headingRad = degToRad(heading)
  const stwMps = Math.max(0, Number(speedThroughWaterKn) || 0) * KNOTS_TO_MPS
  const currentMps = Math.max(0, Number(currentDriftKn) || 0) * KNOTS_TO_MPS
  const currentRad = degToRad(currentSetDeg)
  const north = Math.cos(headingRad) * stwMps + Math.cos(currentRad) * currentMps
  const east = Math.sin(headingRad) * stwMps + Math.sin(currentRad) * currentMps
  const speedOverGroundMps = Math.hypot(north, east)
  return {
    headingDeg: heading,
    courseDeg: speedOverGroundMps > 0 ? normalizeDeg(Math.atan2(east, north) * 180 / Math.PI) : heading,
    speedOverGroundMps
  }
}

function offsetMeters(latitude, longitude, northM, eastM) {
  const latitudeRad = degToRad(latitude)
  return {
    latitude: latitude + (northM / EARTH_RADIUS_M) * 180 / Math.PI,
    longitude: longitude + (eastM / (EARTH_RADIUS_M * Math.cos(latitudeRad))) * 180 / Math.PI
  }
}

function contextForTarget(target) {
  return `vessels.urn:mrn:imo:mmsi:${transmittedMmsi(target)}`
}

function emergencyModeFor(mode) {
  const id = String(mode || 'none').toLowerCase()
  return EMERGENCY_MODES[id] ? id : 'none'
}

function emergencyDefinition(target) {
  return EMERGENCY_MODES[target.emergencyMode] || EMERGENCY_MODES.none
}

function isEmergencyActive(target) {
  return emergencyDefinition(target).id !== 'none'
}

function transmittedMmsi(target) {
  const definition = emergencyDefinition(target)
  if (!definition.prefix) return target.mmsi
  return `${definition.prefix}${String(target.mmsi || '').replace(/\D/g, '').slice(-6).padStart(6, '0')}`
}

function transmittedName(target) {
  return emergencyDefinition(target).name || target.name || target.mmsi
}

function navigationState(target) {
  const definition = emergencyDefinition(target)
  if (definition.stateName) return { id: AIS_NAV_STATUS_ACTIVE_SART, name: definition.stateName }
  if (target.isFixedStation) return 'baseStation'
  return 'underWay'
}

function shortestAngleDelta(fromDeg, toDeg) {
  return ((toDeg - fromDeg + 540) % 360) - 180
}

function normalizeDeg(value) {
  let degrees = Number(value) % 360
  if (!Number.isFinite(degrees)) return 0
  if (degrees < 0) degrees += 360
  return degrees
}

function normalizeSignedRadians(radians) {
  let value = Number(radians) % (2 * Math.PI)
  if (value > Math.PI) value -= 2 * Math.PI
  if (value < -Math.PI) value += 2 * Math.PI
  return value
}

function degToRad(degrees) {
  return normalizeDeg(degrees) * Math.PI / 180
}

function rawDegToRad(degrees) {
  return Number(degrees) * Math.PI / 180
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clamp(value, min, max, fallback))
}

function round(value, decimals = 0) {
  const factor = 10 ** decimals
  return Math.round(Number(value) * factor) / factor
}

module.exports._test = {
  DEFAULT_BASE,
  GPS_FAULT_MODES,
  KNOTS_TO_MPS,
  gnssSatelliteState,
  groundMotionForHeading,
  movePoint,
  offsetMeters,
  trueWindFromApparent
}
