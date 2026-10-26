from math import ceil, floor
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.windows import Window


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILE = PROJECT_ROOT / "data" / "source" / "land_polygons.shp"
OUTPUT_FILE = PROJECT_ROOT / "data" / "tiles" / "global_coarse_10km.tif"

TARGET_CRS = "EPSG:6933"
CELL_SIZE_METERS = 10_000
STRIP_WIDTH_DEGREES = 10
MIN_LATITUDE = -86.0
MAX_LATITUDE = 86.0


def main():
    if not SOURCE_FILE.exists():
        raise FileNotFoundError(
            f"Land shapefile not found:\n{SOURCE_FILE}"
        )

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    to_target = Transformer.from_crs(
        "EPSG:4326", TARGET_CRS, always_xy=True
    )

    west_x, _ = to_target.transform(-180.0, 0.0)
    east_x, _ = to_target.transform(180.0, 0.0)
    _, south_y = to_target.transform(0.0, MIN_LATITUDE)
    _, north_y = to_target.transform(0.0, MAX_LATITUDE)

    min_x, max_x = sorted((west_x, east_x))
    min_y, max_y = sorted((south_y, north_y))

    width = ceil((max_x - min_x) / CELL_SIZE_METERS)
    height = ceil((max_y - min_y) / CELL_SIZE_METERS)
    raster_max_x = min_x + width * CELL_SIZE_METERS
    raster_max_y = min_y + height * CELL_SIZE_METERS
    transform = from_origin(
        min_x,
        raster_max_y,
        CELL_SIZE_METERS,
        CELL_SIZE_METERS,
    )

    print(f"Creating global grid: {width:,} × {height:,} cells")
    print(f"CRS: {TARGET_CRS}")
    print(f"Resolution: {CELL_SIZE_METERS:,} meters")

    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "uint8",
        "crs": TARGET_CRS,
        "transform": transform,
        "compress": "lzw",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
        "BIGTIFF": "IF_SAFER",
    }

    with rasterio.open(OUTPUT_FILE, "w+", **profile) as destination:
        # New GeoTIFF blocks default to zero, which represents ocean.
        for west in range(-180, 180, STRIP_WIDTH_DEGREES):
            east = min(west + STRIP_WIDTH_DEGREES, 180)
            print(f"Processing longitude strip {west}° to {east}°...")

            land = gpd.read_file(
                SOURCE_FILE,
                bbox=(west, MIN_LATITUDE, east, MAX_LATITUDE),
                engine="pyogrio",
            )

            if land.empty:
                continue

            land = land[
                land.geometry.notna() & ~land.geometry.is_empty
            ].copy()

            if land.empty:
                continue

            invalid = ~land.geometry.is_valid
            if invalid.any():
                land.loc[invalid, "geometry"] = (
                    land.loc[invalid, "geometry"].make_valid()
                )

            land = land.to_crs(TARGET_CRS)

            strip_west_x, _ = to_target.transform(west, 0.0)
            strip_east_x, _ = to_target.transform(east, 0.0)
            strip_min_x, strip_max_x = sorted(
                (strip_west_x, strip_east_x)
            )

            column_start = max(
                0,
                floor((strip_min_x - min_x) / CELL_SIZE_METERS),
            )
            column_stop = min(
                width,
                ceil((strip_max_x - min_x) / CELL_SIZE_METERS),
            )
            window_width = column_stop - column_start
            if window_width <= 0:
                continue

            window = Window(column_start, 0, window_width, height)
            window_transform = rasterio.windows.transform(
                window, transform
            )

            blocked = rasterize(
                (
                    (geometry, 1)
                    for geometry in land.geometry
                    if geometry is not None and not geometry.is_empty
                ),
                out_shape=(height, window_width),
                transform=window_transform,
                fill=0,
                all_touched=False,
                dtype=np.uint8,
            )

            # Adjacent geographic strips can share a boundary column.
            # Preserve land written by either strip.
            existing = destination.read(1, window=window)
            destination.write(
                np.maximum(existing, blocked),
                1,
                window=window,
            )

        destination.update_tags(
            description="Global coarse marine routing grid",
            value_0="navigable ocean",
            value_1="land",
            cell_size_meters=str(CELL_SIZE_METERS),
            latitude_range=f"{MIN_LATITUDE},{MAX_LATITUDE}",
        )

    with rasterio.open(OUTPUT_FILE) as verification:
        values, counts = np.unique(
            verification.read(1), return_counts=True
        )
        print(f"Verified CRS: {verification.crs}")
        print(f"Verified shape: {verification.shape}")
        print(f"Values and counts: {list(zip(values, counts))}")

    print(f"Saved global coarse grid to:\n{OUTPUT_FILE}")


if __name__ == "__main__":
    main()
