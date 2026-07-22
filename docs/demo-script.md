# SENTINEL demo script

A narrated 5 minute walkthrough. Each beat is one line: what to click, then what to say. Practice the clicks once before presenting; the sim keeps running the whole time, so nothing here is a static screenshot.

## 0. Setup (before the audience is watching)

Open `index.html` (double click it, or load it from a browser). Confirm the globe renders and the console is otherwise untouched from a fresh boot.

## 1. Orbit intro (0:00-0:30)

- Beat: Let the globe sit for a moment, don't touch anything yet.
  Say: "This is SENTINEL, e&'s global command and control shell. Right now we're in orbital view, looking at the whole fleet footprint from space."
- Beat: Drag the globe left and right to show it rotates freely.
  Say: "It's a live 3D globe, not a static image, so you can find any theater of operations from orbit."
- Beat: Drag until the UAE beacon comes into view and point at it without clicking.
  Say: "Right now we operate one theater: the United Arab Emirates. 104 dock stations, grid online."

## 2. Dive (0:30-0:55)

- Beat: Click the UAE beacon.
  Say: "Clicking a theater triggers a continuous dive, no cut, straight from orbit down to the national view."
- Beat: Wait for the dive to land and the console chrome to fade in.
  Say: "And we're in. Topbar, dock list, national grid stats, all live."

## 3. Layers tour (0:55-1:25)

- Beat: Click DARK, then LIGHT in the layer switcher.
  Say: "Same live data, four base map styles. Dark is our default ops view."
- Beat: Click SATELLITE.
  Say: "Satellite for terrain context when a dock or route needs a real ground reference."
- Beat: Click TERRAIN, then click back to DARK.
  Say: "And terrain for elevation. All four switch instantly, nothing reloads."

## 4. Live network sites (1:25-1:55)

- Beat: Click the "Live network - 19 sites" panel in the sidebar.
  Say: "SENTINEL isn't a concept render. This is our real tower rollout: 13 sites already live, 4 planned, 2 flagged for replacement."
- Beat: Point to a green dot near a city cluster on the map.
  Say: "Each live tower is on the map now, feeding the same console you're looking at."

## 5. Dock card (1:55-2:20)

- Beat: Click any dock row in the "Dock network" list (or a dot on the map).
  Say: "Every dock has an identity: model, battery, current state. This one's ready, fully charged."
- Beat: Point at the LAUNCH MISSION and LOCATE buttons without clicking.
  Say: "From here an operator can dispatch it directly or just center the map on it."

## 6. Autonomous ops at 4x (2:20-2:55)

- Beat: Click the 4x button in the timescale switcher.
  Say: "Let's speed up time. At 4x you can watch the whole national grid work on its own."
- Beat: Point at the AIRBORNE counter in the topbar and the events ticker at the bottom.
  Say: "Fourteen drones airborne autonomously, patrol sweeps, infrastructure inspections, deliveries, all scheduling themselves. The ticker is the play by play."

## 7. Take control of a drone (2:55-3:30)

- Beat: Click an airborne drone triangle on the map (or a "flying" dock row).
  Say: "But this isn't a black box. Click any drone in flight and you get full telemetry: altitude, speed, heading, battery, distance home."
- Beat: Click TAKE CONTROL.
  Say: "TAKE CONTROL hands the stick to a human operator mid mission."
- Beat: Click a new point on the map.
  Say: "Click to fly. The drone breaks off its route and heads exactly where I point."
- Beat: Click RELEASE.
  Say: "Release it and it resumes exactly where it left off. Nothing lost."

## 8. Create an E311 highway mission (3:30-4:15)

- Beat: Click + NEW MISSION.
  Say: "Now let's stand up a new mission from scratch. Highway inspection along the E311."
- Beat: Click HIGHWAY INSPECTION, pick a launch dock near the corridor, click NEXT.
  Say: "Pick the mission type and the dock closest to the road."
- Beat: Click 5 or 6 points along the highway on the map to lay the route, then click NEXT.
  Say: "Point and click the corridor, waypoint by waypoint. Distance and duration estimate live as I go."
- Beat: Adjust altitude or speed if you like, then click LAUNCH.
  Say: "Confirm altitude and speed, and launch. That drone is airborne and inspecting the E311 right now."

## 9. Debrief and MEDIA (4:15-4:35)

- Beat: Speed to 16x and wait for the mission to land (or select a mission that already finished).
  Say: "When it lands, the debrief opens automatically: duration, distance, and mission specific analytics. This one's a highway sweep, so vehicles flagged and pavement defects."
- Beat: Click MEDIA in the topbar.
  Say: "Every mission's debrief lives in the media library too, so nothing gets lost once you move on."

## 10. Offline resilience (4:35-4:50)

- Beat: Turn off networking (devtools offline, or just say it), then point at the OFFLINE MODE chip if it appears.
  Say: "One more thing: if connectivity drops, SENTINEL doesn't go dark. The map falls back to baked vector data, the simulation keeps running, and it reconnects automatically the moment the network's back."

## 11. Return to orbit (4:50-5:00)

- Beat: Click GLOBE.
  Say: "And we're back in orbit, ready for the next theater. That's SENTINEL."
