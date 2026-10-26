from pathlib import Path
import json
import sys

import rasterio


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


GRID_FILE = (
    PROJECT_ROOT / "data" / "tiles" / "global_coarse_10km.tif"
)
OUTPUT_FILE = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "global_antimeridian_test_route.geojson"
)

# Offshore Japan to offshore California. The shortest route should cross
# the antimeridian, exercising horizontal grid wrapping and split output.
START_LNG_LAT = (142.00, 35.00)
END_LNG_LAT = (-123.50, 37.50)

WRAP_COLUMNS = True
MAX_SNAP_RADIUS_CELLS = 100


def main():
    if not GRID_FILE.exists():
        raise FileNotFoundError(
            f"Global grid not found:\n{GRID_FILE}\n"
            "Run build_global_coarse_grid.py first."
        )

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.open(GRID_FILE) as source:
        if source.crs is None:
            raise RuntimeError("The global routing grid has no CRS.")

        grid = source.read(1)
        requested_start = coordinate_to_cell(source, START_LNG_LAT)
        requested_end = coordinate_to_cell(source, END_LNG_LAT)

        start = find_nearest_water(
            grid,
            requested_start,
            MAX_SNAP_RADIUS_CELLS,
            WRAP_COLUMNS,
        )
        destination = find_nearest_water(
            grid,
            requested_end,
            MAX_SNAP_RADIUS_CELLS,
            WRAP_COLUMNS,
        )

        print(f"Requested start cell: {requested_start}")
        print(f"Snapped start cell:   {start}")
        print(f"Requested end cell:   {requested_end}")
        print(f"Snapped end cell:     {destination}")
        print("Calculating global A* route...")

        route, visited_count = find_route(
            grid,
            start,
            destination,
            wrap_columns=WRAP_COLUMNS,
        )

        simplified = simplify_route(
            grid,
            route,
            wrap_columns=WRAP_COLUMNS,
        )

        projected = cells_to_projected_coordinates(source, simplified)
        wgs84_route = projected_to_wgs84(source, projected)
        route_distance = geodesic_distance_meters(wgs84_route)

    route_geometry = antimeridian_safe_geometry(wgs84_route)

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "Global antimeridian test route",
                    "featureType": "global-coarse-route",
                    "distance_kilometers": round(route_distance / 1000, 2),
                    "visited_cells": visited_count,
                    "original_vertices": len(route),
                    "simplified_vertices": len(simplified),
                    "cell_size_meters": 10_000,
                },
                "geometry": route_geometry,
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Route start",
                    "featureType": "route-start",
                    "requested_coordinates": list(START_LNG_LAT),
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": wgs84_route[0],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Route destination",
                    "featureType": "route-destination",
                    "requested_coordinates": list(END_LNG_LAT),
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": wgs84_route[-1],
                },
            },
        ],
    }

    with OUTPUT_FILE.open("w", encoding="utf-8") as output:
        json.dump(geojson, output, indent=2)

    print(f"Visited cells:       {visited_count:,}")
    print(f"Original vertices:   {len(route):,}")
    print(f"Simplified vertices: {len(simplified):,}")
    print(f"Route distance:      {route_distance / 1000:,.2f} km")
    print(f"Saved route to:\n{OUTPUT_FILE}")


if __name__ == "__main__":
    main()
