from pathlib import Path
import json

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import geometry_mask
from shapely.geometry import LineString, mapping
from shapely.ops import transform as shapely_transform

from test_water_route import (
    calculate_distance,
    cell_center,
    find_nearest_water,
    find_route,
    simplify_route,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]

COARSE_GRID_FILE = (
    PROJECT_ROOT
    / "data"
    / "tiles"
    / "florida_keys_coastal_grid_v1.tif"
)

FINE_GRID_FILE = (
    PROJECT_ROOT
    / "data"
    / "tiles"
    / "florida_keys_routing_grid_v2.tif"
)

OUTPUT_FILE = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "florida_keys_hierarchical_route.geojson"
)

START_LNG_LAT = (-81.50, 25.40)
END_LNG_LAT = (-80.10, 25.40)

CORRIDOR_WIDTHS_METERS = (
    10_000,
    25_000,
    50_000,
    100_000,
    200_000,
)


def coordinate_to_cell(dataset, transformer, coordinate):
    x_coordinate, y_coordinate = transformer.transform(
        *coordinate
    )

    return dataset.index(x_coordinate, y_coordinate)


def cells_to_projected_coordinates(dataset, cells):
    return [
        cell_center(dataset, cell)
        for cell in cells
    ]


def coordinates_to_wgs84(coordinates, transformer):
    return [
        list(transformer.transform(x_coordinate, y_coordinate))
        for x_coordinate, y_coordinate in coordinates
    ]


def route_on_grid(
    dataset,
    grid,
    start_lng_lat,
    end_lng_lat,
):
    to_grid = Transformer.from_crs(
        "EPSG:4326",
        dataset.crs,
        always_xy=True,
    )

    requested_start_cell = coordinate_to_cell(
        dataset,
        to_grid,
        start_lng_lat,
    )

    requested_end_cell = coordinate_to_cell(
        dataset,
        to_grid,
        end_lng_lat,
    )

    start_cell = find_nearest_water(
        grid,
        requested_start_cell,
    )

    end_cell = find_nearest_water(
        grid,
        requested_end_cell,
    )

    route = find_route(
        grid,
        start_cell,
        end_cell,
    )

    return route, start_cell, end_cell


def main():
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    print("Opening coarse routing grid...")

    with rasterio.open(COARSE_GRID_FILE) as coarse_source:
        coarse_grid = coarse_source.read(1)

        coarse_route, _, _ = route_on_grid(
            coarse_source,
            coarse_grid,
            START_LNG_LAT,
            END_LNG_LAT,
        )

        coarse_projected_coordinates = (
            cells_to_projected_coordinates(
                coarse_source,
                coarse_route,
            )
        )

        coarse_line = LineString(
            coarse_projected_coordinates
        )

        coarse_crs = coarse_source.crs

        print(
            f"Coarse route cells: {len(coarse_route):,}"
        )

    print("Opening fine routing grid...")

    with rasterio.open(FINE_GRID_FILE) as fine_source:
        if fine_source.crs != coarse_crs:
            raise RuntimeError(
                "The coarse and fine grids must use the same CRS."
            )

        fine_grid = fine_source.read(1)

        total_cells = fine_grid.size

        fine_route = None
        route_corridor = None
        restricted_fine_grid = None
        selected_corridor_width = None
        corridor_cells = None

        for corridor_width in CORRIDOR_WIDTHS_METERS:
            candidate_corridor = coarse_line.buffer(
                corridor_width
            )

            candidate_mask = geometry_mask(
                [mapping(candidate_corridor)],
                out_shape=fine_grid.shape,
                transform=fine_source.transform,
                invert=True,
                all_touched=True,
            )

            candidate_grid = np.where(
                candidate_mask,
                fine_grid,
                1,
            ).astype(np.uint8)

            candidate_cell_count = int(
                np.count_nonzero(candidate_mask)
            )

            candidate_percent = (
                candidate_cell_count / total_cells * 100
            )

            print(
                f"Trying {corridor_width / 1000:.0f} km corridor: "
                f"{candidate_cell_count:,} of {total_cells:,} "
                f"fine cells ({candidate_percent:.1f}%)"
            )

            try:
                candidate_route, start_cell, end_cell = (
                    route_on_grid(
                        fine_source,
                        candidate_grid,
                        START_LNG_LAT,
                        END_LNG_LAT,
                    )
                )
            except RuntimeError as error:
                if "No navigable route exists" not in str(error):
                    raise

                print(
                    "No fine route in this corridor; "
                    "trying a wider corridor."
                )
                continue

            fine_route = candidate_route
            route_corridor = candidate_corridor
            restricted_fine_grid = candidate_grid
            selected_corridor_width = corridor_width
            corridor_cells = candidate_cell_count
            break

        if fine_route is None:
            raise RuntimeError(
                "No fine route was found after trying all "
                "configured corridor widths."
            )

        print(
            f"Selected {selected_corridor_width / 1000:.0f} km "
            f"corridor containing {corridor_cells:,} fine cells."
        )

        simplified_route = simplify_route(
            restricted_fine_grid,
            fine_route,
        )

        fine_projected_coordinates = (
            cells_to_projected_coordinates(
                fine_source,
                simplified_route,
            )
        )

        route_distance = calculate_distance(
            fine_projected_coordinates
        )

        to_wgs84 = Transformer.from_crs(
            fine_source.crs,
            "EPSG:4326",
            always_xy=True,
        )

        route_wgs84 = coordinates_to_wgs84(
            fine_projected_coordinates,
            to_wgs84,
        )

        coarse_route_wgs84 = coordinates_to_wgs84(
            coarse_projected_coordinates,
            to_wgs84,
        )

        start_coordinate = route_wgs84[0]
        end_coordinate = route_wgs84[-1]

        corridor_wgs84 = shapely_transform(
            to_wgs84.transform,
            route_corridor,
        )

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "Final fine route",
                    "featureType": "fine-route",
                    "distance_kilometers": round(
                        route_distance / 1000,
                        2,
                    ),
                    "original_fine_vertices": len(
                        fine_route
                    ),
                    "simplified_vertices": len(
                        simplified_route
                    ),
                    "corridor_width_meters": (
                        selected_corridor_width
                    ),
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": route_wgs84,
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Coarse route",
                    "featureType": "coarse-route",
                    "grid_cells": len(coarse_route),
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": coarse_route_wgs84,
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Fine-routing corridor",
                    "featureType": "routing-corridor",
                },
                "geometry": mapping(corridor_wgs84),
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Route start",
                    "featureType": "route-start",
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": start_coordinate,
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
                    "coordinates": end_coordinate,
                },
            },
        ],
    }

    with OUTPUT_FILE.open("w", encoding="utf-8") as output:
        json.dump(geojson, output, indent=2)

    print(f"Fine route cells:       {len(fine_route):,}")
    print(
        f"Simplified vertices:    "
        f"{len(simplified_route):,}"
    )
    print(
        f"Final route distance:   "
        f"{route_distance / 1000:,.2f} km"
    )
    print(f"Saved output to:\n{OUTPUT_FILE}")


if __name__ == "__main__":
    main()
