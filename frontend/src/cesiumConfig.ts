export type CesiumEnv = {
  VITE_CESIUM_ION_TOKEN?: string;
};

const PLACEHOLDER_TOKEN = 'your_cesium_ion_token_here';
const CESIUM_STATIC_BASE_URL = '/cesium/';
const LOCAL_NATURAL_EARTH_URL = `${CESIUM_STATIC_BASE_URL}Assets/Textures/NaturalEarthII`;
const ARCGIS_WORLD_IMAGERY_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';

export function getCesiumIonToken(env: CesiumEnv): string | null {
  const token = env.VITE_CESIUM_ION_TOKEN?.trim();
  if (!token || token === PLACEHOLDER_TOKEN) return null;
  return token;
}

export function hasCesiumIonToken(env: CesiumEnv): boolean {
  return getCesiumIonToken(env) !== null;
}

export function terrainModeForToken(token: string | null): 'world-terrain' | 'ellipsoid' {
  return token ? 'world-terrain' : 'ellipsoid';
}

export function baseImageryModeForToken(token: string | null): 'arcgis-world-imagery' | 'local-fallback' {
  return token ? 'arcgis-world-imagery' : 'local-fallback';
}

export function getLocalFallbackBaseLayerUrl(): string {
  return LOCAL_NATURAL_EARTH_URL;
}

export const getCesiumBaseLayerUrl = getLocalFallbackBaseLayerUrl;

export function getArcGisWorldImageryUrl(): string {
  return ARCGIS_WORLD_IMAGERY_URL;
}

export function getCesiumStaticBaseUrl(): string {
  return CESIUM_STATIC_BASE_URL;
}
