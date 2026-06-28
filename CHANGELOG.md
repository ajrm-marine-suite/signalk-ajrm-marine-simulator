# Changelog

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

- Reset own-vessel and AIS-target autopilot leg timers when simulator output is enabled, so routes wait the configured leg duration from simulation start rather than Signal K startup.

## 0.5.1

- Expose moving AIS targets and fixed AIS stations as editable plugin configuration arrays.
- Build the simulated fleet from saved config at startup and publish static target identity data when output is enabled.

## 0.5.0

- Initial public beta release as AJRM Marine Simulator.
