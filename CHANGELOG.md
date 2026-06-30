# Changelog

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
