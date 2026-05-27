export type CesiumPickedInfo = {
  lon: number;
  lat: number;
  height: number | null;
  sample: string | null;
};

export function isFiniteLonLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat);
}

export function formatCesiumPickedInfo({ lon, lat, height, sample }: CesiumPickedInfo): string {
  const coordinate = `Lon ${lon.toFixed(6)}, Lat ${lat.toFixed(6)}`;
  const terrain = height === null ? '地表高程未知' : `地表高程 ${height.toFixed(1)} m`;
  return sample ? `${coordinate}; ${terrain}; ${sample}` : `${coordinate}; ${terrain}`;
}
