# Cesium 3D Terrain Integration Design

Date: 2026-05-22

## Context

The current remote sensing app is a React + Leaflet frontend with a FastAPI backend. Existing features include GeoTIFF upload and preview, band selection, raster sampling, zipped Shapefile upload, map box selection, and Google Earth Engine image download. The main frontend map workflow is currently implemented in `frontend/src/main.tsx`.

The new work adds Cesium as a 3D terrain view while preserving the existing 2D Leaflet workflow.

## Goals

- Add a 2D / 3D view switch in the map area.
- Keep the existing Leaflet-based 2D map and all current controls working.
- Add a Cesium 3D globe view focused on terrain browsing.
- Use Cesium World Terrain when a Cesium ion token is configured.
- Reserve a local token configuration interface through `VITE_CESIUM_ION_TOKEN`.
- Avoid hardcoding the Cesium ion token in source files.
- Reuse existing raster, vector, selected-area, opacity, and fit-to-bounds state in the 3D view.

## Non-Goals

- Do not replace Leaflet with Cesium.
- Do not add a backend token service.
- Do not add an in-page token input in this version.
- Do not implement advanced 3D analysis tools such as line-of-sight, volume, or slope analysis in this version.
- Do not modify the current FastAPI raster processing pipeline unless required for 3D display.

## User Experience

The app keeps its current left sidebar for upload, layer control, GEE download, sampling, and metadata. The map area gains a compact `2D / 3D` segmented control.

In 2D mode, the current Leaflet map renders exactly as before.

In 3D mode, the map area renders a Cesium globe. If `VITE_CESIUM_ION_TOKEN` exists, Cesium uses the token and enables Cesium World Terrain. If the token is missing, the globe still renders with a clear non-blocking status message that terrain is unavailable until a token is configured.

The existing zoom buttons should work in both modes:

- Zoom to image: fly to the raster WGS84 bounds.
- Zoom to vector: fly to the vector WGS84 bounds.
- Zoom to area: fly to the selected rectangle.

The 3D view should also display available overlays:

- Raster preview image draped on the globe surface using the existing preview PNG endpoint.
- Uploaded Shapefile as a GeoJSON data source.
- Selected rectangle as a highlighted polygon.

## Configuration

Add `frontend/.env.example`:

```env
VITE_CESIUM_ION_TOKEN=your_cesium_ion_token_here
```

Local usage:

```powershell
cd frontend
Copy-Item .env.example .env
```

Then replace the placeholder value in `.env` with the user's Cesium ion token.

The application reads the token with:

```ts
import.meta.env.VITE_CESIUM_ION_TOKEN
```

The token is treated as browser configuration, not as a private server-side secret. A real token must live in local `.env`, which is not committed.

## Frontend Architecture

### `main.tsx`

Responsibilities:

- Preserve existing app state and Leaflet components.
- Add `viewMode: '2d' | '3d'`.
- Render the segmented view switch in the map area.
- Render the existing `MapContainer` only when `viewMode === '2d'`.
- Render the new Cesium component when `viewMode === '3d'`.
- Pass shared state into the Cesium component:
  - `raster`
  - `vector`
  - `overlayUrl`
  - `raster.boundsWgs84`
  - `vector.boundsWgs84`
  - selected rectangle bounds converted to `[west, south, east, north]`
  - `opacity`
  - layer visibility flags
  - fit target bounds as `[west, south, east, north]`
  - fit nonce to trigger camera flight

### `CesiumGlobe.tsx`

Responsibilities:

- Own Cesium viewer lifecycle.
- Read and apply the Cesium ion token.
- Enable World Terrain when token is present.
- Add and clean up raster, vector, and selected-area overlays.
- Fly camera to the current fit target when requested.
- Surface terrain availability and loading state through a lightweight overlay.
- Accept all geographic bounds as WGS84 `[west, south, east, north]` arrays to keep Cesium independent from Leaflet types.

The component should use Cesium's imperative API behind a React boundary so the rest of the app remains mostly declarative.

### Styling

Add styles for:

- Map mode segmented control.
- Cesium full-height container.
- Cesium status badge.
- Responsive layout so the 3D view follows the same desktop and mobile heights as the 2D map.

## Data Flow

1. User uploads or downloads data using the existing sidebar controls.
2. Existing app state stores raster, vector, selected bounds, opacity, and visibility settings.
3. In 2D mode, Leaflet consumes those values as it does today.
4. In 3D mode, `CesiumGlobe` consumes the same values and maps them to Cesium imagery and data sources.
5. Token configuration affects only Cesium initialization and terrain provider selection.

## Error Handling

- Missing token: show a non-blocking message and render Cesium without World Terrain.
- Cesium initialization failure: show a readable error message inside the map area.
- Raster overlay failure: keep the globe usable and show a short status message.
- Vector overlay failure: keep the raster and terrain usable.
- Invalid or missing bounds: skip camera flight rather than throwing.

## Testing And Verification

Implementation should include lightweight tests or testable helpers for:

- Reading the Cesium token from environment configuration.
- Converting WGS84 bounds into Cesium camera rectangles.
- Choosing terrain mode based on token availability.

Manual verification:

- `npm run build` in `frontend`.
- Start the frontend and confirm 2D mode still loads.
- Switch to 3D mode and confirm the Cesium globe renders.
- Configure `VITE_CESIUM_ION_TOKEN` and confirm terrain mode is enabled.
- Upload or load a raster and verify the overlay appears in 2D and is attempted in 3D.
- Upload a Shapefile and verify the vector boundary appears in 2D and is attempted in 3D.

## Implementation Notes

- Add `cesium` to frontend dependencies.
- Use Cesium CSS from `cesium/Build/Cesium/Widgets/widgets.css`.
- Configure Vite for Cesium static assets if required by the installed Cesium package.
- Do not commit a real `.env` file or real token.
- Keep Cesium code in a separate component to avoid making `main.tsx` harder to maintain.
