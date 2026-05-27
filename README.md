# 遥感影像分析工作台

这是一个课程作业原型，后端使用 Python/FastAPI，前端使用 React + CesiumJS。应用提供统一的 2D/3D 遥感工作区，并加入了可运行的光谱指数分析和双时相变化检测能力。

## 功能

- 上传或拖拽 TIFF/GeoTIFF，并在 Cesium 工作区中叠加显示。
- 上传 zipped Shapefile，并将矢量范围贴地显示。
- 在同一个 Cesium 画布中切换 2D 和 3D 视图。
- 查询坐标、地表高程和 GeoTIFF 像元值。
- 调整 RGB 显示波段和主影像透明度。
- 使用地图框选或 Shapefile 范围从 Google Earth Engine 下载 GeoTIFF。
- 使用主影像和对比影像两个数据槽位组织分析数据。
- 运行 NDVI、NDWI、NDBI 光谱指数分析，支持阈值提取和统计。
- 运行双时相指数变化检测，输出增加、减少、稳定区域统计。
- 将分析结果作为 Cesium 图层叠加，支持显示开关、透明度、缩放到结果范围。
- 下载分析结果 GeoTIFF、预览 PNG 和 JSON 统计文件。

## 启动

后端：

```powershell
cd remote_sensing_app/backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

前端：

```powershell
cd remote_sensing_app/frontend
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。

如需启用 Cesium World Terrain，可在 `frontend/.env` 中配置：

```text
VITE_CESIUM_ION_TOKEN=你的 Cesium ion token
```

未配置 token 时，应用仍可使用本地兜底底图、影像叠加、矢量叠加、框选、点查和分析结果叠加。

## 分析接口

光谱指数：

- `POST /analysis/index`
- 参数：`image_id`、`index_type`、`band_a`、`band_b`、可选 `bounds_wgs84`、可选 `threshold_min`、可选 `threshold_max`
- 支持：`NDVI`、`NDWI`、`NDBI`

变化检测：

- `POST /analysis/change`
- 参数：`before_image_id`、`after_image_id`、`index_type`、前后时相波段、可选 `bounds_wgs84`、`threshold`
- 输出：指数差值 GeoTIFF、变化预览 PNG、像元数量和面积统计

分析结果文件：

- `GET /analysis/{analysis_id}/preview.png`
- `GET /analysis/{analysis_id}/result.tif`
- `GET /analysis/{analysis_id}/stats.json`

## GEE 说明

`/gee/download` 接口使用 `earthengine-api` 生成下载链接；`/gee/fetch` 接口会进一步下载 GeoTIFF，登记为本地影像并返回元数据。第一次使用前需要：

```powershell
earthengine authenticate
```

默认下载 `COPERNICUS/S2_SR_HARMONIZED` 的真彩色 `B4,B3,B2`，时间范围为 2024 年。可在前端或接口参数中修改数据集、日期、波段和分辨率。

当前后端默认使用 Earth Engine 项目 `tea123`。如需更换项目，可在启动后端前设置：

```powershell
$env:EE_PROJECT="你的-project-id"
uvicorn app.main:app --reload --port 8000
```

## 本地验证

```powershell
cd backend
python -m py_compile app\main.py

cd ..\frontend
npm test
npm run build
```
