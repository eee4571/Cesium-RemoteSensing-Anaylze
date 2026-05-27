# Remove 2.5D And OSM Buildings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the Cesium workspace to only 2D and 3D modes and remove OSM Buildings support.

**Architecture:** Keep Cesium terrain and imagery support, but remove Columbus View and OSM building primitive code. Update tests and documentation so future changes do not reintroduce 2.5D or OSM building UI.

**Tech Stack:** React, TypeScript, CesiumJS, Vite, node:test.

---

## File Structure

- Modify: `frontend/src/cesiumView.ts`
  - Remove `columbus` view mode and `COLUMBUS_VIEW` mapping.
- Modify: `frontend/src/CesiumWorkspace.tsx`
  - Remove `createOsmBuildingsAsync`, building state/effect/button, and `morphToColumbusView`.
  - Render only `2D` and `3D` view buttons.
- Modify: `frontend/src/cesiumHelpers.test.ts`
  - Assert only 2D/3D modes exist and no OSM building code remains.
- Modify: `README.md`
  - Remove OSM Buildings and 2.5D mentions.

## Task 1: Add Failing Tests

- [ ] Add tests asserting no `columbus`, `2.5D`, `COLUMBUS_VIEW`, `OSM`, `Building2`, `createOsmBuildingsAsync`, `showBuildings`, or `buildingsRef` remains in frontend source files.
- [ ] Run `cd frontend; npm test` and verify failure.

## Task 2: Remove 2.5D Mode

- [ ] Update `frontend/src/cesiumView.ts` to use `type CesiumViewMode = '2d' | '3d'`.
- [ ] Remove `COLUMBUS_VIEW` from scene mode names.
- [ ] Update `CesiumWorkspace.tsx` toolbar modes to `['2d', '3d']`.
- [ ] Remove `morphToColumbusView` and any `columbus` default destination logic.

## Task 3: Remove OSM Buildings

- [ ] Remove `createOsmBuildingsAsync` and `Building2` imports.
- [ ] Remove `buildingsRef`, `showBuildings`, and the OSM building effect.
- [ ] Simplify `statusForScene` to only mention imagery and terrain.
- [ ] Remove the OSM building toolbar button.

## Task 4: Update Docs And Verify

- [ ] Update README text from `2D、2.5D、3D` to `2D、3D`.
- [ ] Remove OSM Buildings token guidance.
- [ ] Run `cd frontend; npm test`.
- [ ] Run `cd frontend; npm run build`.
