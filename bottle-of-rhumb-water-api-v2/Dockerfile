FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements-api.txt ./
RUN pip install --upgrade pip && \
    pip install -r requirements-api.txt

COPY routing ./routing
COPY scripts ./scripts
COPY api ./api

EXPOSE 8000

# Keep one worker: the in-process semaphore is the concurrency authority.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
