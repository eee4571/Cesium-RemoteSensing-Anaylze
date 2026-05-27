# Frontend Analysis Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the remote sensing analysis frontend with clearer band semantics, comparison raster overlay controls, richer result context, and separate Cesium overlays for continuous index values and threshold extraction masks.

**Architecture:** Keep the current React state ownership in `frontend/src/main.tsx` and the current Cesium rendering boundary in `frontend/src/CesiumWorkspace.tsx`. Add a small backend preview-variant extension so thresholded index analyses can expose both the continuous-value preview and the threshold-mask preview without changing the primary GeoTIFF output model.

**Tech Stack:** React, TypeScript, CSS, CesiumJS, FastAPI, rasterio, Pillow, node:test.

---

## File Structure

- Modify: `frontend/src/cesiumHelpers.test.ts`
  - Add source-level regression tests for comparison raster layers, index guide text, before/after band mapping, result context, and threshold layer variants.
- Modify: `backend/app/main.py`
  - Split index preview generation into continuous and threshold variants.
  - Write optional extra preview PNG files under `data/outputs/<analysis_id>/`.
  - Return `previewVariants` in `/analysis/index` responses when threshold extraction is enabled.
- Modify: `frontend/src/CesiumWorkspace.tsx`
  - Add comparison raster overlay props and layer lifecycle.
  - Keep analysis layer handling compatible with flattened layer variants.
- Modify: `frontend/src/main.tsx`
  - Add index semantic metadata and band-match status helpers.
  - Add before/after band state for change detection.
  - Add comparison overlay visibility and opacity state.
  - Normalize analysis result layer variants.
  - Capture request context and display result context in the modal.
- Modify: `frontend/src/styles.css`
  - Add compact analysis guide, band mapping, layer variant, legend, and result context styles.

This workspace is not a git repository, so commit steps are intentionally omitted. Verification commands are still required.

## Task 1: Add Frontend Regression Tests

**Files:**
- Modify: `frontend/src/cesiumHelpers.test.ts`

- [ ] **Step 1: Add comparison overlay test**

Append this test near the existing Cesium overlay tests:

```ts
test('CesiumWorkspace accepts comparison raster overlay controls', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('comparisonRaster: RasterInfo | null'));
  assert.ok(source.includes('comparisonOverlayUrl: string | null'));
  assert.ok(source.includes('comparisonLayerRef'));
  assert.ok(source.includes('showComparisonRaster'));
  assert.ok(source.includes('comparisonOpacity'));
});
```

- [ ] **Step 2: Add analysis workflow source test**

Append this test near the existing `main exposes platform analysis workspace state and actions` test:

```ts
test('analysis UI explains index semantics and separate before after band mappings', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  assert.ok(source.includes('INDEX_GUIDE'));
  assert.ok(source.includes('NIR / Red'));
  assert.ok(source.includes('Green / NIR'));
  assert.ok(source.includes('SWIR / NIR'));
  assert.ok(source.includes('beforeBandA'));
  assert.ok(source.includes('afterBandA'));
  assert.ok(source.includes('band-match'));
});
```

- [ ] **Step 3: Add result variant source test**

Append this test near the existing analysis summary test:

```ts
test('analysis results support context fields and multiple layer variants', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  assert.ok(source.includes('type AnalysisLayerVariant'));
  assert.ok(source.includes('layerVariants'));
  assert.ok(source.includes('requestContext'));
  assert.ok(source.includes('index-continuous'));
  assert.ok(source.includes('index-threshold'));
  assert.ok(source.includes('数值结果'));
  assert.ok(source.includes('阈值提取'));
});
```

- [ ] **Step 4: Run frontend tests and verify failure**

Run:

```powershell
cd frontend
npm test
```

Expected: FAIL. The new tests should fail because comparison overlay props, `INDEX_GUIDE`, before/after band state, and layer variants have not been implemented yet.

## Task 2: Add Backend Preview Variants For Thresholded Index Results

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add backend unit test coverage**

Modify `backend/test_main.py` by adding this import if it is missing:

```py
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
```

Then add this test case:

```py
def test_index_analysis_returns_continuous_and_threshold_preview_variants():
    from app.main import analysis_index

    async def run_test():
        with tempfile.TemporaryDirectory() as tmp:
            from app import main

            upload_dir = Path(tmp) / "uploads"
            output_dir = Path(tmp) / "outputs"
            upload_dir.mkdir()
            output_dir.mkdir()
            old_upload_dir = main.UPLOAD_DIR
            old_output_dir = main.OUTPUT_DIR
            main.UPLOAD_DIR = upload_dir
            main.OUTPUT_DIR = output_dir
            try:
                raster_path = upload_dir / "sample.tif"
                transform = from_origin(100, 30, 10, 10)
                data = np.array(
                    [
                        [[0.8, 0.7], [0.1, 0.2]],
                        [[0.2, 0.3], [0.1, 0.2]],
                    ],
                    dtype="float32",
                )
                with rasterio.open(
                    raster_path,
                    "w",
                    driver="GTiff",
                    width=2,
                    height=2,
                    count=2,
                    dtype="float32",
                    crs="EPSG:3857",
                    transform=transform,
                ) as dst:
                    dst.write(data)

                result = await analysis_index(
                    image_id="sample",
                    index_type="NDVI",
                    band_a=1,
                    band_b=2,
                    bounds_wgs84=None,
                    threshold_min=0.2,
                    threshold_max=1.0,
                )
                assert "previewVariants" in result
                assert result["previewVariants"][0]["id"] == "continuous"
                assert result["previewVariants"][0]["legend"] == "index-continuous"
                assert result["previewVariants"][1]["id"] == "threshold"
                assert result["previewVariants"][1]["legend"] == "index-threshold"
                assert (output_dir / result["id"] / "preview.png").exists()
                assert (output_dir / result["id"] / "preview-threshold.png").exists()
            finally:
                main.UPLOAD_DIR = old_upload_dir
                main.OUTPUT_DIR = old_output_dir

    import asyncio

    asyncio.run(run_test())
```

- [ ] **Step 2: Run backend tests and verify failure**

Run:

```powershell
cd backend
python -m unittest -v
```

Expected: FAIL with an assertion that `previewVariants` is missing.

- [ ] **Step 3: Split index preview helpers**

In `backend/app/main.py`, replace `_index_preview` with these three functions:

```py
def _index_continuous_preview(index: np.ndarray) -> Image.Image:
    valid = np.isfinite(index)
    rgba = np.zeros((*index.shape, 4), dtype=np.uint8)
    scaled = np.clip((np.nan_to_num(index, nan=-1.0) + 1.0) / 2.0, 0, 1)
    rgba[..., 0] = ((1.0 - scaled) * 88 + scaled * 22).astype(np.uint8)
    rgba[..., 1] = ((1.0 - scaled) * 120 + scaled * 163).astype(np.uint8)
    rgba[..., 2] = ((1.0 - scaled) * 188 + scaled * 74).astype(np.uint8)
    rgba[..., 3] = valid.astype(np.uint8) * 220
    return Image.fromarray(rgba, mode="RGBA")


def _index_threshold_preview(index: np.ndarray, threshold_min: float | None, threshold_max: float | None) -> Image.Image:
    valid = np.isfinite(index)
    rgba = np.zeros((*index.shape, 4), dtype=np.uint8)
    lo = -np.inf if threshold_min is None else threshold_min
    hi = np.inf if threshold_max is None else threshold_max
    mask_arr = valid & (index >= lo) & (index <= hi)
    rgba[mask_arr] = [34, 197, 94, 210]
    return Image.fromarray(rgba, mode="RGBA")


def _index_preview(index: np.ndarray, threshold_min: float | None, threshold_max: float | None) -> Image.Image:
    if threshold_min is not None or threshold_max is not None:
        return _index_threshold_preview(index, threshold_min, threshold_max)
    return _index_continuous_preview(index)
```

- [ ] **Step 4: Extend `_write_analysis_output`**

Change the function signature:

```py
def _write_analysis_output(
    kind: str,
    name: str,
    values: np.ndarray,
    meta: dict[str, Any],
    bounds_wgs84: list[float] | None,
    preview: Image.Image,
    summary: dict[str, Any],
    extra_previews: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
```

After `preview.save(preview_path, format="PNG")`, add:

```py
    preview_variants = [
        {
            "id": "primary",
            "label": "结果图层",
            "previewUrl": f"/analysis/{analysis_id}/preview.png",
            "legend": "change" if kind == "change" else "index-continuous",
        }
    ]
    for item in extra_previews or []:
        filename = item["filename"]
        item["image"].save(target_dir / filename, format="PNG")
        preview_variants.append({
            "id": item["id"],
            "label": item["label"],
            "previewUrl": f"/analysis/{analysis_id}/{filename}",
            "legend": item["legend"],
        })
```

Then add this field to the returned dict:

```py
        "previewVariants": preview_variants,
```

- [ ] **Step 5: Add generic preview file endpoint**

Below `analysis_preview`, add:

```py
@app.get("/analysis/{analysis_id}/{filename}")
def analysis_preview_file(analysis_id: str, filename: str) -> Response:
    if filename not in {"preview.png", "preview-threshold.png"}:
        raise HTTPException(status_code=404, detail="Preview file not found")
    path = _analysis_dir(analysis_id) / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Preview file not found")
    return Response(content=path.read_bytes(), media_type="image/png")
```

- [ ] **Step 6: Return continuous and threshold variants from `analysis_index`**

In `analysis_index`, replace:

```py
    preview = _index_preview(index, threshold_min, threshold_max)
    return _write_analysis_output("index", index_name, index, meta, out_bounds, preview, summary)
```

with:

```py
    continuous_preview = _index_continuous_preview(index)
    extra_previews = None
    if threshold_min is not None or threshold_max is not None:
        threshold_preview = _index_threshold_preview(index, threshold_min, threshold_max)
        extra_previews = [{
            "id": "threshold",
            "label": "阈值提取",
            "filename": "preview-threshold.png",
            "legend": "index-threshold",
            "image": threshold_preview,
        }]
    return _write_analysis_output(
        "index",
        index_name,
        index,
        meta,
        out_bounds,
        continuous_preview,
        summary,
        extra_previews=extra_previews,
    )
```

- [ ] **Step 7: Run backend verification**

Run:

```powershell
cd backend
python -m unittest -v
python -m py_compile app\main.py
```

Expected: all backend tests pass, and `app\main.py` compiles.

## Task 3: Add Comparison Raster Overlay In Cesium

**Files:**
- Modify: `frontend/src/CesiumWorkspace.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Add comparison props and ref**

In `frontend/src/CesiumWorkspace.tsx`, extend `CesiumWorkspaceProps`:

```ts
  comparisonRaster: RasterInfo | null;
  comparisonOverlayUrl: string | null;
  comparisonOpacity: number;
  showComparisonRaster: boolean;
```

Destructure the new props in `CesiumWorkspace`:

```ts
  comparisonRaster,
  comparisonOverlayUrl,
  comparisonOpacity,
  showComparisonRaster,
```

Add this ref next to `rasterLayerRef`:

```ts
  const comparisonLayerRef = React.useRef<ImageryLayer | null>(null);
```

In the cleanup block, add:

```ts
      comparisonLayerRef.current = null;
```

- [ ] **Step 2: Add comparison layer effect**

Add this effect after the primary raster layer effect:

```ts
  React.useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (comparisonLayerRef.current) {
      viewer.imageryLayers.remove(comparisonLayerRef.current, true);
      comparisonLayerRef.current = null;
    }

    if (!showComparisonRaster || !comparisonOverlayUrl || !comparisonRaster?.boundsWgs84) return;

    const rectangle = rectangleFromBounds(comparisonRaster.boundsWgs84);
    if (!rectangle) {
      setMessage('对比影像缺少有效 WGS84 范围，无法在 Cesium 中叠加');
      return;
    }

    const provider = new SingleTileImageryProvider({
      url: comparisonOverlayUrl,
      rectangle,
      tileWidth: 1024,
      tileHeight: 1024,
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = comparisonOpacity;
    comparisonLayerRef.current = layer;
  }, [comparisonOverlayUrl, comparisonOpacity, comparisonRaster, readyVersion, showComparisonRaster]);

  React.useEffect(() => {
    if (comparisonLayerRef.current) comparisonLayerRef.current.alpha = comparisonOpacity;
  }, [comparisonOpacity]);
```

- [ ] **Step 3: Add comparison state and URL in main**

In `frontend/src/main.tsx`, add UI labels:

```ts
  showComparisonRaster: '显示对比影像',
  comparisonOpacity: '对比影像透明度',
```

Add state next to `showRaster` and `opacity`:

```ts
  const [showComparisonRaster, setShowComparisonRaster] = useState(true);
  const [comparisonOpacity, setComparisonOpacity] = useState(0.55);
```

Add the comparison overlay URL next to `overlayUrl`:

```ts
  const comparisonOverlayUrl = comparisonRaster
    ? `${API_BASE}/images/${comparisonRaster.id}/preview.png?v=comparison`
    : null;
```

- [ ] **Step 4: Wire props into `CesiumWorkspace`**

In the `CesiumWorkspace` JSX, add:

```tsx
          comparisonRaster={comparisonRaster}
          comparisonOverlayUrl={comparisonOverlayUrl}
          comparisonOpacity={comparisonOpacity}
          showComparisonRaster={showComparisonRaster}
```

- [ ] **Step 5: Add layer controls**

In the layer control panel, after the primary raster checkbox, add:

```tsx
          <label className="check-row">
            <input type="checkbox" checked={showComparisonRaster} onChange={(event) => setShowComparisonRaster(event.target.checked)} />
            <span>{ui.showComparisonRaster}</span>
          </label>
          <label className="range-row">
            <span>{ui.comparisonOpacity}</span>
            <input type="range" min="0" max="1" step="0.05" value={comparisonOpacity} onChange={(event) => setComparisonOpacity(Number(event.target.value))} />
          </label>
```

- [ ] **Step 6: Run frontend tests**

Run:

```powershell
cd frontend
npm test
```

Expected: comparison overlay test passes. Other new tests may still fail until later tasks.

## Task 4: Add Band Semantics And Before/After Mapping

**Files:**
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Add index guide metadata**

Replace `INDEX_BAND_PRESETS` with:

```ts
const INDEX_GUIDE = {
  NDVI: { a: 'B8', b: 'B4', formula: 'NIR / Red', meaning: '植被覆盖与长势' },
  NDWI: { a: 'B3', b: 'B8', formula: 'Green / NIR', meaning: '水体与湿润区域' },
  NDBI: { a: 'B11', b: 'B8', formula: 'SWIR / NIR', meaning: '建成区与裸地响应' },
} as const;

const INDEX_BAND_PRESETS = INDEX_GUIDE;
```

- [ ] **Step 2: Add match helper**

Below `resolveIndexPreset`, add:

```ts
type BandMatch = {
  bandA: number;
  bandB: number;
  label: string;
  status: 'matched' | 'manual';
};

function resolveBandMatch(
  raster: RasterInfo | null,
  indexType: keyof typeof INDEX_BAND_PRESETS,
  fallbackA: number,
  fallbackB: number,
): BandMatch {
  const preset = resolveIndexPreset(raster, indexType);
  if (preset) return { ...preset, status: 'matched' };
  return { bandA: fallbackA, bandB: fallbackB, label: `${fallbackA}/${fallbackB}`, status: 'manual' };
}
```

- [ ] **Step 3: Add before/after band state**

Replace the single analysis band states:

```ts
  const [bandA, setBandA] = useState(4);
  const [bandB, setBandB] = useState(3);
```

with:

```ts
  const [bandA, setBandA] = useState(4);
  const [bandB, setBandB] = useState(3);
  const [beforeBandA, setBeforeBandA] = useState(4);
  const [beforeBandB, setBeforeBandB] = useState(3);
  const [afterBandA, setAfterBandA] = useState(4);
  const [afterBandB, setAfterBandB] = useState(3);
```

- [ ] **Step 4: Keep band state synchronized on preset changes**

In the `React.useEffect` that watches `[raster, indexType]`, replace its body with:

```ts
    const preset = resolveIndexPreset(raster, indexType);
    if (!preset) return;
    setBandA(preset.bandA);
    setBandB(preset.bandB);
    setBeforeBandA(preset.bandA);
    setBeforeBandB(preset.bandB);
```

Add a new effect after it:

```ts
  React.useEffect(() => {
    const preset = resolveIndexPreset(comparisonRaster, indexType);
    if (!preset) return;
    setAfterBandA(preset.bandA);
    setAfterBandB(preset.bandB);
  }, [comparisonRaster, indexType]);
```

In `onRaster` and `fetchGeeImage`, when `dataTarget === 'comparison'` and a preset exists, set:

```ts
          setAfterBandA(preset.bandA);
          setAfterBandB(preset.bandB);
```

When loading primary rasters, also set:

```ts
          setBeforeBandA(preset.bandA);
          setBeforeBandB(preset.bandB);
```

- [ ] **Step 5: Add guide and band-match UI**

Inside the analysis panel, after the tabs and before the common form grid, add:

```tsx
          <div className="index-guide">
            <strong>{indexType}</strong>
            <span>{INDEX_GUIDE[indexType].meaning}</span>
            <span>{INDEX_GUIDE[indexType].formula}</span>
          </div>
          <div className={`band-match ${resolveBandMatch(raster, indexType, bandA, bandB).status}`}>
            {resolveBandMatch(raster, indexType, bandA, bandB).status === 'matched'
              ? `已按 Band names 匹配 ${resolveBandMatch(raster, indexType, bandA, bandB).label}`
              : '未识别所需语义波段，请手动确认 A/B 波段'}
          </div>
```

- [ ] **Step 6: Replace change detection band controls**

In the common `analysisTab !== 'results'` form grid, keep `bandA` and `bandB` controls only for index analysis by wrapping them:

```tsx
              {analysisTab === 'index' && (
                <>
                  <label>
                    <span>{ui.bandA}</span>
                    <input type="number" min={1} max={raster?.count ?? 1} value={bandA} onChange={(event) => setBandA(Number(event.target.value))} />
                  </label>
                  <label>
                    <span>{ui.bandB}</span>
                    <input type="number" min={1} max={raster?.count ?? 1} value={bandB} onChange={(event) => setBandB(Number(event.target.value))} />
                  </label>
                </>
              )}
```

In the change detection panel, before the threshold slider, add:

```tsx
              <div className="band-mapping-grid">
                <div className="band-mapping-card">
                  <strong>Before 主影像</strong>
                  <span>{raster?.filename ?? ui.needRaster}</span>
                  <div className={`band-match ${resolveBandMatch(raster, indexType, beforeBandA, beforeBandB).status}`}>
                    {resolveBandMatch(raster, indexType, beforeBandA, beforeBandB).status === 'matched' ? '已自动匹配' : '请手动确认'}
                  </div>
                  <label><span>{ui.bandA}</span><input type="number" min={1} max={raster?.count ?? 1} value={beforeBandA} onChange={(event) => setBeforeBandA(Number(event.target.value))} /></label>
                  <label><span>{ui.bandB}</span><input type="number" min={1} max={raster?.count ?? 1} value={beforeBandB} onChange={(event) => setBeforeBandB(Number(event.target.value))} /></label>
                </div>
                <div className="band-mapping-card">
                  <strong>After 对比影像</strong>
                  <span>{comparisonRaster?.filename ?? ui.needComparison}</span>
                  <div className={`band-match ${resolveBandMatch(comparisonRaster, indexType, afterBandA, afterBandB).status}`}>
                    {resolveBandMatch(comparisonRaster, indexType, afterBandA, afterBandB).status === 'matched' ? '已自动匹配' : '请手动确认'}
                  </div>
                  <label><span>{ui.bandA}</span><input type="number" min={1} max={comparisonRaster?.count ?? 1} value={afterBandA} onChange={(event) => setAfterBandA(Number(event.target.value))} /></label>
                  <label><span>{ui.bandB}</span><input type="number" min={1} max={comparisonRaster?.count ?? 1} value={afterBandB} onChange={(event) => setAfterBandB(Number(event.target.value))} /></label>
                </div>
              </div>
```

- [ ] **Step 7: Use explicit before/after band values in requests**

In `runIndexAnalysis`, replace:

```ts
      const preset = resolveIndexPreset(raster, indexType);
      const analysisBandA = preset?.bandA ?? bandA;
      const analysisBandB = preset?.bandB ?? bandB;
```

with:

```ts
      const match = resolveBandMatch(raster, indexType, bandA, bandB);
      const analysisBandA = match.bandA;
      const analysisBandB = match.bandB;
```

In `runChangeDetection`, replace the four preset-derived band constants with:

```ts
      const beforeMatch = resolveBandMatch(raster, indexType, beforeBandA, beforeBandB);
      const afterMatch = resolveBandMatch(comparisonRaster, indexType, afterBandA, afterBandB);
      const beforeBandAValue = beforeMatch.bandA;
      const beforeBandBValue = beforeMatch.bandB;
      const afterBandAValue = afterMatch.bandA;
      const afterBandBValue = afterMatch.bandB;
```

Then update the form fields:

```ts
      data.append('before_band_a', String(beforeBandAValue));
      data.append('before_band_b', String(beforeBandBValue));
      data.append('after_band_a', String(afterBandAValue));
      data.append('after_band_b', String(afterBandBValue));
```

- [ ] **Step 8: Run frontend tests**

Run:

```powershell
cd frontend
npm test
```

Expected: the analysis semantic and before/after mapping tests pass. The layer variant test may still fail until Task 5.

## Task 5: Add Result Layer Variants And Request Context

**Files:**
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Add frontend result types**

Below `type AnalysisKind`, add:

```ts
type AnalysisLayerLegend = 'index-continuous' | 'index-threshold' | 'change';

type AnalysisLayerVariant = {
  id: string;
  label: string;
  layerUrl: string;
  boundsWgs84: Wgs84Bounds | null;
  opacity: number;
  visible: boolean;
  legend: AnalysisLayerLegend;
};

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

Extend `AnalysisResult` with:

```ts
  layerVariants: AnalysisLayerVariant[];
  requestContext: AnalysisRequestContext;
```

- [ ] **Step 2: Update `normalizeAnalysisResult`**

Change its signature:

```ts
function normalizeAnalysisResult(
  body: any,
  rasterId: string,
  requestContext: AnalysisRequestContext,
  comparisonRasterId?: string,
): AnalysisResult {
```

At the top of the function body, add:

```ts
  const boundsWgs84 = normalizeWgs84Bounds(body.boundsWgs84);
  const variants = Array.isArray(body.previewVariants) && body.previewVariants.length
    ? body.previewVariants
    : [{ id: 'primary', label: body.kind === 'change' ? '变化结果' : '数值结果', previewUrl: body.previewUrl, legend: body.kind === 'change' ? 'change' : 'index-continuous' }];
```

Set `boundsWgs84` to the local variable and add:

```ts
    requestContext,
    layerVariants: variants.map((variant: any) => ({
      id: `${body.id}:${variant.id}`,
      label: variant.label ?? (variant.legend === 'index-threshold' ? '阈值提取' : '数值结果'),
      layerUrl: `${API_BASE}${variant.previewUrl}`,
      boundsWgs84,
      opacity: variant.legend === 'index-threshold' ? 0.82 : 0.72,
      visible: true,
      legend: variant.legend ?? (body.kind === 'change' ? 'change' : 'index-continuous'),
    })),
```

- [ ] **Step 3: Flatten layer variants for Cesium**

Before the `return`, add:

```ts
  const analysisLayerVariants = analysisResults.flatMap((result) => result.layerVariants);
```

In `CesiumWorkspace`, replace the `analysisLayers` prop value with:

```tsx
          analysisLayers={analysisLayerVariants.map(({ id, layerUrl, boundsWgs84, opacity, visible }) => ({ id, layerUrl, boundsWgs84, opacity, visible }))}
```

- [ ] **Step 4: Add variant updater**

Below `updateResult`, add:

```ts
  function updateResultVariant(resultId: string, variantId: string, patch: Partial<AnalysisLayerVariant>) {
    setAnalysisResults((items) => items.map((item) => item.id === resultId
      ? { ...item, layerVariants: item.layerVariants.map((variant) => variant.id === variantId ? { ...variant, ...patch } : variant) }
      : item));
  }
```

- [ ] **Step 5: Capture index request context**

In `runIndexAnalysis`, after `analysisBandB`, add:

```ts
      const requestContext: AnalysisRequestContext = {
        indexType,
        primaryFilename: raster.filename,
        beforeBandA: analysisBandA,
        beforeBandB: analysisBandB,
        thresholdMin: thresholdEnabled ? thresholdMin : undefined,
        thresholdMax: thresholdEnabled ? thresholdMax : undefined,
        bandMatchStatus: match.status,
      };
```

Replace:

```ts
      const result = normalizeAnalysisResult(body, raster.id);
```

with:

```ts
      const result = normalizeAnalysisResult(body, raster.id, requestContext);
```

- [ ] **Step 6: Capture change request context**

In `runChangeDetection`, before the fetch, add:

```ts
      const requestContext: AnalysisRequestContext = {
        indexType,
        primaryFilename: raster.filename,
        comparisonFilename: comparisonRaster.filename,
        beforeBandA: beforeBandAValue,
        beforeBandB: beforeBandBValue,
        afterBandA: afterBandAValue,
        afterBandB: afterBandBValue,
        changeThreshold,
        bandMatchStatus: beforeMatch.status === 'matched' && afterMatch.status === 'matched' ? 'matched' : 'manual',
      };
```

Replace:

```ts
      const result = normalizeAnalysisResult(body, raster.id, comparisonRaster.id);
```

with:

```ts
      const result = normalizeAnalysisResult(body, raster.id, requestContext, comparisonRaster.id);
```

- [ ] **Step 7: Render result context and variants**

Inside each result row, after the title button, add:

```tsx
                  <div className="result-context">
                    <span>{result.kind === 'change' ? '变化检测' : '指数分析'}</span>
                    <span>{result.requestContext.primaryFilename}</span>
                    {result.requestContext.comparisonFilename && <span>{result.requestContext.comparisonFilename}</span>}
                    <span>{result.requestContext.indexType}: A{result.requestContext.beforeBandA} / B{result.requestContext.beforeBandB}</span>
                    {result.requestContext.afterBandA && result.requestContext.afterBandB && (
                      <span>After: A{result.requestContext.afterBandA} / B{result.requestContext.afterBandB}</span>
                    )}
                    {result.requestContext.thresholdMin !== undefined && result.requestContext.thresholdMax !== undefined && (
                      <span>阈值 {result.requestContext.thresholdMin} - {result.requestContext.thresholdMax}</span>
                    )}
                    {result.requestContext.changeThreshold !== undefined && <span>变化阈值 {result.requestContext.changeThreshold}</span>}
                    <span>{statsLine(result.summary)}</span>
                  </div>
                  <div className="result-variants">
                    {result.layerVariants.map((variant) => (
                      <div key={variant.id} className="variant-row">
                        <label className="mini-check">
                          <input type="checkbox" checked={variant.visible} onChange={(event) => updateResultVariant(result.id, variant.id, { visible: event.target.checked })} />
                          <span>{variant.label}</span>
                        </label>
                        <input type="range" min="0" max="1" step="0.05" value={variant.opacity} onChange={(event) => updateResultVariant(result.id, variant.id, { opacity: Number(event.target.value) })} />
                      </div>
                    ))}
                  </div>
                  <div className={`legend ${result.layerVariants[0]?.legend ?? 'index-continuous'}`}>
                    {result.kind === 'change' ? '绿色增加 / 红色减少 / 浅色稳定 / 透明无效' : '蓝色低值 / 黄绿色中值 / 绿色高值'}
                  </div>
```

Remove the old row-level visible checkbox and old row-level opacity slider from the result row.

- [ ] **Step 8: Run frontend tests**

Run:

```powershell
cd frontend
npm test
```

Expected: all source-level frontend tests pass.

## Task 6: Add Compact UI Styling

**Files:**
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add analysis guide styles**

Append:

```css
.index-guide {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.48);
  font-size: 12px;
}

.index-guide strong {
  color: #e2e8f0;
}

.band-match {
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.35;
}

.band-match.matched {
  color: #bbf7d0;
  background: rgba(22, 101, 52, 0.26);
}

.band-match.manual {
  color: #fde68a;
  background: rgba(146, 64, 14, 0.26);
}
```

- [ ] **Step 2: Add band mapping styles**

Append:

```css
.band-mapping-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.band-mapping-card {
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.36);
}

.band-mapping-card > span {
  color: #94a3b8;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.band-mapping-card label {
  display: grid;
  grid-template-columns: 52px 1fr;
  align-items: center;
  gap: 6px;
}
```

- [ ] **Step 3: Add result context and variant styles**

Append:

```css
.result-context {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.4;
}

.result-context span {
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.5);
}

.result-variants {
  display: grid;
  gap: 6px;
}

.variant-row {
  display: grid;
  grid-template-columns: minmax(96px, 140px) 1fr;
  gap: 8px;
  align-items: center;
}

.legend {
  font-size: 12px;
  color: #cbd5e1;
}
```

- [ ] **Step 4: Add mobile adjustment**

Inside the existing mobile media query, add:

```css
  .band-mapping-grid {
    grid-template-columns: 1fr;
  }

  .variant-row {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 5: Run frontend build**

Run:

```powershell
cd frontend
npm run build
```

Expected: build exits with code 0.

## Task 7: Final Verification

**Files:**
- No direct edits.

- [ ] **Step 1: Run backend verification**

Run:

```powershell
cd backend
python -m unittest -v
python -m py_compile app\main.py
```

Expected: backend tests pass and `app\main.py` compiles.

- [ ] **Step 2: Run frontend verification**

Run:

```powershell
cd frontend
npm test
npm run build
```

Expected: frontend tests pass and Vite build succeeds.

- [ ] **Step 3: Inspect touched files for mojibake**

Run:

```powershell
rg -n "鍦|鐡|妗|鏍呮牸|宸ュ叿|鍒囨崲" frontend\src backend\app docs\superpowers\specs\2026-05-23-frontend-analysis-workflow-design.md
```

Expected: no matches in touched source files. If `CesiumWorkspace.tsx` still reports the existing mojibake toolbar strings, repair them to readable Chinese while staying within this feature's touched text.

## Self-Review Notes

- Spec coverage: tasks cover band semantics, before/after mapping, comparison raster overlay, result context, quality fields, and continuous plus threshold layer variants.
- Scope: no database, account system, task queue, major backend split, or tile server is introduced.
- Type consistency: `AnalysisLayerVariant`, `AnalysisRequestContext`, `layerVariants`, and `previewVariants` are used consistently across backend response normalization and Cesium layer flattening.
