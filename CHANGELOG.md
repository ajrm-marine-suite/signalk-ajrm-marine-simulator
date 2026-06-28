# Changelog

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
