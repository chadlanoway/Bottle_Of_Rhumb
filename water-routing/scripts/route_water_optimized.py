"""Selective coarse-to-fine water routing.

Open-ocean portions stay on the prebuilt 10 km grid. Only route portions near
land, plus the start and destination, receive dynamic 1 km/500 m refinement.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from time import perf_counter

import numpy as np
import rasterio
from scipy.ndimage import label as label_connected_components


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
from scripts import route_water as base  # noqa: E402
from routing.simplification import line_is_clear  # noqa: E402


LAND_DETECTION_RADIUS_CELLS = 1
ENDPOINT_REFINEMENT_CELLS = 2
GROUP_PADDING_CELLS = 1
GROUP_MERGE_GAP_CELLS = 2
DETAIL_CORRIDOR_METERS = 40_000
ENDPOINT_DETAIL_CORRIDOR_METERS = 75_000
ENDPOINT_FINE_CELL_SIZE_METERS = 250
FINE_SECTION_MINIMUM_CELLS = 10
MAX_ENDPOINT_SNAP_METERS = 2_000


def _connected_ocean_grid(grid):
    """Return a grid containing only the largest connected water region."""
    water = grid == 0
    structure = np.array(
        [
            [0, 1, 0],
            [1, 1, 1],
            [0, 1, 0],
        ],
        dtype=np.uint8,
    )
    labels, component_count = label_connected_components(
        water, structure=structure
    )
    if component_count == 0:
        raise RuntimeError("The global routing grid contains no ocean water.")

    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    ocean_label = int(np.argmax(sizes))
    ocean_grid = np.ones(grid.shape, dtype=np.uint8)
    ocean_grid[labels == ocean_label] = 0
    return ocean_grid


def _near_blocked_cell(grid, cell, radius):
    row, column = cell
    height, width = grid.shape
    row_start = max(0, row - radius)
    row_end = min(height, row + radius + 1)
    columns = [
        (column + offset) % width
        for offset in range(-radius, radius + 1)
    ]
    return bool(np.any(grid[row_start:row_end, columns] != 0))


def _refinement_groups(grid, route):
    last = len(route) - 1
    sensitive = []
    for index, cell in enumerate(route):
        endpoint = (
            index <= ENDPOINT_REFINEMENT_CELLS
            or index >= last - ENDPOINT_REFINEMENT_CELLS
        )
        sensitive.append(
            endpoint
            or _near_blocked_cell(
                grid, cell, LAND_DETECTION_RADIUS_CELLS
            )
        )

    raw_groups = []
    start = None
    for index, is_sensitive in enumerate(sensitive + [False]):
        if is_sensitive and start is None:
            start = index
        elif not is_sensitive and start is not None:
            raw_groups.append((start, index - 1))
            start = None

    expanded = [
        (
            max(0, start - GROUP_PADDING_CELLS),
            min(last, end + GROUP_PADDING_CELLS),
        )
        for start, end in raw_groups
    ]
    merged = []
    for start, end in expanded:
        if merged and start - merged[-1][1] <= GROUP_MERGE_GAP_CELLS:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _route_coordinates(source, grid, cells):
    if len(cells) < 2:
        return []
    simplified = simplify_route(grid, cells, wrap_columns=True)
    projected = cells_to_projected_coordinates(source, simplified)
    return projected_to_wgs84(source, projected)


def _sample_direct_cells(start, end):
    row_difference = end[0] - start[0]
    column_difference = end[1] - start[1]
    steps = max(abs(row_difference), abs(column_difference))
    if steps == 0:
        return [start]
    cells = []
    for step in range(steps + 1):
        fraction = step / steps
        cell = (
            round(start[0] + row_difference * fraction),
            round(start[1] + column_difference * fraction),
        )
        if not cells or cell != cells[-1]:
            cells.append(cell)
    return cells


def calculate_global_plan(start, end):
    print("1/3 Calculating global 10 km guidance route...", flush=True)
    with rasterio.open(base.GLOBAL_GRID) as source:
        grid = source.read(1)
        ocean_grid = _connected_ocean_grid(grid)
        requested_start = coordinate_to_cell(source, start)
        requested_end = coordinate_to_cell(source, end)
        snapped_start = find_nearest_water(
            ocean_grid, requested_start, 100, wrap_columns=True
        )
        snapped_end = find_nearest_water(
            ocean_grid, requested_end, 100, wrap_columns=True
        )
        crosses_grid_edge = (
            abs(snapped_end[1] - snapped_start[1]) > grid.shape[1] / 2
        )
        if not crosses_grid_edge and line_is_clear(
            ocean_grid, snapped_start, snapped_end
        ):
            route = _sample_direct_cells(snapped_start, snapped_end)
            visited = len(route)
            route_method = "direct-line-of-sight"
        else:
            route, visited = find_route(
                ocean_grid,
                snapped_start,
                snapped_end,
                wrap_columns=True,
            )
            route_method = "global-a-star"
        groups = _refinement_groups(grid, route)

        pieces = []
        cursor = 0
        for group_index, (group_start, group_end) in enumerate(groups):
            if cursor < group_start:
                coordinates = _route_coordinates(
                    source, grid, route[cursor:group_start + 1]
                )
                if coordinates:
                    pieces.append({"type": "coarse", "coordinates": coordinates})

            group_cells = route[group_start:group_end + 1]
            group_coordinates = _route_coordinates(
                source, grid, group_cells
            )
            if group_start == 0:
                segment_start = start
            else:
                segment_start = tuple(group_coordinates[0])
            if group_end == len(route) - 1:
                segment_end = end
            else:
                segment_end = tuple(group_coordinates[-1])
            pieces.append(
                {
                    "type": "refine",
                    "index": group_index,
                    "coordinates": group_coordinates,
                    "start": segment_start,
                    "end": segment_end,
                    "contains_requested_start": group_start == 0,
                    "contains_requested_end": group_end == len(route) - 1,
                    "use_fine": (
                        group_start == 0
                        or group_end == len(route) - 1
                        or len(group_cells) >= FINE_SECTION_MINIMUM_CELLS
                    ),
                }
            )
            cursor = group_end

        if cursor < len(route) - 1:
            coordinates = _route_coordinates(source, grid, route[cursor:])
            if coordinates:
                pieces.append({"type": "coarse", "coordinates": coordinates})

        all_projected = cells_to_projected_coordinates(source, route)
        all_wgs84 = projected_to_wgs84(source, all_projected)

    print(
        f"    Visited {visited:,} cells; "
        f"selected {len(groups)} land-sensitive section(s)",
        flush=True,
    )
    return {
        "pieces": pieces,
        "guidance": all_wgs84,
        "visited": visited,
        "route_cells": len(route),
        "global_method": route_method,
    }


def _append_coordinates(target, coordinates):
    for coordinate in coordinates:
        value = [float(coordinate[0]), float(coordinate[1])]
        if not target or value != target[-1]:
            target.append(value)


def refine_plan(plan, slug, tiles_directory):
    print("2/3 Refining land-sensitive sections...", flush=True)
    final_coordinates = []
    refinements = []

    for piece in plan["pieces"]:
        if piece["type"] == "coarse":
            _append_coordinates(final_coordinates, piece["coordinates"])
            continue

        number = piece["index"] + 1
        print(
            f"    Refining section {number} from "
            f"{piece['start']} to {piece['end']}",
            flush=True,
        )
        coastal_path = tiles_directory / f"{slug}_{number}_coastal_1km.tif"
        fine_path = tiles_directory / f"{slug}_{number}_fine_detail.tif"
        detail_guidance = piece["coordinates"]
        if len(detail_guidance) < 2:
            # Short routes can start and end inside the same 10 km global
            # cell. Use the requested section endpoints to create a valid
            # detail corridor instead of buffering an empty LineString.
            detail_guidance = [piece["start"], piece["end"]]
        else:
            detail_guidance = [list(value) for value in detail_guidance]
            if piece["contains_requested_start"]:
                detail_guidance.insert(0, list(piece["start"]))
            if piece["contains_requested_end"]:
                detail_guidance.append(list(piece["end"]))
        build_started = perf_counter()
        endpoint_access_points = []
        if piece["contains_requested_start"]:
            endpoint_access_points.append(("Start", piece["start"]))
        if piece["contains_requested_end"]:
            endpoint_access_points.append(("Destination", piece["end"]))
        base.build_detail_grids(
            detail_guidance,
            coastal_path,
            fine_path,
            corridor_meters=(
                ENDPOINT_DETAIL_CORRIDOR_METERS
                if endpoint_access_points
                else DETAIL_CORRIDOR_METERS
            ),
            build_fine=piece["use_fine"],
            endpoint_access_points=endpoint_access_points,
            fine_cell_size=(
                ENDPOINT_FINE_CELL_SIZE_METERS
                if endpoint_access_points
                else 500
            ),
        )
        build_seconds = perf_counter() - build_started
        route_started = perf_counter()
        result = base.calculate_refined_route(
            piece["start"],
            piece["end"],
            coastal_path,
            fine_path,
            use_fine=piece["use_fine"],
            start_snap_meters=(
                MAX_ENDPOINT_SNAP_METERS
                if piece["contains_requested_start"]
                else None
            ),
            end_snap_meters=(
                MAX_ENDPOINT_SNAP_METERS
                if piece["contains_requested_end"]
                else None
            ),
        )
        result["grid_build_seconds"] = round(build_seconds, 3)
        result["routing_seconds"] = round(
            perf_counter() - route_started, 3
        )
        refinements.append(result)
        _append_coordinates(final_coordinates, result["coordinates"])

    return final_coordinates, refinements


def write_output(path, name, start, end, plan, final_coordinates,
                 refinements, debug, timing):
    distance = geodesic_distance_meters(final_coordinates)
    features = [
        base.route_feature(
            name,
            "water-route",
            final_coordinates,
            {
                "distance_kilometers": round(distance / 1000, 2),
                "routing_strategy": "selective-coarse-to-fine",
                "global_method": plan["global_method"],
                "global_visited_cells": plan["visited"],
                "global_route_cells": plan["route_cells"],
                "refined_sections": len(refinements),
                "coastal_visited_cells": sum(
                    result["coastal_visited"] for result in refinements
                ),
                "fine_visited_cells": sum(
                    result["fine_visited"] for result in refinements
                ),
                "land_buffer_meters": base.LAND_BUFFER_METERS,
                "detail_corridor_meters": DETAIL_CORRIDOR_METERS,
                "endpoint_detail_corridor_meters": (
                    ENDPOINT_DETAIL_CORRIDOR_METERS
                ),
                "five_hundred_meter_sections": sum(
                    result["resolution_meters"] == 500
                    for result in refinements
                ),
                "two_hundred_fifty_meter_sections": sum(
                    result["resolution_meters"] == 250
                    for result in refinements
                ),
                "timing_seconds": timing,
                "section_timing_seconds": [
                    {
                        "grid_build": result["grid_build_seconds"],
                        "routing": result["routing_seconds"],
                    }
                    for result in refinements
                ],
            },
        ),
        base.point_feature(
            "Route start", "route-start", final_coordinates[0], start
        ),
        base.point_feature(
            "Route destination",
            "route-destination",
            final_coordinates[-1],
            end,
        ),
    ]

    if debug:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": "Global guidance route",
                    "featureType": "global-coarse-route",
                },
                "geometry": antimeridian_safe_geometry(plan["guidance"]),
            }
        )
        for index, result in enumerate(refinements, start=1):
            features.append(
                base.route_feature(
                    f"Coastal refinement {index}",
                    "coastal-route",
                    result["coastal_coordinates"],
                )
            )

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        json.dump(
            {"type": "FeatureCollection", "features": features},
            output,
            indent=2,
        )
    return distance


def main():
    total_started = perf_counter()
    args = base.parse_args()
    start = base.validate_lng_lat(tuple(args.start), "Start")
    end = base.validate_lng_lat(tuple(args.end), "End")
    if start == end:
        raise ValueError("Start and destination must be different.")
    for required in (base.SOURCE_LAND, base.GLOBAL_GRID):
        if not required.exists():
            raise FileNotFoundError(f"Required input not found:\n{required}")

    slug = base.slugify(args.name)
    tiles = (
        args.work_dir.resolve()
        if args.work_dir
        else PROJECT_ROOT / "data" / "tiles" / "generated"
    )
    output_path = (
        args.output.resolve()
        if args.output
        else PROJECT_ROOT / "data" / "processed" / f"{slug}.geojson"
    )

    try:
        global_started = perf_counter()
        plan = calculate_global_plan(start, end)
        global_seconds = perf_counter() - global_started
        refinement_started = perf_counter()
        final_coordinates, refinements = refine_plan(plan, slug, tiles)
        refinement_seconds = perf_counter() - refinement_started
        print("3/3 Writing final GeoJSON...", flush=True)
        timing = {
            "global": round(global_seconds, 3),
            "refinement": round(refinement_seconds, 3),
            "total_before_output": round(
                perf_counter() - total_started, 3
            ),
        }
        distance = write_output(
            output_path,
            args.name,
            start,
            end,
            plan,
            final_coordinates,
            refinements,
            args.debug,
            timing,
        )
    finally:
        if not args.keep_grids and tiles.exists():
            for path in tiles.glob(f"{slug}_*_coastal_1km.tif"):
                path.unlink(missing_ok=True)
            for path in tiles.glob(f"{slug}_*_fine_*.tif"):
                path.unlink(missing_ok=True)

    print(f"Final route distance: {distance / 1000:,.2f} km", flush=True)
    print(f"Saved final route to:\n{output_path}", flush=True)


if __name__ == "__main__":
    main()
