# Cesium-only 遥感工作空间设计

## 背景

当前前端同时使用 Leaflet 和 Cesium：Leaflet 负责 2D 地图，Cesium 负责 3D 地形。两者虽然共享影像、矢量、选区和透明度状态，但地图事件、图层对象、相机视角和绘制逻辑是两套系统，导致 2D 与 3D 的关联性不强。

本设计将地图工作区统一为 Cesium 实现。应用仍保留现有上传、影像元数据、GEE 下载、图层控制等业务流程，但地图显示、点击查询、框选、缩放和 2D/3D 切换全部由一个 Cesium Viewer 承担。

## 目标

- 用单个 Cesium 工作空间替代当前 Leaflet 2D 地图与 Cesium 3D 地图并存的结构。
- 支持 2D、2.5D、3D 三种视图模式，所有模式共享同一套图层和交互状态。
- 保留现有核心功能：GeoTIFF 预览叠加、Shapefile/GeoJSON 叠加、框选范围、GEE 下载、点击像元查询、图层显隐、透明度、缩放到影像/矢量/选区。
- 增强 3D 价值：地形高程、贴地图层、OSM Buildings、影像卷帘对比和后续高程剖面预留。

## 非目标

- 第一阶段不重写后端 API。
- 第一阶段不实现复杂变化检测算法，只为变化检测结果图层预留样式和数据入口。
- 第一阶段不引入新的地图引擎或重型状态管理库。

## 用户体验

主界面保留左侧控制面板和右侧地图工作区。右侧只有一个地图视图，不再有 2D/3D 两个互相独立的面板。

地图顶部提供紧凑工具栏：

- 视图模式：2D / 2.5D / 3D。
- 缩放：飞到影像、飞到矢量、飞到选区、复位视角。
- 绘制：框选区域、清除选区。
- 分析：点击查询、影像卷帘、建筑开关。

当用户切换 2D/3D 时，图层、选区、点击点、透明度和当前业务状态保持不变，只改变 Cesium scene mode 和相机视角。

## 架构

新增核心组件 `CesiumWorkspace`，替代当前 `MapContainer` 和 `CesiumGlobe` 的双地图结构。

`main.tsx` 继续负责业务状态：

- `raster`
- `vector`
- `selectedBounds`
- `opacity`
- `showRaster`
- `showVector`
- `showBasemap`
- `fitTarget`
- `mapInfo`
- GEE 参数和上传状态

`CesiumWorkspace` 负责地图状态：

- Viewer 生命周期。
- 底图、地形、建筑初始化。
- 栅格影像 `ImageryLayer` 管理。
- GeoJSON `DataSource` 管理。
- 框选矩形 `CustomDataSource` 管理。
- 点击点标注 `CustomDataSource` 管理。
- 鼠标绘制和点击查询。
- 视图模式切换和相机飞行。

建议提取三个轻量工具模块：

- `cesiumLayers.ts`：创建/更新影像、矢量、选区、点击点图层。
- `cesiumPicking.ts`：屏幕坐标转 lon/lat、高程采样、像元查询辅助。
- `cesiumView.ts`：bounds 到 `Rectangle`、`flyToBounds`、2D/3D 切换。

## Cesium 功能映射

| 功能 | Cesium API |
| --- | --- |
| 2D/2.5D/3D 切换 | `scene.morphTo2D()`、`scene.morphToColumbusView()`、`scene.morphTo3D()` |
| 影像底图 | `ImageryLayer`、`ArcGisMapServerImageryProvider` 或本地 TMS |
| GeoTIFF PNG 叠加 | `SingleTileImageryProvider`、`Rectangle.fromDegrees()` |
| 图层透明度 | `ImageryLayer.alpha` |
| 影像卷帘 | `ImageryLayer.splitDirection`、`scene.splitPosition` |
| 矢量叠加 | `GeoJsonDataSource.load()`、`clampToGround` |
| 框选绘制 | `ScreenSpaceEventHandler`、`RectangleGraphics`、`CustomDataSource` |
| 点击查询 | `ScreenSpaceEventHandler`、`camera.pickEllipsoid()`、`globe.pick()`、`scene.pickPosition()` |
| 地形高程 | `Terrain.fromWorldTerrain()`、`sampleTerrainMostDetailed()` |
| 飞到范围 | `camera.flyTo()`、`viewer.flyTo()` |
| 3D 建筑 | `createOsmBuildingsAsync()` |

## 数据流

上传 GeoTIFF 后：

1. 后端返回影像元数据和预览 URL。
2. `main.tsx` 保存 `raster`。
3. `CesiumWorkspace` 根据 `raster.boundsWgs84` 创建 `SingleTileImageryProvider`。
4. 用户调透明度时更新同一个 `ImageryLayer.alpha`。

上传 Shapefile 后：

1. 后端返回 GeoJSON 和 WGS84 范围。
2. `main.tsx` 保存 `vector`。
3. `CesiumWorkspace` 加载 `GeoJsonDataSource`，贴地显示。
4. 飞到矢量时调用 `viewer.flyTo(dataSource)` 或 `camera.flyTo(Rectangle)`。

框选区域时：

1. 鼠标按下记录起点 lon/lat。
2. 鼠标移动更新临时矩形。
3. 鼠标松开归一化为 WGS84 bounds。
4. `main.tsx` 保存 `selectedBounds`，GEE 下载继续复用该范围。

点击查询时：

1. Cesium 将屏幕坐标转换为 lon/lat。
2. 若 3D 地形可用，采样高程。
3. 若当前有 raster，调用后端像元采样接口。
4. 在地图上添加点击点和标签，同时更新右侧/底部查询信息。

## 错误处理

- 高分辨率在线影像失败时，保留本地 Natural Earth 兜底底图。
- Cesium ion token 缺失时，禁用 World Terrain 和 OSM Buildings，但 2D/影像/矢量/框选仍可用。
- 影像缺少有效 WGS84 bounds 时，不创建叠加图层，并显示明确提示。
- 框选越界、反向拖拽、极小矩形都在保存前归一化或拒绝。
- 点击未命中地球表面时只提示，不抛出错误。

## 迁移步骤

1. 新建 `CesiumWorkspace`，先复用当前 `CesiumGlobe` 中已工作的 Viewer 初始化、影像叠加、矢量叠加、选区显示、点击查询逻辑。
2. 在 `CesiumWorkspace` 中加入 2D/2.5D/3D 切换按钮。
3. 用 Cesium 框选替代当前 Leaflet 框选。
4. 在 `main.tsx` 中移除 Leaflet 视图渲染，仅保留业务面板和 Cesium 工作区。
5. 删除不再使用的 Leaflet 组件、导入和依赖。
6. 增强功能：影像卷帘、高程显示、OSM Buildings 开关。

## 测试计划

- 配置和 bounds 工具函数使用现有 node:test 测试。
- 增加 Cesium 源码静态回归测试，确认不再渲染 Leaflet `MapContainer`。
- 构建验证：`npm run build`。
- 手动验证：
  - 无 ion token 时可打开 Cesium 工作区并显示本地底图。
  - 上传 GeoTIFF 后 2D 和 3D 模式均显示影像叠加。
  - 上传 Shapefile 后 2D 和 3D 模式均显示矢量。
  - 框选后可触发 GEE 下载。
  - 点击影像范围内返回 lon/lat、行列、DN 值。
  - 切换 2D/3D 后图层显隐和透明度保持一致。

## 风险

- Cesium-only 会让前端地图组件承担更多职责，需要拆分工具模块避免 `CesiumWorkspace` 过大。
- Cesium 2D 绘制交互比 Leaflet 手写成本更高，框选逻辑需要小步实现。
- 在线底图和 World Terrain 依赖网络、token 和 CORS，必须保留本地兜底。
- 移除 Leaflet 后要确认 CSS、依赖和 README 同步更新。
