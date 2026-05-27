# Remote Sensing Analysis Platform Design

## Goal

Turn the current Cesium-only remote sensing prototype into a platform-style analysis workspace. The first platform prototype should keep the existing GeoTIFF, Shapefile, GEE, Cesium 2D/2.5D/3D, box selection, and pixel query workflows, then add professional analysis modules for spectral indices and change detection.

The priority analysis groups are:

- Spectral index analysis: NDVI, NDWI, NDBI, false-color display, threshold extraction, and statistics.
- Change detection: two-temporal raster selection, index differencing, change thresholding, and area statistics.

## Current Context

The app is a React + TypeScript + CesiumJS frontend with a FastAPI + rasterio backend.

Existing frontend state lives mainly in `frontend/src/main.tsx`. Map rendering and interaction are in `frontend/src/CesiumWorkspace.tsx`. Existing backend endpoints support raster upload, preview PNG generation, pixel sampling, Shapefile upload, and GEE download/fetch.

Several user-facing Chinese strings in `README.md`, tests, and `CesiumWorkspace.tsx` are mojibake and should be repaired as part of the platform polish.

## Recommended Approach

Build a staged platform prototype rather than a UI-only shell or full production system.

This keeps the implementation realistic for the current project while still producing real professional functionality. The prototype should include actual backend analysis endpoints, frontend parameter panels, result layers, and downloadable outputs. It should avoid heavier production features such as user accounts, persistent databases, distributed task queues, and project permissions.

## Workspace Layout

The page should become a four-zone remote sensing workspace:

1. Left data panel
   - GeoTIFF upload.
   - zipped Shapefile upload.
   - GEE fetch controls.
   - Primary raster and optional comparison raster slots.
   - Basic raster metadata.

2. Center Cesium workspace
   - Single Cesium canvas.
   - 2D, 2.5D, and 3D view modes.
   - Raster, vector, selected area, analysis result overlays.
   - Box selection and point query.
   - Zoom-to controls for raster, vector, selected area, and analysis results.

3. Right analysis panel
   - Analysis tabs: spectral indices, change detection, results.
   - Index parameter controls.
   - Change detection controls.
   - Threshold and output style controls.
   - Current statistics summary.

4. Bottom result drawer
   - Analysis history for this browser session.
   - Result layer toggles.
   - Opacity control per result.
   - Download links for PNG preview, GeoTIFF output, and JSON statistics.

The interface should feel like an operational GIS/remote sensing tool: compact controls, clear grouping, dense information, and restrained styling. It should not become a marketing-style landing page.

## Frontend Data Model

Introduce explicit client-side types for analysis outputs:

```ts
type AnalysisKind = 'index' | 'change';

type AnalysisResult = {
  id: string;
  kind: AnalysisKind;
  name: string;
  rasterId: string;
  comparisonRasterId?: string;
  layerUrl: string;
  downloadUrl: string;
  statsUrl: string;
  boundsWgs84: [number, number, number, number] | null;
  opacity: number;
  visible: boolean;
  createdAt: string;
  summary: Record<string, number | string | null>;
};
```

The existing primary raster should remain simple. Add an optional comparison raster slot for change detection. GEE fetch may populate either the primary slot or comparison slot depending on the active data target.

## Backend Analysis Outputs

Analysis outputs should be written under `data/outputs/<analysis_id>/`:

- `result.tif`: georeferenced output raster.
- `preview.png`: styled overlay for Cesium.
- `stats.json`: numeric summary.

The API should return a small metadata envelope:

```json
{
  "id": "analysis-id",
  "kind": "index",
  "name": "NDVI",
  "boundsWgs84": [113.1, 22.4, 114.5, 23.2],
  "previewUrl": "/analysis/analysis-id/preview.png",
  "downloadUrl": "/analysis/analysis-id/result.tif",
  "statsUrl": "/analysis/analysis-id/stats.json",
  "summary": {
    "validPixels": 12345,
    "min": -0.2,
    "max": 0.86,
    "mean": 0.42
  }
}
```

## Spectral Index Module

The frontend should expose these controls:

- Index type: NDVI, NDWI, NDBI.
- Band mapping:
  - NDVI: NIR and Red.
  - NDWI: Green and NIR.
  - NDBI: SWIR and NIR.
- Optional selected-area clipping.
- Threshold extraction toggle.
- Threshold min/max values.
- Output palette: continuous index or binary mask.

The backend should implement:

- `POST /analysis/index`
  - Inputs: `image_id`, `index_type`, band indices, optional WGS84 bounds, optional threshold.
  - Formula: `(A - B) / (A + B)`.
  - Nodata and divide-by-zero handling.
  - Cropping by selected WGS84 bounds when provided.
  - Statistics: valid pixels, min, max, mean, std, threshold area if threshold is enabled.

Preview styling:

- Continuous index: blue/white/green or brown/yellow/green.
- Binary mask: transparent background with highlighted positive pixels.

## Change Detection Module

The frontend should expose these controls:

- Before raster slot.
- After raster slot.
- Index type: NDVI, NDWI, NDBI.
- Band mapping for each raster, defaulting to the same mapping when possible.
- Optional selected-area clipping.
- Difference threshold.
- Change categories:
  - increase.
  - decrease.
  - stable.

The backend should implement:

- `POST /analysis/change`
  - Inputs: `before_image_id`, `after_image_id`, `index_type`, band mappings, optional WGS84 bounds, threshold.
  - Align the after raster to the before raster grid where needed using rasterio reprojection/resampling.
  - Compute index for each raster, then `after_index - before_index`.
  - Classify pixels into increase, decrease, and stable.
  - Statistics: pixel counts and approximate area by class, min/max/mean/std of difference.

Preview styling:

- Increase: green.
- Decrease: red.
- Stable: transparent or light gray.

## Cesium Integration

`CesiumWorkspace` should support multiple analysis result overlays in addition to the primary raster overlay. Each result layer should be created from a `SingleTileImageryProvider` using the result preview URL and WGS84 bounds.

The workspace should keep these interactions:

- 2D, 2.5D, and 3D switching.
- Terrain and OSM building toggles when Cesium ion is configured.
- Selected-area rectangle.
- Picked coordinate marker and raster sample query.
- Zoom-to current result.

All Cesium toolbar and status text should be repaired to valid Simplified Chinese.

## Error Handling

Frontend:

- Disable analysis buttons when required rasters or band mappings are missing.
- Show clear errors for invalid band indices, missing CRS, missing bounds, and unsupported raster alignment.
- Keep previous result layers visible when a new analysis request fails.
- Show a busy state during analysis.

Backend:

- Validate image ids.
- Validate band indices against raster band count.
- Reject rasters without CRS for geospatial analysis.
- Return HTTP 400 for incompatible inputs with readable Chinese or English details.
- Avoid crashing on all-nodata windows or divide-by-zero arrays.

## Testing

Frontend tests should cover:

- Analysis result type/source structure where feasible.
- Analysis UI source contains no Leaflet imports.
- Cesium result overlay support is wired by prop and helper names.
- Mojibake strings in key source files are repaired.

Backend tests or lightweight verification should cover:

- Index formula on a small synthetic raster.
- Threshold statistics.
- Change detection classification on aligned synthetic rasters.
- API import/compile checks.

Manual verification should include:

- Upload a GeoTIFF and render it in Cesium.
- Run NDVI or another selected index.
- Toggle result layer visibility and opacity.
- Download result files.
- Upload or fetch a second raster and run change detection.
- Confirm 2D, 2.5D, 3D, box selection, and point query still work.

## Out Of Scope For This Prototype

- User accounts and authentication.
- Persistent project database.
- Distributed task queue.
- Multi-user collaboration.
- Full supervised classification workflow.
- Cloud-optimized tile pyramids.
- Production-grade large-raster processing.

## Acceptance Criteria

- The app presents a platform-style remote sensing workspace with data, map, analysis, and result areas.
- User-facing Chinese text in touched files is readable.
- Users can run at least one spectral index analysis and see the result as a Cesium overlay.
- Users can run a two-temporal change detection analysis and see increase/decrease/stable output.
- Analysis result statistics are displayed in the UI and available as JSON.
- Result GeoTIFF and preview PNG are downloadable.
- Existing upload, Shapefile, GEE fetch, box selection, point query, and Cesium view mode workflows remain usable.
- Frontend build and available tests pass.
