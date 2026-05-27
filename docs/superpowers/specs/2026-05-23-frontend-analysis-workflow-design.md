# Frontend Analysis Workflow Design

## Goal

Improve the current remote sensing analysis frontend so users can configure spectral index and change detection analyses with clearer band semantics, inspect before/after imagery in Cesium, and understand analysis outputs without opening raw JSON first.

This design focuses on the frontend experience. It keeps the existing FastAPI analysis endpoints and file output model, and only relies on backend changes if the current single analysis result cannot expose both continuous index and threshold extraction previews.

## Scope

In scope:

- Strengthen the right-side analysis panel for NDVI, NDWI, and NDBI.
- Show whether A/B bands were automatically matched from band descriptions.
- Split change detection band confirmation into before and after sections.
- Add comparison raster overlay controls in Cesium.
- Make analysis results explain input imagery, bands, thresholds, area units, valid ratios, and overlap ratios.
- Ensure continuous numeric index output and threshold extraction output can both be overlaid in Cesium when threshold extraction is enabled.
- Keep the compact operational GIS style already used by the app.

Out of scope:

- User accounts, databases, task queues, or project management.
- A full backend module split.
- A production tile server or COG pyramid service.
- New supervised classification or machine learning analysis.

## Current Context

The app already has:

- `frontend/src/main.tsx` with primary raster state, comparison raster state, GEE fetching, analysis requests, and result modal state.
- `frontend/src/CesiumWorkspace.tsx` with primary raster imagery, vector overlays, selected rectangle, point picking, and analysis result overlays using `SingleTileImageryProvider`.
- `frontend/src/styles.css` with the current three-column workspace and modal styling.
- `backend/app/main.py` returning analysis result metadata, preview PNG, GeoTIFF, and `stats.json`.

The frontend already stores `validRatio`, `areaUnit`, and `overlapRatio` in result summaries, but the analysis workflow still needs clearer explanation and stronger visual controls.

## User Experience Design

### Analysis Parameter Panel

The "专业分析" panel should show a compact index guide near the index selector:

- NDVI: vegetation, recommended A/B = NIR / Red.
- NDWI: water, recommended A/B = Green / NIR.
- NDBI: built-up area, recommended A/B = SWIR / NIR.

For the active raster, the UI should show one of two states:

- Matched: band names were recognized and mapped to concrete band numbers.
- Manual check needed: required semantic bands were not recognized, so the user should confirm A/B manually.

The A/B inputs remain editable. Automatic matching fills them when possible, but the UI should not silently hide the band source from the user.

### Change Detection Panel

Change detection should display before and after band mappings separately:

- Before: primary raster A/B.
- After: comparison raster A/B.

Both sections should show filename, recognized semantic bands, and editable numeric inputs. When both images have compatible recognized band names, the defaults should be filled automatically. When either image cannot be matched, the panel should show a manual confirmation hint rather than silently reusing the primary band numbers.

### Comparison Raster Overlay

`CesiumWorkspace` should accept and render an optional comparison raster overlay in addition to the primary raster overlay.

The layer controls should include:

- Primary raster visibility and opacity.
- Comparison raster visibility and opacity.
- Analysis result visibility and opacity per result.

This lets users visually check whether two temporal images cover the same area before running change detection.

### Analysis Result Modal

Each result row should display:

- Analysis name and creation time.
- Analysis kind: index or change detection.
- Input image filename, and comparison filename when present.
- Band mapping used by the request.
- Threshold configuration if used.
- Quality fields: `validRatio`, `overlapRatio`, `areaUnit`, and relevant pixel counts.

The modal should keep existing controls:

- Show/hide result layer.
- Opacity slider.
- Zoom to result.
- Download GeoTIFF.
- Open stats JSON.

Change detection results should include a fixed legend:

- Increase: green.
- Decrease: red.
- Stable: light neutral color.
- Invalid or nodata: transparent.

Index results should include a continuous-value legend matching the preview palette.

### Continuous Index And Threshold Layers

When threshold extraction is disabled, an index analysis produces one Cesium overlay:

- Continuous numeric index preview.

When threshold extraction is enabled, the user should be able to view two logical outputs in Cesium:

- Continuous numeric index preview.
- Threshold extraction mask preview.

Preferred implementation:

- Preserve the current analysis endpoint for the continuous numeric result.
- If the backend currently returns only a threshold-styled preview when thresholds are provided, add a lightweight frontend or backend representation that lets both layers appear in `analysisResults`.
- The continuous result should remain the primary GeoTIFF download.
- The threshold result may be represented as a secondary preview layer tied to the same analysis summary if no separate GeoTIFF is produced.

The result modal should make this clear by showing separate layer toggles such as "数值结果" and "阈值提取" for thresholded index analyses.

## Data Model Adjustments

Extend frontend result state conservatively:

```ts
type AnalysisLayerVariant = {
  id: string;
  label: string;
  layerUrl: string;
  boundsWgs84: [number, number, number, number] | null;
  opacity: number;
  visible: boolean;
  legend: 'index-continuous' | 'index-threshold' | 'change';
};
```

`AnalysisResult` can either keep the existing top-level layer fields for backward compatibility and add `layerVariants`, or migrate rendering to variants while normalizing old results into a single variant.

Request context should be stored on each result:

```ts
type AnalysisRequestContext = {
  indexType: 'NDVI' | 'NDWI' | 'NDBI';
  primaryFilename: string;
  comparisonFilename?: string;
  beforeBandA: number;
  beforeBandB: number;
  afterBandA?: number;
  afterBandB?: number;
  thresholdMin?: number;
  thresholdMax?: number;
  changeThreshold?: number;
  bandMatchStatus: 'matched' | 'manual';
};
```

This context is client-side metadata captured at submit time. It avoids requiring existing backend outputs to be rewritten.

## Visual Style

The interface should stay dense and work-focused:

- Use compact grouped rows for band mappings and quality fields.
- Use restrained status colors for matched/manual warning states.
- Use icon buttons where the meaning is obvious and text buttons for core commands.
- Keep cards only for repeated result rows and modal content.
- Avoid hero layouts, decorative gradients, and large explanatory blocks.
- Preserve readable Chinese labels and avoid mojibake in touched text.

## Error Handling

The frontend should:

- Disable change detection until both primary and comparison rasters exist.
- Warn when auto band matching fails.
- Keep manual numeric inputs available even when matching fails.
- Keep existing result layers visible when a new request fails.
- Avoid opening an empty modal as a success state.

The backend should continue to own authoritative validation for:

- Missing image ids.
- Out-of-range band indices.
- Invalid thresholds.
- Rasters without valid geospatial metadata.

## Testing

Add or update frontend source-level regression tests in `frontend/src/cesiumHelpers.test.ts` for:

- Comparison raster overlay support is wired into `CesiumWorkspace`.
- Analysis UI contains before and after band mapping concepts.
- Index guide mentions NDVI, NDWI, NDBI semantic band requirements.
- Result modal includes quality/context fields such as `validRatio`, `overlapRatio`, and `areaUnit`.
- Thresholded index analyses support distinct continuous and threshold layer concepts.

Verification commands:

```powershell
cd frontend
npm test
npm run build
```

If a backend preview variant is added, also run:

```powershell
cd backend
python -m unittest -v
python -m py_compile app\main.py
```

## Acceptance Criteria

- Users can see what NDVI, NDWI, and NDBI require before running analysis.
- Users can tell whether band mapping was automatic or needs manual confirmation.
- Change detection shows separate before and after band mappings.
- Primary and comparison rasters can both be inspected in Cesium with independent visibility and opacity controls.
- Result rows explain analysis inputs, bands, thresholds, quality ratios, and area unit.
- Thresholded index analysis allows both continuous numeric index and threshold extraction layers to be viewed in Cesium.
- Existing upload, GEE fetch, point query, box selection, result download, and result modal workflows remain usable.
- Frontend tests and build pass.
