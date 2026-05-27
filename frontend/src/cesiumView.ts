import { boundsToRectangleDegrees, normalizeWgs84Bounds, type Wgs84Bounds } from './cesiumBounds';

export type CesiumViewMode = '2d' | '3d';
export type CesiumSceneModeName = 'SCENE2D' | 'SCENE3D';
export type LonLatPoint = {
  lon: number;
  lat: number;
};

export type RectangleDegrees = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function rectangleDegreesFromWgs84Bounds(bounds: Wgs84Bounds | null): RectangleDegrees | null {
  const normalized = normalizeWgs84Bounds(bounds);
  return boundsToRectangleDegrees(normalized);
}

export function cesiumViewModeLabel(mode: CesiumViewMode): string {
  if (mode === '2d') return '2D';
  return '3D';
}

export function cesiumSceneModeForViewMode(mode: CesiumViewMode): CesiumSceneModeName {
  if (mode === '2d') return 'SCENE2D';
  return 'SCENE3D';
}

export function local2dBoundsForPoint(point: LonLatPoint | null | undefined, spanDegrees = 1): Wgs84Bounds | null {
  if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat) || spanDegrees <= 0) return null;
  return [
    Math.max(-180, point.lon - spanDegrees),
    Math.max(-90, point.lat - spanDegrees),
    Math.min(180, point.lon + spanDegrees),
    Math.min(90, point.lat + spanDegrees),
  ];
}
