# Changelog

## 0.6.3 — 2026-03-28

- **Dependencies** (`client/package-lock.json`): Added `react-icons` package for UI icons.
- **Node firmware**: Flashed node-002 as a second independent sensor node.

## 0.6.2 — 2026-03-28

- **Client — auto-detect base station** (`ControlPage.tsx`): Removed manual station selector from Turret tab. Base station at `192.168.4.1` is now auto-detected on load (same as nodes). Shows Online/Offline badge and pings on mount. Controls appear automatically when online.

## 0.6.1 — 2026-03-28

- **Node firmware** (`firmware/node/src/main.cpp`): Calibrated for capacitive-style LM393 sensor at 3.3V.
  - AO pin: **D32 (GPIO32)** — ADC1, compatible with WiFi/ESP-NOW.
  - Calibration: `DRY_RAW=4095` (in air), `WET_RAW=3000` (in water ~1700-2700).
  - Switched from deep sleep to **continuous loop** — sensor stays powered for stable readings.
  - `soil_wet` now derived from AO percentage (≥50% = wet) instead of unreliable DO pin.
  - 2s warm-up delay on start + 16-sample averaging for noise reduction.

## 0.6.0 — 2026-03-28

- **Node firmware** (`firmware/node/src/main.cpp`): Switched back to **broadcast ESP-NOW** — more reliable when the base runs SoftAP (no unicast ACK issues). Sleep restored to 30 s.
- **Client — auto-discovery** (`ControlPage.tsx`): `NodeReadingsPanel` is now always visible on the Turret tab, even with no station configured. It auto-polls `192.168.4.1/api/nodes` by default. Turret controls (E-Stop, Aim, Stepper, Servo, Pump) still require a station to be selected.

## 0.5.9 — 2026-03-28

- **Node firmware** (`firmware/node/`): Added `platformio.ini` and moved source to `src/main.cpp` (PlatformIO layout). Switched from broadcast to **unicast ESP-NOW**, targeting the base station's STA MAC (`A4:F0:0F:91:2A:E4`) for reliable delivery.
- **Base station firmware** (`firmware/turret_station/src/main.cpp`): Fixed ESP-NOW receive callback — removed `IRAM_ATTR` and replaced `portENTER/EXIT_CRITICAL_ISR` with `portENTER/EXIT_CRITICAL` (callback runs in WiFi task context, not an ISR). Added STA/AP MAC address debug prints on boot.
- **Repository:** Migrated to **CircaOrg** GitHub organization.

## 0.5.8 — 2026-03-28

- **Sensor node firmware** (`firmware/node/node.ino`): Complete rewrite using **ESP-NOW** instead of MQTT. Each node wakes, reads the soil moisture sensor (GPIO 18 = DO digital threshold, GPIO 34 = AO analog), sends a `NodePacket` to the base station via ESP-NOW broadcast, then deep-sleeps for 30 s. No WiFi connection required — transmits on the SoftAP's channel (1). ⚠ AO wire must be on **GPIO 34**, not GPIO 19 (which is not ADC-capable).
- **Base station firmware** (`firmware/turret_station/src/main.cpp`): Added ESP-NOW receiver alongside the existing SoftAP + HTTP server. Receives `NodePacket` structs from any nearby node, stores latest reading per MAC (up to 16 nodes). New `GET /api/nodes` HTTP endpoint returns all stored readings as JSON with `id`, `mac`, `soil_pct`, `soil_wet`, `last_seen_s`.
- **Client — Node Readings Panel** (`ControlPage.tsx`): `TurretApiClient` gains `fetchNodes()` method. New `NodeReadingsPanel` component in the Turret tab polls `/api/nodes` every 35 s (auto) and shows a card per node with moisture bar, percentage, WET/DRY badge, and last-seen time.

## 0.5.7 — 2026-03-28

- **Repository:** Root `.gitignore` added (`node_modules`, PlatformIO `.pio`, build outputs, local env files, `server/data/stations.json`). Prepares the tree for a clean public GitHub push.

## 0.5.6 — 2026-03-28

- **Supabase fully removed.** The project never had a Supabase project and never will.
  - Deleted `server/supabase.js` and uninstalled `@supabase/supabase-js` from the server.
  - Removed the Supabase `persistReading` call from `server/mqtt.js` — sensor data is forwarded to Socket.IO only.
  - Deleted `client/src/lib/supabase.ts` and uninstalled `@supabase/supabase-js` from the client.
  - Removed auth gate from `App.tsx` — app opens directly to dashboard, no login required.
  - Deleted `AuthPage.tsx` and `AuthPage.css` (no longer needed).

## 0.5.5 — 2026-03-28

- **Persistent stations & nodes:** `useFieldStore` now uses Zustand `persist` middleware (localStorage key `circa-field-store`). Base stations and nodes survive page refreshes. `online` status is reset to `false` on rehydration so it correctly updates once live sensor data arrives.
- **Local server storage:** `server/routes/stations.js` rewritten to store all station/node data in `server/data/stations.json` instead of Supabase. `POST`/`DELETE` endpoints work without any external database.
- **Delete devices:** Device list in the Configure page now shows all registered stations and nodes with a ✕ remove button each. Deleting a station also removes its nodes from both client state and server storage.
- **Empty state hint:** Configure → Devices now shows a prompt to add a device when no devices are registered yet.

## 0.5.4 — 2026-03-28

- **Always-direct mode:** Removed the Proxy/Direct toggle from the TurretTab — the client now always calls the ESP32 at its hardware URL directly (CORS headers already present in firmware). Connect your Mac to the `Turret-ESP32` Wi-Fi, open the site, done. No server proxy, no toggle, no switching.

## 0.5.3 — 2026-03-28

- **Direct connection mode:** Solves the problem of needing to switch Wi-Fi between controlling the turret and using the internet (eduroam).
  - **ESP32 firmware** reflashed with CORS headers (`Access-Control-Allow-Origin: *`) on every response and OPTIONS preflight handlers on all routes. The phone browser can now call `http://192.168.4.1/api/...` directly without any server in the middle.
  - **`turretApi.ts`**: `TurretApiClient` gains a `direct` constructor parameter. When `true`, calls are made directly to the ESP32 URL; when `false` (default), they route through the Mac server proxy as before.
  - **TurretTab UI**: connection card now shows a **Proxy / Direct** toggle pill. Switch to Direct when using the phone on `Turret-ESP32` Wi-Fi; keep Proxy when using the Mac browser on eduroam.

## 0.5.2 — 2026-03-28

- **Turret controls expanded:** `TurretTab` rebuilt with richer hardware controls.
  - **Joystick pad**: draggable circular control replaces X/Y sliders in the Aim panel. Pointer capture keeps tracking after moving outside the pad.
  - **Live mode**: toggle on the Aim panel — when active, aim commands are throttled and sent to the ESP32 every 150 ms as you drag.
  - **Fire button**: aims at the current joystick position then activates the pump for a configurable spray duration (1–60 s) in one tap.
  - **Emergency Stop**: prominent red bar at the top of the controls — calls `stopStepper()` + `pumpOff()` in parallel.
  - **Servo presets**: Near (130°) / Home (90°) / Far (45°) quick-set buttons.
  - **Speed presets**: Slow (100) / Med (350) / Fast (800) buttons in Stepper and Aim panels.
  - Aim panel is now the first panel shown after connection (primary control surface).
  - `api` instance stabilised with `useMemo` to prevent stale-callback ping issues.

## 0.5.1 — 2026-03-28

- **Turret station firmware** (`firmware/turret_station/`): New PlatformIO project replacing the old MQTT-based `base_station.ino`. Runs as a Wi-Fi SoftAP (`Turret-ESP32`, IP `192.168.4.1`), serves an HTTP API on port 80. Implements all endpoints the client expects: `/api/servo`, `/api/stepper/start`, `/api/stepper/jog`, `/api/stepper/stop`, `/api/aim`, `/api/pump/on`, `/api/pump/off`. Non-blocking stepper pulse generation in the main loop; shortest-path yaw tracking; timed pump auto-off; brownout detector disabled. Flashed to ESP32 Dev Module via `esptool` at `/dev/cu.usbserial-0001`.

## 0.5.0 — 2026-03-28

- **Hardware client integration:** Connected the React client to the ESP32 base station's direct HTTP API.
- **`client/src/lib/hardwareStore.ts`** (new): Persisted Zustand store (localStorage, key `circa-hardware-urls`) mapping station IDs to their ESP32 hardware URLs. Defaults to `http://192.168.4.1` (ESP32 SoftAP address).
- **`client/src/lib/turretApi.ts`** (new): `TurretApiClient` class wrapping all ESP32 HTTP endpoints (`/api/servo`, `/api/stepper/start`, `/api/stepper/jog`, `/api/stepper/stop`, `/api/aim`, `/api/pump/on`, `/api/pump/off`). Routes through the server proxy to avoid CORS. Exports hardware constants (`STEPS_PER_REV`, `SPEED_MIN/MAX/DEFAULT`, `SERVO_HOME/NEAR/FAR`, `PUMP_MAX_MS`).
- **`server/routes/control.js`**: Added `GET /api/control/hardware/proxy?target=<url>` — a safe dumb proxy that forwards fetch requests to any `http/https` target URL (with 5 s timeout). Lets the browser call the ESP32 without CORS restrictions.
- **`client/src/pages/ConfigurePage.tsx`**: Added optional "Hardware URL" input (placeholder `http://192.168.4.1`) in the station form. On save, writes to `hardwareStore` — purely local, no server POST needed.
- **`client/src/pages/ControlPage.tsx`**: Rebuilt `TurretTab` as a full hardware control panel with four sections — **Stepper** (speed slider, CW/CCW continuous, Jog N steps, Stop), **Servo** (angle slider + Home button), **Aim** (X/Y joystick sliders + speed + Send Aim), **Pump** (On/Off + timed spray up to 60 s). Connection row shows hardware URL and live ping status badge. All actions show in-flight spinners and success/error result lines.

## 0.4.37 — 2026-03-28

- **Dashboard layout — 70/30 split + bottom margin:** 3D field panel widened to `flex: 0 0 70%`, info panel takes the remaining `30%`. Dashboard height reduced by `24px` with a matching `margin-bottom` so the view doesn't bleed to the very bottom of the viewport.

## 0.4.36 — 2026-03-28

- **Dashboard 3D view — 55 % width + device inspector:** Expanded the 3D field panel from `260px` to `flex: 0 0 55%` so it occupies just over half the screen. The right panel is now a **device info panel**: when nothing is selected it shows the full device list (clicking a row also selects); when a device is clicked on the 3D map (or in the list) the panel switches to a rich **inspector** showing type badge, name, ID, online status, sensor readings with a moisture bar, config fields (crop type, turret reach / irrigation radius, parent station), and field position — with an **×** to dismiss back to the list. `Field3DView` gains `onSelect` / `selectedId` props; clicked markers render a white **selection ring** and the cursor changes to `pointer` on hover.

## 0.4.35 — 2026-03-28

- **Dashboard 3D view — compact + pannable:** Shrunk the 3D field panel from `flex: 1` (dominant) to a fixed `260px` column; the devices list now fills the remaining space. Reduced `Field3DView` `min-height` from `320px` to `180px`. Remapped left-click drag to pan (`THREE.MOUSE.PAN`) in `OrbitControls` so users can pan by dragging instead of requiring right-click. Updated hint text to "Drag to pan · Scroll to zoom".

## 0.4.34 — 2026-03-28

- **Turret reach — square indicator:** Replaced the circular `ringGeometry` in `TurretRangeRing` with a square frame built from `THREE.ShapeGeometry` (outer square with an inner square hole). Same blue colour, opacity, and border thickness as before.

## 0.4.33 — 2026-03-28

- **Configure Devices map — pan only:** Added `disableZoom` prop to `FieldCanvas` (passed through to `OrbitControls`). The Devices tab map now only allows panning; scroll-to-zoom is disabled.

## 0.4.32 — 2026-03-28

- **`FieldCanvas` — `fitView` prop:** Added a `CameraAutoFit` component inside `FieldCanvas` (modelled on `FieldShapeEditor`'s `EditorCameraFit`). When `fitView={true}`, uses `useThree()` to read the actual canvas pixel size and sets the orthographic frustum in meters so the full field polygon is always visible on mount and on canvas resize. Used on the Configure Devices tab. The existing `orthoZoom`-based camera is unchanged for all other usages.

## 0.4.31 — 2026-03-28

- **Configure devices map — correct zoom:** Replicated the exact CSS structure from `FieldPage` (`flex: 1; min-height: 0` on the direct `> .field-canvas-container` child) so the canvas gets a definite pixel size from the first paint. Switched panel class from `.card` wrapper to a plain `.configure-devices-body` with explicit `border` / `border-radius`. Height calc updated to `calc(100vh - 120px)` (topbar + page padding + tab rail) matching the field page approach.

## 0.4.30 — 2026-03-28

- **Configure devices map — visible fix:** Switched Devices tab `FieldCanvas` from `variant="preview"` (aspect-ratio 1:1, capped at 360 px) to `variant="full"` so the canvas fills the map column properly. Panel height uses `calc(100dvh - 152px)` instead of the previous `100vh` calc so the map takes up the correct viewport height.

## 0.4.29 — 2026-03-28

- **Configure — tab rework:** The Configure page is now split into two tabs — **Field Configuration** (the boundary polygon editor, unchanged) and **Devices** (the field map + device list).
- **Inline add-device flow:** Removed the multi-step modal entirely. Clicking **⊕ Add Device** in the Devices tab slides in an inline side-panel form (type toggle, ID, name, crop, parent station). The FieldCanvas enters pick-position mode; clicking the map sets the device position. Saving commits the device and returns to the device list.
- **No repositioning on Configure:** The "select a row then click map to reposition" flow is removed from the Devices tab. The map is view-only when not in add mode.

## 0.4.28 — 2026-03-28

- **Keep configured field shape for placement:** when persisted vertices are messy (duplicate points, bad closure, non-simple path), `FieldCanvas` now cleans finite points and, if needed, renders a **convex hull fallback of the user’s points** instead of jumping straight to the default square. Device placement still uses the current field shape footprint.

## 0.4.27 — 2026-03-28

- **Field map reliability:** `FieldCanvas` now sanitizes persisted field vertices before rendering. If saved geometry is invalid (non-finite points, fewer than 3 corners, or self-intersecting), it falls back to `DEFAULT_FIELD_POLYGON` so the map always renders instead of going blank.

## 0.4.26 — 2026-03-28

- **Field map visibility:** Preview **`FieldCanvas`** no longer relies on **`height: 100%`** (it often resolved to **0×0** when parents only had `min-height` / flex). Preview now uses **`aspect-ratio: 1 / 1`** plus caps, modal picker keeps a **fixed height**, and **Dashboard / Configure / Field** wrappers use **flex column** rules so the WebGL layer always gets a real size.

## 0.4.25 — 2026-03-28

- **Field map:** Removed the **“no devices on the field”** overlay from **`FieldCanvas`**. The plot preview always shows the field (grid, boundary, markers when present); emptiness is unrelated to whether the map is shown. Removed **`showEmptyConfigureLink`**, **`hideEmptyOverlay`**, and **`.field-empty`** styles.

## 0.4.24 — 2026-03-28

- **Add device map:** **`hideEmptyOverlay`** on **`FieldCanvas`** hid the empty-device sheet in the in-modal preview. **Superseded by 0.4.25** (overlay removed everywhere).

## 0.4.23 — 2026-03-28

- **Add device — visible map:** Details and confirm now include an **embedded field preview** inside the dialog (labeled *Placement on field*) so position is chosen by **clicking that 3D view**, not a hidden map or “click through” the overlay. **`FieldCanvas`** adds **`groundPickOnly`**: existing-device markers and reach rings **ignore raycasts** so every click targets the soil.

## 0.4.22 — 2026-03-28

- **Add device → map position:** Details and confirm steps use **map clicks** for `field_x` / `field_y` (no manual X/Y inputs). **`FieldCanvas`** accepts **`onMapPositionPick`** for normalized ground picks. (Superseded by **0.4.23** in-modal preview for clearer UI.)

## 0.4.21 — 2026-03-28

- **Configure — placement:** Removed the **“Place devices on field”** checkbox; list selection + map click is always the flow. Empty field copy on this page points to **Add device** above instead of linking to Configure.

## 0.4.20 — 2026-03-28

- **Configure — device placement layout:** **“Place devices on the field”** uses a **map + device list** layout with toolbar, responsive stack on narrow viewports, and shared styling with the rest of Configure (section header, borders, hints).

## 0.4.19 — 2026-03-28

- **Configure field + devices:** **“Place devices on field”** mode (not on Dashboard) — pick a **base** or **node** in the list, then **click the map** to set `field_x` / `field_y`. Positions merge from **`circa-device-field-positions`** (localStorage) over live/API data for the preview until a future API sync exists.
- **Coverage overlays on the map:** each **node** shows a **green** irrigation disk (**`DEFAULT_NODE_IRRIGATION_RADIUS_M` = 12 m**, override with `irrigation_radius_m` on the entity). Each **base** shows a **blue** turret **reach ring** (**`DEFAULT_TURRET_THROW_RADIUS_M` = 28 m**, override with `turret_range_m`). Lets you line up turret azimuth/range with targets visually.
- **`normalizedFromFieldPoint`** in `fieldShape.ts` for ground-hit → normalized coords. Types extended on **`BaseStation`** / **`Node`** for optional radius fields.

## 0.4.18 — 2026-03-28

- **Field pattern:** Single **uniform** grid lines only — removed **major / minor** (thick vs thin) so every line uses the same weight in **Configure** and **FieldCanvas**.

## 0.4.17 — 2026-03-28

- **Field pattern:** **`FIELD_GRID_CELL_METERS`** increased from **5 m** to **10 m** so the cross-hatch reads **less dense** (major lines every **40 m**).

## 0.4.16 — 2026-03-28

- **Field pattern:** Shared **`FIELD_GRID_CELL_METERS` (5 m)** cross-hatch with **minor + major** lines in **world XZ**. **Configure** extruded mesh uses a **shader** (reliable on the cap); **`FieldCanvas`** ground uses the same grid plus a very subtle motion shimmer. Pattern stays aligned with real meters on any outline.

## 0.4.15 — 2026-03-28

- **Field editor:** Each boundary edge shows a **billboard label** at its midpoint (**`1→2`** style, matching the sidebar edge list). Label meshes **ignore raycasts** so **edge split ribbons** stay easy to click.

## 0.4.14 — 2026-03-28

- **Field editor:** Corner **Quick tips** panel can be **hidden** or **shown** with a **Hide / Show** control; preference is stored in **`localStorage`** (`circa-field-shape-steps-minimized`).

## 0.4.13 — 2026-03-28

- **Field editor:** **Edge lengths are editable** in the “Edge lengths & split” list — number inputs commit on **Enter** or **blur**; the **end vertex** of that edge moves along the same ray so the segment matches the new length (minimum **0.25 m**). Changes that would **self-intersect** are rejected and the field reverts.

## 0.4.12 — 2026-03-28

- **Field editor corner drag:** **Freeze orthographic fit** for the duration of a corner drag so the camera no longer **refits every move** (which widened the frustum with the bbox and made meters-per-pixel explode — felt “hyper sensitive” and fields became **super wide** fast). **OrbitControls target** is pinned to the polygon center at **pointer down** so pan/zoom pivot stays stable during the drag.

## 0.4.11 — 2026-03-28

- **Field editor — true square on screen:** Drei’s default orthographic frustum used **different scale for horizontal vs vertical** whenever the canvas wasn’t square, so an isotropic **100×100 m** plot looked like a **rectangle**. The editor camera is now **`manual`** with **left/right/top/bottom in meters** chosen so **halfX / halfZ = canvas width / height**, giving **equal meters-per-pixel on X and Z** and a **centered** square outline.

## 0.4.10 — 2026-03-28

- **Field shape rehydrate:** Bumped persist **version to 3** with **migrate** + **merge** so saves that still match the old **100 × 60 m** default are upgraded to the **100 × 100 m** square (`DEFAULT_FIELD_POLYGON`). Stops the editor from “spawning” a rectangle when `localStorage` had the legacy outline.

## 0.4.9 — 2026-03-28

- **Field editor view:** Orthographic **zoom** is computed from the **real canvas size** (`min(width/needW, height/needH)`) so a **100×100 m** plot stays **centered** in the preview with symmetric margin — no “stretched to one side” framing.
- **Field fill:** Extruded solid uses **line-only** styling — **white background** with a repeating **horizontal + vertical grid** (minor / major strokes) on the texture, **`meshBasicMaterial`** so it reads as **cross-hatch ink**, not a flat shaded color.

## 0.4.8 — 2026-03-28

- **Field default shape:** Fresh / reset boundary is now a **centered square** (**100 × 100 m**) via **`DEFAULT_FIELD_SIDE_M`** instead of **100 × 60 m**. Configure “New rectangle” inputs default to **100 × 100** as well.

## 0.4.7 — 2026-03-28

- **Field editor interaction:** **Tighter default orthographic frame** (`zoom ≈ 300 / span`) so the plot is large without zooming first. **Larger corner spheres** (scale with field size, ~2–5 m) + **pointer capture** while dragging.
- **Edges:** Replaced thin cylinders with **wide top-face ribbons** (`~4.2 m` × edge length, shallow box) so splits are easy to hit from above; clearer hover/click feedback.
- **Mesh look:** **Cross-hatch / plus pattern** texture (tiling ~every 5.5 m) on the extruded field solid. Copy/sidebar trimmed to “move corners + add corners” focus; edge table **collapsed** by default.

## 0.4.6 — 2026-03-28

- **Configure field editor:** **Fixed top-down** view — **rotation disabled** (pan + zoom only) so the plot never tilts in space. **White** scene and canvas backdrop (`#ffffff`).
- **Field representation:** Outline is an **extruded `THREE.ExtrudeGeometry` mesh** (beveled solid with thickness) via **`buildPolygonExtrudedMeshGeometry`** / **`EDITOR_FIELD_EXTRUSION_DEPTH`**, not a flat card. Corner drag uses a plane at the **top** of the mesh.

## 0.4.5 — 2026-03-28

- **Field editor UX:** Removed the **infinite grid**; the plot reads as a **floating patch** (lifted on **Y**) over a soft **radial void** background, with a **blob shadow** on the “floor” and light **contact shadow** for depth.
- **Clearer interaction:** **Perspective** view + **orbit** (rotate / pan / zoom), **numbered corner** labels on billboards, **clickable edges** (glow + blue segment on hover) to **split** at the midpoint, on-canvas **step list**, and sidebar tips + collapsible **measurements**.
- **Materials:** Fill uses a warmer **standard** material with a touch of **emissive** so the field reads as its own object, not a chart on a grid.

## 0.4.4 — 2026-03-28

- **Field boundary polygon:** The configure editor is no longer locked to four corners. The boundary is an ordered **polygon** (minimum three vertices). **+ corner** on any edge inserts a point at that edge’s **midpoint**; **Remove** per vertex when there are more than three. Dragging still rejects **self-intersections**.
- **Ground mesh:** Interior is **ear-cut triangulated** with optional **subdivision** for shading. **`field_x` / `field_y`** still map through the polygon’s **axis-aligned bounding box** (west→east, south→north) so existing normalized device coords stay meaningful on irregular outlines.
- **Persistence:** Store key still `circa-field-shape`; **`merge`** rehydrates legacy **`quad`** saves into **`vertices`**.

## 0.4.3 — 2026-03-28

- **Configure → Field boundary:** New **Three.js** editor on the Configure page: starts as a **centered rectangle** (default **100 × 60 m**), **corner spheres** you drag to mold a convex quad, **grid** with **5 m** cells and **25 m** sections, live **edge lengths in meters**, and **Reset shape** from width/height inputs.
- **`fieldShape` state** (`client/src/lib/fieldShape.ts` + **`useFieldShapeStore`** with **localStorage** persist): quad corners in **real meters**; normalized device **`field_x` / `field_y`** map through **bilinear** interpolation so existing 0–1 coordinates stay valid on the deformed plot.
- **Field view (`FieldCanvas`):** Ground mesh, border, markers, camera, shadows, and zoom **follow the configured quad**; marker size **scales** with field span.

## 0.4.2 — 2026-03-28

- **Pair → Configure:** Sidebar nav, route, and copy now use **Configure** (`/configure`). Old `/pair` URLs redirect to `/configure`.
- New **`ConfigurePage`** (replaces `PairPage`): device list, add-device flow, and CSS updated for configure naming; empty field hint links to Configure with a clickable link (pointer-events fix on empty state).

## 0.4.1 — 2026-03-28

- Dashboard: **flush** layout again — white page, no tan panel behind the preview; field column and canvas sit **edge-to-edge** (no inset frame, no radius). Ground shader and plot edge read **cool grey / white**, not soil tan.
- Statistics row restyled in a **monochrome instrument** mood: thin vertical dividers, bold caps labels, light **index** numerals (`01`…), large values, **inverted black** cell for the last KPI; **Updated** as a slim time column. Warn/alert use **grey/black weight** only (no orange/red blocks). No new charts or copy.

## 0.4.0 — 2026-03-28

- **Field visualization:** Restored **Three.js / R3F** as a true **bird’s-eye** orthographic view over a rectangular plot (field outline + subtle animated **shader** on the soil for a “alive” shimmer). **No orbit** — only pan and zoom; bases and nodes sit on the plane with soft shadows.
- **Dashboard layout:** **Statistics** moved to a **top strip** (all KPIs + last update). The 3D field is a **compact preview** in a bordered frame (`~200–260px` tall, `≤360px` wide) beside the **devices** list — not full-bleed.
- **Field page:** `variant="full"` for a taller canvas; updated copy. Re-added `@react-three/fiber`, `@react-three/drei`, `three`, `@types/three` dependencies.

## 0.3.0 — 2026-03-28

- **Field visualization rebuilt** as a 2D SVG “micro distribution” map: concentric rings (dotted / solid / dashed / fine), radial spokes, grayscale only — no 3D orbit controls.
- **Interaction:** pan by dragging the map, scroll-wheel zoom toward cursor, **drag** base stations and nodes to update `field_*` in the client store, **click** (without dragging) to open an inspector. **Place node:** choose cluster (base), **Place node**, then click empty map; optional POST to `/api/stations/nodes` when backend is up.
- **Clusters:** each base station gets a grayscale ramp; nodes inherit their cluster tone; faint **spokes** link nodes to their base. Legend lists bases.
- **Field page** uses a flush canvas and updated instructions. **Dashboard** compact mode hides duplicate map titles (chrome remains for zoom / place).
- Removed unused **three.js / react-three** dependencies from the client.

## 0.2.1 — 2026-03-28

- App sidebar reworked to match the landing page: `circa` wordmark + `AGRI-TECH` kicker, 28×28 logo mark, horizontal nav rows with mono icons and **brown** active bar (`::before`) on `--brown-subtle` background, footer **Live / Offline** mono stamp.
- Wider editorial rail (`~13.75rem`); top-bar live pill squared with brown left accent; `main-content` scroll/min-width consolidated in `AppShell.css`.
- Compact breakpoint (~720px): horizontal sidebar strip with bottom accent for active item.

## 0.2.0 — 2026-03-28

- Dashboard restyled to match the landing editorial theme: full-bleed field (no card frame), gradient header strip over the canvas, sidebar KPIs as a list with brown-accent gradient separators instead of emoji cards.
- `AppShell`: `.page-content:has(.dashboard)` drops padding for flush layout.
- `StatsPanel`: flat device rows with left brown hover accent and hairline dividers; layout CSS completed for metrics and node moisture bars.
- `FieldCanvas`: soil-moisture legend / hints use minimal top-border panels (no floating card shadow).

## 0.1.6 — 2026-03-28

- Landing: ASCII grid no longer builds extra columns past the container (`floor` width, `ResizeObserver` on resize); `.ascii-field` uses `contain: strict` so wide rows can’t widen the page.
- Landing: bottom block uses CSS `grid` with `minmax(0, …)` tracks; link actions are `display: block` with `word-break` so labels wrap inside the column.
- Global: `html { overflow-x: hidden }`, `max-width: 100%` on `html/body/#root`.

## 0.1.5 — 2026-03-28

- Landing page: keep bottom info row in viewport — links column can shrink (`flex` + `max-width`), full-width link controls with right-aligned text and `overflow-wrap`, meta/description capped to column width, `overflow-x: hidden` on the row.

## 0.1.4 — 2026-03-28

- Landing page: prevent horizontal overflow (replace `100vw` with `100%`/`max-width: 100%`, cap headline width with `min()`, flex-wrap + `min-width: 0` on the info row, safe-area padding, break long text).

## 0.1.3 — 2026-03-28

- Landing page: keep headline vertically centered while anchoring the meta/description/link row to the bottom (`bottom: 28px`) so it no longer rides up with the centered block.

## 0.1.2 — 2026-03-28

- Landing page: main headline block is vertically centered in the viewport again (no bottom anchor after footer removal).

## 0.1.1 — 2026-03-28

- Removed the bottom footer strip from the public landing page (`LandingPage`): it previously showed “Stations Online” and stack/hardware lines. Main content inset adjusted so the layout still clears the bottom edge cleanly.
