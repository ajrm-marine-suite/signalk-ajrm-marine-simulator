const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')

test('web app exposes master output and own GPS fault controls', () => {
  assert.match(html, /id="outputEnabled"/)
  assert.match(html, /Start simulator output/)
  assert.match(html, /id="ownGpsFault"/)
  assert.match(html, /id="ownHeadingEnabled"/)
  assert.match(html, /id="resetOwn"/)
  assert.match(html, /Publish heading/)
  assert.match(html, /Lost\/Intermittent for DR testing/)
})

test('web app exposes own boat start position controls', () => {
  assert.match(html, /Own Boat Start/)
  assert.match(html, /id="startLatitude"/)
  assert.match(html, /id="startLongitude"/)
  assert.match(html, /id="saveStartPosition"/)
  assert.match(html, /id="useCurrentStart"/)
  assert.match(html, /\/own\/start-position/)
})

test('web app exposes GPX route loading controls', () => {
  assert.match(html, /GPX Route/)
  assert.match(html, /id="gpxFile"/)
  assert.match(html, /id="clearGpxRoute"/)
  assert.match(html, /route-status/)
  assert.match(html, /parseGpxPoints/)
  assert.match(html, /\/own\/gpx-route/)
  assert.match(html, /setInterval\(refresh, 5000\)/)
  assert.doesNotMatch(html, /gpxFile\.value = ""/)
})

test('web app keeps target actions and toggles in separate columns', () => {
  assert.match(html, /grid-template-columns: minmax\(160px, 1fr\) 78px 76px 132px 116px 152px 58px/)
  assert.match(html, /\.target-actions[\s\S]*grid-template-columns: repeat\(4, 34px\)/)
  assert.match(html, /toggles\.className = "target-toggles"/)
})

test('web app controls environment variation', () => {
  assert.match(html, /id="depthVarying"/)
  assert.match(html, /id="windVarying"/)
  assert.match(html, /id="currentVarying"/)
})

test('web app wires keyboard arrows to own boat controls', () => {
  assert.match(html, /document\.addEventListener\("keydown", handleKeyboardControls\)/)
  assert.match(html, /event\.key === "ArrowLeft"[\s\S]*\/own\/heading[\s\S]*direction: "left"/)
  assert.match(html, /event\.key === "ArrowRight"[\s\S]*\/own\/heading[\s\S]*direction: "right"/)
  assert.match(html, /event\.key === "ArrowDown"[\s\S]*\/own\/speed[\s\S]*direction: "down"/)
  assert.match(html, /event\.key === "ArrowUp"[\s\S]*\/own\/speed[\s\S]*direction: "up"/)
})
