from math import ceil
from pathlib import Path
import json

import geopandas as gpd
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import geometry_mask, rasterize
from rasterio.transform import from_origin
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILE = PROJECT_ROOT / "data" / "source" / "land_polygons.shp"
GLOBAL_ROUTE_FILE = (
    PROJECT_ROOT / "data" / "processed" / "global_test_route.geojson"
)
COASTAL_OUTPUT = (
    PROJECT_ROOT / "data" / "tiles" / "ny_lisbon_coastal_1km.tif"
)
FINE_OUTPUT = (
    PROJECT_ROOT / "data" / "tiles" / "ny_lisbon_fine_500m.tif"
)

TARGET_CRS = "EPSG:6933"
GLOBAL_CORRIDOR_METERS = 150_000
LAND_BUFFER_METERS = 2_000


def load_route():
    with GLOBAL_ROUTE_FILE.open("r", encoding="utf-8") as source:
        collection = json.load(source)

    route_feature = next(
        (
            feature
            for feature in collection.get("features", [])
            if feature.get("geometry", {}).get("type") == "LineString"
        ),
        None,
    )
    if route_feature is None:
        raise RuntimeError("No LineString route found in global route file.")
    return shape(route_feature["geometry"])


def write_grid(output_file, cell_size, land, corridor):
    min_x, min_y, max_x, max_y = corridor.bounds
    width = ceil((max_x - min_x) / cell_size)
    height = ceil((max_y - min_y) / cell_size)
    raster_max_y = min_y + height * cell_size
    transform = from_origin(min_x, raster_max_y, cell_size, cell_size)

    print(
        f"Creating {output_file.name}: {width:,} × {height:,} "
        f"cells at {cell_size:,} m"
    )

    blocked = rasterize(
        (
            (geometry, 1)
            for geometry in land.geometry
            if geometry is not None and not geometry.is_empty
        ),
        out_shape=(height, width),
        transform=transform,
        fill=0,
        all_touched=True,
        dtype=np.uint8,
    )

    inside_corridor = geometry_mask(
        [mapping(corridor)],
        out_shape=(height, width),
        transform=transform,
        invert=True,
        all_touched=True,
    )
    blocked[~inside_corridor] = 1

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        output_file,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=1,
        dtype="uint8",
        crs=TARGET_CRS,
        transform=transform,
        compress="lzw",
        tiled=True,
        blockxsize=256,
        blockysize=256,
        BIGTIFF="IF_SAFER",
    ) as destination:
        destination.write(blocked, 1)
        destination.update_tags(
            description="Route-specific marine routing grid",
            value_0="navigable water",
            value_1="land, safety buffer, or outside route corridor",
            cell_size_meters=str(cell_size),
            land_buffer_meters=str(LAND_BUFFER_METERS),
            global_corridor_meters=str(GLOBAL_CORRIDOR_METERS),
        )

    values, counts = np.unique(blocked, return_counts=True)
    print(f"Values and counts: {list(zip(values, counts))}")


def main():
    if not SOURCE_FILE.exists():
        raise FileNotFoundError(f"Land shapefile not found:\n{SOURCE_FILE}")
    if not GLOBAL_ROUTE_FILE.exists():
        raise FileNotFoundError(
            f"New York-to-Lisbon route not found:\n{GLOBAL_ROUTE_FILE}\n"
            "Run the original global test route first."
        )

    route_wgs84 = load_route()
    to_target = Transformer.from_crs(
        "EPSG:4326", TARGET_CRS, always_xy=True
    )
    to_wgs84 = Transformer.from_crs(
        TARGET_CRS, "EPSG:4326", always_xy=True
    )
    route_projected = shapely_transform(to_target.transform, route_wgs84)
    corridor = route_projected.buffer(GLOBAL_CORRIDOR_METERS)
    corridor_wgs84 = shapely_transform(to_wgs84.transform, corridor)
    source_bbox = corridor_wgs84.bounds

    print(f"Reading land polygons for bounding box: {source_bbox}")
    land = gpd.read_file(
        SOURCE_FILE,
        bbox=source_bbox,
        engine="pyogrio",
    )
    land = land[land.geometry.notna() & ~land.geometry.is_empty].copy()
    invalid = ~land.geometry.is_valid
    if invalid.any():
        land.loc[invalid, "geometry"] = (
            land.loc[invalid, "geometry"].make_valid()
        )
    land = land.to_crs(TARGET_CRS)
    land.geometry = land.geometry.buffer(LAND_BUFFER_METERS)
    land.geometry = land.geometry.intersection(corridor)
    land = land[land.geometry.notna() & ~land.geometry.is_empty].copy()
    print(f"Loaded and buffered {len(land):,} land features")

    write_grid(COASTAL_OUTPUT, 1_000, land, corridor)
    write_grid(FINE_OUTPUT, 500, land, corridor)
    print("Finished building route-specific detail grids.")


if __name__ == "__main__":
    main()
