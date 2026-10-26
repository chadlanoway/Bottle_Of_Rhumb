FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends libexpat1 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements-api.txt ./
RUN pip install --upgrade pip && \
    pip install -r requirements-api.txt

COPY routing ./routing
COPY scripts ./scripts
COPY api ./api

# Cloud Run cannot use the Windows bind mount from docker-compose.yml.
# Include only the two production routing datasets in the image.
COPY data/tiles/global_coarse_10km.tif ./data/tiles/global_coarse_10km.tif
COPY data/source/land_polygons_indexed.gpkg ./data/source/land_polygons_indexed.gpkg

EXPOSE 8080

# Cloud Run injects PORT. The fallback keeps this image easy to run locally.
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
