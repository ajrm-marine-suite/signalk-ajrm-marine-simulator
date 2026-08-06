# Changelog

## 0.7.8

- Always place own vessel at the first GPX point when a route is loaded,
  including while simulator output is already active.
- Treat a GPX route as the required ground track and calculate a crabbing
  course-to-steer against simulated current, preventing environmental current
  from displacing deterministic route playback.

## 0.7.7

- Normalize the exact duplicated-route sequence produced by the legacy GPX
  importer, including already-persisted runtime routes, so Auto reverse turns
  onto the next waypoint instead of steering directly across the route.
- Show when this legacy route correction has been applied in the Simulator UI.

## 0.7.6

- Import one ordered GPX route or track instead of concatenating an OpenCPN
  waypoint catalogue with the same route points.
- Add an explicit default-off GPX route Auto reverse option for unattended soak
  testing. Normal route playback still stops with zero speed at the final point.

## 0.7.5

- Add headings to the target table for GPS fault simulation and AIS emergency
  identity mode.
- Show the vessel-only emergency identity selector as explicitly not applicable
  for SAR aircraft and AIS base stations instead of leaving it blank.
- Keep the SAR aircraft's internal emergency-mode state as the explicit `none`
  identifier.

## 0.7.4

- Migrate already-saved default `sim-1` through `sim-10` target names to the
  `SIM` prefix as well as applying it to fresh installations.

## 0.7.3

- Add an explicitly typed synthetic SAR helicopter using reserved test MMSI
  `111000599` and publish it with AIS SAR aircraft report PGN 129798.
- Prefix named default simulated vessels with `SIM` while retaining the
  deliberately unnamed target used to test missing static AIS data.
- Preserve the aircraft category through runtime state, allow realistic SAR
  speeds, and avoid publishing vessel-only static details or AIS A/B class.

## 0.7.2

- Correct the explicit subscriber-facing `$source` on simulated NMEA 2000
  updates as well as their gateway label, allowing Navigation Reference to
  recognise the configured `YDEN.4` compass source.

## 0.7.1

- Publish simulated NMEA 2000 updates under the captured `YDEN` gateway
  identity, including compass source `YDEN.4`, so Navigation Reference can use
  its explicitly configured physical-heading source during isolated home tests.
- Keep Simulator-only calculated values in the separate configured simulator
  namespace.

## 0.7.0

- Model the recurring raw YDEN capture shapes with separate NMEA 2000 source
  metadata and PGN-grouped updates for heading, rudder, STW, position,
  COG/SOG, GNSS quality, depth, wind, water temperature, engine-room
  temperature, autopilot state, and active-route projection.
- Publish structured `navigation.gnss.satellitesInView` data with satellite
  IDs, elevation, azimuth, and SNR, matching the captured PGN 129540 shape.
- Model AIS Class A, Class B, and base-station traffic using their distinct
  dynamic and static PGNs, including root MMSI fragments, Class A navigation
  state/special-manoeuvre fields, and `shore.basestations` contexts.
- Keep the one-second simulation loop instead of reproducing YDEN's frequent
  metadata-only empty updates, which carry no changed Signal K values.
- Publish GPX next-leg navigation using the captured PGN 129284 course
  projection paths.

## 0.6.1

- Publish simulated IMO registration numbers as canonical Signal K static
  vessel data, avoiding static/dynamic leaf collisions in Signal K.

## 0.5.26

- Clear GPS-derived current/tide set and drift when own-vessel GPS is lost or
  intermittent-off, while leaving heading, STW, wind, and depth available.

## 0.5.25

- Rename own-vessel Stationary mode in the web app to Docked / anchored and
  explain that Self steering at 0 kn is the mode for testing tide drift.
- Keep Self steering selected when the own-vessel speed is set to 0 kn, so a
  stopped boat can still drift in simulated current unless Docked / anchored is
  explicitly selected.

## 0.5.24

- Make the high-speed GPX route regression test drive the simulator clock
  explicitly so Windows CI does not depend on real timer scheduling.

## 0.5.23

- Clone repeated GPS fault-mode schema enums so the Signal K plugin CI schema
  validator sees a JSON-clean plugin configuration schema.

## 0.5.21

- Keep manually edited environment values stable while variation is enabled.
  Editing simulated depth now rebases the depth variation phase instead of
  producing alternating manual and varied depth samples.
- Avoid rebasing unrelated wind, tide, and temperature baselines when only one
  environment value is changed.

## 0.5.20

- Allow selecting GPX route mode before a GPX file has been loaded.
- Keep GPX route mode selected when changing route speed.
- Change own-vessel speed +/- controls from half-knot to one-knot steps while
  leaving numeric speed fields at 0.1-knot precision.

## 0.5.19

- Remove the manual `Update now` button from the simulator web app; automatic
  state refresh remains active.
- Make `Reset defaults` a normal-sized common control.
- Add coverage confirming own-vessel reset works from Stationary, Self
  steering, and GPX route modes.

## 0.5.18

- Split Own Vessel controls into Stationary, Self steering, and GPX route
  sub-modes so only relevant controls are visible.
- Replace GPX route playback text buttons with compact transport controls.
- Add a GPX route restart action that rewinds to the first point and resumes
  route playback.

## 0.5.17

- Rename the manual state refresh control to `Update now`.
- Replace AIS target left/right text buttons with left/right arrow controls.
- Replace environment variation enable/disable buttons with one checkbox-style
  control.

## 0.5.16

- Rework own-vessel control around explicit Stationary, Self steering, and
  Follow GPX route modes.
- Add GPX route Play, Pause, and Stop controls separate from the master Run
  simulator switch.
- Replace visible autopilot wording with auto-reverse wording, keeping
  compatibility routes and config keys internally.
- Show the remembered GPX route name in a dedicated selector field instead of
  relying on the browser file input display.

## 0.5.15

- Add a real simulated-environment enable switch; when disabled, simulated
  depth, wind, current, temperature, and electrical paths are cleared and own
  vessel no longer crabs in simulated current.
- Move the AIS target automatic-turns control into the AIS Vessels tab and
  label it as automatic turns.
- Put the simulator run control and Running/Stopped status above the tabs.
- Clarify own-vessel start and heading labels, and colocate GPS/GNSS controls.

## 0.5.14

- Reorganise the simulator web app into top-level AIS Vessels, Environment,
  and Own Vessel tabs.
- Add AIS target bulk enable/disable controls and environment variation
  enable/disable controls.

## 0.5.13

- Stabilise GPX route following at very high simulator speeds by breaking each
  tick into small steering steps, preventing own boat from overshooting a
  waypoint and turning back repeatedly.

## 0.5.12

- Raise own-boat simulator speed limit from 30 knots to 999 knots for
  deliberate fault and stress testing.

## 0.5.11

- Keep the selected GPX filename visible in the file chooser after loading.
- Make GPX route progress text larger and brighter, and avoid duplicating the
  filename in the progress line.

## 0.5.10

- Add GPX route loading to the simulator web UI for own-boat steering.
- Load GPX track, route, or waypoint points into the simulator, place own boat
  at the first point while output is off, and steer toward subsequent points
  when simulation output is running.
- Reduce simulator web page state polling from every 3 seconds to every 5
  seconds to lower access-log noise.

## 0.5.9

- Enable the simulator plugin by default after install while keeping master simulation output off after every startup.
- Use the configured own-boat start position by default, without requiring an extra enable flag.
- Add web controls for own-boat start latitude/longitude, with saved runtime settings and reset-to-defaults behaviour.

## 0.5.8

- Exclude test fixtures from the published package contents.

## 0.5.7

- Update public install command to the current release tag.

## 0.5.6

- Remove obsolete suite naming from package metadata and README text.

## 0.5.5

- Rename the default simulated Signal K source to `ajrm-marine-simulator`.

## 0.5.4

- Publish a final quiet own-vessel/environment sample when simulator output is stopped, so downstream apps do not keep reacting to stale simulated motion or tide.
- Clear simulated AIS target positions when simulator output is stopped, reducing lingering traffic alerts after a test run ends.

## 0.5.3

- Remember simulator web-control settings across Signal K restarts while still starting with master output off.
- Make Reset defaults clear saved runtime settings and restore the configured/default own boat, environment, and AIS target controls.

## 0.5.2

- Reset own-vessel and AIS-target auto-reverse leg timers when simulator output is enabled, so routes wait the configured leg duration from simulation start rather than Signal K startup.

## 0.5.1

- Expose moving AIS targets and fixed AIS stations as editable plugin configuration arrays.
- Build the simulated fleet from saved config at startup and publish static target identity data when output is enabled.

## 0.5.0

- Initial public beta release as AJRM Marine Simulator.
