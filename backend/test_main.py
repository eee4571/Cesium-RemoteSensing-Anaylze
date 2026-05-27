import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import rasterio
from fastapi import HTTPException
from rasterio.transform import from_origin

from app import main

TEST_PROJECTED_WKT = 'LOCAL_CS["Test metre CRS",UNIT["metre",1],AXIS["Easting",EAST],AXIS["Northing",NORTH]]'


class GeeBandDefaultsTest(unittest.TestCase):
    def test_default_gee_bands_cover_rgb_nir_and_swir_indexes(self):
        self.assertEqual(main.DEFAULT_GEE_BANDS, "B2,B3,B4,B8,B11,B12")
        self.assertEqual(main.INDEX_BAND_PRESETS["NDVI"], ("B8", "B4"))
        self.assertEqual(main.INDEX_BAND_PRESETS["NDWI"], ("B3", "B8"))
        self.assertEqual(main.INDEX_BAND_PRESETS["NDBI"], ("B11", "B8"))

    def test_downloaded_gee_raster_gets_band_descriptions(self):
        bands = ["B2", "B3", "B4", "B8", "B11", "B12"]
        descriptions = main._band_descriptions_for_download(bands)

        self.assertEqual(descriptions, bands)


class AnalysisQualityTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._temp_dir = TemporaryDirectory()
        self.temp_path = Path(self._temp_dir.name)
        self.original_upload_dir = main.UPLOAD_DIR
        self.original_output_dir = main.OUTPUT_DIR
        main.UPLOAD_DIR = self.temp_path / "uploads"
        main.OUTPUT_DIR = self.temp_path / "outputs"
        main.UPLOAD_DIR.mkdir()
        main.OUTPUT_DIR.mkdir()

    def tearDown(self):
        main.UPLOAD_DIR = self.original_upload_dir
        main.OUTPUT_DIR = self.original_output_dir
        self._temp_dir.cleanup()

    def write_raster(
        self,
        image_id: str,
        band_a: np.ndarray,
        band_b: np.ndarray,
        *,
        west: float = 0,
        north: float = 2,
        crs: str = TEST_PROJECTED_WKT,
    ) -> None:
        path = main.UPLOAD_DIR / f"{image_id}.tif"
        height, width = band_a.shape
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            height=height,
            width=width,
            count=2,
            dtype="float32",
            crs=crs,
            transform=from_origin(west, north, 1, 1),
            nodata=np.nan,
        ) as dst:
            dst.write(band_a.astype("float32"), 1)
            dst.write(band_b.astype("float32"), 2)

    def test_normalized_difference_handles_zero_denominator_and_nan(self):
        a = np.array([[4, 1, np.nan]], dtype="float32")
        b = np.array([[2, -1, 3]], dtype="float32")

        result = main._normalized_difference(a, b)

        self.assertAlmostEqual(float(result[0, 0]), 1 / 3)
        self.assertTrue(np.isnan(result[0, 1]))
        self.assertTrue(np.isnan(result[0, 2]))

    async def test_index_summary_includes_quality_and_area_unit(self):
        self.write_raster(
            "index_quality",
            np.array([[4, 6], [np.nan, 2]], dtype="float32"),
            np.array([[2, 2], [1, 2]], dtype="float32"),
        )

        result = await main.analysis_index(
            image_id="index_quality",
            index_type="NDVI",
            band_a=1,
            band_b=2,
            bounds_wgs84=None,
            threshold_min=0.2,
            threshold_max=1.0,
        )

        summary = result["summary"]
        self.assertEqual(summary["totalPixels"], 4)
        self.assertEqual(summary["validPixels"], 3)
        self.assertEqual(summary["nodataPixels"], 1)
        self.assertAlmostEqual(summary["validRatio"], 0.75)
        self.assertEqual(summary["thresholdPixels"], 2)
        self.assertEqual(summary["areaUnit"], "square_meters")
        self.assertAlmostEqual(summary["pixelArea"], 1.0)
        self.assertAlmostEqual(summary["thresholdArea"], 2.0)

    async def test_index_analysis_returns_continuous_and_threshold_preview_variants(self):
        self.write_raster(
            "index_variants",
            np.array([[4, 6], [1, 2]], dtype="float32"),
            np.array([[2, 2], [2, 2]], dtype="float32"),
        )

        result = await main.analysis_index(
            image_id="index_variants",
            index_type="NDVI",
            band_a=1,
            band_b=2,
            bounds_wgs84=None,
            threshold_min=0.2,
            threshold_max=1.0,
        )

        self.assertIn("previewVariants", result)
        variants = result["previewVariants"]
        self.assertEqual(variants[0]["id"], "continuous")
        self.assertEqual(variants[0]["legend"], "index-continuous")
        self.assertEqual(variants[1]["id"], "threshold")
        self.assertEqual(variants[1]["legend"], "index-threshold")
        output_dir = main.OUTPUT_DIR / result["id"]
        self.assertTrue((output_dir / "preview.png").exists())
        self.assertTrue((output_dir / "preview-threshold.png").exists())

    def test_preview_rejects_parent_directory_analysis_id(self):
        (self.temp_path / "preview.png").write_bytes(b"bad")

        with self.assertRaises(HTTPException) as raised:
            main.analysis_preview_variant("..", "preview.png")

        self.assertEqual(raised.exception.status_code, 404)

    async def test_index_rejects_reversed_thresholds(self):
        self.write_raster(
            "bad_threshold",
            np.array([[4, 6]], dtype="float32"),
            np.array([[2, 2]], dtype="float32"),
        )

        with self.assertRaises(HTTPException) as raised:
            await main.analysis_index(
                image_id="bad_threshold",
                index_type="NDVI",
                band_a=1,
                band_b=2,
                bounds_wgs84=None,
                threshold_min=0.8,
                threshold_max=0.2,
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("threshold_min", raised.exception.detail)

    async def test_change_summary_includes_overlap_quality(self):
        self.write_raster(
            "before_change",
            np.array([[4, 6], [2, 2]], dtype="float32"),
            np.array([[2, 2], [2, 2]], dtype="float32"),
        )
        self.write_raster(
            "after_change",
            np.array([[8, 2], [2, np.nan]], dtype="float32"),
            np.array([[2, 2], [2, 2]], dtype="float32"),
        )

        result = await main.analysis_change(
            before_image_id="before_change",
            after_image_id="after_change",
            index_type="NDVI",
            before_band_a=1,
            before_band_b=2,
            after_band_a=1,
            after_band_b=2,
            bounds_wgs84=None,
            threshold=0.1,
        )

        summary = result["summary"]
        self.assertEqual(summary["totalPixels"], 4)
        self.assertEqual(summary["overlapPixels"], 3)
        self.assertAlmostEqual(summary["overlapRatio"], 0.75)
        self.assertEqual(summary["increasePixels"], 1)
        self.assertEqual(summary["decreasePixels"], 1)
        self.assertEqual(summary["stablePixels"], 1)
        self.assertEqual(summary["areaUnit"], "square_meters")

    async def test_change_rejects_when_overlap_is_too_low(self):
        self.write_raster(
            "before_no_overlap",
            np.array([[4, 6], [2, 2]], dtype="float32"),
            np.array([[2, 2], [2, 2]], dtype="float32"),
        )
        self.write_raster(
            "after_no_overlap",
            np.array([[8, 2], [2, 2]], dtype="float32"),
            np.array([[2, 2], [2, 2]], dtype="float32"),
            west=100,
            north=102,
        )

        with self.assertRaises(HTTPException) as raised:
            await main.analysis_change(
                before_image_id="before_no_overlap",
                after_image_id="after_no_overlap",
                index_type="NDVI",
                before_band_a=1,
                before_band_b=2,
                after_band_a=1,
                after_band_b=2,
                bounds_wgs84=None,
                threshold=0.1,
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("overlap", raised.exception.detail.lower())


if __name__ == "__main__":
    unittest.main()
