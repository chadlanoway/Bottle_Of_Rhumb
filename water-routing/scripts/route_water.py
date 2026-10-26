"""Create a refined water route between two longitude/latitude positions.

The command uses the prebuilt global 10 km grid for broad guidance, then
builds route-specific 1 km and 500 m grids from the source land polygons.
Only the final route and its endpoints are written by default. Pass --debug
to include the intermediate global and coastal routes.
"""

from __future__ import annotations

import argparse
from collections import deque
import json
import math
import os
import re
import sys
from math import ceil, hypot
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import geometry_mask, rasterize
from rasterio.transform import from_origin, rowcol, xy
from shapely.geometry import LineString, mapping
from shapely.ops import transform as shapely_transform


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from routing import (  # noqa: E402
    antimeridian_safe_geometry,
    cells_to_projected_coordinates,
    coordinate_to_cell,
    find_nearest_water,
    find_route,
    geodesic_distance_meters,
    projected_to_wgs84,
    simplify_route,
)


INDEXED_LAND = (
    PROJECT_ROOT / "data" / "source" / "land_polygons_indexed.gpkg"
)
SOURCE_LAND = Path(
    os.getenv(
        "ROUTING_LAND_FILE",
        str(
            INDEXED_LAND
            if INDEXED_LAND.exists()
            else PROJECT_ROOT / "data" / "source" / "land_polygons.shp"
        ),
    )
)
GLOBAL_GRID = PROJECT_ROOT / "data" / "tiles" / "global_coarse_10km.tif"
TARGET_CRS = "EPSG:6933"
GLOBAL_CORRIDOR_METERS = 150_000
LAND_BUFFER_METERS = 2_000
FINE_CORRIDOR_WIDTHS = (10_000, 25_000, 50_000, 100_000)
ENDPOINT_WATER_SEARCH_METERS = 2_000
MAX_HARBOR_CONNECTOR_METERS = 300_000


def parse_args():
    parser = argparse.ArgumentParser(
        description="Create a coarse-to-fine water route."
    )
    parser.add_argument("--start", nargs=2, type=float, required=True,
                        metavar=("LNG", "LAT"))
    parser.add_argument("--end", nargs=2, type=float, required=True,
                        metavar=("LNG", "LAT"))
    parser.add_argument("--name", default="water-route",
                        help="Route name and output filename stem.")
    parser.add_argument("--debug", action="store_true",
                        help="Include intermediate routes in the GeoJSON.")
    parser.add_argument("--keep-grids", action="store_true",
                        help="Keep generated 1 km and 500 m GeoTIFFs.")
    parser.add_argument(
        "--work-dir",
        type=Path,
        help="Directory for request-specific temporary detail grids.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Exact GeoJSON output path (overrides the default path).",
    )
    return parser.parse_args()


def validate_lng_lat(value, label):
    longitude, latitude = value
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise ValueError(f"{label} must be within longitude/latitude bounds.")
    return longitude, latitude


def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "water-route"


def _snap_endpoint_within_meters(
    source,
    grid,
    lng_lat,
    label,
    max_distance_meters,
):
    transformer = Transformer.from_crs(
        "EPSG:4326", source.crs, always_xy=True
    )
    requested_x, requested_y = transformer.transform(*lng_lat)
    requested_row, requested_column = source.index(requested_x, requested_y)
    height, width = grid.shape
    cell_size = min(abs(source.transform.a), abs(source.transform.e))
    radius = ceil(max_distance_meters / cell_size) + 1
    candidates = []

    for row in range(requested_row - radius, requested_row + radius + 1):
        if not 0 <= row < height:
            continue
        for column in range(
            requested_column - radius,
            requested_column + radius + 1,
        ):
            if not 0 <= column < width or grid[row, column] != 0:
                continue
            water_x, water_y = source.xy(row, column, offset="center")
            distance = hypot(water_x - requested_x, water_y - requested_y)
            if distance <= max_distance_meters:
                candidates.append((distance, (row, column)))

    if not candidates:
        marker = "START" if label == "Start" else "DESTINATION"
        raise RuntimeError(
            f"{marker}_TOO_FAR_FROM_WATER: {label} point is more than "
            f"{max_distance_meters / 1000:g} km from navigable water. "
            f"Choose a {label.lower()} point nearer to water."
        )

    return min(candidates, key=lambda item: item[0])[1]


def route_on_grid(
    source,
    grid,
    start,
    end,
    *,
    wrap=False,
    snap=200,
    start_snap_meters=None,
    end_snap_meters=None,
):
    requested_start = coordinate_to_cell(source, start)
    requested_end = coordinate_to_cell(source, end)
    snapped_start = (
        _snap_endpoint_within_meters(
            source, grid, start, "Start", start_snap_meters
        )
        if start_snap_meters is not None
        else find_nearest_water(
            grid, requested_start, snap, wrap_columns=wrap
        )
    )
    snapped_end = (
        _snap_endpoint_within_meters(
            source, grid, end, "Destination", end_snap_meters
        )
        if end_snap_meters is not None
        else find_nearest_water(
            grid, requested_end, snap, wrap_columns=wrap
        )
    )
    route, visited = find_route(
        grid, snapped_start, snapped_end, wrap_columns=wrap
    )
    return route, visited


def calculate_global_route(start, end):
    print("1/4 Calculating global 10 km guidance route...")
    with rasterio.open(GLOBAL_GRID) as source:
        grid = source.read(1)
        route, visited = route_on_grid(
            source, grid, start, end, wrap=True, snap=100
        )
        simplified = simplify_route(grid, route, wrap_columns=True)
        projected = cells_to_projected_coordinates(source, simplified)
        coordinates = projected_to_wgs84(source, projected)
    print(f"    Visited {visited:,} cells; {len(simplified):,} vertices")
    return coordinates, visited


def crosses_antimeridian(coordinates):
    return any(
        abs(second[0] - first[0]) > 180
        for first, second in zip(coordinates, coordinates[1:])
    )


def read_buffered_land(corridor, to_wgs84):
    if corridor.is_empty:
        raise RuntimeError(
            "The route corridor is empty. Choose start and destination "
            "points farther apart."
        )
    corridor_wgs84 = shapely_transform(to_wgs84.transform, corridor)
    bbox = corridor_wgs84.bounds
    if len(bbox) != 4 or not all(math.isfinite(value) for value in bbox):
        raise RuntimeError(
            "The route corridor has invalid bounds. Choose slightly "
            "different start and destination points."
        )
    print(f"    Reading land polygons within {tuple(round(v, 3) for v in bbox)}")
    land = gpd.read_file(SOURCE_LAND, bbox=bbox, engine="pyogrio")
    land = land[~land.geometry.is_empty & land.geometry.notna()].copy()
    invalid = ~land.geometry.is_valid
    if invalid.any():
        land.loc[invalid, "geometry"] = land.loc[invalid, "geometry"].make_valid()
    land = land.to_crs(TARGET_CRS)

    actual_land = land.copy()
    actual_land.geometry = actual_land.geometry.intersection(corridor)
    actual_land = actual_land[
        ~actual_land.geometry.is_empty & actual_land.geometry.notna()
    ].copy()

    buffered_land = land.copy()
    buffered_land.geometry = buffered_land.geometry.buffer(
        LAND_BUFFER_METERS
    ).intersection(corridor)
    buffered_land = buffered_land[
        ~buffered_land.geometry.is_empty & buffered_land.geometry.notna()
    ].copy()
    return actual_land, buffered_land


def _nearest_actual_water_cell(
    actual_blocked,
    transform,
    point,
    label,
    max_distance_meters=ENDPOINT_WATER_SEARCH_METERS,
):
    point_x, point_y = point
    start_row, start_column = rowcol(transform, point_x, point_y)
    height, width = actual_blocked.shape
    cell_size = min(abs(transform.a), abs(transform.e))
    radius = ceil(max_distance_meters / cell_size) + 1
    candidates = []

    for row in range(start_row - radius, start_row + radius + 1):
        if not 0 <= row < height:
            continue
        for column in range(
            start_column - radius,
            start_column + radius + 1,
        ):
            if not 0 <= column < width or actual_blocked[row, column] != 0:
                continue
            water_x, water_y = xy(transform, row, column, offset="center")
            distance = hypot(water_x - point_x, water_y - point_y)
            if distance <= max_distance_meters:
                candidates.append((distance, (row, column)))

    if not candidates:
        marker = "START" if label == "Start" else "DESTINATION"
        raise RuntimeError(
            f"{marker}_TOO_FAR_FROM_WATER: {label} point is more than "
            f"{max_distance_meters / 1000:g} km from actual water. "
            f"Choose a {label.lower()} point nearer to water."
        )
    return min(candidates, key=lambda item: item[0])


def _open_harbor_connector(
    blocked,
    actual_blocked,
    transform,
    point,
    label,
):
    snap_distance, start = _nearest_actual_water_cell(
        actual_blocked, transform, point, label
    )
    cell_size = min(abs(transform.a), abs(transform.e))
    max_steps = ceil(MAX_HARBOR_CONNECTOR_METERS / cell_size)
    queue = deque([(start, 0)])
    parents = {start: None}
    destination = None
    height, width = blocked.shape

    while queue:
        current, steps = queue.popleft()
        if blocked[current] == 0:
            destination = current
            break
        if steps >= max_steps:
            continue
        row, column = current
        for row_offset, column_offset in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            neighbor = (row + row_offset, column + column_offset)
            if (
                not 0 <= neighbor[0] < height
                or not 0 <= neighbor[1] < width
                or neighbor in parents
                or actual_blocked[neighbor] != 0
            ):
                continue
            parents[neighbor] = current
            queue.append((neighbor, steps + 1))

    if destination is None:
        raise RuntimeError(
            f"{label} is in water, but its harbor or channel could not "
            "connect to the open-water routing grid. Choose a point closer "
            "to the harbor entrance."
        )

    connector = []
    current = destination
    while current is not None:
        connector.append(current)
        current = parents[current]
    connector.reverse()

    # Open a narrow corridor around the connector, but only through cells that
    # are genuinely water in the unbuffered land mask.
    for row, column in connector:
        for row_offset in (-1, 0, 1):
            for column_offset in (-1, 0, 1):
                candidate = (row + row_offset, column + column_offset)
                if (
                    0 <= candidate[0] < height
                    and 0 <= candidate[1] < width
                    and actual_blocked[candidate] == 0
                ):
                    blocked[candidate] = 0

    print(
        f"    Opened {label.lower()} harbor connector: "
        f"{len(connector):,} cells; snap {snap_distance:.0f} m"
    )


def write_detail_grid(
    path,
    cell_size,
    actual_land,
    buffered_land,
    corridor,
    endpoint_access_points=(),
):
    min_x, min_y, max_x, max_y = corridor.bounds
    width = ceil((max_x - min_x) / cell_size)
    height = ceil((max_y - min_y) / cell_size)
    raster_max_y = min_y + height * cell_size
    transform = from_origin(min_x, raster_max_y, cell_size, cell_size)
    print(f"    {path.name}: {width:,} x {height:,} cells")

    blocked = rasterize(
        ((geometry, 1) for geometry in buffered_land.geometry),
        out_shape=(height, width),
        transform=transform,
        fill=0,
        all_touched=True,
        dtype=np.uint8,
    )
    actual_blocked = rasterize(
        ((geometry, 1) for geometry in actual_land.geometry),
        out_shape=(height, width),
        transform=transform,
        fill=0,
        # Harbor-access water is determined by the cell center. Using
        # all_touched=True causes small islands on opposite sides of narrow
        # channels to merge into an artificial land wall.
        all_touched=False,
        dtype=np.uint8,
    )
    inside = geometry_mask(
        [mapping(corridor)],
        out_shape=(height, width),
        transform=transform,
        invert=True,
        all_touched=True,
    )
    blocked[~inside] = 1
    actual_blocked[~inside] = 1
    for label, point in endpoint_access_points:
        _open_harbor_connector(
            blocked, actual_blocked, transform, point, label
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path, "w", driver="GTiff", height=height, width=width, count=1,
        dtype="uint8", crs=TARGET_CRS, transform=transform,
        compress="lzw", tiled=True, blockxsize=256, blockysize=256,
        BIGTIFF="IF_SAFER",
    ) as destination:
        destination.write(blocked, 1)
        destination.update_tags(
            value_0="navigable water",
            value_1="land, safety buffer, or outside route corridor",
            cell_size_meters=str(cell_size),
            land_buffer_meters=str(LAND_BUFFER_METERS),
        )


def build_detail_grids(
    global_coordinates,
    coastal_path,
    fine_path,
    *,
    corridor_meters=GLOBAL_CORRIDOR_METERS,
    build_fine=True,
    endpoint_access_points=(),
    fine_cell_size=500,
):
    if len(global_coordinates) < 2:
        raise RuntimeError(
            "Detailed routing requires two distinct guidance coordinates."
        )
    if crosses_antimeridian(global_coordinates):
        raise RuntimeError(
            "Detailed refinement across the antimeridian is the next stage. "
            "The global coarse route supports it, but this route-specific "
            "detail-grid builder currently requires a non-dateline route."
        )

    print("2/4 Building route-specific detail grids...")
    to_target = Transformer.from_crs("EPSG:4326", TARGET_CRS, always_xy=True)
    to_wgs84 = Transformer.from_crs(TARGET_CRS, "EPSG:4326", always_xy=True)
    route = LineString(global_coordinates)
    projected_route = shapely_transform(to_target.transform, route)
    corridor = projected_route.buffer(corridor_meters)
    actual_land, buffered_land = read_buffered_land(corridor, to_wgs84)
    projected_access_points = [
        (label, to_target.transform(*point))
        for label, point in endpoint_access_points
    ]
    print(
        f"    Loaded {len(actual_land):,} land features and "
        f"{len(buffered_land):,} buffered features"
    )
    write_detail_grid(
        coastal_path,
        1_000,
        actual_land,
        buffered_land,
        corridor,
        projected_access_points,
    )
    if build_fine:
        write_detail_grid(
            fine_path,
            fine_cell_size,
            actual_land,
            buffered_land,
            corridor,
            projected_access_points,
        )


def calculate_refined_route(
    start,
    end,
    coastal_path,
    fine_path,
    *,
    use_fine=True,
    start_snap_meters=None,
    end_snap_meters=None,
):
    print("3/4 Calculating 1 km coastal route...")
    with rasterio.open(coastal_path) as coastal_source:
        coastal_grid = coastal_source.read(1)
        coastal_route, coastal_visited = route_on_grid(
            coastal_source,
            coastal_grid,
            start,
            end,
            start_snap_meters=start_snap_meters,
            end_snap_meters=end_snap_meters,
        )
        coastal_projected = cells_to_projected_coordinates(
            coastal_source, coastal_route
        )
        coastal_line = LineString(coastal_projected)
        coastal_wgs84 = projected_to_wgs84(
            coastal_source, coastal_projected
        )
        coastal_crs = coastal_source.crs
    print(f"    Visited {coastal_visited:,} cells")

    if not use_fine:
        with rasterio.open(coastal_path) as coastal_source:
            coastal_grid = coastal_source.read(1)
            coastal_simplified = simplify_route(
                coastal_grid, coastal_route
            )
            projected = cells_to_projected_coordinates(
                coastal_source, coastal_simplified
            )
            coordinates = projected_to_wgs84(
                coastal_source, projected
            )
        return {
            "coordinates": coordinates,
            "coastal_coordinates": coastal_wgs84,
            "coastal_visited": coastal_visited,
            "fine_visited": 0,
            "fine_vertices": 0,
            "simplified_vertices": len(coastal_simplified),
            "fine_corridor": 0,
            "resolution_meters": 1_000,
        }

    print("4/4 Calculating fine route...")
    with rasterio.open(fine_path) as fine_source:
        if fine_source.crs != coastal_crs:
            raise RuntimeError("Coastal and fine grids use different CRSs.")
        fine_grid = fine_source.read(1)
        fine_resolution = int(round(min(
            abs(fine_source.transform.a),
            abs(fine_source.transform.e),
        )))
        print(f"    Fine-grid resolution: {fine_resolution:,} m")
        fine_route = fine_visited = selected_width = restricted_grid = None

        for width in FINE_CORRIDOR_WIDTHS:
            corridor = coastal_line.buffer(width)
            mask = geometry_mask(
                [mapping(corridor)], out_shape=fine_grid.shape,
                transform=fine_source.transform, invert=True, all_touched=True,
            )
            candidate_grid = np.where(mask, fine_grid, 1).astype(np.uint8)
            included = int(np.count_nonzero(mask))
            print(
                f"    Trying {width / 1000:.0f} km corridor "
                f"({included:,} cells)"
            )
            try:
                candidate_route, candidate_visited = route_on_grid(
                    fine_source,
                    candidate_grid,
                    start,
                    end,
                    start_snap_meters=start_snap_meters,
                    end_snap_meters=end_snap_meters,
                )
            except RuntimeError as error:
                if "No navigable route exists" not in str(error):
                    raise
                continue
            fine_route = candidate_route
            fine_visited = candidate_visited
            selected_width = width
            restricted_grid = candidate_grid
            break

        if fine_route is None:
            raise RuntimeError("No fine route found in configured corridors.")
        simplified = simplify_route(restricted_grid, fine_route)
        projected = cells_to_projected_coordinates(fine_source, simplified)
        fine_wgs84 = projected_to_wgs84(fine_source, projected)

    return {
        "coordinates": fine_wgs84,
        "coastal_coordinates": coastal_wgs84,
        "coastal_visited": coastal_visited,
        "fine_visited": fine_visited,
        "fine_vertices": len(fine_route),
        "simplified_vertices": len(simplified),
        "fine_corridor": selected_width,
        "resolution_meters": fine_resolution,
    }


def route_feature(name, feature_type, coordinates, properties=None):
    return {
        "type": "Feature",
        "properties": {
            "name": name,
            "featureType": feature_type,
            **(properties or {}),
        },
        "geometry": antimeridian_safe_geometry(coordinates),
    }


def point_feature(name, feature_type, coordinates, requested):
    return {
        "type": "Feature",
        "properties": {
            "name": name,
            "featureType": feature_type,
            "requested_coordinates": list(requested),
        },
        "geometry": {"type": "Point", "coordinates": coordinates},
    }


def write_output(path, name, start, end, global_coordinates, global_visited,
                 result, debug):
    distance = geodesic_distance_meters(result["coordinates"])
    properties = {
        "distance_kilometers": round(distance / 1000, 2),
        "global_visited_cells": global_visited,
        "coastal_visited_cells": result["coastal_visited"],
        "fine_visited_cells": result["fine_visited"],
        "fine_original_vertices": result["fine_vertices"],
        "fine_simplified_vertices": result["simplified_vertices"],
        "fine_corridor_meters": result["fine_corridor"],
        "land_buffer_meters": LAND_BUFFER_METERS,
    }
    features = [
        route_feature(name, "water-route", result["coordinates"], properties),
        point_feature("Route start", "route-start", result["coordinates"][0], start),
        point_feature("Route destination", "route-destination",
                      result["coordinates"][-1], end),
    ]
    if debug:
        features.extend([
            route_feature("Global guidance route", "global-coarse-route",
                          global_coordinates),
            route_feature("One kilometer coastal route", "coastal-route",
                          result["coastal_coordinates"]),
        ])
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        json.dump({"type": "FeatureCollection", "features": features},
                  output, indent=2)
    return distance


def main():
    args = parse_args()
    start = validate_lng_lat(tuple(args.start), "Start")
    end = validate_lng_lat(tuple(args.end), "End")
    if start == end:
        raise ValueError("Start and destination must be different.")
    for required in (SOURCE_LAND, GLOBAL_GRID):
        if not required.exists():
            raise FileNotFoundError(f"Required input not found:\n{required}")

    slug = slugify(args.name)
    tiles = (
        args.work_dir.resolve()
        if args.work_dir
        else PROJECT_ROOT / "data" / "tiles" / "generated"
    )
    coastal_path = tiles / f"{slug}_coastal_1km.tif"
    fine_path = tiles / f"{slug}_fine_500m.tif"
    output_path = (
        args.output.resolve()
        if args.output
        else PROJECT_ROOT / "data" / "processed" / f"{slug}.geojson"
    )

    try:
        global_coordinates, global_visited = calculate_global_route(start, end)
        build_detail_grids(global_coordinates, coastal_path, fine_path)
        result = calculate_refined_route(start, end, coastal_path, fine_path)
        distance = write_output(
            output_path, args.name, start, end, global_coordinates,
            global_visited, result, args.debug,
        )
    finally:
        if not args.keep_grids:
            coastal_path.unlink(missing_ok=True)
            fine_path.unlink(missing_ok=True)

    print(f"Final route distance: {distance / 1000:,.2f} km")
    print(f"Saved final route to:\n{output_path}")
    if args.debug:
        print("Debug routes were included in the output.")


if __name__ == "__main__":
    main()
