import React from 'react';
import {
  ArcGisMapServerImageryProvider,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  Ellipsoid,
  EllipsoidTerrainProvider,
  GeoJsonDataSource,
  ImageryLayer,
  Ion,
  Math as CesiumMath,
  Rectangle as CesiumRectangle,
  RectangleGraphics,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SceneMode,
  SingleTileImageryProvider,
  Terrain,
  TileMapServiceImageryProvider,
  Viewer,
  buildModuleUrl,
  sampleTerrainMostDetailed,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { GeoJsonObject } from 'geojson';
import { LocateFixed, Navigation2 } from 'lucide-react';
import { boundsToRectangleDegrees, normalizeWgs84Bounds, type Wgs84Bounds } from './cesiumBounds';
import { formatCesiumPickedInfo } from './cesiumPicking';
import {
  getArcGisWorldImageryUrl,
  getCesiumIonToken,
  getCesiumStaticBaseUrl,
  getLocalFallbackBaseLayerUrl,
} from './cesiumConfig';
import { cesiumViewModeLabel, local2dBoundsForPoint, type CesiumViewMode, type LonLatPoint } from './cesiumView';

type RasterInfo = {
  id: string;
  filename: string;
  boundsWgs84: number[] | null;
};

type VectorInfo = {
  id: string;
  boundsWgs84: number[];
  geojson: GeoJsonObject;
};

type AnalysisLayerInfo = {
  id: string;
  layerUrl: string;
  boundsWgs84: Wgs84Bounds | null;
  opacity: number;
  visible: boolean;
};

type CesiumWorkspaceProps = {
  raster: RasterInfo | null;
  comparisonRaster: RasterInfo | null;
  vector: VectorInfo | null;
  overlayUrl: string | null;
  comparisonOverlayUrl: string | null;
  analysisLayers: AnalysisLayerInfo[];
  selectedBounds: Wgs84Bounds | null;
  opacity: number;
  comparisonOpacity: number;
  showRaster: boolean;
  showComparisonRaster: boolean;
  showVector: boolean;
  showBasemap: boolean;
  drawing: boolean;
  fitBounds: Wgs84Bounds | null;
  fitNonce: number;
  apiBase: string;
  onInfo: (message: string) => void;
  onDrawingChange: (drawing: boolean) => void;
  onSelectedBoundsChange: (bounds: Wgs84Bounds | null) => void;
};

const chinaOverviewBounds: Wgs84Bounds = [73, 18, 135, 54];
const chinaOverviewDestination = CesiumRectangle.fromDegrees(...chinaOverviewBounds);
const globeOverviewDestination = Cartesian3.fromDegrees(104, 32, 18_000_000);
const AUTO_ROTATE_RADIANS_PER_SECOND = 0.012;

function rectangleFromBounds(bounds: number[] | null | undefined): CesiumRectangle | null {
  const rectangle = boundsToRectangleDegrees(bounds);
  if (!rectangle) return null;
  return CesiumRectangle.fromDegrees(rectangle.west, rectangle.south, rectangle.east, rectangle.north);
}

function cameraDestination(
  bounds: Wgs84Bounds | null,
  fallbackMode: CesiumViewMode,
  pickedPoint?: LonLatPoint | null,
): CesiumRectangle | Cartesian3 {
  return rectangleFromBounds(bounds) ?? defaultDestinationForViewMode(fallbackMode, pickedPoint);
}

function defaultDestinationForViewMode(mode: CesiumViewMode, pickedPoint?: LonLatPoint | null): CesiumRectangle | Cartesian3 {
  if (mode === '3d') return globeOverviewDestination;
  return rectangleFromBounds(local2dBoundsForPoint(pickedPoint)) ?? chinaOverviewDestination;
}

function cesiumSceneModeMatchesViewMode(sceneMode: SceneMode, mode: CesiumViewMode): boolean {
  if (mode === '2d') return sceneMode === SceneMode.SCENE2D;
  return sceneMode === SceneMode.SCENE3D;
}

function statusForScene(hasIonToken: boolean, terrainReady: boolean) {
  if (!hasIonToken) return '未配置 Cesium ion token，当前使用本地低清兜底底图';
  if (terrainReady) return 'ArcGIS 影像 / World Terrain 已启用';
  return 'ArcGIS 影像加载中';
}

export default function CesiumWorkspace({
  raster,
  comparisonRaster,
  vector,
  overlayUrl,
  comparisonOverlayUrl,
  analysisLayers,
  selectedBounds,
  opacity,
  comparisonOpacity,
  showRaster,
  showComparisonRaster,
  showVector,
  showBasemap,
  drawing,
  fitBounds,
  fitNonce,
  apiBase,
  onInfo,
  onDrawingChange,
  onSelectedBoundsChange,
}: CesiumWorkspaceProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const viewerRef = React.useRef<Viewer | null>(null);
  const fallbackBaseLayerRef = React.useRef<ImageryLayer | null>(null);
  const ionBaseLayerRef = React.useRef<ImageryLayer | null>(null);
  const rasterLayerRef = React.useRef<ImageryLayer | null>(null);
  const comparisonLayerRef = React.useRef<ImageryLayer | null>(null);
  const analysisLayerRefs = React.useRef(new Map<string, ImageryLayer>());
  const vectorSourceRef = React.useRef<GeoJsonDataSource | null>(null);
  const selectionSourceRef = React.useRef<CustomDataSource | null>(null);
  const pickedSourceRef = React.useRef<CustomDataSource | null>(null);
  const terrainRef = React.useRef<Terrain | null>(null);
  const clickHandlerRef = React.useRef<ScreenSpaceEventHandler | null>(null);
  const drawHandlerRef = React.useRef<ScreenSpaceEventHandler | null>(null);
  const drawingStartRef = React.useRef<Cartographic | null>(null);
  const drawingSourceRef = React.useRef<CustomDataSource | null>(null);
  const drawingRef = React.useRef(drawing);
  const viewModeRef = React.useRef<CesiumViewMode>('3d');
  const viewSwitchSequenceRef = React.useRef(0);
  const lastPickedLonLatRef = React.useRef<LonLatPoint | null>(null);
  const pendingMorphCompleteRef = React.useRef<(() => void) | null>(null);
  const autoRotateHandlerRef = React.useRef<((scene: Viewer['scene'], time: unknown) => void) | null>(null);
  const lastAutoRotateTimeRef = React.useRef<number | null>(null);
  const lastFitNonceRef = React.useRef(0);
  const pickSequenceRef = React.useRef(0);
  const [message, setMessage] = React.useState('');
  const [readyVersion, setReadyVersion] = React.useState(0);
  const [terrainReady, setTerrainReady] = React.useState(false);
  const [baseLayerMode, setBaseLayerMode] = React.useState<'fallback' | 'ion'>('fallback');
  const [viewMode, setViewMode] = React.useState<CesiumViewMode>('3d');

  const hasIonToken = Boolean(getCesiumIonToken(import.meta.env));

  React.useEffect(() => {
    drawingRef.current = drawing;
  }, [drawing]);

  React.useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  React.useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const token = getCesiumIonToken(import.meta.env);
    if (token) Ion.defaultAccessToken = token;
    buildModuleUrl.setBaseUrl(getCesiumStaticBaseUrl());

    setTerrainReady(false);
    setBaseLayerMode('fallback');

    const terrain = token
      ? Terrain.fromWorldTerrain({
          requestWaterMask: true,
          requestVertexNormals: true,
        })
      : undefined;
    terrainRef.current = terrain ?? null;

    const fallbackLayer = ImageryLayer.fromProviderAsync(
      TileMapServiceImageryProvider.fromUrl(getLocalFallbackBaseLayerUrl()),
      {},
    );
    fallbackLayer.show = showBasemap;
    fallbackBaseLayerRef.current = fallbackLayer;

    const viewer = new Viewer(containerRef.current, {
      animation: false,
      baseLayer: fallbackLayer,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      terrain,
    });

    viewer.scene.globe.depthTestAgainstTerrain = Boolean(terrain);
    viewer.scene.globe.enableLighting = false;
    viewer.scene.backgroundColor = Color.fromBytes(9, 16, 32);
    viewer.camera.setView({ destination: defaultDestinationForViewMode('3d') });
    viewerRef.current = viewer;

    const autoRotateGlobe = () => {
      if (!viewerRef.current) return;
      if (viewModeRef.current !== '3d') return;
      if (!cesiumSceneModeMatchesViewMode(viewerRef.current.scene.mode, '3d')) return;
      if (drawingRef.current) return;
      const now = performance.now();
      const lastTime = lastAutoRotateTimeRef.current ?? now;
      lastAutoRotateTimeRef.current = now;
      const deltaSeconds = Math.min((now - lastTime) / 1000, 0.08);
      if (deltaSeconds <= 0) return;
      viewer.camera.rotate(Cartesian3.UNIT_Z, -AUTO_ROTATE_RADIANS_PER_SECOND * deltaSeconds);
    };
    autoRotateHandlerRef.current = autoRotateGlobe;
    viewer.scene.preRender.addEventListener(autoRotateGlobe);

    fallbackLayer.readyEvent.addEventListener(() => {
      if (!viewerRef.current) return;
      setMessage(statusForScene(Boolean(token), false));
    });
    fallbackLayer.errorEvent.addEventListener((error) => {
      if (!viewerRef.current) return;
      setMessage(error instanceof Error ? `本地兜底底图加载失败：${error.message}` : '本地兜底底图加载失败');
    });

    if (token) {
      const ionLayer = ImageryLayer.fromProviderAsync(
        ArcGisMapServerImageryProvider.fromUrl(getArcGisWorldImageryUrl(), {
          enablePickFeatures: false,
        }),
      );
      ionLayer.show = showBasemap;
      ionBaseLayerRef.current = ionLayer;
      viewer.imageryLayers.add(ionLayer, 1);

      ionLayer.readyEvent.addEventListener((provider) => {
        if (!viewerRef.current) return;
        setBaseLayerMode('ion');
        provider.errorEvent.addEventListener((error) => {
          if (!viewerRef.current) return;
          ionLayer.show = false;
          fallbackLayer.show = showBasemap;
          setBaseLayerMode('fallback');
          setMessage(error instanceof Error ? `ArcGIS 影像瓦片错误：${error.message}` : 'ArcGIS 影像瓦片错误，已切回兜底底图');
        });
        setMessage(statusForScene(true, terrainReady));
      });

      ionLayer.errorEvent.addEventListener((error) => {
        if (!viewerRef.current) return;
        ionLayer.show = false;
        fallbackLayer.show = showBasemap;
        setBaseLayerMode('fallback');
        setMessage(error instanceof Error ? `ArcGIS 影像加载失败：${error.message}` : 'ArcGIS 影像加载失败，已切回兜底底图');
      });

      terrain?.readyEvent.addEventListener(() => {
        if (!viewerRef.current) return;
        setTerrainReady(true);
        viewerRef.current.scene.globe.enableLighting = false;
        viewerRef.current.scene.globe.depthTestAgainstTerrain = true;
        setMessage(statusForScene(true, true));
        const terrainProvider = terrain.provider;
        terrainProvider.errorEvent.addEventListener((error) => {
          if (!viewerRef.current) return;
          viewerRef.current.terrainProvider = new EllipsoidTerrainProvider();
          viewerRef.current.scene.globe.depthTestAgainstTerrain = false;
          viewerRef.current.scene.globe.enableLighting = false;
          terrainRef.current = null;
          setTerrainReady(false);
          setMessage(error instanceof Error ? `World Terrain 瓦片错误：${error.message}` : 'World Terrain 瓦片错误，已切换为椭球地球');
        });
      });

      terrain?.errorEvent.addEventListener((error) => {
        if (!viewerRef.current) return;
        viewerRef.current.terrainProvider = new EllipsoidTerrainProvider();
        viewerRef.current.scene.globe.depthTestAgainstTerrain = false;
        viewerRef.current.scene.globe.enableLighting = false;
        terrainRef.current = null;
        setTerrainReady(false);
        setMessage(error instanceof Error ? `World Terrain 加载失败：${error.message}` : 'World Terrain 加载失败，已切换为椭球地球');
      });

      setMessage(statusForScene(true, terrainReady));
    } else {
      setMessage(statusForScene(false, false));
    }

    const clickHandler = new ScreenSpaceEventHandler(viewer.canvas);
    clickHandler.setInputAction((movement) => {
      if (drawingStartRef.current || drawingRef.current) return;
      void handlePick(viewer, movement.position);
    }, ScreenSpaceEventType.LEFT_CLICK);
    clickHandlerRef.current = clickHandler;

    setReadyVersion((version) => version + 1);

    return () => {
      clickHandlerRef.current = clickHandlerRef.current?.destroy() ?? null;
      if (autoRotateHandlerRef.current) {
        viewer.scene.preRender.removeEventListener(autoRotateHandlerRef.current);
        autoRotateHandlerRef.current = null;
        lastAutoRotateTimeRef.current = null;
      }
      if (pendingMorphCompleteRef.current) {
        viewer.scene.morphComplete.removeEventListener(pendingMorphCompleteRef.current);
        pendingMorphCompleteRef.current = null;
      }
      for (const layer of analysisLayerRefs.current.values()) viewer.imageryLayers.remove(layer, true);
      analysisLayerRefs.current.clear();
      viewerRef.current = null;
      rasterLayerRef.current = null;
      comparisonLayerRef.current = null;
      vectorSourceRef.current = null;
      selectionSourceRef.current = null;
      pickedSourceRef.current = null;
      fallbackBaseLayerRef.current = null;
      ionBaseLayerRef.current = null;
      terrainRef.current = null;
      viewer.destroy();
    };
  }, []);

  React.useEffect(() => {
    const fallbackLayer = fallbackBaseLayerRef.current;
    if (fallbackLayer) fallbackLayer.show = showBasemap && baseLayerMode === 'fallback';
    const ionLayer = ionBaseLayerRef.current;
    if (ionLayer) ionLayer.show = showBasemap && baseLayerMode === 'ion' && hasIonToken;
  }, [baseLayerMode, hasIonToken, showBasemap, readyVersion]);

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
      setMessage('影像缺少有效 WGS84 范围，无法在 Cesium 中叠加');
      return;
    }

    const provider = new SingleTileImageryProvider({
      url: overlayUrl,
      rectangle,
      tileWidth: 1024,
      tileHeight: 1024,
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = opacity;
    rasterLayerRef.current = layer;
  }, [overlayUrl, opacity, raster, readyVersion, showRaster]);

  React.useEffect(() => {
    if (rasterLayerRef.current) rasterLayerRef.current.alpha = opacity;
  }, [opacity]);

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

  React.useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const desiredIds = new Set(analysisLayers.filter((layer) => layer.visible && layer.boundsWgs84).map((layer) => layer.id));
    for (const [id, layer] of analysisLayerRefs.current) {
      if (!desiredIds.has(id)) {
        viewer.imageryLayers.remove(layer, true);
        analysisLayerRefs.current.delete(id);
      }
    }

    for (const analysisLayer of analysisLayers) {
      const existing = analysisLayerRefs.current.get(analysisLayer.id);
      if (!analysisLayer.visible || !analysisLayer.boundsWgs84) continue;
      if (existing) {
        existing.alpha = analysisLayer.opacity;
        continue;
      }
      const rectangle = rectangleFromBounds(analysisLayer.boundsWgs84);
      if (!rectangle) continue;
      const provider = new SingleTileImageryProvider({
        url: analysisLayer.layerUrl,
        rectangle,
        tileWidth: 1024,
        tileHeight: 1024,
      });
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = analysisLayer.opacity;
      viewer.imageryLayers.raiseToTop(layer);
      layer.readyEvent.addEventListener(() => {
        if (!viewerRef.current) return;
        setMessage('分析结果图层已叠加到 Cesium');
      });
      layer.errorEvent.addEventListener((error) => {
        if (!viewerRef.current) return;
        setMessage(error instanceof Error ? `分析结果图层加载失败：${error.message}` : '分析结果图层加载失败');
      });
      analysisLayerRefs.current.set(analysisLayer.id, layer);
    }
  }, [analysisLayers, readyVersion]);

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
      clampToGround: true,
      fill: Color.LIME.withAlpha(0.12),
      stroke: Color.LIME.withAlpha(0.95),
      strokeWidth: 3,
    })
      .then((source) => {
        if (cancelled || !viewerRef.current) return;
        vectorSourceRef.current = source;
        viewerRef.current.dataSources.add(source);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? `矢量图层加载失败：${error.message}` : '矢量图层加载失败');
      });

    return () => {
      cancelled = true;
    };
  }, [readyVersion, showVector, vector]);

  React.useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (selectionSourceRef.current) {
      viewer.dataSources.remove(selectionSourceRef.current, true);
      selectionSourceRef.current = null;
    }

    const normalized = normalizeWgs84Bounds(selectedBounds);
    const rectangle = rectangleFromBounds(normalized);
    if (!rectangle) return;

    const source = new CustomDataSource('selected-area');
    source.entities.add({
      name: 'Selected area',
      rectangle: new RectangleGraphics({
        coordinates: rectangle,
        fill: true,
        height: 0,
        material: Color.ORANGE.withAlpha(0.16),
        outline: true,
        outlineColor: Color.ORANGE,
      }),
    });
    selectionSourceRef.current = source;
    viewer.dataSources.add(source);
  }, [readyVersion, selectedBounds]);

  React.useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (fitNonce === 0 || fitNonce === lastFitNonceRef.current) return;
    lastFitNonceRef.current = fitNonce;
    viewer.camera.flyTo({
      destination: cameraDestination(fitBounds, viewMode, lastPickedLonLatRef.current),
      duration: 0.9,
    });
  }, [fitBounds, fitNonce, readyVersion, viewMode]);


  function cartographicFromScreen(viewer: Viewer, position: Cartesian2): Cartographic | null {
    const ray = viewer.camera.getPickRay(position);
    const surface = ray
      ? viewer.scene.globe.pick(ray, viewer.scene)
      : viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
    if (!surface) return null;
    return Ellipsoid.WGS84.cartesianToCartographic(surface);
  }

  React.useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !drawing) return;

    const source = new CustomDataSource('drawing-selection');
    drawingSourceRef.current = source;
    viewer.dataSources.add(source);

    const cameraController = viewer.scene.screenSpaceCameraController;
    const previousEnableInputs = cameraController.enableInputs;
    cameraController.enableInputs = false;

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
      onDrawingChange(false);
      if (!start || !end) return;
      const west = CesiumMath.toDegrees(Math.min(start.longitude, end.longitude));
      const east = CesiumMath.toDegrees(Math.max(start.longitude, end.longitude));
      const south = CesiumMath.toDegrees(Math.min(start.latitude, end.latitude));
      const north = CesiumMath.toDegrees(Math.max(start.latitude, end.latitude));
      if (east - west < 0.000001 || north - south < 0.000001) return;
      onSelectedBoundsChange([west, south, east, north]);
    }, ScreenSpaceEventType.LEFT_UP);

    return () => {
      cameraController.enableInputs = previousEnableInputs;
      drawHandlerRef.current = drawHandlerRef.current?.destroy() ?? null;
      drawingStartRef.current = null;
      if (drawingSourceRef.current) {
        viewer.dataSources.remove(drawingSourceRef.current, true);
        drawingSourceRef.current = null;
      }
    };
  }, [drawing, onDrawingChange, onSelectedBoundsChange, readyVersion]);

  async function handlePick(viewer: Viewer, position: Cartesian2) {
    const pickId = ++pickSequenceRef.current;
    const pickedPosition = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(position) : undefined;
    const ray = viewer.camera.getPickRay(position);
    const surface =
      pickedPosition ??
      (ray ? viewer.scene.globe.pick(ray, viewer.scene) : viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid));

    if (!surface) {
      onInfo('未拾取到地球表面');
      return;
    }

    const cartographic = Ellipsoid.WGS84.cartesianToCartographic(surface);
    if (!cartographic) {
      onInfo('未能解析拾取位置');
      return;
    }

    const lon = CesiumMath.toDegrees(cartographic.longitude);
    const lat = CesiumMath.toDegrees(cartographic.latitude);
    lastPickedLonLatRef.current = { lon, lat };
    let height: number | null = Number.isFinite(cartographic.height) ? cartographic.height : null;

    if (terrainRef.current && terrainRef.current.ready) {
      try {
        const sampled = await sampleTerrainMostDetailed(terrainRef.current.provider, [
          Cartographic.fromDegrees(lon, lat),
        ]);
        const sampledHeight = sampled[0]?.height;
        if (Number.isFinite(sampledHeight)) {
          height = sampledHeight ?? height;
        }
      } catch {
        // Terrain sampling is optional; picked height is still useful.
      }
    }

    if (pickId !== pickSequenceRef.current || !viewerRef.current) return;

    if (pickedSourceRef.current) {
      viewer.dataSources.remove(pickedSourceRef.current, true);
      pickedSourceRef.current = null;
    }

    const labelText = formatCesiumPickedInfo({ lon, lat, height, sample: null });
    const pointSource = new CustomDataSource('picked-point');
    pointSource.entities.add({
      name: 'Picked point',
      position: surface,
      point: {
        pixelSize: 10,
        color: Color.CYAN,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: labelText,
        font: '12px sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        showBackground: true,
        backgroundColor: new Color(0, 0, 0, 0.65),
        pixelOffset: new Cartesian2(0, -28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    pickedSourceRef.current = pointSource;
    viewer.dataSources.add(pointSource);

    let sampleText: string | null = null;
    if (raster) {
      try {
        const response = await fetch(`${apiBase}/images/${raster.id}/sample?lon=${lon}&lat=${lat}`);
        const body = await response.json();
        if (!response.ok) {
          sampleText = body.detail ?? '栅格查询失败';
        } else {
          sampleText = `DN: ${body.values.slice(0, 6).join(', ')}`;
        }
      } catch (error) {
        sampleText = error instanceof Error ? error.message : '栅格查询失败';
      }
    }

    onInfo(formatCesiumPickedInfo({ lon, lat, height, sample: sampleText }));
  }

  function clearPendingMorphComplete(viewer: Viewer) {
    if (!pendingMorphCompleteRef.current) return;
    viewer.scene.morphComplete.removeEventListener(pendingMorphCompleteRef.current);
    pendingMorphCompleteRef.current = null;
  }

  function flyToDefaultViewMode(viewer: Viewer, mode: CesiumViewMode, duration = 0.6) {
    viewer.camera.flyTo({
      destination: defaultDestinationForViewMode(mode, lastPickedLonLatRef.current),
      duration,
    });
  }

  function switchViewMode(viewer: Viewer, mode: CesiumViewMode) {
    if (viewModeRef.current === mode && cesiumSceneModeMatchesViewMode(viewer.scene.mode, mode)) return;

    const sequence = viewSwitchSequenceRef.current + 1;
    viewSwitchSequenceRef.current = sequence;
    setViewMode(mode);
    viewModeRef.current = mode;
    clearPendingMorphComplete(viewer);
    viewer.camera.cancelFlight();

    const completeViewSwitch = () => {
      viewer.scene.morphComplete.removeEventListener(completeViewSwitch);
      if (pendingMorphCompleteRef.current === completeViewSwitch) pendingMorphCompleteRef.current = null;
      if (viewSwitchSequenceRef.current !== sequence) return;
      if (viewModeRef.current !== mode) return;
      if (!viewerRef.current) return;
      if (!cesiumSceneModeMatchesViewMode(viewerRef.current.scene.mode, mode)) return;
      flyToDefaultViewMode(viewerRef.current, mode);
    };

    if (mode === '2d') viewer.scene.morphTo2D(0.6);
    if (mode === '3d') viewer.scene.morphTo3D(0.6);

    if (cesiumSceneModeMatchesViewMode(viewer.scene.mode, mode)) {
      flyToDefaultViewMode(viewer, mode);
      return;
    }

    pendingMorphCompleteRef.current = completeViewSwitch;
    viewer.scene.morphComplete.addEventListener(completeViewSwitch);
  }

  return (
    <div className="cesium-shell">
      <div className="cesium-toolbar" role="toolbar" aria-label="Cesium 工具">
        {(['2d', '3d'] as CesiumViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            title={`切换到 ${cesiumViewModeLabel(mode)}`}
            aria-label={`切换到 ${cesiumViewModeLabel(mode)}`}
            className={viewMode === mode ? 'selected' : ''}
            onClick={() => {
              const viewer = viewerRef.current;
              if (!viewer) return;
              switchViewMode(viewer, mode);
            }}
            aria-pressed={viewMode === mode}
          >
            {cesiumViewModeLabel(mode)}
          </button>
        ))}
        <button
          type="button"
          title="框选区域"
          aria-label="框选区域"
          className={drawing ? 'selected' : ''}
          onClick={() => onDrawingChange(!drawing)}
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
        <button
          type="button"
          title="飞到当前数据范围"
          aria-label="飞到当前数据范围"
          onClick={() => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            viewer.camera.flyTo({
              destination: cameraDestination(fitBounds, viewMode, lastPickedLonLatRef.current),
              duration: 0.9,
            });
          }}
        >
          <LocateFixed size={16} />
        </button>
        <button
          type="button"
          title="复位视角"
          aria-label="复位视角"
          onClick={() => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            viewer.camera.flyTo({ destination: defaultDestinationForViewMode(viewMode, lastPickedLonLatRef.current), duration: 0.9 });
          }}
        >
          <Navigation2 size={16} />
        </button>
      </div>
      <div ref={containerRef} className="cesium-viewer" aria-label="Cesium 三维遥感工作区" />
      {message && <div className="cesium-status">{message}</div>}
    </div>
  );
}

