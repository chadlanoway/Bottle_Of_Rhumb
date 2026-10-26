from pathlib import Path
import json
import sys

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from shapely.geometry import LineString, mapping


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


COASTAL_GRID = (
    PROJECT_ROOT / "data" / "tiles" / "ny_lisbon_coastal_1km.tif"
)
FINE_GRID = PROJECT_ROOT / "data" / "tiles" / "ny_lisbon_fine_500m.tif"
OUTPUT_FILE = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "ny_lisbon_refined_route.geojson"
)

START_LNG_LAT = (-73.70, 40.30)
END_LNG_LAT = (-9.70, 38.55)
FINE_CORRIDOR_WIDTHS = (10_000, 25_000, 50_000, 100_000)


def route_on_grid(source, grid, start_lng_lat, end_lng_lat):
    requested_start = coordinate_to_cell(source, start_lng_lat)
    requested_end = coordinate_to_cell(source, end_lng_lat)
    start = find_nearest_water(grid, requested_start, 200)
    end = find_nearest_water(grid, requested_end, 200)
    route, visited = find_route(grid, start, end)
    return route, visited


def main():
    for path in (COASTAL_GRID, FINE_GRID):
        if not path.exists():
            raise FileNotFoundError(
                f"Detail grid not found:\n{path}\n"
                "Run build_route_detail_grids.py first."
            )

    print("Calculating the 1 km coastal route...")
    with rasterio.open(COASTAL_GRID) as coastal_source:
        coastal_grid = coastal_source.read(1)
        coastal_route, coastal_visited = route_on_grid(
            coastal_source,
            coastal_grid,
            START_LNG_LAT,
            END_LNG_LAT,
        )
        coastal_projected = cells_to_projected_coordinates(
            coastal_source, coastal_route
        )
        coastal_line = LineString(coastal_projected)
        coastal_wgs84 = projected_to_wgs84(
            coastal_source, coastal_projected
        )
        coastal_crs = coastal_source.crs

    print(f"Coastal cells visited: {coastal_visited:,}")
    print("Calculating the 500 m fine route...")

    with rasterio.open(FINE_GRID) as fine_source:
        if fine_source.crs != coastal_crs:
            raise RuntimeError("Coastal and fine grids use different CRSs.")

        fine_grid = fine_source.read(1)
        total_fine_cells = fine_grid.size
        fine_route = None
        fine_visited = None
        selected_width = None
        restricted_grid = None

        for width in FINE_CORRIDOR_WIDTHS:
            corridor = coastal_line.buffer(width)
            mask = geometry_mask(
                [mapping(corridor)],
                out_shape=fine_grid.shape,
                transform=fine_source.transform,
                invert=True,
                all_touched=True,
            )
            candidate_grid = np.where(mask, fine_grid, 1).astype(np.uint8)
            included = int(np.count_nonzero(mask))
            print(
                f"Trying {width / 1000:.0f} km fine corridor: "
                f"{included:,} of {total_fine_cells:,} cells "
                f"({included / total_fine_cells * 100:.1f}%)"
            )

            try:
                candidate_route, candidate_visited = route_on_grid(
                    fine_source,
                    candidate_grid,
                    START_LNG_LAT,
                    END_LNG_LAT,
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
        fine_projected = cells_to_projected_coordinates(
            fine_source, simplified
        )
        fine_wgs84 = projected_to_wgs84(fine_source, fine_projected)

    distance_meters = geodesic_distance_meters(fine_wgs84)
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "New York to Lisbon refined route",
                    "featureType": "fine-route",
                    "distance_kilometers": round(distance_meters / 1000, 2),
                    "coastal_visited_cells": coastal_visited,
                    "fine_visited_cells": fine_visited,
                    "fine_original_vertices": len(fine_route),
                    "fine_simplified_vertices": len(simplified),
                    "fine_corridor_meters": selected_width,
                },
                "geometry": antimeridian_safe_geometry(fine_wgs84),
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "One kilometer coastal route",
                    "featureType": "coastal-route",
                },
                "geometry": antimeridian_safe_geometry(coastal_wgs84),
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Route start",
                    "featureType": "route-start",
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": fine_wgs84[0],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Route destination",
                    "featureType": "route-destination",
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": fine_wgs84[-1],
                },
            },
        ],
    }

    with OUTPUT_FILE.open("w", encoding="utf-8") as output:
        json.dump(geojson, output, indent=2)

    print(f"Selected fine corridor: {selected_width / 1000:.0f} km")
    print(f"Fine cells visited:     {fine_visited:,}")
    print(f"Fine route vertices:    {len(fine_route):,}")
    print(f"Simplified vertices:    {len(simplified):,}")
    print(f"Distance:               {distance_meters / 1000:,.2f} km")
    print(f"Saved refined route to:\n{OUTPUT_FILE}")


if __name__ == "__main__":
    main()
