# AJRM Marine Simulator

> **Alpha Release disclaimer:** This software is Alpha Release and must not be
> relied upon for navigation or safety.

Unified Signal K simulator for AJRM Marine/AJRM Marine testing.

This plugin replaces running `signalk-self-track-simulator` and
`signalk-vessel-simulator` at the same time. It uses one Signal K source,
`watchkeeper-simulator`, so simulated own-vessel values and simulated AIS
targets do not fight each other.

## Safety Switch

The simulator has a master **Start simulator output** switch. When output is
off, the web controls remain available but no simulated Signal K deltas are
published. Output always starts off after a plugin or Signal K restart, even if
it was enabled during the previous run.

Leave output off when sailing for real.

## Simulated Data

- Own-vessel position, heading, STW, derived COG/SOG, rudder, rate of turn, and
  state. Own-boat controls set heading and STW; cross tide/current makes COG
  and SOG differ so DR Plotter can exercise the navigation triangle and
  heading-based clock notation.
- Own-vessel route autopilot for unattended soak tests.
- GNSS quality with varying HDOP, VDOP, PDOP, satellites used/in-view, signal
  strength, and GPS/GLONASS/Galileo/BeiDou constellation summaries.
- GNSS fault modes: `normal`, `degraded`, `lost`, `jump`, `spoof`, and
  `intermittent`.
- Depth below transducer, transducer-to-keel, and below-keel depth.
- Apparent/true wind values with optional variation.
- Cross-current/tide set and drift with optional variation.
- Engine room temperature, exhaust water temperature, and basic battery values.
- AIS target vessels, fixed AIS stations, target autopilot routes, emergency
  identities, per-target GPS fault modes, and manual target controls.

## DR Testing

Version `0.1.10` pauses internal own-boat, environment, and target movement
while **Start simulator output** is off. After a Signal K restart the simulator
therefore remains at the active configured/default start position until output
is deliberately enabled.

Version `0.1.9` starts own boat at the Craobh default unless a configured start
position is explicitly enabled. The Reset button/API route returns own boat to
the active configured/default start position during testing.

Version `0.1.8` treats own-vessel GPS loss as loss of GPS-derived position,
SOG, and COG. It still publishes heading, STW, current/tide, wind, and depth so
DR Plotter can test dead reckoning without other apps seeing pseudo-GPS
movement.

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
npm install git+ssh://git@ssh.github.com:443/ajrm-marine-suite/signalk-ajrm-marine-simulator.git#v0.5.1 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Disable the old self-track and vessel simulators before enabling this one.


## Public Beta

Own-vessel, environment, GNSS, and AIS target simulator for AJRM Marine Suite testing.

Development assistance: OpenAI Codex helped with code generation, refactoring, and automated testing during the beta development cycle.
