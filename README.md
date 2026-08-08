# AJRM Marine Simulator

> **Public Beta disclaimer:** This software is a public beta and must not be
> relied upon for navigation or safety.

Unified Signal K simulator for AJRM Marine Suite testing.

Version `0.8.0` is the reviewed Signal K baseline. It protects every control
route with Signal K write access, documents the HTTP API with OpenAPI, and
publishes a retained `plugins.ajrmMarineSimulator` lifecycle contract for
Console/BITE. Stopping the plugin now emits a final quiet snapshot and retracts
the lifecycle projection.

This plugin combines own-vessel, environment, GNSS, fixed-station, and moving
AIS target simulation in one coordinated model. Simulator-only calculated
values use the `ajrm-marine-simulator` namespace. Separate simulated NMEA 2000
devices and PGN-shaped updates resemble data from a normal physical gateway.
They use the unmistakably synthetic `AJRM-SIM-N2K` identity (for example
compass source `AJRM-SIM-N2K.4`) so tests cannot be mistaken for a particular
manufacturer's interface. Run the simulator only in an isolated test
environment, not while real navigation inputs are in operational use.

## Safety Switch

The simulator has a master **Run simulator** switch. When output is
off, the web controls remain available but no simulated Signal K deltas are
published. Output always starts off after a plugin or Signal K restart, even if
it was enabled during the previous run.

The plugin is enabled by default after install, but simulation output remains
off until the skipper deliberately starts it. Web-control settings such as own
boat start position, heading/STW, GNSS fault mode, environment values, target
switches, and target fault modes are remembered across Signal K restarts. Use
**Reset defaults** to clear those saved runtime settings and return to the
configured/default simulator setup.

Leave output off when sailing for real.

## Simulated Data

- Own-vessel position, heading, STW, derived COG/SOG, rudder, rate of turn, and
  state. Own-boat controls set heading and STW; cross tide/current makes COG
  and SOG differ so DR Plotter can exercise the navigation triangle and
  heading-based clock notation.
- Own-vessel motion modes: stationary, self steering to a set heading/STW, and
  GPX route following while retaining simulated AIS targets and environment
  data.
- GPX route following has its own Play, Pause, and Stop controls separate from
  the master Run simulator switch. It stops with zero speed at the final point
  by default; the explicit Auto reverse option continuously traverses the route
  in both directions for unattended soak testing.
- An explicit AJRM Marine Traffic Anchored profile holds the simulated position
  against tide while commanded STW is zero. A positive speed command permits
  movement while chain is being paid out.
- GPX route following holds the route line only while the commanded STW can
  overcome the simulated current. If that ground track is physically
  impossible, the boat moves with the resulting ground vector instead of being
  artificially frozen. **Docked / anchored** also provides a fixed-position
  simulator-only mode; increasing speed from that mode resumes self steering.
- Own-vessel auto-reverse heading tests for unattended soak tests.
- GNSS quality with varying HDOP, VDOP, PDOP, satellites used/in-view, signal
  strength, and GPS/GLONASS/Galileo/BeiDou constellation summaries. The
  satellites-in-view value includes the captured count/satellite object shape
  with satellite ID, elevation, azimuth, and SNR.
- GNSS fault modes: `normal`, `degraded`, `lost`, `jump`, `spoof`, and
  `intermittent`.
- Depth below transducer, transducer-to-keel, and below-keel depth.
- Apparent/true wind values with optional variation.
- Cross-current/tide set and drift with optional variation.
- Engine room temperature, exhaust water temperature, and basic battery values.
- AIS target vessels, a synthetic SAR helicopter, fixed AIS stations, target
  auto-reverse routes, and emergency/GNSS fault modes. Default vessel names use
  the `SIM` prefix; the deliberately unnamed AIS target remains available for
  missing-static-data tests.
- The AIS target table separates GPS signal fault simulation from vessel-only
  AIS emergency identity modes (Normal, AIS-SART, MOB-AIS, and EPIRB-AIS). The
  emergency identity mode is not applicable to SAR aircraft or base stations.
- Representative NMEA 2000 grouping for the principal
  navigation, instrument, GNSS, autopilot, route, AIS Class A, AIS Class B,
  and AIS base-station PGNs. The simulator intentionally does not publish
  high-rate empty updates because they contain no changed values.

## DR Testing

While **Run simulator** is off, own-boat, environment, and target movement is
paused. GPX route loading places own boat at the first point and route playback
follows the displayed ground track while heading crabs into simulated current.
The final quiet sample sets movement to zero, clears simulated environmental
measurements and removes target positions so downstream plugins do not retain
stale test data.

Use Own GPS mode:

- `lost`: publishes `navigation.position`, `navigation.speedOverGround`, and
  `navigation.courseOverGroundTrue` as `null`.
- `intermittent`: alternates between available and unavailable GPS.
- `jump`: offsets the reported GPS position.
- `spoof`: walks the reported GPS position away over time.

These modes are intended to exercise GPS Integrity and DR Plotter.

## Install on a Raspberry Pi

```sh
cd ~/.signalk
npm install git+https://github.com/ajrm-marine-suite/signalk-ajrm-marine-simulator.git#v0.8.3 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Disable the old self-track and vessel simulators before enabling this one.

The v0.8.0 runtime-settings format deliberately drops the obsolete duplicated
GPX-route repair. Settings saved by older versions are ignored once; configure
or adjust a control to write a clean v2 settings file. Re-import an original
GPX file rather than relying on a route produced by the retired importer.


## Public Beta

Own-vessel, environment, GNSS, and AIS target simulator for AJRM Marine Suite testing.

Development assistance: OpenAI Codex helped with code generation, refactoring, and automated testing during the beta development cycle.
## License and commercial use

This software is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). You may use, study, share, and modify it under that licence. If you modify it and make it available to users over a network, the corresponding source code must also be made available under the AGPL.

Commercial licensing is available by arrangement for organisations that want different terms.
