import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { boundsToRectangleDegrees, normalizeWgs84Bounds } from './cesiumBounds';
import { formatCesiumPickedInfo, isFiniteLonLat } from './cesiumPicking';
import {
  cesiumSceneModeForViewMode,
  cesiumViewModeLabel,
  local2dBoundsForPoint,
  rectangleDegreesFromWgs84Bounds,
  type CesiumViewMode,
} from './cesiumView';
import {
  baseImageryModeForToken,
  getArcGisWorldImageryUrl,
  getCesiumStaticBaseUrl,
  getLocalFallbackBaseLayerUrl,
  getCesiumIonToken,
  hasCesiumIonToken,
  terrainModeForToken,
} from './cesiumConfig';

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

test('baseImageryModeForToken chooses ion imagery only when token is usable', () => {
  assert.equal(baseImageryModeForToken('abc'), 'arcgis-world-imagery');
  assert.equal(baseImageryModeForToken(null), 'local-fallback');
});

test('getArcGisWorldImageryUrl avoids VirtualEarth tile hosts that fail local CORS', () => {
  const url = getArcGisWorldImageryUrl();
  assert.equal(url, 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer');
  assert.equal(url.includes('virtualearth.net'), false);
});

test('getLocalFallbackBaseLayerUrl uses a local low-resolution fallback tile source', () => {
  const url = getLocalFallbackBaseLayerUrl();
  assert.equal(url, '/cesium/Assets/Textures/NaturalEarthII');
  assert.equal(url.includes('ion.cesium.com'), false);
  assert.equal(url.startsWith('/cesium/'), true);
});

test('getCesiumStaticBaseUrl points Cesium workers and assets at a public path', () => {
  assert.equal(getCesiumStaticBaseUrl(), '/cesium/');
});

test('CesiumWorkspace keeps the fallback base layer ref name consistent', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('fallbackBaseLayerRef.current = fallbackLayer;'));
  assert.equal(source.includes('fallbackLayerRef.current = fallbackLayer;'), false);
});

test('main renders CesiumWorkspace instead of Leaflet MapContainer', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  assert.equal(source.includes('MapContainer'), false);
  assert.equal(source.includes('react-leaflet'), false);
  assert.equal(source.includes('CesiumWorkspace'), true);
});

test('frontend package no longer depends on Leaflet', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert.equal(Boolean(packageJson.dependencies?.leaflet), false);
  assert.equal(Boolean(packageJson.dependencies?.['react-leaflet']), false);
  assert.equal(Boolean(packageJson.devDependencies?.['@types/leaflet']), false);
});

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

test('CesiumWorkspace accepts analysis result overlays', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('analysisLayers: AnalysisLayerInfo[]'));
  assert.ok(source.includes('analysisLayerRefs'));
  assert.ok(source.includes('layerUrl'));
});

test('CesiumWorkspace accepts comparison raster overlay controls', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('comparisonRaster: RasterInfo | null'));
  assert.ok(source.includes('comparisonOverlayUrl: string | null'));
  assert.ok(source.includes('comparisonLayerRef'));
  assert.ok(source.includes('showComparisonRaster'));
  assert.ok(source.includes('comparisonOpacity'));
});

test('CesiumWorkspace uses globe overview for 3D and China overview for 2D modes', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('chinaOverviewBounds'));
  assert.ok(source.includes('globeOverviewDestination'));
  assert.ok(source.includes('const chinaOverviewBounds: Wgs84Bounds = [73, 18, 135, 54];'));
  assert.ok(source.includes('CesiumRectangle.fromDegrees(...chinaOverviewBounds)'));
  assert.ok(source.includes('Cartesian3.fromDegrees(104, 32, 18_000_000)'));
  assert.ok(source.includes('defaultDestinationForViewMode'));
  assert.ok(source.includes("if (mode === '3d') return globeOverviewDestination;"));
  assert.ok(source.includes('return rectangleFromBounds(local2dBoundsForPoint(pickedPoint)) ?? chinaOverviewDestination;'));
  assert.ok(source.includes("defaultDestinationForViewMode('3d')"));
  assert.ok(source.includes('defaultDestinationForViewMode(mode, lastPickedLonLatRef.current)'));
  assert.ok(source.includes('defaultDestinationForViewMode(viewMode, lastPickedLonLatRef.current)'));
});

test('CesiumWorkspace prevents stale view-mode camera flights during rapid switching', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('viewModeRef'));
  assert.ok(source.includes('viewSwitchSequenceRef'));
  assert.ok(source.includes('if (viewSwitchSequenceRef.current !== sequence) return;'));
});

test('CesiumWorkspace waits for Cesium morph completion instead of timing view-mode resets', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('viewer.scene.morphComplete.addEventListener'));
  assert.ok(source.includes('viewer.scene.morphComplete.removeEventListener'));
  assert.ok(source.includes('viewer.camera.cancelFlight()'));
  assert.equal(source.includes('pendingViewResetRef'), false);
  assert.equal(source.includes('window.setTimeout'), false);
  assert.equal(source.includes('window.clearTimeout'), false);
});

test('CesiumWorkspace registers morph completion after starting the requested morph', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  const morphTo2dIndex = source.indexOf("if (mode === '2d') viewer.scene.morphTo2D(0.6);");
  const morphTo3dIndex = source.indexOf("if (mode === '3d') viewer.scene.morphTo3D(0.6);");
  const morphCompleteIndex = source.indexOf('viewer.scene.morphComplete.addEventListener(completeViewSwitch);');
  assert.ok(morphTo2dIndex >= 0);
  assert.ok(morphTo3dIndex >= 0);
  assert.ok(morphCompleteIndex > morphTo2dIndex);
  assert.ok(morphCompleteIndex > morphTo3dIndex);
});

test('CesiumWorkspace auto-rotates the 3D globe without realtime day-night lighting', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('AUTO_ROTATE_RADIANS_PER_SECOND'));
  assert.ok(source.includes('autoRotateHandlerRef'));
  assert.ok(source.includes('viewer.scene.preRender.addEventListener(autoRotateGlobe)'));
  assert.ok(source.includes('viewer.scene.preRender.removeEventListener(autoRotateHandlerRef.current)'));
  assert.ok(source.includes("if (viewModeRef.current !== '3d') return;"));
  assert.ok(source.includes('viewer.camera.rotate(Cartesian3.UNIT_Z, -AUTO_ROTATE_RADIANS_PER_SECOND * deltaSeconds);'));
  assert.ok(source.includes('viewer.scene.globe.enableLighting = false;'));
  assert.equal(source.includes('enableLighting = true'), false);
});

test('CesiumWorkspace ignores selecting the already active view mode', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('if (viewModeRef.current === mode && cesiumSceneModeMatchesViewMode(viewer.scene.mode, mode)) return;'));
});

test('CesiumWorkspace fallback camera destination follows the active view mode', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('fallbackMode: CesiumViewMode'));
  assert.ok(source.includes('pickedPoint?: LonLatPoint | null'));
  assert.ok(source.includes('return rectangleFromBounds(bounds) ?? defaultDestinationForViewMode(fallbackMode, pickedPoint);'));
  assert.ok(source.includes('destination: cameraDestination(fitBounds, viewMode, lastPickedLonLatRef.current)'));
});

test('local2dBoundsForPoint creates a focused 2D rectangle around a picked point', () => {
  assert.deepEqual(local2dBoundsForPoint({ lon: 116.391, lat: 39.907 }), [115.391, 38.907, 117.391, 40.907]);
  assert.deepEqual(local2dBoundsForPoint({ lon: 179.5, lat: 89.5 }), [178.5, 88.5, 180, 90]);
  assert.equal(local2dBoundsForPoint(null), null);
  assert.equal(local2dBoundsForPoint({ lon: Number.NaN, lat: 39.907 }), null);
});

test('CesiumWorkspace uses the last picked point for local 2D camera resets', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('lastPickedLonLatRef'));
  assert.ok(source.includes('lastPickedLonLatRef.current = { lon, lat };'));
  assert.ok(source.includes('defaultDestinationForViewMode(mode, lastPickedLonLatRef.current)'));
  assert.ok(source.includes('defaultDestinationForViewMode(viewMode, lastPickedLonLatRef.current)'));
});

test('CesiumWorkspace disables camera drag controls while drawing a selection box', () => {
  const source = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('const cameraController = viewer.scene.screenSpaceCameraController;'));
  assert.ok(source.includes('const previousEnableInputs = cameraController.enableInputs;'));
  assert.ok(source.includes('cameraController.enableInputs = false;'));
  assert.ok(source.includes('cameraController.enableInputs = previousEnableInputs;'));
});

test('main exposes platform analysis workspace state and actions', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  assert.ok(source.includes("type AnalysisKind = 'index' | 'change'"));
  assert.ok(source.includes('runIndexAnalysis'));
  assert.ok(source.includes('runChangeDetection'));
  assert.ok(source.includes('comparisonRaster'));
});

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

test('main downloads GEE multispectral bands and maps index presets by band name', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  assert.ok(source.includes("const GEE_DEFAULT_BANDS = 'B2,B3,B4,B8,B11,B12';"));
  assert.ok(source.includes("NDVI: { a: 'B8', b: 'B4' }"));
  assert.ok(source.includes("NDWI: { a: 'B3', b: 'B8' }"));
  assert.ok(source.includes("NDBI: { a: 'B11', b: 'B8' }"));
  assert.ok(source.includes("data.append('bands', GEE_DEFAULT_BANDS);"));
  assert.ok(source.includes('resolveIndexPreset(raster, indexType)'));
});

test('GEE fetch panel lets users choose primary or comparison target slot', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  const cssSource = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');
  assert.ok(source.includes('gee-target-row'));
  assert.ok(source.includes("onClick={() => setDataTarget('primary')}"));
  assert.ok(source.includes("onClick={() => setDataTarget('comparison')}"));
  assert.ok(source.includes("if (dataTarget === 'comparison')"));
  assert.ok(source.includes('setComparisonRaster(image)'));
  assert.ok(source.includes('setRaster(image)'));
  assert.ok(cssSource.includes('.gee-target-row'));
});

test('analysis UI explains change detection colors and GEE maximum resolution', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  const cssSource = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');
  assert.ok(source.includes('const GEE_MIN_SCALE_METERS = 10;'));
  assert.ok(source.includes('GEE_RESOLUTION_NOTE'));
  assert.ok(source.includes('gee-resolution-note'));
  assert.ok(source.includes('CHANGE_LEGEND_ITEMS'));
  assert.ok(source.includes("key: 'increase'"));
  assert.ok(source.includes("key: 'decrease'"));
  assert.ok(source.includes("key: 'stable'"));
  assert.ok(source.includes('ChangeLegend'));
  assert.ok(source.includes("result.kind === 'change'"));
  assert.ok(cssSource.includes('.change-legend'));
  assert.ok(cssSource.includes('.change-legend-swatch'));
});

test('workspace separates feature sidebar from layer and reset controls', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  const cssSource = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');
  assert.ok(source.includes('function-sidebar'));
  assert.ok(source.includes('function-nav'));
  assert.ok(source.includes('workspace-panel'));
  assert.ok(source.includes('layer-sidebar'));
  assert.ok(source.includes("type FunctionPanel = 'data' | 'gee' | 'analysis' | 'results' | 'metadata' | 'info'"));
  assert.ok(source.includes('setActiveFunctionPanel'));
  assert.ok(source.includes('layer-actions'));
  assert.ok(source.includes('workspace-panel-title'));
  assert.ok(cssSource.includes('.function-sidebar'));
  assert.ok(cssSource.includes('.function-nav'));
  assert.ok(cssSource.includes('.workspace-panel'));
  assert.ok(cssSource.includes('.layer-sidebar'));
  assert.ok(cssSource.includes('.layer-actions'));
  const layerSidebarStart = source.indexOf('className="layer-sidebar"');
  const clearAllIndex = source.indexOf('onClick={clearAll}', layerSidebarStart);
  assert.ok(layerSidebarStart >= 0);
  assert.ok(clearAllIndex > layerSidebarStart);
}
);

test('analysis results render as a modal instead of a bottom drawer', () => {
  const mainSource = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  const cssSource = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');
  assert.ok(mainSource.includes('resultsOpen'));
  assert.ok(mainSource.includes('result-modal-backdrop'));
  assert.equal(mainSource.includes('className="result-drawer"'), false);
  assert.ok(cssSource.includes('.result-modal-backdrop'));
  assert.ok(cssSource.includes('.result-modal'));
});

test('analysis summary includes quality and area fields', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  assert.ok(source.includes("'totalPixels'"));
  assert.ok(source.includes("'nodataPixels'"));
  assert.ok(source.includes("'validRatio'"));
  assert.ok(source.includes("'areaUnit'"));
  assert.ok(source.includes("'overlapRatio'"));
});

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

test('analysis result layer variants expose clear map display controls', () => {
  const source = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  const cesiumSource = fs.readFileSync(path.resolve('src/CesiumWorkspace.tsx'), 'utf8');
  assert.ok(source.includes('showOnMap'));
  assert.ok(source.includes('layerOpacity'));
  assert.ok(source.includes('visible: Boolean(variantBounds)'));
  assert.ok(source.includes('fallbackBounds?: Wgs84Bounds | null'));
  assert.ok(source.includes('normalizeAnalysisResult(body, raster.id, requestContext, selectedWgs84Bounds ?? rasterWgs84Bounds)'));
  assert.ok(source.includes('resultBounds ?? fallbackBounds'));
  assert.ok(source.includes('analysis-layer-stack'));
  assert.ok(source.includes('analysis-layer-control'));
  assert.ok(source.includes('variant.visible'));
  assert.ok(source.includes('showResultVariantOnMap(result.id, variant, event.target.checked)'));
  assert.ok(source.includes('updateResultVariant(result.id, variant.id, { opacity: Number(event.target.value) })'));
  assert.ok(source.includes('showResultVariantOnMap'));
  assert.ok(source.includes('setResultsOpen(false)'));
  assert.equal(source.includes('disabled={!variant.boundsWgs84}'), false);
  assert.ok(cesiumSource.includes('viewer.imageryLayers.raiseToTop(layer)'));
  assert.ok(cesiumSource.includes('分析结果图层已叠加到 Cesium'));
  assert.ok(cesiumSource.includes('分析结果图层加载失败'));
});

test('touched frontend files do not contain known mojibake fragments', () => {
  for (const file of ['src/CesiumWorkspace.tsx', 'src/cesiumPicking.ts', 'src/main.tsx']) {
    const source = fs.readFileSync(path.resolve(file), 'utf8');
    assert.equal(source.includes('鍦'), false, `${file} contains mojibake`);
    assert.equal(source.includes('鐡'), false, `${file} contains mojibake`);
    assert.equal(source.includes('妗'), false, `${file} contains mojibake`);
  }
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
  const modes: CesiumViewMode[] = ['2d', '3d'];
  assert.deepEqual(modes.map(cesiumViewModeLabel), ['2D', '3D']);
  assert.deepEqual(modes.map(cesiumSceneModeForViewMode), ['SCENE2D', 'SCENE3D']);
});

test('frontend no longer exposes 2.5D or OSM building controls', () => {
  const files = ['src/CesiumWorkspace.tsx', 'src/cesiumView.ts'];
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(file), 'utf8');
    assert.equal(source.includes('columbus'), false, `${file} still includes columbus`);
    assert.equal(source.includes('2.5D'), false, `${file} still includes 2.5D`);
    assert.equal(source.includes('COLUMBUS_VIEW'), false, `${file} still includes COLUMBUS_VIEW`);
    assert.equal(source.includes('createOsmBuildingsAsync'), false, `${file} still creates OSM buildings`);
    assert.equal(source.includes('showBuildings'), false, `${file} still has building state`);
    assert.equal(source.includes('buildingsRef'), false, `${file} still has building refs`);
    assert.equal(source.includes('Building2'), false, `${file} still imports building icon`);
  }
});
