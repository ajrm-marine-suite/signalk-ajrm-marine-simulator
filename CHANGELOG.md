# Changelog

## 0.5.2

- Reset own-vessel and AIS-target autopilot leg timers when simulator output is enabled, so routes wait the configured leg duration from simulation start rather than Signal K startup.

## 0.5.1

- Expose moving AIS targets and fixed AIS stations as editable plugin configuration arrays.
- Build the simulated fleet from saved config at startup and publish static target identity data when output is enabled.

## 0.5.0

- Initial public beta release as AJRM Marine Simulator.
