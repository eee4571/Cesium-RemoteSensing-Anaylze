import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GeoJsonObject } from 'geojson';
import {
  Download,
  Eye,
  FileImage,
  FolderUp,
  Layers,
  LocateFixed,
  MousePointer2,
  RotateCcw,
  Satellite,
  Shapes,
  Trash2,
} from 'lucide-react';
import CesiumWorkspace from './CesiumWorkspace';
import { normalizeWgs84Bounds, type Wgs84Bounds } from './cesiumBounds';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';
const GEE_DEFAULT_BANDS = 'B2,B3,B4,B8,B11,B12';
const GEE_MIN_SCALE_METERS = 10;
const GEE_RESOLUTION_NOTE = `当前平台最高 ${GEE_MIN_SCALE_METERS} m；范围过大时会自动降到 20/40/80 m 等更粗分辨率。`;
const RGB_BAND_NAMES = ['B4', 'B3', 'B2'];
const INDEX_BAND_PRESETS = {
  NDVI: { a: 'B8', b: 'B4' },
  NDWI: { a: 'B3', b: 'B8' },
  NDBI: { a: 'B11', b: 'B8' },
} as const;
const INDEX_GUIDE = {
  NDVI: { formula: 'NIR / Red', meaning: 'Vegetation vigor and biomass' },
  NDWI: { formula: 'Green / NIR', meaning: 'Open water and moisture' },
  NDBI: { formula: 'SWIR / NIR', meaning: 'Built-up land and impervious surface' },
} as const;
const CHANGE_LEGEND_ITEMS = [
  { key: 'increase', label: '指数增加', rule: 'after - before > threshold', color: '#22c55e' },
  { key: 'decrease', label: '指数减少', rule: 'after - before < -threshold', color: '#ef4444' },
  { key: 'stable', label: '变化不明显/稳定', rule: 'abs(after - before) <= threshold', color: '#cbd5e1' },
] as const;

const ui = {
  waiting: '等待上传数据',
  noQuery: '尚未查询',
  uploadTiff: '正在上传 GeoTIFF',
  loaded: '已加载',
  uploadShape: '正在上传 Shapefile',
  vectorLoaded: '矢量范围已加载',
  needArea: '请先框选范围或上传 Shapefile',
  geeFetching: '正在从 GEE 下载并加载影像',
  geeFailed: 'GEE 请求失败',
  geeDone: 'GEE 影像已下载并展示',
  geeDoneScale: 'GEE 影像已下载并展示，实际分辨率',
  queryFailed: '查询失败',
  title: '遥感分析工作台',
  subtitle: 'Cesium 三维浏览、指数分析与变化检测',
  data: '数据管理',
  target: '数据槽位',
  primaryRaster: '主影像',
  comparisonRaster: '对比影像',
  uploadOrDrop: '上传或拖拽 TIFF/GeoTIFF',
  uploadZipShape: '上传 zipped Shapefile',
  bandDisplay: '显示与点查',
  queryCenter: '查询影像中心像元',
  areaDownload: 'GEE 范围下载',
  stopDraw: '结束框选',
  drawBox: '地图框选',
  fetchGee: '从 GEE 下载到当前槽位',
  openDownload: '打开 GeoTIFF 下载链接',
  metadata: '主影像信息',
  comparisonMetadata: '对比影像',
  file: '文件',
  size: '尺寸',
  bands: '波段',
  crs: '坐标系',
  unknown: '未知',
  resolution: '分辨率',
  types: '数据类型',
  bounds: '范围',
  clickInfo: '坐标查询',
  uploadHint: '上传 GeoTIFF 后显示坐标系、分辨率和波段信息。',
  areaSelected: '已选择下载范围',
  busy: '正在处理，请稍候',
  clearAll: '清空全部',
  clearArea: '清除框选',
  zoomImage: '缩放到影像',
  zoomVector: '缩放到矢量',
  zoomArea: '缩放到框选',
  layerControl: '图层控制',
  showRaster: '显示主影像',
  showComparisonRaster: '显示对比影像',
  showVector: '显示矢量',
  showBasemap: '显示底图',
  opacity: '主影像透明度',
  comparisonOpacity: '对比影像透明度',
  geeParams: 'GEE 参数',
  startDate: '开始日期',
  endDate: '结束日期',
  scale: '分辨率 m',
  dataset: '数据集',
  fromDraw: '使用框选范围',
  fromVector: '使用 Shapefile 范围',
  analysis: '专业分析',
  indexAnalysis: '指数分析',
  changeDetection: '变化检测',
  results: '结果',
  indexType: '指数类型',
  bandA: 'A 波段',
  bandB: 'B 波段',
  threshold: '阈值',
  thresholdEnabled: '启用阈值提取',
  thresholdMin: '阈值下限',
  thresholdMax: '阈值上限',
  runIndex: '运行指数分析',
  runChange: '运行变化检测',
  needRaster: '请先加载主影像',
  needComparison: '请先加载主影像和对比影像',
  resultDrawer: '分析结果',
  noResults: '暂无分析结果',
  visible: '显示',
  showOnMap: '显示到地图',
  layerOpacity: '图层透明度',
  zoomResult: '缩放到结果',
  downloadResult: '下载结果',
  stats: '统计',
};

type RasterInfo = {
  id: string;
  filename: string;
  width: number;
  height: number;
  count: number;
  crs: string | null;
  bounds: number[];
  boundsWgs84: number[] | null;
  resolution: number[];
  dtypes: string[];
  bandDescriptions: Array<string | null>;
};

type VectorInfo = {
  id: string;
  boundsWgs84: number[];
  geojson: GeoJsonObject;
};

type IndexType = keyof typeof INDEX_BAND_PRESETS;
type BandMatch = {
  bandA: number;
  bandB: number;
  status: 'matched' | 'manual';
  label: string;
};

type AnalysisKind = 'index' | 'change';
type AnalysisLayerLegend = 'index-continuous' | 'index-threshold' | 'change';
type FunctionPanel = 'data' | 'gee' | 'analysis' | 'results' | 'metadata' | 'info';

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

type AnalysisResult = {
  id: string;
  kind: AnalysisKind;
  name: string;
  rasterId: string;
  comparisonRasterId?: string;
  downloadUrl: string;
  statsUrl: string;
  boundsWgs84: Wgs84Bounds | null;
  layerVariants: AnalysisLayerVariant[];
  requestContext: AnalysisRequestContext;
  createdAt: string;
  summary: Record<string, number | string | null>;
};

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

async function uploadFile(path: string, file: File) {
  const data = new FormData();
  data.append('file', file);
  const response = await fetch(`${API_BASE}${path}`, { method: 'POST', body: data });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail ?? response.statusText);
  return body;
}

function apiUrl(pathOrUrl: string | null | undefined) {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

function normalizeAnalysisResult(
  body: any,
  rasterId: string,
  requestContext: AnalysisRequestContext,
  fallbackBounds?: Wgs84Bounds | null,
  comparisonRasterId?: string,
): AnalysisResult {
  const resultBounds = normalizeWgs84Bounds(body.boundsWgs84);
  const analysisBounds = resultBounds ?? fallbackBounds;
  const kind = body.kind as AnalysisKind;
  const fallbackLegend: AnalysisLayerLegend = kind === 'change' ? 'change' : 'index-continuous';
  const fallbackLabel = kind === 'change' ? '变化结果' : '数值结果';
  const previewVariants = Array.isArray(body.previewVariants) && body.previewVariants.length > 0
    ? body.previewVariants
    : [{ id: 'default', label: fallbackLabel, previewUrl: body.previewUrl, boundsWgs84: body.boundsWgs84, legend: fallbackLegend }];
  const layerVariants = previewVariants.flatMap((variant: any, index: number): AnalysisLayerVariant[] => {
    const variantLegend = variant.legend === 'index-threshold'
      ? 'index-threshold'
      : variant.legend === 'change' || kind === 'change'
        ? 'change'
        : 'index-continuous';
    const defaultLabel = variantLegend === 'index-threshold' ? '阈值提取' : fallbackLabel;
    const layerUrl = apiUrl(variant.layerUrl ?? variant.previewUrl ?? body.previewUrl);
    if (!layerUrl) return [];
    const variantBounds = normalizeWgs84Bounds(variant.boundsWgs84) ?? analysisBounds;
    return [{
      id: `${body.id}:${variant.id ?? `${variantLegend}-${index}`}`,
      label: variant.label ?? defaultLabel,
      layerUrl,
      boundsWgs84: variantBounds,
      opacity: 0.72,
      visible: Boolean(variantBounds),
      legend: variantLegend,
    }];
  });

  return {
    id: body.id,
    kind,
    name: body.name,
    rasterId,
    comparisonRasterId,
    downloadUrl: apiUrl(body.downloadUrl) ?? '#',
    statsUrl: apiUrl(body.statsUrl) ?? '#',
    boundsWgs84: analysisBounds,
    layerVariants,
    requestContext,
    createdAt: new Date().toLocaleString(),
    summary: body.summary ?? {},
  };
}

function normalizedBandName(name: string | null | undefined) {
  return (name ?? '').trim().toUpperCase();
}

function bandIndexByName(raster: RasterInfo | null, bandName: string) {
  if (!raster?.bandDescriptions?.length) return null;
  const target = normalizedBandName(bandName);
  const index = raster.bandDescriptions.findIndex((description) => normalizedBandName(description) === target);
  return index >= 0 ? index + 1 : null;
}

function resolveRgbBands(raster: RasterInfo) {
  const byName = RGB_BAND_NAMES.map((name) => bandIndexByName(raster, name));
  if (byName.every((value): value is number => value !== null)) return byName;
  return [1, Math.min(2, raster.count), Math.min(3, raster.count)];
}

function resolveIndexPreset(raster: RasterInfo | null, indexType: IndexType) {
  const preset = INDEX_BAND_PRESETS[indexType];
  const a = bandIndexByName(raster, preset.a);
  const b = bandIndexByName(raster, preset.b);
  return a && b ? { bandA: a, bandB: b, label: `${preset.a}/${preset.b}` } : null;
}

function clampBandValue(value: number, raster: RasterInfo | null) {
  const max = Math.max(1, raster?.count ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(1, Math.trunc(value)), max);
}

function resolveBandMatch(raster: RasterInfo | null, indexType: IndexType, fallbackA: number, fallbackB: number): BandMatch {
  const preset = resolveIndexPreset(raster, indexType);
  if (preset) return { ...preset, status: 'matched' };
  const bandA = clampBandValue(fallbackA, raster);
  const bandB = clampBandValue(fallbackB, raster);
  return { bandA, bandB, status: 'manual', label: `manual ${bandA}/${bandB}` };
}

function statsLine(summary: Record<string, number | string | null>) {
  const keys = [
    'totalPixels',
    'validPixels',
    'nodataPixels',
    'validRatio',
    'mean',
    'min',
    'max',
    'areaUnit',
    'overlapRatio',
    'increasePixels',
    'decreasePixels',
    'stablePixels',
    'thresholdPixels',
  ];
  return keys
    .filter((key) => summary[key] !== undefined && summary[key] !== null)
    .map((key) => `${key}: ${typeof summary[key] === 'number' ? Number(summary[key]).toFixed(3).replace(/\.000$/, '') : summary[key]}`)
    .join(' / ');
}

function resultMapBounds(result: AnalysisResult) {
  return result.layerVariants.find((variant) => variant.visible && variant.boundsWgs84)?.boundsWgs84
    ?? result.layerVariants.find((variant) => variant.boundsWgs84)?.boundsWgs84
    ?? result.boundsWgs84;
}

function ChangeLegend() {
  return (
    <div className="change-legend" aria-label="变化检测颜色说明">
      {CHANGE_LEGEND_ITEMS.map((item) => (
        <div key={item.key} className="change-legend-item">
          <span className="change-legend-swatch" style={{ background: item.color }} />
          <span>
            <strong>{item.label}</strong>
            <small>{item.rule}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [raster, setRaster] = useState<RasterInfo | null>(null);
  const [comparisonRaster, setComparisonRaster] = useState<RasterInfo | null>(null);
  const [vector, setVector] = useState<VectorInfo | null>(null);
  const [bands, setBands] = useState([1, 2, 3]);
  const [selectedBounds, setSelectedBounds] = useState<Wgs84Bounds | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [status, setStatus] = useState(ui.waiting);
  const [busy, setBusy] = useState(false);
  const [geeUrl, setGeeUrl] = useState<string | null>(null);
  const [sample, setSample] = useState<string>(ui.noQuery);
  const [mapInfo, setMapInfo] = useState<string>(ui.noQuery);
  const [showRaster, setShowRaster] = useState(true);
  const [showComparisonRaster, setShowComparisonRaster] = useState(true);
  const [showVector, setShowVector] = useState(true);
  const [showBasemap, setShowBasemap] = useState(true);
  const [opacity, setOpacity] = useState(0.82);
  const [comparisonOpacity, setComparisonOpacity] = useState(0.62);
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [scale, setScale] = useState(10);
  const [dataset, setDataset] = useState('COPERNICUS/S2_SR_HARMONIZED');
  const [fitNonce, setFitNonce] = useState(0);
  const [fitBounds3d, setFitBounds3d] = useState<Wgs84Bounds | null>(null);
  const [dataTarget, setDataTarget] = useState<'primary' | 'comparison'>('primary');
  const [analysisTab, setAnalysisTab] = useState<'index' | 'change' | 'results'>('index');
  const [indexType, setIndexType] = useState<IndexType>('NDVI');
  const [bandA, setBandA] = useState(4);
  const [bandB, setBandB] = useState(3);
  const [beforeBandA, setBeforeBandA] = useState(4);
  const [beforeBandB, setBeforeBandB] = useState(3);
  const [afterBandA, setAfterBandA] = useState(4);
  const [afterBandB, setAfterBandB] = useState(3);
  const [thresholdEnabled, setThresholdEnabled] = useState(false);
  const [thresholdMin, setThresholdMin] = useState(0.2);
  const [thresholdMax, setThresholdMax] = useState(1);
  const [changeThreshold, setChangeThreshold] = useState(0.2);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [activeFunctionPanel, setActiveFunctionPanel] = useState<FunctionPanel>('data');

  const selectedWgs84Bounds = selectedBounds;
  const rasterWgs84Bounds = useMemo(() => normalizeWgs84Bounds(raster?.boundsWgs84), [raster]);
  const comparisonWgs84Bounds = useMemo(() => normalizeWgs84Bounds(comparisonRaster?.boundsWgs84), [comparisonRaster]);
  const vectorWgs84Bounds = useMemo(() => normalizeWgs84Bounds(vector?.boundsWgs84), [vector]);
  const activeResult = analysisResults.find((result) => result.id === activeResultId) ?? analysisResults[0] ?? null;
  const overlayUrl = raster
    ? `${API_BASE}/images/${raster.id}/preview.png?bands=${bands.join(',')}&v=${bands.join('-')}`
    : null;
  const comparisonOverlayUrl = comparisonRaster
    ? `${API_BASE}/images/${comparisonRaster.id}/preview.png`
    : null;
  const indexBandMatch = resolveBandMatch(raster, indexType, bandA, bandB);
  const beforeBandMatch = resolveBandMatch(raster, indexType, beforeBandA, beforeBandB);
  const afterBandMatch = resolveBandMatch(comparisonRaster, indexType, afterBandA, afterBandB);

  React.useEffect(() => {
    if (!resultsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setResultsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resultsOpen]);

  React.useEffect(() => {
    const preset = resolveIndexPreset(raster, indexType);
    if (!preset) return;
    setBandA(preset.bandA);
    setBandB(preset.bandB);
    setBeforeBandA(preset.bandA);
    setBeforeBandB(preset.bandB);
  }, [raster, indexType]);

  React.useEffect(() => {
    const preset = resolveIndexPreset(comparisonRaster, indexType);
    if (!preset) return;
    setAfterBandA(preset.bandA);
    setAfterBandB(preset.bandB);
  }, [comparisonRaster, indexType]);

  async function onRaster(file: File) {
    if (busy) return;
    setBusy(true);
    try {
      setStatus(ui.uploadTiff);
      const info = await uploadFile('/upload/tiff', file) as RasterInfo;
      if (dataTarget === 'comparison') {
        setComparisonRaster(info);
        setShowComparisonRaster(true);
        const preset = resolveIndexPreset(info, indexType);
        if (preset) {
          setAfterBandA(preset.bandA);
          setAfterBandB(preset.bandB);
        }
      } else {
        setRaster(info);
        setShowRaster(true);
        setBands(resolveRgbBands(info));
        const preset = resolveIndexPreset(info, indexType);
        if (preset) {
          setBandA(preset.bandA);
          setBandB(preset.bandB);
          setBeforeBandA(preset.bandA);
          setBeforeBandB(preset.bandB);
        }
      }
      setFitBounds3d(normalizeWgs84Bounds(info.boundsWgs84));
      setFitNonce(n => n + 1);
      setStatus(`${ui.loaded} ${info.filename}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : ui.queryFailed);
    } finally {
      setBusy(false);
    }
  }

  async function onVector(file: File) {
    if (busy) return;
    setBusy(true);
    try {
      setStatus(ui.uploadShape);
      const info = await uploadFile('/upload/shapefile', file) as VectorInfo;
      setVector(info);
      setShowVector(true);
      setFitBounds3d(normalizeWgs84Bounds(info.boundsWgs84));
      setFitNonce(n => n + 1);
      setStatus(ui.vectorLoaded);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : ui.queryFailed);
    } finally {
      setBusy(false);
    }
  }

  function dropHandler(callback: (file: File) => Promise<void>) {
    return (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (file) callback(file).catch(err => setStatus(err.message));
    };
  }

  async function fetchGeeImage() {
    if (busy) {
      setStatus(ui.busy);
      return;
    }
    const geom = selectedBounds
      ? boundsToGeeGeometry(selectedBounds)
      : vector
        ? boundsToGeeGeometry(vector.boundsWgs84 as Wgs84Bounds)
        : null;
    if (!geom) {
      setStatus(ui.needArea);
      return;
    }
    setBusy(true);
    try {
      setStatus(ui.geeFetching);
      const data = new FormData();
      data.append('geometry', JSON.stringify(geom));
      data.append('dataset', dataset);
      data.append('start', startDate);
      data.append('end', endDate);
      data.append('bands', GEE_DEFAULT_BANDS);
      data.append('scale', String(scale));
      const response = await fetch(`${API_BASE}/gee/fetch`, { method: 'POST', body: data });
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.detail ?? ui.geeFailed);
        return;
      }
      const image = body.image as RasterInfo;
      setGeeUrl(body.downloadUrl);
      if (dataTarget === 'comparison') {
        setComparisonRaster(image);
        setShowComparisonRaster(true);
        const preset = resolveIndexPreset(image, indexType);
        if (preset) {
          setAfterBandA(preset.bandA);
          setAfterBandB(preset.bandB);
        }
      } else {
        setRaster(image);
        setShowRaster(true);
        setBands(resolveRgbBands(image));
        const preset = resolveIndexPreset(image, indexType);
        if (preset) {
          setBandA(preset.bandA);
          setBandB(preset.bandB);
          setBeforeBandA(preset.bandA);
          setBeforeBandB(preset.bandB);
        }
      }
      setFitBounds3d(normalizeWgs84Bounds(image.boundsWgs84));
      setFitNonce(n => n + 1);
      setStatus(body.scale ? `${ui.geeDoneScale} ${body.scale} m` : ui.geeDone);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : ui.geeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function queryCenter() {
    if (!raster?.boundsWgs84) return;
    const [west, south, east, north] = raster.boundsWgs84;
    const lon = (west + east) / 2;
    const lat = (south + north) / 2;
    const response = await fetch(`${API_BASE}/images/${raster.id}/sample?lon=${lon}&lat=${lat}`);
    const body = await response.json();
    if (!response.ok) {
      setSample(body.detail ?? ui.queryFailed);
      return;
    }
    setSample(`中心点：行 ${body.row}，列 ${body.col}，DN：${body.values.slice(0, 6).join(', ')}`);
  }

  async function runIndexAnalysis() {
    if (!raster || busy) {
      setStatus(ui.needRaster);
      return;
    }
    setBusy(true);
    try {
      setStatus(`正在运行 ${indexType} 指数分析`);
      const submittedBandA = clampBandValue(bandA, raster);
      const submittedBandB = clampBandValue(bandB, raster);
      const requestContext: AnalysisRequestContext = {
        indexType,
        primaryFilename: raster.filename,
        beforeBandA: submittedBandA,
        beforeBandB: submittedBandB,
        thresholdMin: thresholdEnabled ? thresholdMin : undefined,
        thresholdMax: thresholdEnabled ? thresholdMax : undefined,
        bandMatchStatus: resolveBandMatch(raster, indexType, bandA, bandB).status,
      };
      const data = new FormData();
      data.append('image_id', raster.id);
      data.append('index_type', indexType);
      data.append('band_a', String(submittedBandA));
      data.append('band_b', String(submittedBandB));
      if (selectedBounds) data.append('bounds_wgs84', selectedBounds.join(','));
      if (thresholdEnabled) {
        data.append('threshold_min', String(thresholdMin));
        data.append('threshold_max', String(thresholdMax));
      }
      const response = await fetch(`${API_BASE}/analysis/index`, { method: 'POST', body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? '指数分析失败');
      const result = normalizeAnalysisResult(body, raster.id, requestContext, selectedWgs84Bounds ?? rasterWgs84Bounds);
      setAnalysisResults((items) => [result, ...items]);
      setActiveResultId(result.id);
      setFitBounds3d(resultMapBounds(result));
      setFitNonce(n => n + 1);
      setResultsOpen(true);
      setStatus(`${result.name} 分析完成`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '指数分析失败');
    } finally {
      setBusy(false);
    }
  }

  async function runChangeDetection() {
    if (!raster || !comparisonRaster || busy) {
      setStatus(ui.needComparison);
      return;
    }
    setBusy(true);
    try {
      setStatus(`正在运行 ${indexType} 变化检测`);
      const submittedBeforeBandA = clampBandValue(beforeBandA, raster);
      const submittedBeforeBandB = clampBandValue(beforeBandB, raster);
      const submittedAfterBandA = clampBandValue(afterBandA, comparisonRaster);
      const submittedAfterBandB = clampBandValue(afterBandB, comparisonRaster);
      const beforeMatchStatus = resolveBandMatch(raster, indexType, beforeBandA, beforeBandB).status;
      const afterMatchStatus = resolveBandMatch(comparisonRaster, indexType, afterBandA, afterBandB).status;
      const requestContext: AnalysisRequestContext = {
        indexType,
        primaryFilename: raster.filename,
        comparisonFilename: comparisonRaster.filename,
        beforeBandA: submittedBeforeBandA,
        beforeBandB: submittedBeforeBandB,
        afterBandA: submittedAfterBandA,
        afterBandB: submittedAfterBandB,
        changeThreshold,
        bandMatchStatus: beforeMatchStatus === 'matched' && afterMatchStatus === 'matched' ? 'matched' : 'manual',
      };
      const data = new FormData();
      data.append('before_image_id', raster.id);
      data.append('after_image_id', comparisonRaster.id);
      data.append('index_type', indexType);
      data.append('before_band_a', String(submittedBeforeBandA));
      data.append('before_band_b', String(submittedBeforeBandB));
      data.append('after_band_a', String(submittedAfterBandA));
      data.append('after_band_b', String(submittedAfterBandB));
      data.append('threshold', String(changeThreshold));
      if (selectedBounds) data.append('bounds_wgs84', selectedBounds.join(','));
      const response = await fetch(`${API_BASE}/analysis/change`, { method: 'POST', body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? '变化检测失败');
      const result = normalizeAnalysisResult(body, raster.id, requestContext, selectedWgs84Bounds ?? rasterWgs84Bounds, comparisonRaster.id);
      setAnalysisResults((items) => [result, ...items]);
      setActiveResultId(result.id);
      setFitBounds3d(resultMapBounds(result));
      setFitNonce(n => n + 1);
      setResultsOpen(true);
      setStatus(`${result.name} 完成`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '变化检测失败');
    } finally {
      setBusy(false);
    }
  }

  function updateResultVariant(resultId: string, variantId: string, patch: Partial<AnalysisLayerVariant>) {
    setAnalysisResults((items) => items.map((item) => item.id === resultId
      ? {
        ...item,
        layerVariants: item.layerVariants.map((variant) => variant.id === variantId ? { ...variant, ...patch } : variant),
      }
      : item));
  }

  function showResultVariantOnMap(resultId: string, variant: AnalysisLayerVariant, checked: boolean) {
    updateResultVariant(resultId, variant.id, { visible: checked });
    if (!checked || !variant.boundsWgs84) return;
    setActiveResultId(resultId);
    setFitBounds3d(variant.boundsWgs84);
    setFitNonce(n => n + 1);
    setResultsOpen(false);
    setStatus(`已显示到地图：${variant.label}`);
  }

  function zoomTo(wgs84Bounds: Wgs84Bounds | null) {
    if (!wgs84Bounds) return;
    setFitBounds3d(wgs84Bounds);
    setFitNonce(n => n + 1);
  }

  function clearAll() {
    setRaster(null);
    setComparisonRaster(null);
    setVector(null);
    setSelectedBounds(null);
    setGeeUrl(null);
    setSample(ui.noQuery);
    setMapInfo(ui.noQuery);
    setStatus(ui.waiting);
    setAnalysisResults([]);
    setActiveResultId(null);
    setFitBounds3d(null);
    setFitNonce(n => n + 1);
  }

  return (
    <div className="app platform-app">
      <aside className="function-sidebar">
        <header className="brand">
          <Satellite size={26} />
          <div>
            <h1>{ui.title}</h1>
            <p>{ui.subtitle}</p>
          </div>
        </header>

        <nav className="function-nav" aria-label="功能侧边栏">
          <button type="button" className={activeFunctionPanel === 'data' ? 'selected' : 'secondary'} onClick={() => setActiveFunctionPanel('data')}><FolderUp size={17} />{ui.data}</button>
          <button type="button" className={activeFunctionPanel === 'gee' ? 'selected' : 'secondary'} onClick={() => setActiveFunctionPanel('gee')}><MousePointer2 size={17} />{ui.areaDownload}</button>
          <button type="button" className={activeFunctionPanel === 'analysis' ? 'selected' : 'secondary'} onClick={() => setActiveFunctionPanel('analysis')}><Layers size={17} />{ui.analysis}</button>
          <button type="button" className={activeFunctionPanel === 'results' ? 'selected' : 'secondary'} onClick={() => setActiveFunctionPanel('results')}><Eye size={17} />{ui.results}</button>
          <button type="button" className={activeFunctionPanel === 'metadata' ? 'selected' : 'secondary'} onClick={() => setActiveFunctionPanel('metadata')}><FileImage size={17} />{ui.metadata}</button>
          <button type="button" className={activeFunctionPanel === 'info' ? 'selected' : 'secondary'} onClick={() => setActiveFunctionPanel('info')}><LocateFixed size={17} />{ui.clickInfo}</button>
        </nav>

        <section className="workspace-panel">
          <h2 className="workspace-panel-title">
            {activeFunctionPanel === 'data' && <><FolderUp size={18} /> {ui.data}</>}
            {activeFunctionPanel === 'gee' && <><MousePointer2 size={18} /> {ui.areaDownload}</>}
            {activeFunctionPanel === 'analysis' && <><Layers size={18} /> {ui.analysis}</>}
            {activeFunctionPanel === 'results' && <><Eye size={18} /> {ui.resultDrawer}</>}
            {activeFunctionPanel === 'metadata' && <><FileImage size={18} /> {ui.metadata}</>}
            {activeFunctionPanel === 'info' && <><LocateFixed size={18} /> {ui.clickInfo}</>}
          </h2>

        {activeFunctionPanel === 'data' && <>
        <section className="panel">
          <h2><FolderUp size={18} /> {ui.data}</h2>
          <div className="segmented">
            <button type="button" className={dataTarget === 'primary' ? 'selected' : 'secondary'} onClick={() => setDataTarget('primary')}>{ui.primaryRaster}</button>
            <button type="button" className={dataTarget === 'comparison' ? 'selected' : 'secondary'} onClick={() => setDataTarget('comparison')}>{ui.comparisonRaster}</button>
          </div>
          <label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={dropHandler(onRaster)}>
            <FileImage size={24} />
            <span>{ui.uploadOrDrop}</span>
            <input disabled={busy} type="file" accept=".tif,.tiff" onChange={(e) => e.target.files?.[0] && onRaster(e.target.files[0])} />
          </label>
          <label className="dropzone compact" onDragOver={(event) => event.preventDefault()} onDrop={dropHandler(onVector)}>
            <Shapes size={22} />
            <span>{ui.uploadZipShape}</span>
            <input disabled={busy} type="file" accept=".zip" onChange={(e) => e.target.files?.[0] && onVector(e.target.files[0])} />
          </label>
        </section>

        <section className="panel">
          <h2><Layers size={18} /> {ui.bandDisplay}</h2>
          <div className="band-grid">
            {['R', 'G', 'B'].map((label, index) => (
              <label key={label}>
                <span>{label}</span>
                <input
                  type="number"
                  min={1}
                  max={raster?.count ?? 1}
                  disabled={!raster || busy}
                  value={bands[index]}
                  onChange={(event) => {
                    const next = [...bands];
                    next[index] = Number(event.target.value);
                    setBands(next);
                  }}
                />
              </label>
            ))}
          </div>
          <label className="range-row">
            <span>{ui.opacity}</span>
            <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
          </label>
          <button type="button" onClick={queryCenter} disabled={!raster || busy}>
            <LocateFixed size={18} /> {ui.queryCenter}
          </button>
          <div className="sample">{sample}</div>
        </section>

        </>}

        {activeFunctionPanel === 'metadata' && <>
        <section className="metadata">
          <h2>{ui.metadata}</h2>
          {raster ? (
            <dl>
              <dt>{ui.file}</dt><dd>{raster.filename}</dd>
              <dt>{ui.size}</dt><dd>{raster.width} x {raster.height}</dd>
              <dt>{ui.bands}</dt><dd>{raster.count}</dd>
              <dt>Band names</dt><dd>{raster.bandDescriptions.filter(Boolean).join(', ') || ui.unknown}</dd>
              <dt>{ui.crs}</dt><dd>{raster.crs ?? ui.unknown}</dd>
              <dt>{ui.resolution}</dt><dd>{raster.resolution.map(v => v.toFixed(3)).join(' / ')}</dd>
              <dt>{ui.types}</dt><dd>{raster.dtypes.join(', ')}</dd>
              <dt>{ui.bounds}</dt><dd>{raster.boundsWgs84 ? raster.boundsWgs84.map(v => v.toFixed(5)).join(', ') : ui.unknown}</dd>
            </dl>
          ) : <p>{ui.uploadHint}</p>}
        </section>

        <section className="metadata">
          <h2>{ui.comparisonMetadata}</h2>
          {comparisonRaster ? (
            <dl>
              <dt>{ui.file}</dt><dd>{comparisonRaster.filename}</dd>
              <dt>{ui.size}</dt><dd>{comparisonRaster.width} x {comparisonRaster.height}</dd>
              <dt>{ui.bands}</dt><dd>{comparisonRaster.count}</dd>
              <dt>Band names</dt><dd>{comparisonRaster.bandDescriptions.filter(Boolean).join(', ') || ui.unknown}</dd>
              <dt>{ui.bounds}</dt><dd>{comparisonRaster.boundsWgs84 ? comparisonRaster.boundsWgs84.map(v => v.toFixed(5)).join(', ') : ui.unknown}</dd>
            </dl>
          ) : <p>{ui.needComparison}</p>}
        </section>
        </>}

        {activeFunctionPanel === 'info' && (
          <section className="panel">
            <div className="sample">{mapInfo}</div>
          </section>
        )}

        {activeFunctionPanel === 'results' && (
          <section className="panel">
            <div className="sample">{activeResult ? statsLine(activeResult.summary) || ui.stats : ui.noResults}</div>
            <button type="button" onClick={() => setResultsOpen(true)} disabled={analysisResults.length === 0}>{ui.resultDrawer}</button>
          </section>
        )}

        {activeFunctionPanel === 'gee' && (
          <section className="panel">
            <div className="gee-target-row">
              <span>{ui.target}</span>
              <div className="segmented">
                <button type="button" className={dataTarget === 'primary' ? 'selected' : 'secondary'} onClick={() => setDataTarget('primary')} disabled={busy}>{ui.primaryRaster}</button>
                <button type="button" className={dataTarget === 'comparison' ? 'selected' : 'secondary'} onClick={() => setDataTarget('comparison')} disabled={busy}>{ui.comparisonRaster}</button>
              </div>
            </div>
            <div className="form-grid">
              <label>
                <span>{ui.dataset}</span>
                <input value={dataset} onChange={(event) => setDataset(event.target.value)} disabled={busy} />
              </label>
              <label>
                <span>{ui.startDate}</span>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={busy} />
              </label>
              <label>
                <span>{ui.endDate}</span>
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={busy} />
              </label>
              <label>
                <span>{ui.scale}</span>
                <input type="number" min={GEE_MIN_SCALE_METERS} step={10} value={scale} onChange={(event) => setScale(Number(event.target.value))} disabled={busy} />
              </label>
            </div>
            <div className="gee-resolution-note">{GEE_RESOLUTION_NOTE}</div>
            <div className="sample">{selectedBounds ? ui.fromDraw : vector ? ui.fromVector : ui.needArea}</div>
            <button type="button" className={drawing ? 'active' : ''} onClick={() => setDrawing(!drawing)} disabled={busy}>
              <MousePointer2 size={18} /> {drawing ? ui.stopDraw : ui.drawBox}
            </button>
            <button type="button" onClick={fetchGeeImage} disabled={busy || (!selectedBounds && !vector)}>
              <Download size={18} /> {ui.fetchGee}
            </button>
            {geeUrl && <a className="download" href={geeUrl} target="_blank" rel="noreferrer">{ui.openDownload}</a>}
          </section>
        )}

        {activeFunctionPanel === 'analysis' && (
          <section className="panel analysis-panel">
            <div className="tabs">
              <button type="button" className={analysisTab === 'index' ? 'selected' : 'secondary'} onClick={() => setAnalysisTab('index')}>{ui.indexAnalysis}</button>
              <button type="button" className={analysisTab === 'change' ? 'selected' : 'secondary'} onClick={() => setAnalysisTab('change')}>{ui.changeDetection}</button>
              <button type="button" className="secondary" onClick={() => setActiveFunctionPanel('results')}>{ui.results}</button>
            </div>

            {analysisTab !== 'results' && (
              <div className="form-grid analysis-form">
                <label>
                  <span>{ui.indexType}</span>
                  <select value={indexType} onChange={(event) => setIndexType(event.target.value as IndexType)}>
                    <option value="NDVI">NDVI</option>
                    <option value="NDWI">NDWI</option>
                    <option value="NDBI">NDBI</option>
                  </select>
                </label>
              </div>
            )}

            {analysisTab === 'index' && (
              <>
                <div className="sample">
                  <strong>{indexType}</strong> {INDEX_GUIDE[indexType].formula}: {INDEX_GUIDE[indexType].meaning}
                </div>
                <div className="band-match">
                  <span>{indexBandMatch.status === 'matched' ? 'Matched preset' : 'Manual bands'}: {indexBandMatch.label}</span>
                  <label>
                    <span>{ui.bandA}</span>
                    <input type="number" min={1} max={raster?.count ?? 1} value={bandA} onChange={(event) => setBandA(Number(event.target.value))} />
                  </label>
                  <label>
                    <span>{ui.bandB}</span>
                    <input type="number" min={1} max={raster?.count ?? 1} value={bandB} onChange={(event) => setBandB(Number(event.target.value))} />
                  </label>
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={thresholdEnabled} onChange={(event) => setThresholdEnabled(event.target.checked)} />
                  <span>{ui.thresholdEnabled}</span>
                </label>
                {thresholdEnabled && (
                  <div className="form-grid">
                    <label>
                      <span>{ui.thresholdMin}</span>
                      <input type="number" step="0.05" value={thresholdMin} onChange={(event) => setThresholdMin(Number(event.target.value))} />
                    </label>
                    <label>
                      <span>{ui.thresholdMax}</span>
                      <input type="number" step="0.05" value={thresholdMax} onChange={(event) => setThresholdMax(Number(event.target.value))} />
                    </label>
                  </div>
                )}
                <button type="button" onClick={runIndexAnalysis} disabled={!raster || busy}>{ui.runIndex}</button>
              </>
            )}

            {analysisTab === 'change' && (
              <>
                <div className="sample">
                  <strong>{indexType}</strong> {INDEX_GUIDE[indexType].formula}: {INDEX_GUIDE[indexType].meaning}
                </div>
                <div className="band-match">
                  <article>
                    <strong>Before 主影像</strong>
                    <span>{beforeBandMatch.status === 'matched' ? 'Matched preset' : 'Manual bands'}: {beforeBandMatch.label}</span>
                    <label>
                      <span>{ui.bandA}</span>
                      <input type="number" min={1} max={raster?.count ?? 1} value={beforeBandA} onChange={(event) => setBeforeBandA(Number(event.target.value))} />
                    </label>
                    <label>
                      <span>{ui.bandB}</span>
                      <input type="number" min={1} max={raster?.count ?? 1} value={beforeBandB} onChange={(event) => setBeforeBandB(Number(event.target.value))} />
                    </label>
                  </article>
                  <article>
                    <strong>After 对比影像</strong>
                    <span>{afterBandMatch.status === 'matched' ? 'Matched preset' : 'Manual bands'}: {afterBandMatch.label}</span>
                    <label>
                      <span>{ui.bandA}</span>
                      <input type="number" min={1} max={comparisonRaster?.count ?? 1} value={afterBandA} onChange={(event) => setAfterBandA(Number(event.target.value))} />
                    </label>
                    <label>
                      <span>{ui.bandB}</span>
                      <input type="number" min={1} max={comparisonRaster?.count ?? 1} value={afterBandB} onChange={(event) => setAfterBandB(Number(event.target.value))} />
                    </label>
                  </article>
                </div>
                <label className="range-row">
                  <span>{ui.threshold}: {changeThreshold.toFixed(2)}</span>
                  <input type="range" min="0.02" max="1" step="0.02" value={changeThreshold} onChange={(event) => setChangeThreshold(Number(event.target.value))} />
                </label>
                <div className="sample">{raster && comparisonRaster ? `${raster.filename} -> ${comparisonRaster.filename}` : ui.needComparison}</div>
                <button type="button" onClick={runChangeDetection} disabled={!raster || !comparisonRaster || busy}>{ui.runChange}</button>
              </>
            )}
          </section>
        )}

        </section>
      </aside>

      <main className="map-shell">
        <div className={`status ${busy ? 'loading' : ''}`}>{status}</div>
        <CesiumWorkspace
          raster={raster}
          comparisonRaster={comparisonRaster}
          vector={vector}
          overlayUrl={overlayUrl}
          comparisonOverlayUrl={comparisonOverlayUrl}
          analysisLayers={analysisResults.flatMap((result) => result.layerVariants)}
          selectedBounds={selectedWgs84Bounds}
          opacity={opacity}
          comparisonOpacity={comparisonOpacity}
          showRaster={showRaster}
          showComparisonRaster={showComparisonRaster}
          showVector={showVector}
          showBasemap={showBasemap}
          drawing={drawing}
          fitBounds={fitBounds3d ?? activeResult?.boundsWgs84 ?? rasterWgs84Bounds ?? vectorWgs84Bounds ?? comparisonWgs84Bounds ?? selectedWgs84Bounds}
          fitNonce={fitNonce}
          apiBase={API_BASE}
          onInfo={setMapInfo}
          onDrawingChange={setDrawing}
          onSelectedBoundsChange={(bounds) => {
            setSelectedBounds(bounds);
            setFitBounds3d(bounds);
            setDrawing(false);
            if (bounds) setStatus(ui.areaSelected);
          }}
        />
      </main>

      <aside className="layer-sidebar">
        <section className="panel">
          <h2><Eye size={18} /> {ui.layerControl}</h2>
          <label className="check-row">
            <input type="checkbox" checked={showBasemap} onChange={(event) => setShowBasemap(event.target.checked)} />
            <span>{ui.showBasemap}</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={showRaster} onChange={(event) => setShowRaster(event.target.checked)} />
            <span>{ui.showRaster}</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={showComparisonRaster} onChange={(event) => setShowComparisonRaster(event.target.checked)} />
            <span>{ui.showComparisonRaster}</span>
          </label>
          <label className="range-row">
            <span>{ui.comparisonOpacity}</span>
            <input type="range" min="0" max="1" step="0.05" value={comparisonOpacity} onChange={(event) => setComparisonOpacity(Number(event.target.value))} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={showVector} onChange={(event) => setShowVector(event.target.checked)} />
            <span>{ui.showVector}</span>
          </label>
          {analysisResults.length > 0 && (
            <div className="analysis-layer-stack">
              {analysisResults.map((result) => (
                <div key={result.id} className="analysis-layer-group">
                  <strong>{result.name}</strong>
                  {result.kind === 'change' && <ChangeLegend />}
                  {result.layerVariants.map((variant) => (
                    <div key={variant.id} className="analysis-layer-control">
                      <label className="mini-check">
                        <input
                          type="checkbox"
                          checked={variant.visible}
                          onChange={(event) => showResultVariantOnMap(result.id, variant, event.target.checked)}
                        />
                        <span>{variant.label}</span>
                      </label>
                      <label className="mini-range">
                        <span>{ui.layerOpacity}</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={variant.opacity}
                          onChange={(event) => updateResultVariant(result.id, variant.id, { opacity: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="button-grid">
            <button type="button" className="secondary" onClick={() => zoomTo(rasterWgs84Bounds)} disabled={!rasterWgs84Bounds}>{ui.zoomImage}</button>
            <button type="button" className="secondary" onClick={() => zoomTo(vectorWgs84Bounds)} disabled={!vectorWgs84Bounds}>{ui.zoomVector}</button>
            <button type="button" className="secondary" onClick={() => zoomTo(selectedWgs84Bounds)} disabled={!selectedWgs84Bounds}>{ui.zoomArea}</button>
          </div>
          <div className="layer-actions">
            <button type="button" className="secondary" onClick={() => setSelectedBounds(null)} disabled={!selectedBounds || busy}>
              <RotateCcw size={18} /> {ui.clearArea}
            </button>
            <button type="button" className="secondary" onClick={clearAll} disabled={busy}>
              <Trash2 size={18} /> {ui.clearAll}
            </button>
          </div>
        </section>

        <section className="panel">
          <h2><MousePointer2 size={18} /> {ui.areaDownload}</h2>
          <div className="gee-target-row">
            <span>{ui.target}</span>
            <div className="segmented">
              <button type="button" className={dataTarget === 'primary' ? 'selected' : 'secondary'} onClick={() => setDataTarget('primary')} disabled={busy}>{ui.primaryRaster}</button>
              <button type="button" className={dataTarget === 'comparison' ? 'selected' : 'secondary'} onClick={() => setDataTarget('comparison')} disabled={busy}>{ui.comparisonRaster}</button>
            </div>
          </div>
          <div className="form-grid">
            <label>
              <span>{ui.dataset}</span>
              <input value={dataset} onChange={(event) => setDataset(event.target.value)} disabled={busy} />
            </label>
            <label>
              <span>{ui.startDate}</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={busy} />
            </label>
            <label>
              <span>{ui.endDate}</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={busy} />
            </label>
            <label>
              <span>{ui.scale}</span>
              <input type="number" min={GEE_MIN_SCALE_METERS} step={10} value={scale} onChange={(event) => setScale(Number(event.target.value))} disabled={busy} />
            </label>
          </div>
          <div className="gee-resolution-note">{GEE_RESOLUTION_NOTE}</div>
          <div className="sample">
            {selectedBounds ? ui.fromDraw : vector ? ui.fromVector : ui.needArea}
          </div>
          <button type="button" className={drawing ? 'active' : ''} onClick={() => setDrawing(!drawing)} disabled={busy}>
            <MousePointer2 size={18} /> {drawing ? ui.stopDraw : ui.drawBox}
          </button>
          <button type="button" className="secondary" onClick={() => setSelectedBounds(null)} disabled={!selectedBounds || busy}>
            <RotateCcw size={18} /> {ui.clearArea}
          </button>
          <button type="button" onClick={fetchGeeImage} disabled={busy || (!selectedBounds && !vector)}>
            <Download size={18} /> {ui.fetchGee}
          </button>
          {geeUrl && <a className="download" href={geeUrl} target="_blank" rel="noreferrer">{ui.openDownload}</a>}
        </section>

        <section className="panel analysis-panel">
          <h2>{ui.analysis}</h2>
          <div className="tabs">
            <button type="button" className={analysisTab === 'index' ? 'selected' : 'secondary'} onClick={() => setAnalysisTab('index')}>{ui.indexAnalysis}</button>
            <button type="button" className={analysisTab === 'change' ? 'selected' : 'secondary'} onClick={() => setAnalysisTab('change')}>{ui.changeDetection}</button>
            <button type="button" className="secondary" onClick={() => setResultsOpen(true)}>{ui.results}</button>
          </div>

          {analysisTab !== 'results' && (
            <div className="form-grid analysis-form">
              <label>
                <span>{ui.indexType}</span>
                <select value={indexType} onChange={(event) => setIndexType(event.target.value as IndexType)}>
                  <option value="NDVI">NDVI</option>
                  <option value="NDWI">NDWI</option>
                  <option value="NDBI">NDBI</option>
                </select>
              </label>
            </div>
          )}

          {analysisTab === 'index' && (
            <>
              <div className="sample">
                <strong>{indexType}</strong> {INDEX_GUIDE[indexType].formula}: {INDEX_GUIDE[indexType].meaning}
              </div>
              <div className="band-match">
                <span>{indexBandMatch.status === 'matched' ? 'Matched preset' : 'Manual bands'}: {indexBandMatch.label}</span>
                <label>
                  <span>{ui.bandA}</span>
                  <input type="number" min={1} max={raster?.count ?? 1} value={bandA} onChange={(event) => setBandA(Number(event.target.value))} />
                </label>
                <label>
                  <span>{ui.bandB}</span>
                  <input type="number" min={1} max={raster?.count ?? 1} value={bandB} onChange={(event) => setBandB(Number(event.target.value))} />
                </label>
              </div>
              <label className="check-row">
                <input type="checkbox" checked={thresholdEnabled} onChange={(event) => setThresholdEnabled(event.target.checked)} />
                <span>{ui.thresholdEnabled}</span>
              </label>
              {thresholdEnabled && (
                <div className="form-grid">
                  <label>
                    <span>{ui.thresholdMin}</span>
                    <input type="number" step="0.05" value={thresholdMin} onChange={(event) => setThresholdMin(Number(event.target.value))} />
                  </label>
                  <label>
                    <span>{ui.thresholdMax}</span>
                    <input type="number" step="0.05" value={thresholdMax} onChange={(event) => setThresholdMax(Number(event.target.value))} />
                  </label>
                </div>
              )}
              <button type="button" onClick={runIndexAnalysis} disabled={!raster || busy}>{ui.runIndex}</button>
            </>
          )}

          {analysisTab === 'change' && (
            <>
              <div className="sample">
                <strong>{indexType}</strong> {INDEX_GUIDE[indexType].formula}: {INDEX_GUIDE[indexType].meaning}
              </div>
              <div className="band-match">
                <article>
                  <strong>Before 主影像</strong>
                  <span>{beforeBandMatch.status === 'matched' ? 'Matched preset' : 'Manual bands'}: {beforeBandMatch.label}</span>
                  <label>
                    <span>{ui.bandA}</span>
                    <input type="number" min={1} max={raster?.count ?? 1} value={beforeBandA} onChange={(event) => setBeforeBandA(Number(event.target.value))} />
                  </label>
                  <label>
                    <span>{ui.bandB}</span>
                    <input type="number" min={1} max={raster?.count ?? 1} value={beforeBandB} onChange={(event) => setBeforeBandB(Number(event.target.value))} />
                  </label>
                </article>
                <article>
                  <strong>After 对比影像</strong>
                  <span>{afterBandMatch.status === 'matched' ? 'Matched preset' : 'Manual bands'}: {afterBandMatch.label}</span>
                  <label>
                    <span>{ui.bandA}</span>
                    <input type="number" min={1} max={comparisonRaster?.count ?? 1} value={afterBandA} onChange={(event) => setAfterBandA(Number(event.target.value))} />
                  </label>
                  <label>
                    <span>{ui.bandB}</span>
                    <input type="number" min={1} max={comparisonRaster?.count ?? 1} value={afterBandB} onChange={(event) => setAfterBandB(Number(event.target.value))} />
                  </label>
                </article>
              </div>
              <label className="range-row">
                <span>{ui.threshold}: {changeThreshold.toFixed(2)}</span>
                <input type="range" min="0.02" max="1" step="0.02" value={changeThreshold} onChange={(event) => setChangeThreshold(Number(event.target.value))} />
              </label>
              <div className="sample">{raster && comparisonRaster ? `${raster.filename} -> ${comparisonRaster.filename}` : ui.needComparison}</div>
              <button type="button" onClick={runChangeDetection} disabled={!raster || !comparisonRaster || busy}>{ui.runChange}</button>
            </>
          )}

          <div className="sample">{activeResult ? statsLine(activeResult.summary) || ui.stats : ui.noResults}</div>
        </section>

        <section className="panel">
          <h2>{ui.clickInfo}</h2>
          <div className="sample">{mapInfo}</div>
        </section>
      </aside>

      {resultsOpen && (
        <div className="result-modal-backdrop" role="presentation" onClick={() => setResultsOpen(false)}>
          <section
            className="result-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="analysis-results-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-heading">
              <h2 id="analysis-results-title">{ui.resultDrawer}</h2>
              <div className="modal-actions">
                <span>{analysisResults.length}</span>
                <button type="button" className="secondary" onClick={() => setResultsOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="result-list">
              {analysisResults.length === 0 ? (
                <div className="sample">{ui.noResults}</div>
              ) : analysisResults.map((result) => (
                <article key={result.id} className={`result-row ${activeResultId === result.id ? 'active-result' : ''}`}>
                  <button type="button" className="result-title secondary" onClick={() => setActiveResultId(result.id)}>
                    <strong>{result.name}</strong>
                    <span>{result.createdAt}</span>
                  </button>
                  <div className="result-context">
                    <span>{result.requestContext.indexType}</span>
                    <span>{result.requestContext.primaryFilename}</span>
                    {result.requestContext.comparisonFilename && <span>{result.requestContext.comparisonFilename}</span>}
                    <span>A/B {result.requestContext.beforeBandA}/{result.requestContext.beforeBandB}</span>
                    {result.requestContext.afterBandA && result.requestContext.afterBandB && (
                      <span>After {result.requestContext.afterBandA}/{result.requestContext.afterBandB}</span>
                    )}
                    {result.requestContext.thresholdMin !== undefined && result.requestContext.thresholdMax !== undefined && (
                      <span>{ui.threshold} {result.requestContext.thresholdMin} - {result.requestContext.thresholdMax}</span>
                    )}
                    {result.requestContext.changeThreshold !== undefined && (
                      <span>{ui.threshold} {result.requestContext.changeThreshold}</span>
                    )}
                    <span>{result.requestContext.bandMatchStatus === 'matched' ? 'Matched preset' : 'Manual bands'}</span>
                  </div>
                  <div className="result-variants">
                    {result.kind === 'change' && <ChangeLegend />}
                    {result.layerVariants.map((variant) => (
                      <div key={variant.id} className="result-variant-control">
                        <label className="mini-check">
                          <input
                            type="checkbox"
                            checked={variant.visible}
                            onChange={(event) => showResultVariantOnMap(result.id, variant, event.target.checked)}
                          />
                          <span>{ui.showOnMap}: {variant.label}</span>
                        </label>
                        <label className="mini-range">
                          <span>{ui.layerOpacity}</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={variant.opacity}
                            onChange={(event) => updateResultVariant(result.id, variant.id, { opacity: Number(event.target.value) })}
                          />
                        </label>
                        <span className={`result-legend legend-${variant.legend}`}>{variant.legend}</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="secondary" onClick={() => zoomTo(result.boundsWgs84)} disabled={!result.boundsWgs84}>{ui.zoomResult}</button>
                  <a className="download small" href={result.downloadUrl} target="_blank" rel="noreferrer">{ui.downloadResult}</a>
                  <a className="download small" href={result.statsUrl} target="_blank" rel="noreferrer">{ui.stats}</a>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
