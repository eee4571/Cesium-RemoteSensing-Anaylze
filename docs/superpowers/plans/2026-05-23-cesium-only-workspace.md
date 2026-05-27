# Cesium-only Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split Leaflet 2D map plus Cesium 3D globe with one Cesium workspace that supports 2D, 2.5D, and 3D modes while preserving raster, vector, selection, GEE, and pixel-query workflows.

**Architecture:** Keep `frontend/src/main.tsx` as the business-state owner and move all map rendering and map interaction into a new `CesiumWorkspace` component. Extract small Cesium helper modules for view conversion, layer creation, and picking so the workspace component stays readable and testable.

**Tech Stack:** React, TypeScript, CesiumJS, Vite, node:test with tsx.

---

## File Structure

- Modify: `frontend/src/cesiumConfig.ts`
  - Keep Cesium asset and base imagery configuration centralized.
- Modify: `frontend/src/cesiumHelpers.test.ts`
  - Add regression tests for Cesium-only source structure and helper behavior.
- Create: `frontend/src/cesiumView.ts`
  - Convert WGS84 bounds to Cesium rectangles and expose view mode helpers.
- Create: `frontend/src/cesiumPicking.ts`
  - Convert screen positions to WGS84 coordinates and format pick/sample messages.
- Create: `frontend/src/CesiumWorkspace.tsx`
  - Own the single Cesium viewer, layers, drawing, clicking, and view mode switching.
- Modify: `frontend/src/main.tsx`
  - Remove Leaflet rendering and route map state into `CesiumWorkspace`.
- Modify: `frontend/src/styles.css`
  - Remove Leaflet-specific layout assumptions and style the Cesium workspace toolbar.
- Modify: `frontend/package.json`
  - Remove Leaflet dependencies after the app no longer imports them.
- Modify: `frontend/package-lock.json`
  - Update via `npm install` after package changes.
- Modify: `README.md`
  - Update the frontend technology description from React + Leaflet to React + Cesium.

## Task 1: Add Cesium View Helpers

**Files:**
- Create: `frontend/src/cesiumView.ts`
- Modify: `frontend/src/cesiumHelpers.test.ts`

- [ ] **Step 1: Write failing tests for bounds and view mode helpers**

Add these imports to `frontend/src/cesiumHelpers.test.ts`:

```ts
import {
  cesiumSceneModeForViewMode,
  cesiumViewModeLabel,
  rectangleDegreesFromWgs84Bounds,
  type CesiumViewMode,
} from './cesiumView';
```

Add these tests after the existing `boundsToRectangleDegrees returns named rectangle degrees` test:

```ts
test('rectangleDegreesFromWgs84Bounds converts valid WGS84 bounds', () => {
  assert.deepEqual(rectangleDegreesFromWgs84Bounds([113.1, 22.4, 114.5, 23.2]), {
    west: 113.1,
    south: 22.4,
    east: 114.5,
    north: 23.2,
  });
});

test('rectangleDegreesFromWgs84Bounds rejects null and reversed bounds', () => {
  assert.equal(rectangleDegreesFromWgs84Bounds(null), null);
  assert.equal(rectangleDegreesFromWgs84Bounds([114, 22, 113, 23]), null);
  assert.equal(rectangleDegreesFromWgs84Bounds([113, 23, 114, 22]), null);
});

test('cesium view modes map to stable labels and scene mode names', () => {
  const modes: CesiumViewMode[] = ['2d', 'columbus', '3d'];
  assert.deepEqual(modes.map(cesiumViewModeLabel), ['2D', '2.5D', '3D']);
  assert.deepEqual(modes.map(cesiumSceneModeForViewMode), ['SCENE2D', 'COLUMBUS_VIEW', 'SCENE3D']);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd frontend
npm test
```

Expected: FAIL because `./cesiumView` does not exist.

- [ ] **Step 3: Implement `frontend/src/cesiumView.ts`**

Create `frontend/src/cesiumView.ts`:

```ts
import { boundsToRectangleDegrees, normalizeWgs84Bounds, type Wgs84Bounds } from './cesiumBounds';

export type CesiumViewMode = '2d' | 'columbus' | '3d';
export type CesiumSceneModeName = 'SCENE2D' | 'COLUMBUS_VIEW' | 'SCENE3D';

export type RectangleDegrees = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function rectangleDegreesFromWgs84Bounds(bounds: Wgs84Bounds | null): RectangleDegrees | null {
  const normalized = normalizeWgs84Bounds(bounds);
  return boundsToRectangleDegrees(normalized);
}

export function cesiumViewModeLabel(mode: CesiumViewMode): string {
  if (mode === '2d') return '2D';
  if (mode === 'columbus') return '2.5D';
  return '3D';
}

export function cesiumSceneModeForViewMode(mode: CesiumViewMode): CesiumSceneModeName {
  if (mode === '2d') return 'SCENE2D';
  if (mode === 'columbus') return 'COLUMBUS_VIEW';
  return 'SCENE3D';
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
cd frontend
npm test
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```bash
cd frontend
npm run build
```

Expected: build exits with code 0.

## Task 2: Add Picking Helpers

**Files:**
- Create: `frontend/src/cesiumPicking.ts`
- Modify: `frontend/src/cesiumHelpers.test.ts`

- [ ] **Step 1: Write failing tests for pick message formatting**

Add this import to `frontend/src/cesiumHelpers.test.ts`:

```ts
import { formatCesiumPickedInfo, isFiniteLonLat } from './cesiumPicking';
```

Add these tests near the other Cesium helper tests:

```ts
test('isFiniteLonLat validates longitude and latitude values', () => {
  assert.equal(isFiniteLonLat(113.5, 22.8), true);
  assert.equal(isFiniteLonLat(Number.NaN, 22.8), false);
  assert.equal(isFiniteLonLat(113.5, Number.POSITIVE_INFINITY), false);
});

test('formatCesiumPickedInfo includes coordinate, height, and raster sample text', () => {
  assert.equal(
    formatCesiumPickedInfo({
      lon: 113.1234567,
      lat: 22.7654321,
      height: 33.25,
      sample: 'DN: 1, 2, 3',
    }),
    'Lon 113.123457, Lat 22.765432; 地表高程 33.3 m; DN: 1, 2, 3',
  );
});

test('formatCesiumPickedInfo handles missing height and sample text', () => {
  assert.equal(
    formatCesiumPickedInfo({
      lon: 113.1234567,
      lat: 22.7654321,
      height: null,
      sample: null,
    }),
    'Lon 113.123457, Lat 22.765432; 地表高程未知',
  );
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd frontend
npm test
```

Expected: FAIL because `./cesiumPicking` does not exist.

- [ ] **Step 3: Implement `frontend/src/cesiumPicking.ts`**

Create `frontend/src/cesiumPicking.ts`:

```ts
export type CesiumPickedInfo = {
  lon: number;
  lat: number;
  height: number | null;
  sample: string | null;
};

export function isFiniteLonLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat);
}

export function formatCesiumPickedInfo({ lon, lat, height, sample }: CesiumPickedInfo): string {
  const coordinate = `Lon ${lon.toFixed(6)}, Lat ${lat.toFixed(6)}`;
  const terrain = height === null ? '地表高程未知' : `地表高程 ${height.toFixed(1)} m`;
  return sample ? `${coordinate}; ${terrain}; ${sample}` : `${coordinate}; ${terrain}`;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
cd frontend
npm test
```

Expected: PASS.

## Task 3: Create CesiumWorkspace From Current CesiumGlobe

**Files:**
- Create: `frontend/src/CesiumWorkspace.tsx`
- Keep temporarily: `frontend/src/CesiumGlobe.tsx`

- [ ] **Step 1: Copy the current Cesium component into `CesiumWorkspace`**

Create `frontend/src/CesiumWorkspace.tsx` by copying the current `frontend/src/CesiumGlobe.tsx`.

Then make these exact structural changes:

```ts
import { cesiumViewModeLabel, type CesiumViewMode } from './cesiumView';
import { formatCesiumPickedInfo } from './cesiumPicking';
```

Rename:

```ts
type CesiumGlobeProps = {
```

to:

```ts
type CesiumWorkspaceProps = {
```

Rename:

```ts
export default function CesiumGlobe({
```

to:

```ts
export default function CesiumWorkspace({
```

Add state inside the component:

```ts
const [viewMode, setViewMode] = React.useState<CesiumViewMode>('3d');
```

Replace the old local formatter calls with:

```ts
formatCesiumPickedInfo({ lon, lat, height, sample: null })
```

and:

```ts
onInfo(formatCesiumPickedInfo({ lon, lat, height, sample: sampleText }));
```

- [ ] **Step 2: Add view mode toolbar buttons**

Inside the existing `.cesium-toolbar`, before the locate button, add:

```tsx
{(['2d', 'columbus', '3d'] as CesiumViewMode[]).map((mode) => (
  <button
    key={mode}
    type="button"
    title={`切换到 ${cesiumViewModeLabel(mode)}`}
    aria-label={`切换到 ${cesiumViewModeLabel(mode)}`}
    className={viewMode === mode ? 'selected' : ''}
    onClick={() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      setViewMode(mode);
      if (mode === '2d') viewer.scene.morphTo2D(0.6);
      if (mode === 'columbus') viewer.scene.morphToColumbusView(0.6);
      if (mode === '3d') viewer.scene.morphTo3D(0.6);
    }}
    aria-pressed={viewMode === mode}
  >
    {cesiumViewModeLabel(mode)}
  </button>
))}
```

- [ ] **Step 3: Build to catch copy/rename mistakes**

Run:

```bash
cd frontend
npm run build
```

Expected: build exits with code 0. The app still renders the old component because `main.tsx` has not been changed yet.

## Task 4: Replace Leaflet Rendering With CesiumWorkspace

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/cesiumHelpers.test.ts`

- [ ] **Step 1: Write a static regression test for Cesium-only rendering**

Add this test to `frontend/src/cesiumHelpers.test.ts`:

```ts
test('main renders CesiumWorkspace instead of Leaflet MapContainer', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  assert.equal(source.includes('MapContainer'), false);
  assert.equal(source.includes('react-leaflet'), false);
  assert.equal(source.includes('CesiumWorkspace'), true);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd frontend
npm test
```

Expected: FAIL because `main.tsx` still imports and renders Leaflet `MapContainer`.

- [ ] **Step 3: Update imports in `main.tsx`**

Remove only the `react-leaflet` imports:

```ts
import {
  GeoJSON,
  ImageOverlay,
  MapContainer,
  Rectangle,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
```

Remove:

```ts
import 'leaflet/dist/leaflet.css';
```

Keep the direct Leaflet import temporarily because `selectedBounds` is still stored as `L.LatLngBounds` until Task 6:

```ts
import L from 'leaflet';
```

Remove `type { LatLngBoundsExpression } from 'leaflet'` only if the build reports it is unused after removing the Leaflet map rendering variables.

Replace:

```ts
import CesiumGlobe from './CesiumGlobe';
```

with:

```ts
import CesiumWorkspace from './CesiumWorkspace';
```

- [ ] **Step 4: Remove Leaflet-only helper components**

Delete these component definitions from `main.tsx`:

```ts
function FitBounds({ bounds, nonce }: FitBoundsProps) {
  const map = useMap();
  React.useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [24, 24] });
  }, [bounds, map, nonce]);
  return null;
}

function MapClick({ raster, onInfo }: MapClickProps) {
  useMapEvents({
    click: async (event) => {
      const lat = event.latlng.lat;
      const lon = event.latlng.lng;
      const coord = `Lon ${lon.toFixed(6)}, Lat ${lat.toFixed(6)}`;
      if (!raster) {
        onInfo(coord);
        return;
      }
      try {
        const response = await fetch(`${apiBase}/images/${raster.id}/sample?lon=${lon}&lat=${lat}`);
        const body = await response.json();
        if (!response.ok) {
          onInfo(`${coord}; ${body.detail ?? ui.queryFailed}`);
          return;
        }
        onInfo(`${coord}; 行 ${body.row}, 列 ${body.col}; DN: ${body.values.slice(0, 6).join(', ')}`);
      } catch (error) {
        onInfo(`${coord}; ${error instanceof Error ? error.message : ui.queryFailed}`);
      }
    },
  });
  return null;
}
```

If exact code differs, remove the whole `FitBounds` and `MapClick` functions and their associated prop types.

- [ ] **Step 5: Replace the map rendering block**

Replace the current block that starts with:

```tsx
{activeView === '2d' ? (
  <MapContainer bounds={fitBounds} className="map" scrollWheelZoom>
```

and ends after the `CesiumGlobe` branch with this single workspace:

```tsx
<CesiumWorkspace
  raster={raster}
  vector={vector}
  overlayUrl={overlayUrl}
  selectedBounds={selectedWgs84Bounds}
  opacity={opacity}
  showRaster={showRaster}
  showVector={showVector}
  showBasemap={showBasemap}
  fitBounds={fitBounds3d ?? rasterWgs84Bounds ?? vectorWgs84Bounds ?? selectedWgs84Bounds}
  fitNonce={fitNonce}
  apiBase={apiBase}
  onInfo={setMapInfo}
/>
```

Remove `activeView` state and the UI buttons that switch between `ui.view2d` and `ui.view3d`; view mode now lives in `CesiumWorkspace`.

- [ ] **Step 6: Remove unused Leaflet-derived variables**

Remove variables that only served Leaflet rendering:

```ts
const selectedLeafletBounds = ...
const fitBounds = ...
const imageBounds = ...
const vectorBounds = ...
const manualFitBounds = ...
```

Keep the WGS84 bounds variables used by Cesium and GEE:

```ts
selectedWgs84Bounds
rasterWgs84Bounds
vectorWgs84Bounds
fitBounds3d
```

- [ ] **Step 7: Run tests and verify they pass**

Run:

```bash
cd frontend
npm test
```

Expected: PASS, including the static `main renders CesiumWorkspace instead of Leaflet MapContainer` test.

- [ ] **Step 8: Run build**

Run:

```bash
cd frontend
npm run build
```

Expected: build exits with code 0.

## Task 5: Implement Cesium Rectangle Drawing

**Files:**
- Modify: `frontend/src/CesiumWorkspace.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add draw callback prop**

In `CesiumWorkspaceProps`, add:

```ts
onSelectedBoundsChange: (bounds: Wgs84Bounds | null) => void;
```

Update the function parameters to receive it:

```ts
onSelectedBoundsChange,
```

In `main.tsx`, pass:

```tsx
onSelectedBoundsChange={setSelectedBoundsFromWgs84}
```

Before passing this prop, add this helper function in `main.tsx`:

```ts
function setSelectedBoundsFromWgs84(bounds: Wgs84Bounds | null) {
  if (!bounds) {
    setSelectedBounds(null);
    return;
  }
  setSelectedBounds(L.latLngBounds([bounds[1], bounds[0]], [bounds[3], bounds[2]]));
}
```

If Leaflet has already been removed from dependencies in a later task, replace this with a `selectedBounds` state stored directly as `Wgs84Bounds | null`. During this task, keep Leaflet installed until state migration is complete.

- [ ] **Step 2: Add drawing state refs**

In `CesiumWorkspace`, add:

```ts
const drawHandlerRef = React.useRef<ScreenSpaceEventHandler | null>(null);
const drawingStartRef = React.useRef<Cartographic | null>(null);
const drawingSourceRef = React.useRef<CustomDataSource | null>(null);
const [drawing, setDrawing] = React.useState(false);
```

- [ ] **Step 3: Add helper to convert screen position to cartographic**

Inside `CesiumWorkspace`, add:

```ts
function cartographicFromScreen(viewer: Viewer, position: Cartesian2): Cartographic | null {
  const ray = viewer.camera.getPickRay(position);
  const surface = ray
    ? viewer.scene.globe.pick(ray, viewer.scene)
    : viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  if (!surface) return null;
  return Ellipsoid.WGS84.cartesianToCartographic(surface);
}
```

- [ ] **Step 4: Add rectangle drawing effect**

Add this effect:

```ts
React.useEffect(() => {
  const viewer = viewerRef.current;
  if (!viewer || !drawing) return;

  const source = new CustomDataSource('drawing-selection');
  drawingSourceRef.current = source;
  viewer.dataSources.add(source);

  const handler = new ScreenSpaceEventHandler(viewer.canvas);
  drawHandlerRef.current = handler;

  handler.setInputAction((movement) => {
    const cartographic = cartographicFromScreen(viewer, movement.position);
    if (!cartographic) return;
    drawingStartRef.current = cartographic;
  }, ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction((movement) => {
    const start = drawingStartRef.current;
    if (!start) return;
    const end = cartographicFromScreen(viewer, movement.endPosition);
    if (!end) return;
    const west = CesiumMath.toDegrees(Math.min(start.longitude, end.longitude));
    const east = CesiumMath.toDegrees(Math.max(start.longitude, end.longitude));
    const south = CesiumMath.toDegrees(Math.min(start.latitude, end.latitude));
    const north = CesiumMath.toDegrees(Math.max(start.latitude, end.latitude));
    source.entities.removeAll();
    source.entities.add({
      rectangle: new RectangleGraphics({
        coordinates: CesiumRectangle.fromDegrees(west, south, east, north),
        fill: true,
        height: 0,
        material: Color.ORANGE.withAlpha(0.18),
        outline: true,
        outlineColor: Color.ORANGE,
      }),
    });
  }, ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction((movement) => {
    const start = drawingStartRef.current;
    const end = cartographicFromScreen(viewer, movement.position);
    drawingStartRef.current = null;
    setDrawing(false);
    if (!start || !end) return;
    const west = CesiumMath.toDegrees(Math.min(start.longitude, end.longitude));
    const east = CesiumMath.toDegrees(Math.max(start.longitude, end.longitude));
    const south = CesiumMath.toDegrees(Math.min(start.latitude, end.latitude));
    const north = CesiumMath.toDegrees(Math.max(start.latitude, end.latitude));
    if (east - west < 0.000001 || north - south < 0.000001) return;
    onSelectedBoundsChange([west, south, east, north]);
  }, ScreenSpaceEventType.LEFT_UP);

  return () => {
    drawHandlerRef.current = drawHandlerRef.current?.destroy() ?? null;
    drawingStartRef.current = null;
    if (drawingSourceRef.current) {
      viewer.dataSources.remove(drawingSourceRef.current, true);
      drawingSourceRef.current = null;
    }
  };
}, [drawing, onSelectedBoundsChange, readyVersion]);
```

- [ ] **Step 5: Add toolbar buttons for drawing and clearing**

In `.cesium-toolbar`, add:

```tsx
<button
  type="button"
  title="框选区域"
  aria-label="框选区域"
  className={drawing ? 'selected' : ''}
  onClick={() => setDrawing((next) => !next)}
  aria-pressed={drawing}
>
  框选
</button>
<button
  type="button"
  title="清除框选"
  aria-label="清除框选"
  onClick={() => onSelectedBoundsChange(null)}
>
  清除
</button>
```

- [ ] **Step 6: Disable normal click pick while drawing**

In the existing click handler:

```ts
clickHandler.setInputAction((movement) => {
  void handlePick(viewer, movement.position);
}, ScreenSpaceEventType.LEFT_CLICK);
```

Change to:

```ts
clickHandler.setInputAction((movement) => {
  if (drawingStartRef.current || drawing) return;
  void handlePick(viewer, movement.position);
}, ScreenSpaceEventType.LEFT_CLICK);
```

- [ ] **Step 7: Build**

Run:

```bash
cd frontend
npm run build
```

Expected: build exits with code 0.

## Task 6: Remove Leaflet State and Dependencies

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/cesiumHelpers.test.ts`

- [ ] **Step 1: Store selected bounds directly as WGS84**

In `main.tsx`, change:

```ts
const [selectedBounds, setSelectedBounds] = useState<L.LatLngBounds | null>(null);
```

to:

```ts
const [selectedBounds, setSelectedBounds] = useState<Wgs84Bounds | null>(null);
```

Remove `selectedWgs84Bounds` memoization and use `selectedBounds` directly wherever `selectedWgs84Bounds` was used.

Replace:

```ts
onSelectedBoundsChange={setSelectedBoundsFromWgs84}
```

with:

```tsx
onSelectedBoundsChange={setSelectedBounds}
```

Delete the `setSelectedBoundsFromWgs84` helper.

- [ ] **Step 2: Update GEE geometry conversion**

If `boundsToGeeGeometry` currently accepts a Leaflet bounds object, replace it with:

```ts
function boundsToGeeGeometry(bounds: Wgs84Bounds) {
  const [west, south, east, north] = bounds;
  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}
```

Ensure `fetchGeeImage` calls:

```ts
const geom = selectedBounds
  ? boundsToGeeGeometry(selectedBounds)
  : vector
    ? boundsToGeeGeometry(vector.boundsWgs84 as Wgs84Bounds)
    : null;
```

- [ ] **Step 3: Add a dependency regression test**

Add this test to `frontend/src/cesiumHelpers.test.ts`:

```ts
test('frontend package no longer depends on Leaflet', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert.equal(Boolean(packageJson.dependencies?.leaflet), false);
  assert.equal(Boolean(packageJson.dependencies?.['react-leaflet']), false);
  assert.equal(Boolean(packageJson.devDependencies?.['@types/leaflet']), false);
});
```

- [ ] **Step 4: Run tests and verify dependency test fails**

Run:

```bash
cd frontend
npm test
```

Expected: FAIL because `package.json` still contains Leaflet dependencies.

- [ ] **Step 5: Remove Leaflet dependencies**

In `frontend/package.json`, remove:

```json
"leaflet": "latest",
"react-leaflet": "latest",
"@types/leaflet": "latest",
```

Run:

```bash
cd frontend
npm install
```

Expected: `package-lock.json` updates and no install errors.

- [ ] **Step 6: Run tests and build**

Run:

```bash
cd frontend
npm test
npm run build
```

Expected: tests pass and build exits with code 0.

## Task 7: Update Styles for Single Cesium Workspace

**Files:**
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Remove Leaflet-only CSS selectors**

Remove rules that target:

```css
.leaflet-container
.leaflet-pane
.leaflet-control
```

Keep or add rules for:

```css
.cesium-shell
.cesium-viewer
.cesium-toolbar
.cesium-status
```

- [ ] **Step 2: Add stable toolbar button sizing**

Add or update:

```css
.cesium-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  position: absolute;
  z-index: 10;
  top: 12px;
  left: 12px;
}

.cesium-toolbar button {
  min-width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cesium-toolbar button.selected {
  border-color: #2563eb;
  background: #dbeafe;
  color: #1d4ed8;
}
```

- [ ] **Step 3: Build**

Run:

```bash
cd frontend
npm run build
```

Expected: build exits with code 0.

## Task 8: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update frontend technology line**

Replace:

```md
这是一个课程作业原型，后端使用 Python/FastAPI，前端使用 React + Leaflet。
```

with:

```md
这是一个课程作业原型，后端使用 Python/FastAPI，前端使用 React + CesiumJS。
```

- [ ] **Step 2: Update feature list**

Add this bullet to the feature list:

```md
- 基于 CesiumJS 的统一 2D / 2.5D / 3D 遥感工作空间，支持同一套影像、矢量、框选和点击查询状态。
```

Replace any bullet that describes Leaflet-only global basemap behavior with:

```md
- 上传 zipped Shapefile，并在 Cesium 工作空间中贴地叠加显示。
```

- [ ] **Step 3: Add Cesium token note**

Under startup or GEE notes, add:

```md
如需启用 Cesium World Terrain 和 OSM Buildings，可在 `frontend/.env` 中配置 `VITE_CESIUM_ION_TOKEN`。未配置 token 时，应用仍可使用本地兜底底图、影像叠加、矢量叠加、框选和像元查询。
```

- [ ] **Step 4: Run final verification**

Run:

```bash
cd frontend
npm test
npm run build
```

Expected: tests pass and build exits with code 0.

## Manual Verification Checklist

- [ ] Open `http://127.0.0.1:5173/`.
- [ ] Confirm the map area is a single Cesium workspace, not separate 2D and 3D panes.
- [ ] Toggle 2D, 2.5D, and 3D modes.
- [ ] Upload a GeoTIFF and confirm raster overlay appears in all modes.
- [ ] Change opacity and confirm the raster layer updates without reloading the app.
- [ ] Upload zipped Shapefile and confirm vector overlay appears in all modes.
- [ ] Draw a rectangle and confirm the selected bounds drive GEE fetch.
- [ ] Click inside the raster bounds and confirm lon/lat and DN values are reported.
- [ ] Toggle raster/vector/basemap visibility.
- [ ] Build output contains no TypeScript errors.

## Notes

- The workspace directory is not a git repository. Skip commit steps unless the project is later initialized as git.
- If ArcGIS or Cesium ion imagery fails because of network or CORS, keep the local Natural Earth fallback enabled and report the warning in the Cesium status area.
