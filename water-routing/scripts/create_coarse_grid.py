from pathlib import Path
from math import ceil

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import box


PROJECT_ROOT = Path(__file__).resolve().parents[1]

INPUT_FILE = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "florida_keys_land.gpkg"
)

BUFFER_OUTPUT = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "florida_keys_land_coarse_buffered.gpkg"
)

RASTER_OUTPUT = (
    PROJECT_ROOT
    / "data"
    / "tiles"
    / "florida_keys_routing_grid.tif"
)

INPUT_LAYER = "land"

# Florida Keys bounding box in WGS84.
WEST = -82.1
SOUTH = 24.2
EAST = -80.0
NORTH = 25.9

# Florida lies in UTM Zone 17 North.
METRIC_CRS = "EPSG:32617"

SAFETY_BUFFER_METERS = 2000
CELL_SIZE_METERS = 1_000


def main():
    BUFFER_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    RASTER_OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Input file not found:\n{INPUT_FILE}"
        )

    print("Reading extracted Florida Keys land polygons...")

    land = gpd.read_file(
        INPUT_FILE,
        layer=INPUT_LAYER,
        engine="pyogrio",
    )

    if land.empty:
        raise RuntimeError("The input land layer contains no features.")

    if land.crs is None:
        raise RuntimeError("The input land layer does not have a CRS.")

    land = land[
        land.geometry.notna() & ~land.geometry.is_empty
    ].copy()

    print(f"Loaded {len(land):,} polygon features")
    print(f"Input CRS: {land.crs}")

    # Define the exact test-region boundary.
    region_wgs84 = gpd.GeoSeries(
        [box(WEST, SOUTH, EAST, NORTH)],
        crs="EPSG:4326",
    )

    # Reproject the land and region into meters.
    land_metric = land.to_crs(METRIC_CRS)
    region_metric = region_wgs84.to_crs(METRIC_CRS).iloc[0]

    print(
        f"Applying a {SAFETY_BUFFER_METERS:,} meter "
        "safety buffer..."
    )

    land_metric.geometry = land_metric.geometry.buffer(
        SAFETY_BUFFER_METERS
    )

    # Restrict the buffered polygons to the test region.
    land_metric.geometry = land_metric.geometry.intersection(
        region_metric
    )

    land_metric = land_metric[
        land_metric.geometry.notna()
        & ~land_metric.geometry.is_empty
    ].copy()

    land_metric.to_file(
        BUFFER_OUTPUT,
        layer="blocked_area",
        driver="GPKG",
        engine="pyogrio",
    )

    print(f"Saved buffered land to:\n{BUFFER_OUTPUT}")

    min_x, min_y, max_x, max_y = region_metric.bounds

    width = ceil((max_x - min_x) / CELL_SIZE_METERS)
    height = ceil((max_y - min_y) / CELL_SIZE_METERS)

    # Adjust the raster bounds to match whole cells.
    raster_max_x = min_x + width * CELL_SIZE_METERS
    raster_max_y = min_y + height * CELL_SIZE_METERS

    transform = from_origin(
        min_x,
        raster_max_y,
        CELL_SIZE_METERS,
        CELL_SIZE_METERS,
    )

    print(
        f"Rasterizing a {width:,} × {height:,} grid "
        f"at {CELL_SIZE_METERS:,} meter resolution..."
    )

    blocked_grid = rasterize(
        (
            (geometry, 1)
            for geometry in land_metric.geometry
            if geometry is not None and not geometry.is_empty
        ),
        out_shape=(height, width),
        transform=transform,
        fill=0,
        all_touched=True,
        dtype=np.uint8,
    )

    new_raster_output = (
    PROJECT_ROOT
    / "data"
    / "tiles"
    / "florida_keys_coastal_grid_v1.tif"
)

    with rasterio.open(
        new_raster_output,
        mode="w",
        driver="GTiff",
        height=height,
        width=width,
        count=1,
        dtype="uint8",
        crs=METRIC_CRS,
        transform=transform,
        compress="lzw",
    ) as destination:
        destination.write(blocked_grid.astype("uint8"), 1)

        destination.write_colormap(
            1,
            {
                0: (80, 170, 230, 160),
                1: (230, 50, 50, 230),
            },
        )

        destination.update_tags(
            description="Florida Keys coarse marine routing grid",
            value_0="navigable water",
            value_1="land or coastal safety buffer",
            safety_buffer_meters=str(SAFETY_BUFFER_METERS),
            cell_size_meters=str(CELL_SIZE_METERS),
        )

    # Verify the saved file immediately.
    with rasterio.open(new_raster_output) as verification:
        saved_grid = verification.read(1)

        print(f"Verified CRS: {verification.crs}")
        print(f"Verified bounds: {verification.bounds}")
        print(
            "Verified values:",
            np.unique(saved_grid, return_counts=True),
        )

    if verification.crs is None:
        raise RuntimeError("The output raster was saved without a CRS.")

    unexpected_values = set(np.unique(saved_grid)) - {0, 1}

    if unexpected_values:
        raise RuntimeError(
            f"Unexpected raster values: {unexpected_values}"
        )

    print(f"Saved corrected routing grid to:\n{new_raster_output}")
    print("Done.")


if __name__ == "__main__":
    main()