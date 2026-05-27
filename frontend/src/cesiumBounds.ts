export type Wgs84Bounds = [number, number, number, number];

export type RectangleDegrees = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function normalizeWgs84Bounds(bounds: number[] | null | undefined): Wgs84Bounds | null {
  if (!bounds || bounds.length !== 4) return null;
  const [west, south, east, north] = bounds;
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (east <= west || north <= south) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  return [west, south, east, north];
}

export function boundsToRectangleDegrees(bounds: number[] | null | undefined): RectangleDegrees | null {
  const normalized = normalizeWgs84Bounds(bounds);
  if (!normalized) return null;
  const [west, south, east, north] = normalized;
  return { west, south, east, north };
}
