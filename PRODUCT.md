# PRODUCT.md

## Product

**e& UAE Drone Operations Console** ("Physical Intelligence"). A high-fidelity simulated command & control system for a nationwide fleet of DJI dock-based drones across the UAE, modeled on DJI FlightHub 2 but visibly better. It is a demo/sales-grade simulation: everything is simulated data, but it must read as a real, live, national-scale C2 system.

## Register

product

## Users

- e& leadership, government clients, and partners watching a live demo on a large screen (projector or 4K display, often in a bright meeting room, sometimes dim).
- The presenter (Danijel) driving it: clicks docks, takes control of drones, creates missions point-and-click, plays AI-generated mission videos.

## Core capabilities

- ~100 dock stations across all 7 emirates (Abu Dhabi, Dubai, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah), each hosting DJI drones.
- Live simulated missions across 7 mission types: security & surveillance patrol, infrastructure inspection, emergency/first response, delivery & logistics, construction monitoring & mapping, highway inspection, parks vegetation inspection (plant health, plant count).
- Monochromatic map (Leaflet) with switchable layers: dark mono, light mono, satellite, terrain + offline stylized fallback.
- Take manual control of individual drones; point-and-click waypoint mission creation on the map.
- Every completed mission produces an "AI mission video" (pre-generated via Higgsfield) with analytics overlays; console plays the matching video per mission type.

## Brand

- e& corporate identity: red #BC0000 (hot variant #ff5a5a on dark), deep navy #141D2D, Poppins (display, 700/800) + Nunito Sans (body). Existing deck uses uppercase kickers with wide letter-spacing.
- Status colors must NOT overload brand red: red is brand + alert only.

## Tone

Sovereign, precise, operational. "National grid" seriousness, not gamer HUD. Modern and minimalistic; generous restraint; data-dense where it counts.

## Anti-references

- Generic sci-fi/gamer HUD slop (scanlines, glows everywhere, fake hex grids).
- SaaS dashboard cream/gradient template look.
- The existing embedded sim (reference/embedded_sim.html) is the baseline to clearly beat, not copy.

## Strategic principles

- Must feel alive at all times: drones moving, telemetry ticking, events streaming.
- Every interaction the presenter does must look effortless and cinematic on a big screen.
- Deliverable: folder with index.html + assets/ + videos/, double-click to run, works offline via fallback map.
