from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ROUTE_SCRIPT = PROJECT_ROOT / "scripts" / "route_water_hybrid.py"
DATA_DIR = PROJECT_ROOT / "data"

MAX_CONCURRENT_ROUTES = max(1, int(os.getenv("MAX_CONCURRENT_ROUTES", "1")))
QUEUE_WAIT_SECONDS = max(0.1, float(os.getenv("QUEUE_WAIT_SECONDS", "10")))
ROUTE_TIMEOUT_SECONDS = max(
    30, int(os.getenv("ROUTE_TIMEOUT_SECONDS", "840"))
)

route_slots = asyncio.Semaphore(MAX_CONCURRENT_ROUTES)


class Position(BaseModel):
    lng: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)


class WaterRouteRequest(BaseModel):
    start: Position
    end: Position
    name: str = Field(default="Water route", min_length=1, max_length=100)
    debug: bool = False

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Route name cannot be blank.")
        return cleaned


def configured_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,https://bottleofrhumb.com,"
        "https://www.bottleofrhumb.com,https://chadlanoway.github.io",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app = FastAPI(
    title="Bottle of Rhumb Water Routing API",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/")
def root():
    return {
        "service": "Bottle of Rhumb Water Routing API",
        "health": "/health",
    }


@app.get("/health")
def health():
    required = {
        "route_script": ROUTE_SCRIPT.exists(),
        "global_grid": (DATA_DIR / "tiles" / "global_coarse_10km.tif").exists(),
        "indexed_land": (
            DATA_DIR / "source" / "land_polygons_indexed.gpkg"
        ).exists(),
    }
    return {
        "ok": all(required.values()),
        "checks": required,
        "maxConcurrentRoutes": MAX_CONCURRENT_ROUTES,
    }


def set_api_metadata(collection: dict, *, api_seconds: float) -> dict:
    features = collection.get("features", [])
    if features:
        properties = features[0].setdefault("properties", {})
        # Retained for compatibility with the current frontend/reporting.
        properties["cache_hit"] = False
        properties["api_seconds"] = round(api_seconds, 3)
    return collection


def calculate_route(request: WaterRouteRequest) -> dict:
    # Temporary working rasters and GeoJSON are deleted after every request.
    with tempfile.TemporaryDirectory(prefix="rhumb-route-") as temp_name:
        workspace = Path(temp_name)
        output_file = workspace / "route.geojson"
        command = [
            sys.executable,
            str(ROUTE_SCRIPT),
            "--start",
            str(request.start.lng),
            str(request.start.lat),
            "--end",
            str(request.end.lng),
            str(request.end.lat),
            "--name",
            request.name,
            "--work-dir",
            str(workspace),
            "--output",
            str(output_file),
        ]
        if request.debug:
            command.append("--debug")

        try:
            result = subprocess.run(
                command,
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                timeout=ROUTE_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(
                f"Water routing exceeded {ROUTE_TIMEOUT_SECONDS} seconds."
            ) from error

        if result.returncode != 0:
            details = (result.stderr or result.stdout).strip()
            if "START_TOO_FAR_FROM_WATER:" in details:
                raise RuntimeError(
                    details.split("START_TOO_FAR_FROM_WATER:", 1)[1]
                    .splitlines()[0]
                    .strip()
                )
            if "DESTINATION_TOO_FAR_FROM_WATER:" in details:
                raise RuntimeError(
                    details.split("DESTINATION_TOO_FAR_FROM_WATER:", 1)[1]
                    .splitlines()[0]
                    .strip()
                )
            if len(details) > 2_000:
                details = details[-2_000:]
            raise RuntimeError(details or "The routing process failed.")

        if result.stdout:
            print(result.stdout, flush=True)

        if not output_file.exists():
            raise RuntimeError("Routing completed without producing GeoJSON.")

        with output_file.open("r", encoding="utf-8") as source:
            return json.load(source)


@app.post("/water-route")
async def water_route(request: WaterRouteRequest):
    api_started = perf_counter()
    if request.start == request.end:
        raise HTTPException(400, "Start and destination must be different.")

    try:
        await asyncio.wait_for(
            route_slots.acquire(), timeout=QUEUE_WAIT_SECONDS
        )
    except TimeoutError as error:
        raise HTTPException(
            status_code=503,
            detail="The routing service is busy. Please try again shortly.",
            headers={"Retry-After": "15"},
        ) from error

    try:
        result = await asyncio.to_thread(calculate_route, request)
        return set_api_metadata(
            result,
            api_seconds=perf_counter() - api_started,
        )
    except RuntimeError as error:
        message = str(error)
        endpoint_error = (
            "point is more than" in message
            and (
                "from navigable water" in message
                or "from actual water" in message
            )
        )
        harbor_error = "harbor or channel could not connect" in message
        status = 422 if (
            endpoint_error
            or harbor_error
            or "No navigable route" in message
        ) else 500
        raise HTTPException(status_code=status, detail=message) from error
    finally:
        route_slots.release()
