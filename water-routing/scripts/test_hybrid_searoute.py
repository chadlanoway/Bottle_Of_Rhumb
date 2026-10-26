"""Test a MARNET backbone with short, high-resolution coastal connectors."""

from __future__ import annotations

import heapq
import json
import math
import sys
import warnings
from datetime import datetime
from pathlib import Path
from time import perf_counter

import geopandas as gpd
import numpy as np
import rasterio
import searoute as sr
from pyproj import CRS, Transformer
from rasterio.features import geometry_mask, rasterize
from rasterio.transform import from_origin, rowcol, xy
from scipy.ndimage import distance_transform_edt
from shapely.geometry import LineString, mapping
from shapely.ops import transform as shapely_transform


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from routing.simplification import simplify_route  # noqa: E402
from routing.coordinates import (  # noqa: E402
    coordinate_to_cell,
    geodesic_distance_meters,
)
from routing.simplification import line_is_clear  # noqa: E402
from scripts.test_searoute_backbone import (  # noqa: E402
    TEST_ROUTES,
    feature_mapping,
)


INDEXED_LAND = PROJECT_ROOT / "data" / "source" / "land_polygons_indexed.gpkg"
SHAPEFILE_LAND = PROJECT_ROOT / "data" / "source" / "land_polygons.shp"
SOURCE_LAND = INDEXED_LAND if INDEXED_LAND.exists() else SHAPEFILE_LAND
OUTPUT_DIRECTORY = PROJECT_ROOT / "data" / "processed" / "hybrid_searoute"
GLOBAL_GRID = PROJECT_ROOT / "data" / "tiles" / "global_coarse_10km.tif"

CELL_SIZE_METERS = 100
FINE_CELL_SIZE_METERS = 50
ULTRA_FINE_CELL_SIZE_METERS = 25
CORRIDOR_WIDTHS_METERS = (5_000, 10_000, 20_000, 40_000)
FINE_CORRIDOR_WIDTHS_METERS = (5_000, 10_000, 20_000)
ULTRA_FINE_CORRIDOR_WIDTHS_METERS = (5_000, 10_000)
MAX_ENDPOINT_SNAP_METERS = 2_000
MAX_CONNECTOR_LENGTH_METERS = 120_000
MAX_BACKBONE_CANDIDATES = 12
CLEARANCE_PREFERENCE_METERS = 750
CLEARANCE_PENALTY = 5.0

warnings.filterwarnings(
    "ignore",
    message="The 'shapely.ops.transform\\(\\)' function is deprecated.*",
    category=DeprecationWarning,
)
warnings.filterwarnings(
    "ignore",
    message="GeoSeries.notna\\(\\) previously returned False.*",
    category=UserWarning,
)


def local_crs(first, second):
    longitude = (first[0] + second[0]) / 2
    latitude = (first[1] + second[1]) / 2
    return CRS.from_proj4(
        f"+proj=aeqd +lat_0={latitude} +lon_0={longitude} "
        "+datum=WGS84 +units=m +no_defs"
    )


def load_local_land(corridor, to_wgs84, target_crs):
    corridor_wgs84 = shapely_transform(to_wgs84.transform, corridor)
    land = gpd.read_file(
        SOURCE_LAND,
        bbox=corridor_wgs84.bounds,
        engine="pyogrio",
    )
    land = land[~land.geometry.is_empty & land.geometry.notna()].copy()
    if land.empty:
        return land.to_crs(target_crs)
    invalid = ~land.geometry.is_valid
    if invalid.any():
        land.loc[invalid, "geometry"] = land.loc[
            invalid, "geometry"
        ].make_valid()
    land = land.to_crs(target_crs)
    land.geometry = land.geometry.intersection(corridor)
    return land[~land.geometry.is_empty & land.geometry.notna()].copy()


def nearest_water_cell(blocked, transform, point_xy, cell_size):
    requested_row, requested_column = rowcol(transform, *point_xy)
    radius = math.ceil(MAX_ENDPOINT_SNAP_METERS / cell_size) + 1
    height, width = blocked.shape
    candidates = []
    for row in range(requested_row - radius, requested_row + radius + 1):
        if not 0 <= row < height:
            continue
        for column in range(
            requested_column - radius,
            requested_column + radius + 1,
        ):
            if not 0 <= column < width or blocked[row, column] != 0:
                continue
            center_x, center_y = xy(transform, row, column, offset="center")
            distance = math.hypot(
                center_x - point_xy[0], center_y - point_xy[1]
            )
            if distance <= MAX_ENDPOINT_SNAP_METERS:
                candidates.append((distance, (row, column)))
    if not candidates:
        raise RuntimeError("No water cell was found within 2 km of an endpoint.")
    return min(candidates, key=lambda item: item[0])


def weighted_route(blocked, traversal_cost, start, destination):
    height, width = blocked.shape
    frontier = [(0.0, start)]
    came_from = {}
    costs = {start: 0.0}
    visited = set()
    directions = (
        (-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
        (-1, -1, math.sqrt(2)), (-1, 1, math.sqrt(2)),
        (1, -1, math.sqrt(2)), (1, 1, math.sqrt(2)),
    )

    while frontier:
        _, current = heapq.heappop(frontier)
        if current in visited:
            continue
        visited.add(current)
        if current == destination:
            path = [current]
            while current in came_from:
                current = came_from[current]
                path.append(current)
            path.reverse()
            return path, len(visited)

        row, column = current
        for row_offset, column_offset, movement in directions:
            neighbor = (row + row_offset, column + column_offset)
            if (
                not 0 <= neighbor[0] < height
                or not 0 <= neighbor[1] < width
                or blocked[neighbor] != 0
            ):
                continue
            if row_offset and column_offset:
                if (
                    blocked[row, neighbor[1]] != 0
                    or blocked[neighbor[0], column] != 0
                ):
                    continue
            step_cost = movement * (
                traversal_cost[current] + traversal_cost[neighbor]
            ) / 2
            candidate_cost = costs[current] + step_cost
            if candidate_cost >= costs.get(neighbor, math.inf):
                continue
            costs[neighbor] = candidate_cost
            came_from[neighbor] = current
            heuristic = math.hypot(
                destination[0] - neighbor[0],
                destination[1] - neighbor[1],
            )
            heapq.heappush(
                frontier, (candidate_cost + heuristic, neighbor)
            )
    raise RuntimeError("No local water route exists in this corridor.")


def connector_route(requested, network_point, allow_ultra_fine=False):
    target_crs = local_crs(requested, network_point)
    to_local = Transformer.from_crs(
        "EPSG:4326", target_crs, always_xy=True
    )
    to_wgs84 = Transformer.from_crs(
        target_crs, "EPSG:4326", always_xy=True
    )
    requested_xy = to_local.transform(*requested)
    network_xy = to_local.transform(*network_point)
    guide = LineString([requested_xy, network_xy])
    if guide.length > MAX_CONNECTOR_LENGTH_METERS:
        raise RuntimeError(
            f"Backbone candidate is {guide.length / 1000:.1f} km from endpoint."
        )
    last_error = None

    resolution_passes = [
        (CELL_SIZE_METERS, CORRIDOR_WIDTHS_METERS),
        (FINE_CELL_SIZE_METERS, FINE_CORRIDOR_WIDTHS_METERS),
    ]
    if allow_ultra_fine:
        resolution_passes.append(
            (ULTRA_FINE_CELL_SIZE_METERS, ULTRA_FINE_CORRIDOR_WIDTHS_METERS)
        )
    for cell_size, corridor_widths in resolution_passes:
        # Fine resolution is for harbor and archipelago access, not for
        # constructing very long local substitutes for the MARNET backbone.
        if cell_size == FINE_CELL_SIZE_METERS and guide.length > 60_000:
            continue
        if cell_size == ULTRA_FINE_CELL_SIZE_METERS and guide.length > 45_000:
            continue
        for corridor_width in corridor_widths:
            corridor = guide.buffer(corridor_width)
            min_x, min_y, max_x, max_y = corridor.bounds
            width = math.ceil((max_x - min_x) / cell_size)
            height = math.ceil((max_y - min_y) / cell_size)
            raster_max_y = min_y + height * cell_size
            transform = from_origin(
                min_x, raster_max_y, cell_size, cell_size
            )
            land = load_local_land(corridor, to_wgs84, target_crs)
            blocked = rasterize(
                ((geometry, 1) for geometry in land.geometry),
                out_shape=(height, width),
                transform=transform,
                fill=0,
                all_touched=False,
                dtype=np.uint8,
            )
            inside = geometry_mask(
                [mapping(corridor)],
                out_shape=blocked.shape,
                transform=transform,
                invert=True,
                all_touched=True,
            )
            blocked[~inside] = 1

            try:
                start_gap, start_cell = nearest_water_cell(
                    blocked, transform, requested_xy, cell_size
                )
                end_gap, end_cell = nearest_water_cell(
                    blocked, transform, network_xy, cell_size
                )
                clearance = distance_transform_edt(blocked == 0) * cell_size
                traversal_cost = 1 + CLEARANCE_PENALTY * np.exp(
                    -clearance / CLEARANCE_PREFERENCE_METERS
                )
                cells, visited = weighted_route(
                    blocked, traversal_cost, start_cell, end_cell
                )
            except RuntimeError as error:
                last_error = error
                continue

            simplified = simplify_route(blocked, cells)
            projected = [
                xy(transform, *cell, offset="center") for cell in simplified
            ]
            coordinates = [
                [float(longitude), float(latitude)]
                for longitude, latitude in (
                    to_wgs84.transform(x_coordinate, y_coordinate)
                    for x_coordinate, y_coordinate in projected
                )
            ]
            return {
                "coordinates": coordinates,
                "cell_size_meters": cell_size,
                "corridor_width_meters": corridor_width,
                "visited_cells": visited,
                "original_cells": len(cells),
                "simplified_vertices": len(coordinates),
                "requested_snap_meters": round(start_gap, 1),
                "network_snap_meters": round(end_gap, 1),
            }

    raise RuntimeError(str(last_error or "No connector route was found."))


def candidate_indices(coordinates, from_start=True):
    """Return progressively farther MARNET vertices near one route end."""
    count = len(coordinates)
    if not count:
        return []
    offsets = [0, 1, 2, 3, 4, 5, 7, 9, 12, 16, 21, 28]
    indices = []
    for offset in offsets:
        index = offset if from_start else count - 1 - offset
        if 0 <= index < count and index not in indices:
            indices.append(index)
        if len(indices) >= MAX_BACKBONE_CANDIDATES:
            break
    return indices


def editable_fallback_connector(
    requested, backbone_coordinates, from_start, errors
):
    index = 0 if from_start else len(backbone_coordinates) - 1
    network_point = backbone_coordinates[index]
    return {
        "coordinates": [requested, network_point],
        "cell_size_meters": None,
        "corridor_width_meters": None,
        "visited_cells": 0,
        "original_cells": 2,
        "simplified_vertices": 2,
        "requested_snap_meters": 0,
        "network_snap_meters": 0,
        "backbone_index": index,
        "candidates_tried": len(errors),
        "editable_fallback": True,
        "warning": (
            "Automatic harbor approach failed. This straight connector may "
            "cross land and must be adjusted before use."
        ),
        "automatic_errors": errors,
    }


def find_reachable_connector(requested, backbone_coordinates, from_start):
    errors = []
    for attempt, index in enumerate(
        candidate_indices(backbone_coordinates, from_start)
    ):
        try:
            connector = connector_route(
                requested,
                backbone_coordinates[index],
                allow_ultra_fine=(attempt == 0),
            )
            connector["backbone_index"] = index
            connector["candidates_tried"] = len(errors) + 1
            connector["editable_fallback"] = False
            return connector
        except RuntimeError as error:
            errors.append(f"vertex {index}: {error}")
    return editable_fallback_connector(
        requested, backbone_coordinates, from_start, errors
    )


def append_coordinates(target, source):
    for coordinate in source:
        value = [round(float(coordinate[0]), 6), round(float(coordinate[1]), 6)]
        if not target or value != target[-1]:
            target.append(value)


def _wrapped_destination_cell(start_cell, destination_cell, width):
    row, column = destination_cell
    candidates = (column - width, column, column + width)
    return row, min(candidates, key=lambda value: abs(value - start_cell[1]))


def shorten_backbone_over_visible_water(coordinates):
    """Remove large MARNET detours only when a water-only shortcut exists."""
    if len(coordinates) <= 2 or not GLOBAL_GRID.exists():
        return coordinates, 0.0

    with rasterio.open(GLOBAL_GRID) as source:
        grid = source.read(1)
        cells = [coordinate_to_cell(source, coordinate) for coordinate in coordinates]
        retained_indices = [0]
        current_index = 0
        final_index = len(coordinates) - 1

        while current_index < final_index:
            next_index = final_index
            while next_index > current_index + 1:
                destination_cell = _wrapped_destination_cell(
                    cells[current_index], cells[next_index], grid.shape[1]
                )
                if line_is_clear(
                    grid,
                    cells[current_index],
                    destination_cell,
                    wrap_columns=True,
                ):
                    break
                next_index -= 1
            retained_indices.append(next_index)
            current_index = next_index

    shortened = [coordinates[index] for index in retained_indices]
    original_distance = geodesic_distance_meters(coordinates)
    shortened_distance = geodesic_distance_meters(shortened)
    saved_kilometers = max(0.0, (original_distance - shortened_distance) / 1000)

    # Small changes are not worth altering a known-good MARNET path.
    if saved_kilometers < 5:
        return coordinates, 0.0
    return shortened, round(saved_kilometers, 2)


def calculate_hybrid(test):
    started = perf_counter()
    backbone = feature_mapping(
        sr.searoute(
            test["start"],
            test["end"],
            units="km",
            append_orig_dest=False,
            include_ports=test.get("include_ports", False),
            backend="igraph",
        )
    )
    original_backbone_coordinates = backbone["geometry"]["coordinates"]
    backbone_coordinates, shortcut_savings = shorten_backbone_over_visible_water(
        original_backbone_coordinates
    )
    start_connector = find_reachable_connector(
        test["start"], backbone_coordinates, True
    )
    destination_connector = find_reachable_connector(
        test["end"], backbone_coordinates, False
    )

    start_index = start_connector["backbone_index"]
    destination_index = destination_connector["backbone_index"]
    if start_index >= destination_index:
        raise RuntimeError(
            "Reachable endpoint connectors overlap on the SeaRoute backbone."
        )
    retained_backbone = backbone_coordinates[
        start_index:destination_index + 1
    ]

    coordinates = []
    append_coordinates(coordinates, start_connector["coordinates"])
    append_coordinates(coordinates, retained_backbone)
    append_coordinates(
        coordinates, reversed(destination_connector["coordinates"])
    )
    seconds = perf_counter() - started
    manual_segments = []
    if start_connector["editable_fallback"]:
        manual_segments.append("start")
    if destination_connector["editable_fallback"]:
        manual_segments.append("destination")
    feature = {
        "type": "Feature",
        "properties": {
            "name": test["name"],
            "featureType": "hybrid-water-route",
            "portAwareBackbone": test.get("include_ports", False),
            "requiresManualAdjustment": bool(manual_segments),
            "manualAdjustmentSegments": manual_segments,
            "calculationSeconds": round(seconds, 3),
            "backboneLengthKm": backbone.get("properties", {}).get("length"),
            "backboneOriginalVertices": len(original_backbone_coordinates),
            "backboneRetainedVertices": len(backbone_coordinates),
            "waterShortcutSavingsKm": shortcut_savings,
            "startConnector": {
                key: value for key, value in start_connector.items()
                if key != "coordinates"
            },
            "destinationConnector": {
                key: value for key, value in destination_connector.items()
                if key != "coordinates"
            },
        },
        "geometry": {"type": "LineString", "coordinates": coordinates},
    }
    return feature


def connector_summary(connector):
    if connector.get("editable_fallback"):
        return "EDITABLE FALLBACK"
    return (
        f"{connector['corridor_width_meters'] / 1000:g} km "
        f"at {connector['cell_size_meters']} m"
    )


def main():
    if not SOURCE_LAND.exists():
        raise FileNotFoundError(f"Land dataset not found: {SOURCE_LAND}")
    run_directory = OUTPUT_DIRECTORY / datetime.now().strftime("run_%Y%m%d_%H%M%S")
    run_directory.mkdir(parents=True, exist_ok=False)

    combined = []
    report = []
    print("Testing adaptive hybrid SeaRoute endpoint connectors...\n")

    for test in TEST_ROUTES:
        try:
            feature = calculate_hybrid(test)
        except Exception as error:
            print(f"FAILED  {test['name']}: {error}")
            report.append({"name": test["name"], "error": str(error)})
            continue
        combined.append(feature)
        properties = feature["properties"]
        report.append(properties)
        filename = (
            test["name"].lower().replace(" ", "-").replace("→", "to")
            + ".geojson"
        )
        with (run_directory / filename).open("w", encoding="utf-8") as output:
            json.dump(
                {"type": "FeatureCollection", "features": [feature]},
                output,
                indent=2,
            )
        print(
            f"OK      {test['name']}: {properties['calculationSeconds']:.3f}s; "
            f"start {connector_summary(properties['startConnector'])}; "
            f"destination "
            f"{connector_summary(properties['destinationConnector'])}"
        )
        if properties["requiresManualAdjustment"]:
            segments = ", ".join(properties["manualAdjustmentSegments"])
            print(
                f"        WARNING: manually adjust the {segments} connector "
                "before using this visualization."
            )

    with (run_directory / "hybrid_routes.geojson").open(
        "w", encoding="utf-8"
    ) as output:
        json.dump(
            {"type": "FeatureCollection", "features": combined},
            output,
            indent=2,
        )
    with (run_directory / "hybrid_report.json").open(
        "w", encoding="utf-8"
    ) as output:
        json.dump({"routes": report}, output, indent=2)

    print(f"\nOutputs: {run_directory}")
    print("Inspect each individual GeoJSON against a basemap in QGIS.")


if __name__ == "__main__":
    main()
