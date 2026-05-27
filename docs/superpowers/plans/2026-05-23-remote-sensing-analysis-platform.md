# Remote Sensing Analysis Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a platform-style remote sensing analysis workspace with real spectral index and change detection analysis outputs.

**Architecture:** Keep FastAPI as the analysis backend and React as the workspace state owner. Add focused backend analysis helpers for raster math and output writing, then extend the Cesium workspace to render multiple analysis overlays while the main UI becomes a data/map/analysis/results workbench.

**Tech Stack:** React, TypeScript, CesiumJS, Vite, FastAPI, rasterio, NumPy, Pillow, node:test.

---

## File Structure

- Modify: `backend/app/main.py`
  - Add reusable raster-analysis helpers, spectral index endpoint, change detection endpoint, and result file serving.
- Modify: `frontend/src/main.tsx`
  - Add comparison raster state, analysis result state, analysis panels, result drawer, and readable Chinese UI copy.
- Modify: `frontend/src/CesiumWorkspace.tsx`
  - Repair mojibake strings and add support for multiple analysis result overlays.
- Modify: `frontend/src/cesiumPicking.ts`
  - Repair mojibake output text.
- Modify: `frontend/src/cesiumHelpers.test.ts`
  - Add regression checks for analysis wiring and readable Chinese text.
- Modify: `frontend/src/styles.css`
  - Rework the page into data, map, analysis, and result zones.
- Modify: `README.md`
  - Repair text and document the new platform analysis modules.

## Task 1: Add Backend Spectral Index Analysis

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add analysis imports**

At the top of `backend/app/main.py`, extend the imports:

```python
from rasterio.mask import mask
from rasterio.transform import array_bounds
from rasterio.warp import Resampling as WarpResampling, reproject
from shapely.geometry import box, mapping
```

- [ ] **Step 2: Add analysis directory helper**

Below `_raster_path`, add:

```python
def _analysis_dir(analysis_id: str) -> Path:
    path = OUTPUT_DIR / analysis_id
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Analysis result not found")
    return path
```

- [ ] **Step 3: Add band validation and clipping helpers**

Add these helpers before `_preview_png`:

```python
def _validate_band(ds: rasterio.DatasetReader, band: int, label: str) -> int:
    if band < 1 or band > ds.count:
        raise HTTPException(status_code=400, detail=f"{label} band {band} is out of range")
    return band


def _bounds_geometry_for_dataset(ds: rasterio.DatasetReader, bounds_wgs84: str | None) -> list[dict[str, Any]] | None:
    if not bounds_wgs84:
        return None
    try:
        values = [float(part) for part in bounds_wgs84.split(",")]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="bounds must be west,south,east,north") from exc
    if len(values) != 4:
        raise HTTPException(status_code=400, detail="bounds must contain four numbers")
    west, south, east, north = values
    if east <= west or north <= south:
        raise HTTPException(status_code=400, detail="bounds are invalid")
    transformer = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
    minx, miny = transformer.transform(west, south)
    maxx, maxy = transformer.transform(east, north)
    return [mapping(box(min(minx, maxx), min(miny, maxy), max(minx, maxx), max(miny, maxy)))]


def _read_analysis_bands(
    path: Path,
    band_a: int,
    band_b: int,
    bounds_wgs84: str | None,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any], list[float] | None]:
    with rasterio.open(path) as ds:
        if not ds.crs:
            raise HTTPException(status_code=400, detail="Raster has no CRS")
        _validate_band(ds, band_a, "A")
        _validate_band(ds, band_b, "B")
        shapes = _bounds_geometry_for_dataset(ds, bounds_wgs84)
        if shapes:
            data, transform = mask(ds, shapes, crop=True, indexes=[band_a, band_b], filled=True, nodata=np.nan)
            height, width = data.shape[1], data.shape[2]
            meta = ds.meta.copy()
            meta.update({"height": height, "width": width, "transform": transform, "count": 1, "dtype": "float32", "nodata": np.nan})
            try:
                raw_bounds = array_bounds(height, width, transform)
                out_bounds = list(transform_bounds(ds.crs, "EPSG:4326", *raw_bounds, densify_pts=21))
            except Exception:
                out_bounds = None
            return data[0].astype("float32"), data[1].astype("float32"), meta, out_bounds
        data = ds.read([band_a, band_b], masked=True).astype("float32")
        arr = np.asarray(data.filled(np.nan))
        meta = ds.meta.copy()
        meta.update({"count": 1, "dtype": "float32", "nodata": np.nan})
        return arr[0], arr[1], meta, _wgs84_bounds(ds)
```

- [ ] **Step 4: Add index math, preview, stats, and writer helpers**

Add these helpers after `_read_analysis_bands`:

```python
def _normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    denominator = a + b
    with np.errstate(divide="ignore", invalid="ignore"):
        index = (a - b) / denominator
    index[~np.isfinite(index)] = np.nan
    return index.astype("float32")


def _basic_stats(values: np.ndarray) -> dict[str, Any]:
    valid = values[np.isfinite(values)]
    if valid.size == 0:
        return {"validPixels": 0, "min": None, "max": None, "mean": None, "std": None}
    return {
        "validPixels": int(valid.size),
        "min": float(np.min(valid)),
        "max": float(np.max(valid)),
        "mean": float(np.mean(valid)),
        "std": float(np.std(valid)),
    }


def _index_preview(index: np.ndarray, threshold_min: float | None, threshold_max: float | None) -> Image.Image:
    valid = np.isfinite(index)
    rgba = np.zeros((*index.shape, 4), dtype=np.uint8)
    if threshold_min is not None or threshold_max is not None:
        lo = -np.inf if threshold_min is None else threshold_min
        hi = np.inf if threshold_max is None else threshold_max
        mask_arr = valid & (index >= lo) & (index <= hi)
        rgba[mask_arr] = [34, 197, 94, 210]
        return Image.fromarray(rgba, mode="RGBA")
    scaled = np.clip((np.nan_to_num(index, nan=-1.0) + 1.0) / 2.0, 0, 1)
    rgba[..., 0] = ((1.0 - scaled) * 88 + scaled * 22).astype(np.uint8)
    rgba[..., 1] = ((1.0 - scaled) * 120 + scaled * 163).astype(np.uint8)
    rgba[..., 2] = ((1.0 - scaled) * 188 + scaled * 74).astype(np.uint8)
    rgba[..., 3] = valid.astype(np.uint8) * 220
    return Image.fromarray(rgba, mode="RGBA")


def _write_analysis_output(
    kind: str,
    name: str,
    values: np.ndarray,
    meta: dict[str, Any],
    bounds_wgs84: list[float] | None,
    preview: Image.Image,
    summary: dict[str, Any],
) -> dict[str, Any]:
    analysis_id = uuid.uuid4().hex
    target_dir = OUTPUT_DIR / analysis_id
    target_dir.mkdir(parents=True, exist_ok=True)
    result_path = target_dir / "result.tif"
    preview_path = target_dir / "preview.png"
    stats_path = target_dir / "stats.json"
    write_meta = meta.copy()
    write_meta.update({"driver": "GTiff", "count": 1, "dtype": "float32", "nodata": np.nan})
    with rasterio.open(result_path, "w", **write_meta) as dst:
        dst.write(values.astype("float32"), 1)
    preview.save(preview_path, format="PNG")
    stats_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "id": analysis_id,
        "kind": kind,
        "name": name,
        "boundsWgs84": bounds_wgs84,
        "previewUrl": f"/analysis/{analysis_id}/preview.png",
        "downloadUrl": f"/analysis/{analysis_id}/result.tif",
        "statsUrl": f"/analysis/{analysis_id}/stats.json",
        "summary": summary,
    }
```

- [ ] **Step 5: Add spectral index endpoint**

Add this endpoint after `sample_endpoint`:

```python
@app.post("/analysis/index")
async def analysis_index(
    image_id: str = Form(...),
    index_type: str = Form("NDVI"),
    band_a: int = Form(...),
    band_b: int = Form(...),
    bounds_wgs84: str | None = Form(None),
    threshold_min: float | None = Form(None),
    threshold_max: float | None = Form(None),
) -> dict[str, Any]:
    index_name = index_type.upper()
    if index_name not in {"NDVI", "NDWI", "NDBI"}:
        raise HTTPException(status_code=400, detail="index_type must be NDVI, NDWI, or NDBI")
    a, b, meta, out_bounds = _read_analysis_bands(_raster_path(image_id), band_a, band_b, bounds_wgs84)
    index = _normalized_difference(a, b)
    summary = _basic_stats(index)
    if threshold_min is not None or threshold_max is not None:
        lo = -np.inf if threshold_min is None else threshold_min
        hi = np.inf if threshold_max is None else threshold_max
        threshold_mask = np.isfinite(index) & (index >= lo) & (index <= hi)
        pixel_area = abs(float(meta["transform"].a) * float(meta["transform"].e))
        summary["thresholdPixels"] = int(np.count_nonzero(threshold_mask))
        summary["thresholdArea"] = float(np.count_nonzero(threshold_mask) * pixel_area)
    preview = _index_preview(index, threshold_min, threshold_max)
    return _write_analysis_output("index", index_name, index, meta, out_bounds, preview, summary)
```

- [ ] **Step 6: Add analysis file endpoints**

Add these endpoints near the analysis endpoint:

```python
@app.get("/analysis/{analysis_id}/preview.png")
def analysis_preview(analysis_id: str) -> Response:
    path = _analysis_dir(analysis_id) / "preview.png"
    return Response(content=path.read_bytes(), media_type="image/png")


@app.get("/analysis/{analysis_id}/result.tif")
def analysis_result(analysis_id: str) -> Response:
    path = _analysis_dir(analysis_id) / "result.tif"
    return Response(content=path.read_bytes(), media_type="image/tiff")


@app.get("/analysis/{analysis_id}/stats.json")
def analysis_stats(analysis_id: str) -> dict[str, Any]:
    path = _analysis_dir(analysis_id) / "stats.json"
    return json.loads(path.read_text(encoding="utf-8"))
```

- [ ] **Step 7: Verify backend import**

Run:

```powershell
cd backend
python -m py_compile app\main.py
```

Expected: exits with code 0.

## Task 2: Add Backend Change Detection

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add aligned raster read helper**

Add this helper after `_read_analysis_bands`:

```python
def _read_aligned_index(
    path: Path,
    band_a: int,
    band_b: int,
    target_meta: dict[str, Any],
    bounds_wgs84: str | None,
) -> np.ndarray:
    with rasterio.open(path) as ds:
        if not ds.crs:
            raise HTTPException(status_code=400, detail="Raster has no CRS")
        _validate_band(ds, band_a, "A")
        _validate_band(ds, band_b, "B")
        a = np.empty((target_meta["height"], target_meta["width"]), dtype="float32")
        b = np.empty((target_meta["height"], target_meta["width"]), dtype="float32")
        reproject(
            source=rasterio.band(ds, band_a),
            destination=a,
            src_transform=ds.transform,
            src_crs=ds.crs,
            dst_transform=target_meta["transform"],
            dst_crs=target_meta["crs"],
            resampling=WarpResampling.bilinear,
            dst_nodata=np.nan,
        )
        reproject(
            source=rasterio.band(ds, band_b),
            destination=b,
            src_transform=ds.transform,
            src_crs=ds.crs,
            dst_transform=target_meta["transform"],
            dst_crs=target_meta["crs"],
            resampling=WarpResampling.bilinear,
            dst_nodata=np.nan,
        )
    return _normalized_difference(a, b)
```

- [ ] **Step 2: Add change preview helper**

Add this helper after `_index_preview`:

```python
def _change_preview(classes: np.ndarray) -> Image.Image:
    rgba = np.zeros((*classes.shape, 4), dtype=np.uint8)
    rgba[classes == 1] = [34, 197, 94, 220]
    rgba[classes == -1] = [239, 68, 68, 220]
    rgba[classes == 0] = [226, 232, 240, 80]
    return Image.fromarray(rgba, mode="RGBA")
```

- [ ] **Step 3: Add change detection endpoint**

Add this endpoint after `analysis_index`:

```python
@app.post("/analysis/change")
async def analysis_change(
    before_image_id: str = Form(...),
    after_image_id: str = Form(...),
    index_type: str = Form("NDVI"),
    before_band_a: int = Form(...),
    before_band_b: int = Form(...),
    after_band_a: int = Form(...),
    after_band_b: int = Form(...),
    bounds_wgs84: str | None = Form(None),
    threshold: float = Form(0.2),
) -> dict[str, Any]:
    index_name = index_type.upper()
    if index_name not in {"NDVI", "NDWI", "NDBI"}:
        raise HTTPException(status_code=400, detail="index_type must be NDVI, NDWI, or NDBI")
    if threshold <= 0:
        raise HTTPException(status_code=400, detail="threshold must be greater than 0")
    before_a, before_b, meta, out_bounds = _read_analysis_bands(
        _raster_path(before_image_id),
        before_band_a,
        before_band_b,
        bounds_wgs84,
    )
    before_index = _normalized_difference(before_a, before_b)
    after_index = _read_aligned_index(
        _raster_path(after_image_id),
        after_band_a,
        after_band_b,
        meta,
        bounds_wgs84,
    )
    diff = after_index - before_index
    valid = np.isfinite(diff)
    classes = np.full(diff.shape, 99, dtype="int16")
    classes[valid & (diff > threshold)] = 1
    classes[valid & (diff < -threshold)] = -1
    classes[valid & (np.abs(diff) <= threshold)] = 0
    pixel_area = abs(float(meta["transform"].a) * float(meta["transform"].e))
    summary = _basic_stats(diff)
    increase_pixels = int(np.count_nonzero(classes == 1))
    decrease_pixels = int(np.count_nonzero(classes == -1))
    stable_pixels = int(np.count_nonzero(classes == 0))
    summary.update({
        "increasePixels": increase_pixels,
        "decreasePixels": decrease_pixels,
        "stablePixels": stable_pixels,
        "increaseArea": float(increase_pixels * pixel_area),
        "decreaseArea": float(decrease_pixels * pixel_area),
        "stableArea": float(stable_pixels * pixel_area),
        "threshold": float(threshold),
    })
    preview = _change_preview(classes)
    return _write_analysis_output("change", f"{index_name}变化检测", diff, meta, out_bounds, preview, summary)
```

- [ ] **Step 4: Verify backend import**

Run:

```powershell
cd backend
python -m py_compile app\main.py
```

Expected: exits with code 0.

## Task 3: Add Frontend Analysis Types And API Calls

**Files:**
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Add analysis UI labels**

Extend the `ui` object in `frontend/src/main.tsx` with readable Chinese labels for platform layout, analysis tabs, result drawer, and change detection.

- [ ] **Step 2: Add analysis types**

Below `VectorInfo`, add:

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
  boundsWgs84: Wgs84Bounds | null;
  opacity: number;
  visible: boolean;
  createdAt: string;
  summary: Record<string, number | string | null>;
};
```

- [ ] **Step 3: Add API response mapper**

Below `uploadFile`, add:

```ts
function normalizeAnalysisResult(
  body: any,
  rasterId: string,
  comparisonRasterId?: string,
): AnalysisResult {
  return {
    id: body.id,
    kind: body.kind,
    name: body.name,
    rasterId,
    comparisonRasterId,
    layerUrl: `${API_BASE}${body.previewUrl}`,
    downloadUrl: `${API_BASE}${body.downloadUrl}`,
    statsUrl: `${API_BASE}${body.statsUrl}`,
    boundsWgs84: normalizeWgs84Bounds(body.boundsWgs84),
    opacity: 0.72,
    visible: true,
    createdAt: new Date().toLocaleString(),
    summary: body.summary ?? {},
  };
}
```

- [ ] **Step 4: Add state**

Inside `App`, add state for:

```ts
const [comparisonRaster, setComparisonRaster] = useState<RasterInfo | null>(null);
const [dataTarget, setDataTarget] = useState<'primary' | 'comparison'>('primary');
const [analysisTab, setAnalysisTab] = useState<'index' | 'change' | 'results'>('index');
const [indexType, setIndexType] = useState<'NDVI' | 'NDWI' | 'NDBI'>('NDVI');
const [bandA, setBandA] = useState(4);
const [bandB, setBandB] = useState(3);
const [thresholdEnabled, setThresholdEnabled] = useState(false);
const [thresholdMin, setThresholdMin] = useState(0.2);
const [thresholdMax, setThresholdMax] = useState(1);
const [changeThreshold, setChangeThreshold] = useState(0.2);
const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
const [activeResultId, setActiveResultId] = useState<string | null>(null);
```

- [ ] **Step 5: Add analysis request functions**

Inside `App`, add `runIndexAnalysis` and `runChangeDetection` using `fetch` and `FormData`.

- [ ] **Step 6: Update clearAll**

Extend `clearAll` to clear comparison raster and analysis results.

## Task 4: Rework Frontend Layout

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Change top-level shell**

Replace the current two-column layout with:

```tsx
<div className="app platform-app">
  <aside className="sidebar data-sidebar">...</aside>
  <main className="map-shell">...</main>
  <aside className="analysis-sidebar">...</aside>
  <section className="result-drawer">...</section>
</div>
```

- [ ] **Step 2: Add comparison raster upload target controls**

Add a segmented control in the data panel that decides whether uploads and GEE fetches populate the primary raster or comparison raster.

- [ ] **Step 3: Add analysis panel tabs**

Add buttons for index, change, and results tabs. Render controls for the active tab.

- [ ] **Step 4: Add result drawer**

Render `analysisResults` as compact rows with visibility, opacity, zoom, and download controls.

- [ ] **Step 5: Update CSS grid**

Change `.app` to a three-column plus bottom drawer layout on desktop and a stacked layout on mobile:

```css
.platform-app {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr) 360px;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 100vh;
}
```

## Task 5: Add Cesium Analysis Overlays And Repair Copy

**Files:**
- Modify: `frontend/src/CesiumWorkspace.tsx`
- Modify: `frontend/src/cesiumPicking.ts`
- Modify: `frontend/src/cesiumHelpers.test.ts`

- [ ] **Step 1: Add AnalysisResult prop type**

In `CesiumWorkspace.tsx`, add a local prop-compatible result type:

```ts
type AnalysisLayerInfo = {
  id: string;
  layerUrl: string;
  boundsWgs84: Wgs84Bounds | null;
  opacity: number;
  visible: boolean;
};
```

- [ ] **Step 2: Add prop**

Add `analysisLayers: AnalysisLayerInfo[]` to `CesiumWorkspaceProps`.

- [ ] **Step 3: Add analysis layer refs**

Add:

```ts
const analysisLayerRefs = React.useRef(new Map<string, ImageryLayer>());
```

- [ ] **Step 4: Add effect to sync result overlays**

Add an effect that removes stale analysis layers and adds visible layers using `SingleTileImageryProvider`, `layerUrl`, bounds, and opacity.

- [ ] **Step 5: Repair Chinese strings**

Replace mojibake strings in `CesiumWorkspace.tsx` and `cesiumPicking.ts` with readable Chinese.

- [ ] **Step 6: Add frontend regression tests**

Extend `cesiumHelpers.test.ts` with source checks for `analysisLayers` and absence of known mojibake fragments.

## Task 6: Update Documentation And Verify

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README Chinese text**

Replace mojibake with readable Chinese that documents the app, startup commands, GEE setup, Cesium token, and analysis modules.

- [ ] **Step 2: Run frontend tests**

Run:

```powershell
cd frontend
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run frontend build**

Run:

```powershell
cd frontend
npm run build
```

Expected: build exits with code 0.

- [ ] **Step 4: Run backend compile check**

Run:

```powershell
cd backend
python -m py_compile app\main.py
```

Expected: exits with code 0.
