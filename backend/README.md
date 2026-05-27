# Backend

FastAPI service for GeoTIFF upload, metadata inspection, preview rendering, point sampling, zipped shapefile upload, and Google Earth Engine download URL generation.

## Run

```powershell
cd remote_sensing_app/backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

For the GEE endpoint, install the dependencies above and authenticate once:

```powershell
earthengine authenticate
```

