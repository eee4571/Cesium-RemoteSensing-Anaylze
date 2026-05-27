from __future__ import annotations

import io
import json
import os
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import requests
import rasterio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from rasterio.mask import mask
from rasterio.transform import array_bounds
from rasterio.warp import transform_bounds
from rasterio.warp import Resampling as WarpResampling, reproject
from shapely.geometry import box, mapping

try:
    import geopandas as gpd
except Exception:  # pragma: no cover - optional in lightweight installs
    gpd = None

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "outputs"
for directory in (UPLOAD_DIR, OUTPUT_DIR):
    directory.mkdir(parents=True, exist_ok=True)

DEFAULT_GEE_BANDS = "B2,B3,B4,B8,B11,B12"
INDEX_BAND_PRESETS = {
    "NDVI": ("B8", "B4"),
    "NDWI": ("B3", "B8"),
    "NDBI": ("B11", "B8"),
}

app = FastAPI(title="Satellite Image Explorer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_name(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    return f"{uuid.uuid4().hex}{suffix}"


def _raster_path(image_id: str) -> Path:
    matches = list(UPLOAD_DIR.glob(f"{image_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Image not found")
    return matches[0]


def _is_hex_id(value: str) -> bool:
    return len(value) == 32 and all(char in "0123456789abcdef" for char in value)


def _analysis_dir(analysis_id: str) -> Path:
    if not _is_hex_id(analysis_id):
        raise HTTPException(status_code=404, detail="Analysis result not found")
    path = OUTPUT_DIR / analysis_id
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Analysis result not found")
    return path


def _wgs84_bounds(ds: rasterio.DatasetReader) -> list[float] | None:
    if not ds.crs:
        return None
    try:
        return list(transform_bounds(ds.crs, "EPSG:4326", *ds.bounds, densify_pts=21))
    except Exception:
        pass
    try:
        source_crs = CRS.from_user_input(ds.crs.to_wkt() if hasattr(ds.crs, "to_wkt") else ds.crs)
        transformer = Transformer.from_crs(source_crs, CRS.from_epsg(4326), always_xy=True)
        xs = np.linspace(ds.bounds.left, ds.bounds.right, 11)
        ys = np.linspace(ds.bounds.bottom, ds.bounds.top, 11)
        points: list[tuple[float, float]] = []
        for x in xs:
            points.append((x, ds.bounds.bottom))
            points.append((x, ds.bounds.top))
        for y in ys:
            points.append((ds.bounds.left, y))
            points.append((ds.bounds.right, y))
        lon, lat = transformer.transform([p[0] for p in points], [p[1] for p in points])
        return [float(min(lon)), float(min(lat)), float(max(lon)), float(max(lat))]
    except Exception:
        return None


def _stretch_band(data: np.ndarray) -> np.ndarray:
    valid = data[np.isfinite(data)]
    if valid.size == 0:
        return np.zeros(data.shape, dtype=np.uint8)
    lo, hi = np.percentile(valid, [2, 98])
    if hi <= lo:
        hi = lo + 1
    scaled = (np.clip(data, lo, hi) - lo) / (hi - lo)
    scaled = np.nan_to_num(scaled, nan=0.0)
    return (scaled * 255).astype(np.uint8)


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
            masked_data, transform = mask(ds, shapes, crop=True, indexes=[band_a, band_b], filled=False)
            data = np.ma.asarray(masked_data).astype("float32").filled(np.nan)
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


def _read_aligned_index(
    path: Path,
    band_a: int,
    band_b: int,
    target_meta: dict[str, Any],
) -> np.ndarray:
    with rasterio.open(path) as ds:
        if not ds.crs:
            raise HTTPException(status_code=400, detail="Raster has no CRS")
        _validate_band(ds, band_a, "A")
        _validate_band(ds, band_b, "B")
        a = np.full((target_meta["height"], target_meta["width"]), np.nan, dtype="float32")
        b = np.full((target_meta["height"], target_meta["width"]), np.nan, dtype="float32")
        reproject(
            source=rasterio.band(ds, band_a),
            destination=a,
            src_transform=ds.transform,
            src_crs=ds.crs,
            src_nodata=ds.nodata,
            dst_transform=target_meta["transform"],
            dst_crs=target_meta["crs"],
            resampling=WarpResampling.bilinear,
            dst_nodata=np.nan,
            init_dest_nodata=True,
        )
        reproject(
            source=rasterio.band(ds, band_b),
            destination=b,
            src_transform=ds.transform,
            src_crs=ds.crs,
            src_nodata=ds.nodata,
            dst_transform=target_meta["transform"],
            dst_crs=target_meta["crs"],
            resampling=WarpResampling.bilinear,
            dst_nodata=np.nan,
            init_dest_nodata=True,
        )
    return _normalized_difference(a, b)


def _normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    denominator = a + b
    with np.errstate(divide="ignore", invalid="ignore"):
        index = (a - b) / denominator
    index[~np.isfinite(index)] = np.nan
    return index.astype("float32")


def _basic_stats(values: np.ndarray) -> dict[str, Any]:
    valid = values[np.isfinite(values)]
    total_pixels = int(values.size)
    valid_pixels = int(valid.size)
    quality = {
        "totalPixels": total_pixels,
        "validPixels": valid_pixels,
        "nodataPixels": int(total_pixels - valid_pixels),
        "validRatio": float(valid_pixels / total_pixels) if total_pixels else 0.0,
    }
    if valid.size == 0:
        return {**quality, "min": None, "max": None, "mean": None, "std": None}
    return {
        **quality,
        "min": float(np.min(valid)),
        "max": float(np.max(valid)),
        "mean": float(np.mean(valid)),
        "std": float(np.std(valid)),
    }


def _pixel_area_info(meta: dict[str, Any]) -> dict[str, Any]:
    transform = meta["transform"]
    pixel_area = abs(float(transform.a) * float(transform.e))
    crs = meta.get("crs")
    if crs is not None and getattr(crs, "is_geographic", False):
        area_unit = "square_degrees"
    else:
        area_unit = "square_meters"
    return {"pixelArea": float(pixel_area), "areaUnit": area_unit}


def _validate_index_thresholds(threshold_min: float | None, threshold_max: float | None) -> None:
    for label, value in (("threshold_min", threshold_min), ("threshold_max", threshold_max)):
        if value is not None and (value < -1 or value > 1):
            raise HTTPException(status_code=400, detail=f"{label} must be between -1 and 1")
    if threshold_min is not None and threshold_max is not None and threshold_min > threshold_max:
        raise HTTPException(status_code=400, detail="threshold_min must be less than or equal to threshold_max")


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


def _change_preview(classes: np.ndarray) -> Image.Image:
    rgba = np.zeros((*classes.shape, 4), dtype=np.uint8)
    rgba[classes == 1] = [34, 197, 94, 220]
    rgba[classes == -1] = [239, 68, 68, 220]
    rgba[classes == 0] = [226, 232, 240, 80]
    return Image.fromarray(rgba, mode="RGBA")


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
    primary_variant = {
        "id": "continuous" if kind == "index" else "primary",
        "label": "数值结果" if kind == "index" else "变化结果",
        "previewUrl": f"/analysis/{analysis_id}/preview.png",
        "legend": "index-continuous" if kind == "index" else "change",
    }
    preview_variants = [primary_variant]
    for extra_preview in extra_previews or []:
        filename = extra_preview["filename"]
        extra_path = target_dir / filename
        extra_preview["image"].save(extra_path, format="PNG")
        preview_variants.append({
            "id": extra_preview["id"],
            "label": extra_preview["label"],
            "previewUrl": f"/analysis/{analysis_id}/{filename}",
            "legend": extra_preview["legend"],
        })
    stats_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "id": analysis_id,
        "kind": kind,
        "name": name,
        "boundsWgs84": bounds_wgs84,
        "previewUrl": f"/analysis/{analysis_id}/preview.png",
        "previewVariants": preview_variants,
        "downloadUrl": f"/analysis/{analysis_id}/result.tif",
        "statsUrl": f"/analysis/{analysis_id}/stats.json",
        "summary": summary,
    }


def _preview_png(path: Path, bands: list[int] | None = None, max_size: int = 1200) -> bytes:
    with rasterio.open(path) as ds:
        if bands is None:
            if ds.count >= 3:
                bands = [1, 2, 3]
            else:
                bands = [1]
        for band in bands:
            if band < 1 or band > ds.count:
                raise HTTPException(status_code=400, detail=f"Band {band} is out of range")

        scale = min(max_size / ds.width, max_size / ds.height, 1.0)
        out_width = max(1, int(ds.width * scale))
        out_height = max(1, int(ds.height * scale))
        arr_masked = ds.read(
            bands,
            out_shape=(len(bands), out_height, out_width),
            resampling=Resampling.bilinear,
            masked=True,
        ).astype("float32")
        mask = np.ma.getmaskarray(arr_masked)
        alpha = (~np.all(mask, axis=0)).astype(np.uint8) * 255
        arr = np.asarray(arr_masked.filled(np.nan))

    if arr.shape[0] == 1:
        gray = _stretch_band(arr[0])
        rgb = np.dstack([gray, gray, gray])
    else:
        rgb = np.dstack([_stretch_band(arr[i]) for i in range(3)])

    rgba = np.dstack([rgb, alpha])
    image = Image.fromarray(rgba, mode="RGBA")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _metadata(path: Path) -> dict[str, Any]:
    with rasterio.open(path) as ds:
        crs_text = ds.crs.to_string() if ds.crs else None
        bounds = list(ds.bounds)
        wgs84_bounds = _wgs84_bounds(ds)
        tags = ds.tags()
        descriptions = list(ds.descriptions)
        return {
            "id": path.stem,
            "filename": path.name,
            "width": ds.width,
            "height": ds.height,
            "count": ds.count,
            "crs": crs_text,
            "bounds": bounds,
            "boundsWgs84": wgs84_bounds,
            "resolution": [abs(ds.transform.a), abs(ds.transform.e)],
            "transform": list(ds.transform)[:6],
            "dtypes": list(ds.dtypes),
            "bandDescriptions": descriptions,
            "tags": {k: tags[k] for k in list(tags)[:30]},
        }


def _band_descriptions_for_download(bands: list[str]) -> list[str]:
    return [band.strip() for band in bands if band.strip()]


def _write_band_descriptions(path: Path, bands: list[str]) -> None:
    descriptions = _band_descriptions_for_download(bands)
    if not descriptions:
        return
    with rasterio.open(path, "r+") as ds:
        for index, description in enumerate(descriptions[: ds.count], start=1):
            ds.set_band_description(index, description)


def _first_tiff_from_download(download_path: Path, image_id: str) -> Path:
    suffix = download_path.suffix.lower()
    if suffix in {".tif", ".tiff"}:
        target = UPLOAD_DIR / f"{image_id}.tif"
        shutil.move(str(download_path), target)
        return target

    if suffix == ".zip":
        extract_dir = OUTPUT_DIR / image_id
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(download_path) as zf:
            zf.extractall(extract_dir)
        tif_files = list(extract_dir.rglob("*.tif")) + list(extract_dir.rglob("*.tiff"))
        if not tif_files:
            raise ValueError("GEE download did not contain a GeoTIFF")
        target = UPLOAD_DIR / f"{image_id}.tif"
        shutil.move(str(tif_files[0]), target)
        return target

    raise ValueError(f"Unsupported GEE download suffix: {suffix}")


def _gee_download_url(
    geometry: str,
    dataset: str,
    start: str,
    end: str,
    bands: str,
    scale: int,
) -> dict[str, Any]:
    try:
        import ee
    except Exception as exc:
        raise HTTPException(status_code=501, detail="earthengine-api is not installed") from exc
    try:
        ee.Initialize(project=os.getenv("EE_PROJECT", "tea123"))
    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail="Google Earth Engine is not authenticated. Run `earthengine authenticate` first.",
        ) from exc

    try:
        geom_json = json.loads(geometry)
        ee_geom = ee.Geometry(geom_json)
        band_list = [b.strip() for b in bands.split(",") if b.strip()]
        image = (
            ee.ImageCollection(dataset)
            .filterBounds(ee_geom)
            .filterDate(start, end)
            .sort("CLOUDY_PIXEL_PERCENTAGE")
            .first()
            .select(band_list)
        )
        url = None
        actual_scale = scale
        last_error: Exception | None = None
        for actual_scale in (scale, scale * 2, scale * 4, scale * 8, scale * 16, scale * 32):
            try:
                url = image.getDownloadURL(
                    {
                        "scale": actual_scale,
                        "region": ee_geom,
                        "format": "GEO_TIFF",
                        "filePerBand": False,
                    }
                )
                break
            except Exception as exc:
                last_error = exc
                message = str(exc)
                if "Total request size" not in message and "must be less than or equal" not in message:
                    raise
        if url is None:
            raise ValueError(
                "GEE request is still too large after automatic scale adjustment. "
                "Please draw a smaller area or use a coarser scale."
            ) from last_error
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"GEE request failed: {exc}") from exc
    return {
        "downloadUrl": url,
        "dataset": dataset,
        "bands": band_list,
        "requestedScale": scale,
        "scale": actual_scale,
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/upload/tiff")
async def upload_tiff(file: UploadFile = File(...)) -> dict[str, Any]:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".tif", ".tiff"}:
        raise HTTPException(status_code=400, detail="Please upload a TIFF/GeoTIFF file")
    filename = _safe_name(file.filename or "image.tif")
    target = UPLOAD_DIR / filename
    with target.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    try:
        info = _metadata(target)
    except Exception as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Cannot read raster: {exc}") from exc
    return info


@app.get("/images/{image_id}/metadata")
def metadata_endpoint(image_id: str) -> dict[str, Any]:
    return _metadata(_raster_path(image_id))


@app.get("/images/{image_id}/preview.png")
def preview_endpoint(image_id: str, bands: str | None = None) -> Response:
    band_list = None
    if bands:
        try:
            band_list = [int(part) for part in bands.split(",") if part.strip()]
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="bands must be comma-separated integers") from exc
    png = _preview_png(_raster_path(image_id), band_list)
    return Response(content=png, media_type="image/png")


@app.get("/images/{image_id}/sample")
def sample_endpoint(image_id: str, lon: float, lat: float) -> dict[str, Any]:
    path = _raster_path(image_id)
    with rasterio.open(path) as ds:
        if not ds.crs:
            raise HTTPException(status_code=400, detail="Raster has no CRS")
        transformer = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
        x, y = transformer.transform(lon, lat)
        row, col = ds.index(x, y)
        if row < 0 or col < 0 or row >= ds.height or col >= ds.width:
            raise HTTPException(status_code=400, detail="Point is outside the raster")
        values = ds.read(window=((row, row + 1), (col, col + 1)))[:, 0, 0]
    return {
        "lon": lon,
        "lat": lat,
        "row": int(row),
        "col": int(col),
        "values": [float(v) if np.isfinite(v) else None for v in values],
    }


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
    _validate_index_thresholds(threshold_min, threshold_max)
    a, b, meta, out_bounds = _read_analysis_bands(_raster_path(image_id), band_a, band_b, bounds_wgs84)
    index = _normalized_difference(a, b)
    summary = _basic_stats(index)
    area_info = _pixel_area_info(meta)
    summary.update(area_info)
    if threshold_min is not None or threshold_max is not None:
        lo = -np.inf if threshold_min is None else threshold_min
        hi = np.inf if threshold_max is None else threshold_max
        threshold_mask = np.isfinite(index) & (index >= lo) & (index <= hi)
        summary["thresholdPixels"] = int(np.count_nonzero(threshold_mask))
        summary["thresholdArea"] = float(np.count_nonzero(threshold_mask) * area_info["pixelArea"])
    preview = _index_continuous_preview(index)
    extra_previews = None
    if threshold_min is not None or threshold_max is not None:
        extra_previews = [{
            "id": "threshold",
            "label": "阈值提取",
            "filename": "preview-threshold.png",
            "legend": "index-threshold",
            "image": _index_threshold_preview(index, threshold_min, threshold_max),
        }]
    return _write_analysis_output("index", index_name, index, meta, out_bounds, preview, summary, extra_previews)


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
    if threshold > 2:
        raise HTTPException(status_code=400, detail="threshold must be less than or equal to 2")
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
    )
    diff = after_index - before_index
    valid = np.isfinite(diff)
    classes = np.full(diff.shape, 99, dtype="int16")
    classes[valid & (diff > threshold)] = 1
    classes[valid & (diff < -threshold)] = -1
    classes[valid & (np.abs(diff) <= threshold)] = 0
    total_pixels = int(diff.size)
    overlap_pixels = int(np.count_nonzero(valid))
    overlap_ratio = float(overlap_pixels / total_pixels) if total_pixels else 0.0
    if overlap_pixels == 0:
        raise HTTPException(status_code=400, detail="Change detection has no overlapping valid pixels")
    if overlap_ratio < 0.05:
        raise HTTPException(status_code=400, detail="Change detection overlap is too low")
    area_info = _pixel_area_info(meta)
    summary = _basic_stats(diff)
    increase_pixels = int(np.count_nonzero(classes == 1))
    decrease_pixels = int(np.count_nonzero(classes == -1))
    stable_pixels = int(np.count_nonzero(classes == 0))
    summary.update({
        "increasePixels": increase_pixels,
        "decreasePixels": decrease_pixels,
        "stablePixels": stable_pixels,
        "increaseArea": float(increase_pixels * area_info["pixelArea"]),
        "decreaseArea": float(decrease_pixels * area_info["pixelArea"]),
        "stableArea": float(stable_pixels * area_info["pixelArea"]),
        "overlapPixels": overlap_pixels,
        "overlapRatio": overlap_ratio,
        **area_info,
        "threshold": float(threshold),
    })
    preview = _change_preview(classes)
    return _write_analysis_output("change", f"{index_name}变化检测", diff, meta, out_bounds, preview, summary)


@app.get("/analysis/{analysis_id}/result.tif")
def analysis_result(analysis_id: str) -> Response:
    path = _analysis_dir(analysis_id) / "result.tif"
    return Response(content=path.read_bytes(), media_type="image/tiff")


@app.get("/analysis/{analysis_id}/stats.json")
def analysis_stats(analysis_id: str) -> dict[str, Any]:
    path = _analysis_dir(analysis_id) / "stats.json"
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/analysis/{analysis_id}/{filename}")
def analysis_preview_variant(analysis_id: str, filename: str) -> Response:
    if filename not in {"preview.png", "preview-threshold.png"}:
        raise HTTPException(status_code=404, detail="Preview not found")
    path = _analysis_dir(analysis_id) / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Preview not found")
    return Response(content=path.read_bytes(), media_type="image/png")


@app.post("/upload/shapefile")
async def upload_shapefile(file: UploadFile = File(...)) -> dict[str, Any]:
    if gpd is None:
        raise HTTPException(status_code=500, detail="geopandas is not installed")
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload a zipped shapefile")
    vector_id = uuid.uuid4().hex
    target_dir = UPLOAD_DIR / vector_id
    target_dir.mkdir(parents=True, exist_ok=True)
    zip_path = target_dir / "shape.zip"
    with zip_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(target_dir)
        shp_files = list(target_dir.glob("*.shp"))
        if not shp_files:
            raise ValueError("zip does not contain a .shp file")
        gdf = gpd.read_file(shp_files[0])
        if gdf.empty:
            raise ValueError("shapefile has no features")
        if gdf.crs is None:
            raise ValueError("shapefile has no CRS")
        gdf_wgs84 = gdf.to_crs("EPSG:4326")
        bounds = list(gdf_wgs84.total_bounds)
        geojson = json.loads(gdf_wgs84.to_json())
    except Exception as exc:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Cannot read shapefile: {exc}") from exc
    return {"id": vector_id, "boundsWgs84": bounds, "geojson": geojson}


@app.post("/gee/download")
async def gee_download(
    geometry: str = Form(...),
    dataset: str = Form("COPERNICUS/S2_SR_HARMONIZED"),
    start: str = Form("2024-01-01"),
    end: str = Form("2024-12-31"),
    bands: str = Form(DEFAULT_GEE_BANDS),
    scale: int = Form(10),
) -> dict[str, Any]:
    return _gee_download_url(geometry, dataset, start, end, bands, scale)


@app.post("/gee/fetch")
async def gee_fetch(
    geometry: str = Form(...),
    dataset: str = Form("COPERNICUS/S2_SR_HARMONIZED"),
    start: str = Form("2024-01-01"),
    end: str = Form("2024-12-31"),
    bands: str = Form(DEFAULT_GEE_BANDS),
    scale: int = Form(10),
) -> dict[str, Any]:
    result = _gee_download_url(geometry, dataset, start, end, bands, scale)
    image_id = uuid.uuid4().hex
    temp_path = OUTPUT_DIR / f"{image_id}.tif"
    try:
        with requests.get(result["downloadUrl"], stream=True, timeout=120) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "zip" in content_type:
                temp_path = OUTPUT_DIR / f"{image_id}.zip"
            with temp_path.open("wb") as f:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        f.write(chunk)
        raster_path = _first_tiff_from_download(temp_path, image_id)
        _write_band_descriptions(raster_path, result["bands"])
        result["image"] = _metadata(raster_path)
    except Exception as exc:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"GEE download failed: {exc}") from exc
    return result
