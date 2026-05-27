# Cesium 3D Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cesium 3D terrain mode beside the existing Leaflet 2D map, with token configuration through `VITE_CESIUM_ION_TOKEN`.

**Architecture:** Keep Leaflet as the existing 2D implementation and add Cesium behind a focused React component. Extract Cesium configuration and bounds helpers into small TypeScript modules so token handling and camera geometry can be verified without a browser.

**Tech Stack:** React, TypeScript, Vite, Leaflet, Cesium, FastAPI backend endpoints already present.

---

## File Structure

- Create `frontend/src/cesiumConfig.ts`: reads and normalizes Cesium ion token configuration.
- Create `frontend/src/cesiumBounds.ts`: converts app WGS84 bounds and Leaflet selected bounds into Cesium-friendly plain bounds.
- Create `frontend/src/cesiumHelpers.test.ts`: lightweight test harness using Node's built-in `node:test` and `assert`.
- Create `frontend/src/CesiumGlobe.tsx`: owns Cesium Viewer lifecycle, terrain provider selection, imagery overlay, GeoJSON overlay, selected rectangle overlay, and camera flight.
- Create `frontend/.env.example`: documents where the user writes their real Cesium ion token.
- Modify `frontend/package.json`: add `cesium` dependency and a `test` script.
- Modify `frontend/src/main.tsx`: add `viewMode`, view switch UI, 3D rendering branch, and WGS84 fit target plumbing.
- Modify `frontend/src/styles.css`: add mode switch, Cesium container, status badge, and responsive styling.

Current workspace is not a git repository, so commit steps are skipped with that reason.

---

### Task 1: Add Testable Cesium Helpers

**Files:**
- Create: `frontend/src/cesiumConfig.ts`
- Create: `frontend/src/cesiumBounds.ts`
- Create: `frontend/src/cesiumHelpers.test.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Add the failing helper tests**

Create `frontend/src/cesiumHelpers.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { boundsToRectangleDegrees, normalizeWgs84Bounds } from './cesiumBounds';
import { getCesiumIonToken, hasCesiumIonToken, terrainModeForToken } from './cesiumConfig';

test('getCesiumIonToken trims configured token values', () => {
  assert.equal(getCesiumIonToken({ VITE_CESIUM_ION_TOKEN: '  token-123  ' }), 'token-123');
});

test('getCesiumIonToken returns null for missing or placeholder token values', () => {
  assert.equal(getCesiumIonToken({}), null);
  assert.equal(getCesiumIonToken({ VITE_CESIUM_ION_TOKEN: '' }), null);
  assert.equal(getCesiumIonToken({ VITE_CESIUM_ION_TOKEN: 'your_cesium_ion_token_here' }), null);
});

test('hasCesiumIonToken reflects usable token availability', () => {
  assert.equal(hasCesiumIonToken({ VITE_CESIUM_ION_TOKEN: 'abc' }), true);
  assert.equal(hasCesiumIonToken({ VITE_CESIUM_ION_TOKEN: 'your_cesium_ion_token_here' }), false);
});

test('terrainModeForToken chooses world terrain only when token is usable', () => {
  assert.equal(terrainModeForToken('abc'), 'world-terrain');
  assert.equal(terrainModeForToken(null), 'ellipsoid');
});

test('normalizeWgs84Bounds accepts valid west south east north bounds', () => {
  assert.deepEqual(normalizeWgs84Bounds([113.1, 22.4, 114.5, 23.2]), [113.1, 22.4, 114.5, 23.2]);
});

test('normalizeWgs84Bounds rejects invalid bounds', () => {
  assert.equal(normalizeWgs84Bounds(null), null);
  assert.equal(normalizeWgs84Bounds([114, 22, 113, 23]), null);
  assert.equal(normalizeWgs84Bounds([113, 23, 114, 22]), null);
  assert.equal(normalizeWgs84Bounds([Number.NaN, 22, 114, 23]), null);
});

test('boundsToRectangleDegrees returns named rectangle degrees', () => {
  assert.deepEqual(boundsToRectangleDegrees([113.1, 22.4, 114.5, 23.2]), {
    west: 113.1,
    south: 22.4,
    east: 114.5,
    north: 23.2,
  });
});
```

- [ ] **Step 2: Add a test script to `frontend/package.json`**

Modify the `scripts` object:

```json
{
  "dev": "vite --host 127.0.0.1 --port 5173",
  "build": "vite build",
  "preview": "vite preview --host 127.0.0.1 --port 4173",
  "test": "node --import tsx --test src/cesiumHelpers.test.ts"
}
```

Add `tsx` to `devDependencies`:

```json
"devDependencies": {
  "@types/leaflet": "latest",
  "@types/react": "latest",
  "@types/react-dom": "latest",
  "@vitejs/plugin-react": "latest",
  "tsx": "latest"
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
cd frontend
npm test
```

Expected: failure because `cesiumBounds.ts` and `cesiumConfig.ts` do not exist.

- [ ] **Step 4: Implement `frontend/src/cesiumConfig.ts`**

```ts
export type CesiumEnv = {
  VITE_CESIUM_ION_TOKEN?: string;
};

const PLACEHOLDER_TOKEN = 'your_cesium_ion_token_here';

export function getCesiumIonToken(env: CesiumEnv): string | null {
  const token = env.VITE_CESIUM_ION_TOKEN?.trim();
  if (!token || token === PLACEHOLDER_TOKEN) return null;
  return token;
}

export function hasCesiumIonToken(env: CesiumEnv): boolean {
  return getCesiumIonToken(env) !== null;
}

export function terrainModeForToken(token: string | null): 'world-terrain' | 'ellipsoid' {
  return token ? 'world-terrain' : 'ellipsoid';
}
```

- [ ] **Step 5: Implement `frontend/src/cesiumBounds.ts`**

```ts
export type Wgs84Bounds = [number, number, number, number];

export type RectangleDegrees = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function normalizeWgs84Bounds(bounds: number[] | null | undefined): Wgs84Bounds | null {
  if (!bounds || bounds.length !== 4) return null;
  const [west, south, east, north] = bounds;
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (east <= west || north <= south) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  return [west, south, east, north];
}

export function boundsToRectangleDegrees(bounds: number[] | null | undefined): RectangleDegrees | null {
  const normalized = normalizeWgs84Bounds(bounds);
  if (!normalized) return null;
  const [west, south, east, north] = normalized;
  return { west, south, east, north };
}
```

- [ ] **Step 6: Run helper tests to verify they pass**

Run:

```powershell
cd frontend
npm test
```

Expected: all 7 tests pass.

- [ ] **Step 7: Skip commit**

Do not run `git commit` because `c:\Users\Lenovo\Desktop\作业\remote_sensing_app` is not a git repository.

---

### Task 2: Add Cesium Dependency And Token Example

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/.env.example`

- [ ] **Step 1: Install Cesium and tsx**

Run:

```powershell
cd frontend
npm install cesium tsx
```

Expected: `package.json` and `package-lock.json` include `cesium` and `tsx`.

- [ ] **Step 2: Create `frontend/.env.example`**

```env
VITE_CESIUM_ION_TOKEN=your_cesium_ion_token_here
```

- [ ] **Step 3: Verify dependency scripts**

Run:

```powershell
cd frontend
npm test
```

Expected: all helper tests pass.

- [ ] **Step 4: Skip commit**

Do not run `git commit` because this workspace is not a git repository.

---

### Task 3: Build The Cesium Globe Component

**Files:**
- Create: `frontend/src/CesiumGlobe.tsx`

- [ ] **Step 1: Create `frontend/src/CesiumGlobe.tsx`**

```tsx
import React from 'react';
import {
  AlphaMode,
  Cartesian3,
  Color,
  CustomDataSource,
  GeoJsonDataSource,
  Ion,
  ImageryLayer,
  Rectangle,
  RectangleGraphics,
  RectangleGeometry,
  SingleTileImageryProvider,
  Terrain,
  Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { boundsToRectangleDegrees, normalizeWgs84Bounds, type Wgs84Bounds } from './cesiumBounds';
import { getCesiumIonToken, terrainModeForToken } from './cesiumConfig';

type RasterInfo = {
  id: string;
  filename: string;
  boundsWgs84: number[] | null;
};

type VectorInfo = {
  id: string;
  boundsWgs84: number[];
  geojson: GeoJSON.GeoJsonObject;
};

type CesiumGlobeProps = {
  raster: RasterInfo | null;
  vector: VectorInfo | null;
  overlayUrl: string | null;
  selectedBounds: Wgs84Bounds | null;
  opacity: number;
  showRaster: boolean;
  showVector: boolean;
  fitBounds: Wgs84Bounds | null;
  fitNonce: number;
};

function rectangleFromBounds(bounds: number[] | null | undefined): Rectangle | null {
  const rectangle = boundsToRectangleDegrees(bounds);
  if (!rectangle) return null;
  return Rectangle.fromDegrees(rectangle.west, rectangle.south, rectangle.east, rectangle.north);
}

function cameraDestination(bounds: Wgs84Bounds | null): Rectangle | Cartesian3 {
  const rectangle = rectangleFromBounds(bounds);
  if (rectangle) return rectangle;
  return Cartesian3.fromDegrees(104, 32, 18_000_000);
}

export default function CesiumGlobe({
  raster,
  vector,
  overlayUrl,
  selectedBounds,
  opacity,
  showRaster,
  showVector,
  fitBounds,
  fitNonce,
}: CesiumGlobeProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const viewerRef = React.useRef<Viewer | null>(null);
  const rasterLayerRef = React.useRef<ImageryLayer | null>(null);
  const vectorSourceRef = React.useRef<GeoJsonDataSource | null>(null);
  const selectionSourceRef = React.useRef<CustomDataSource | null>(null);
  const lastFitNonceRef = React.useRef(0);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    let disposed = false;
    const token = getCesiumIonToken(import.meta.env);
    const terrainMode = terrainModeForToken(token);
    if (token) Ion.defaultAccessToken = token;

    const viewer = new Viewer(containerRef.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      terrain: terrainMode === 'world-terrain' ? Terrain.fromWorldTerrain() : undefined,
    });

    viewer.scene.globe.depthTestAgainstTerrain = terrainMode === 'world-terrain';
    viewer.camera.setView({ destination: cameraDestination(null) });
    viewerRef.current = viewer;
    setMessage(
      terrainMode === 'world-terrain'
        ? 'Cesium World Terrain 已启用'
        : '未配置 Cesium ion token，当前为普通三维地球'
    );

    return () => {
      disposed = true;
      if (!disposed) return;
      viewer.destroy();
      viewerRef.current = null;
      rasterLayerRef.current = null;
      vectorSourceRef.current = null;
      selectionSourceRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (rasterLayerRef.current) {
      viewer.imageryLayers.remove(rasterLayerRef.current, true);
      rasterLayerRef.current = null;
    }

    if (!showRaster || !overlayUrl || !raster?.boundsWgs84) return;
    const rectangle = rectangleFromBounds(raster.boundsWgs84);
    if (!rectangle) {
      setMessage('影像缺少有效 WGS84 范围，无法在 3D 中叠加');
      return;
    }

    const provider = new SingleTileImageryProvider({
      url: overlayUrl,
      rectangle,
      tileWidth: 1024,
      tileHeight: 1024,
    });
    const layer = new ImageryLayer(provider, { alpha: opacity });
    layer.alpha = opacity;
    rasterLayerRef.current = viewer.imageryLayers.add(layer);
  }, [overlayUrl, opacity, raster, showRaster]);

  React.useEffect(() => {
    if (rasterLayerRef.current) {
      rasterLayerRef.current.alpha = opacity;
    }
  }, [opacity]);

  React.useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (vectorSourceRef.current) {
      viewer.dataSources.remove(vectorSourceRef.current, true);
      vectorSourceRef.current = null;
    }

    if (!showVector || !vector) return;

    let cancelled = false;
    GeoJsonDataSource.load(vector.geojson, {
      stroke: Color.LIME.withAlpha(0.95),
      fill: Color.LIME.withAlpha(0.12),
      strokeWidth: 3,
      clampToGround: true,
    })
      .then((source) => {
        if (cancelled || !viewerRef.current) return;
        vectorSourceRef.current = source;
        viewerRef.current.dataSources.add(source);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : '矢量图层加载失败');
      });

    return () => {
      cancelled = true;
    };
  }, [showVector, vector]);

  React.useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (selectionSourceRef.current) {
      viewer.dataSources.remove(selectionSourceRef.current, true);
      selectionSourceRef.current = null;
    }

    const normalized = normalizeWgs84Bounds(selectedBounds);
    if (!normalized) return;
    const rectangle = rectangleFromBounds(normalized);
    if (!rectangle) return;

    const source = new CustomDataSource('selected-area');
    source.entities.add({
      name: 'Selected area',
      rectangle: new RectangleGraphics({
        coordinates: rectangle,
        fill: true,
        material: Color.ORANGE.withAlpha(0.16),
        outline: true,
        outlineColor: Color.ORANGE,
        height: 0,
      }),
    });
    selectionSourceRef.current = source;
    viewer.dataSources.add(source);
  }, [selectedBounds]);

  React.useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || fitNonce === 0 || fitNonce === lastFitNonceRef.current) return;
    lastFitNonceRef.current = fitNonce;
    viewer.camera.flyTo({
      destination: cameraDestination(fitBounds),
      duration: 0.9,
    });
  }, [fitBounds, fitNonce]);

  return (
    <div className="cesium-shell">
      <div ref={containerRef} className="cesium-viewer" aria-label="Cesium 3D terrain globe" />
      {message && <div className="cesium-status">{message}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Run TypeScript build to expose compile issues**

Run:

```powershell
cd frontend
npm run build
```

Expected at this step: it may fail because Cesium package or type imports need adjustment. Fix only compile errors in `CesiumGlobe.tsx` while preserving the same public props and behavior.

- [ ] **Step 3: Run helper tests**

Run:

```powershell
cd frontend
npm test
```

Expected: all helper tests pass.

- [ ] **Step 4: Skip commit**

Do not run `git commit` because this workspace is not a git repository.

---

### Task 4: Wire 2D / 3D Mode Into The App

**Files:**
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Import the Cesium component and WGS84 type**

Add imports near the other local imports:

```ts
import CesiumGlobe from './CesiumGlobe';
import { normalizeWgs84Bounds, type Wgs84Bounds } from './cesiumBounds';
```

- [ ] **Step 2: Add UI labels**

Add to the `ui` object:

```ts
view2d: '2D 地图',
view3d: '3D 地形',
```

- [ ] **Step 3: Add view mode state**

Inside `App()` state declarations:

```ts
const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
const [fitBounds3d, setFitBounds3d] = useState<Wgs84Bounds | null>(null);
```

- [ ] **Step 4: Add helpers for selected bounds and fit bounds**

Add inside `App()` after existing `useMemo` bounds:

```ts
const selectedWgs84Bounds = useMemo<Wgs84Bounds | null>(() => {
  if (!selectedBounds) return null;
  return normalizeWgs84Bounds([
    selectedBounds.getWest(),
    selectedBounds.getSouth(),
    selectedBounds.getEast(),
    selectedBounds.getNorth(),
  ]);
}, [selectedBounds]);

const rasterWgs84Bounds = useMemo(
  () => normalizeWgs84Bounds(raster?.boundsWgs84),
  [raster]
);

const vectorWgs84Bounds = useMemo(
  () => normalizeWgs84Bounds(vector?.boundsWgs84),
  [vector]
);
```

- [ ] **Step 5: Update `zoomTo` to feed both maps**

Replace `zoomTo` with:

```ts
function zoomTo(bounds: LatLngBoundsExpression | null, wgs84Bounds?: Wgs84Bounds | null) {
  if (!bounds) return;
  setManualFitBounds(bounds);
  setFitBounds3d(wgs84Bounds ?? null);
  setFitNonce(n => n + 1);
}
```

- [ ] **Step 6: Update zoom button calls**

Change the three zoom buttons to:

```tsx
<button type="button" className="secondary" onClick={() => zoomTo(imageBounds, rasterWgs84Bounds)} disabled={!imageBounds}>{ui.zoomImage}</button>
<button type="button" className="secondary" onClick={() => zoomTo(vectorBounds, vectorWgs84Bounds)} disabled={!vectorBounds}>{ui.zoomVector}</button>
<button type="button" className="secondary" onClick={() => zoomTo(selectedLeafletBounds, selectedWgs84Bounds)} disabled={!selectedLeafletBounds}>{ui.zoomArea}</button>
```

- [ ] **Step 7: Set 3D fit bounds when data changes**

In `onRaster`, after `setManualFitBounds(wgsBoundsToLeaflet(info.boundsWgs84));`, add:

```ts
setFitBounds3d(normalizeWgs84Bounds(info.boundsWgs84));
```

In `onVector`, after `setManualFitBounds(wgsBoundsToLeaflet(info.boundsWgs84));`, add:

```ts
setFitBounds3d(normalizeWgs84Bounds(info.boundsWgs84));
```

In `fetchGeeImage`, after `setManualFitBounds(wgsBoundsToLeaflet(image.boundsWgs84));`, add:

```ts
setFitBounds3d(normalizeWgs84Bounds(image.boundsWgs84));
```

In `clearAll`, after `setManualFitBounds([[-60, -160], [75, 160]]);`, add:

```ts
setFitBounds3d(null);
```

- [ ] **Step 8: Add the map mode switch and conditional rendering**

Replace the current `<main className="map-shell">...</main>` map block with:

```tsx
<main className="map-shell">
  <div className={`status ${busy ? 'loading' : ''}`}>{status}</div>
  <div className="view-switch" role="group" aria-label="地图视图切换">
    <button
      type="button"
      className={viewMode === '2d' ? 'selected' : ''}
      onClick={() => setViewMode('2d')}
      aria-pressed={viewMode === '2d'}
    >
      {ui.view2d}
    </button>
    <button
      type="button"
      className={viewMode === '3d' ? 'selected' : ''}
      onClick={() => setViewMode('3d')}
      aria-pressed={viewMode === '3d'}
    >
      {ui.view3d}
    </button>
  </div>

  {viewMode === '2d' ? (
    <MapContainer bounds={fitBounds} className="map" scrollWheelZoom>
      <FitBounds bounds={fitBounds} nonce={fitNonce} />
      {showBasemap && <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />}
      {showRaster && overlayUrl && imageBounds && <ImageOverlay url={overlayUrl} bounds={imageBounds} opacity={opacity} />}
      {showVector && vector && <GeoJSONLayer data={vector.geojson} style={{ color: '#16a34a', weight: 2, fillOpacity: 0.08 }} />}
      {selectedBounds && <Rectangle bounds={selectedBounds} pathOptions={{ color: '#f97316', weight: 2 }} />}
      <MapClick raster={raster} onInfo={setMapInfo} />
      <DrawBox enabled={drawing} onComplete={(bounds) => {
        setSelectedBounds(bounds);
        setFitBounds3d(normalizeWgs84Bounds([
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ]));
        setDrawing(false);
        setStatus(ui.areaSelected);
      }} />
    </MapContainer>
  ) : (
    <CesiumGlobe
      raster={raster}
      vector={vector}
      overlayUrl={overlayUrl}
      selectedBounds={selectedWgs84Bounds}
      opacity={opacity}
      showRaster={showRaster}
      showVector={showVector}
      fitBounds={fitBounds3d ?? rasterWgs84Bounds ?? vectorWgs84Bounds ?? selectedWgs84Bounds}
      fitNonce={fitNonce}
    />
  )}
</main>
```

- [ ] **Step 9: Run build**

Run:

```powershell
cd frontend
npm run build
```

Expected: build succeeds. If it fails, fix TypeScript errors caused by prop types or imports only.

- [ ] **Step 10: Run helper tests**

Run:

```powershell
cd frontend
npm test
```

Expected: all helper tests pass.

- [ ] **Step 11: Skip commit**

Do not run `git commit` because this workspace is not a git repository.

---

### Task 5: Add Styling For 3D Mode

**Files:**
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add desktop 3D styles before the existing media query**

```css
.view-switch {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 520;
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(86px, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid #d7dee8;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12);
}

.view-switch button {
  width: auto;
  min-height: 34px;
  margin-top: 0;
  border-color: transparent;
  border-radius: 6px;
  color: #334155;
  background: transparent;
}

.view-switch button.selected {
  color: #ffffff;
  background: #2563eb;
}

.cesium-shell {
  position: relative;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background: #0f172a;
}

.cesium-viewer {
  height: 100%;
  width: 100%;
}

.cesium-status {
  position: absolute;
  right: 16px;
  bottom: 18px;
  z-index: 510;
  max-width: min(420px, calc(100vw - 420px));
  padding: 9px 12px;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.82);
  color: #f8fafc;
  font-size: 12px;
  line-height: 1.45;
}
```

- [ ] **Step 2: Add responsive 3D styles inside the existing `@media (max-width: 860px)` block**

```css
  .view-switch {
    top: 52px;
    right: 10px;
    grid-template-columns: repeat(2, minmax(72px, 1fr));
  }

  .cesium-shell {
    height: 68vh;
  }

  .cesium-status {
    right: 10px;
    bottom: 12px;
    max-width: calc(100vw - 20px);
  }
```

- [ ] **Step 3: Run build**

Run:

```powershell
cd frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Run helper tests**

Run:

```powershell
cd frontend
npm test
```

Expected: all helper tests pass.

- [ ] **Step 5: Skip commit**

Do not run `git commit` because this workspace is not a git repository.

---

### Task 6: Final Verification

**Files:**
- Verify: `frontend/src/main.tsx`
- Verify: `frontend/src/CesiumGlobe.tsx`
- Verify: `frontend/src/styles.css`
- Verify: `frontend/.env.example`
- Verify: `frontend/package.json`

- [ ] **Step 1: Run helper tests**

Run:

```powershell
cd frontend
npm test
```

Expected: all helper tests pass.

- [ ] **Step 2: Run production build**

Run:

```powershell
cd frontend
npm run build
```

Expected: build exits with code 0 and emits `dist`.

- [ ] **Step 3: Start the frontend dev server**

Run:

```powershell
cd frontend
npm run dev
```

Expected: Vite starts on `http://127.0.0.1:5173`.

- [ ] **Step 4: Manual browser check**

Open `http://127.0.0.1:5173` and verify:

- 2D mode renders the existing Leaflet map.
- The `2D 地图 / 3D 地形` switch is visible in the map area.
- 3D mode renders the Cesium globe.
- Without a local `.env` token, the 3D status says terrain token is not configured.
- With `frontend/.env` containing `VITE_CESIUM_ION_TOKEN=<real token>`, the 3D status says World Terrain is enabled after restarting Vite.

- [ ] **Step 5: Stop the dev server when verification is finished**

Use `Ctrl+C` in the terminal session running Vite.

---

## Self-Review

- Spec coverage: all goals map to tasks. 2D/3D switch is Task 4. Token configuration is Tasks 1 and 2. Cesium World Terrain selection is Task 3. Existing 2D preservation is Task 4 conditional rendering. 3D overlays are Task 3. Verification is Task 6.
- Placeholder scan: no `TBD`, `TODO`, or undefined implementation instructions remain. The token placeholder appears only as the literal value for `.env.example` and test rejection.
- Type consistency: `Wgs84Bounds` is defined in `cesiumBounds.ts` and used consistently by `main.tsx` and `CesiumGlobe.tsx`.
