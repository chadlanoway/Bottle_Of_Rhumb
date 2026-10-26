from pathlib import Path
import heapq
import json
import math

import numpy as np
import rasterio
from pyproj import Transformer


PROJECT_ROOT = Path(__file__).resolve().parents[1]

GRID_FILE = (
    PROJECT_ROOT
    / "data"
    / "tiles"
    / "florida_keys_routing_grid_v2.tif"
)

OUTPUT_FILE = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "florida_keys_simplified_route.geojson"
)

START_LNG_LAT = (-81.50, 25.40)
END_LNG_LAT = (-80.10, 25.40)

WATER_VALUE = 0
MAX_SNAP_RADIUS_CELLS = 40


def heuristic(first, second):
    row_difference = abs(first[0] - second[0])
    column_difference = abs(first[1] - second[1])

    diagonal = min(row_difference, column_difference)
    straight = max(row_difference, column_difference) - diagonal

    return diagonal * math.sqrt(2) + straight


def get_neighbors(node, grid):
    row, column = node
    height, width = grid.shape

    directions = [
        (-1, 0, 1.0),
        (1, 0, 1.0),
        (0, -1, 1.0),
        (0, 1, 1.0),
        (-1, -1, math.sqrt(2)),
        (-1, 1, math.sqrt(2)),
        (1, -1, math.sqrt(2)),
        (1, 1, math.sqrt(2)),
    ]

    for row_offset, column_offset, cost in directions:
        new_row = row + row_offset
        new_column = column + column_offset

        if not (
            0 <= new_row < height
            and 0 <= new_column < width
        ):
            continue

        if grid[new_row, new_column] != WATER_VALUE:
            continue

        # Do not cut diagonally through blocked corners.
        if row_offset != 0 and column_offset != 0:
            if (
                grid[row, new_column] != WATER_VALUE
                or grid[new_row, column] != WATER_VALUE
            ):
                continue

        yield (new_row, new_column), cost


def find_nearest_water(grid, starting_cell):
    starting_row, starting_column = starting_cell
    height, width = grid.shape

    if (
        0 <= starting_row < height
        and 0 <= starting_column < width
        and grid[starting_row, starting_column] == WATER_VALUE
    ):
        return starting_cell

    for radius in range(1, MAX_SNAP_RADIUS_CELLS + 1):
        candidates = []

        for row in range(
            starting_row - radius,
            starting_row + radius + 1,
        ):
            for column in range(
                starting_column - radius,
                starting_column + radius + 1,
            ):
                if not (
                    0 <= row < height
                    and 0 <= column < width
                ):
                    continue

                if grid[row, column] != WATER_VALUE:
                    continue

                distance = math.hypot(
                    row - starting_row,
                    column - starting_column,
                )

                candidates.append((distance, (row, column)))

        if candidates:
            return min(candidates, key=lambda item: item[0])[1]

    raise RuntimeError(
        "Could not find navigable water near the selected point."
    )


def reconstruct_path(came_from, current):
    path = [current]

    while current in came_from:
        current = came_from[current]
        path.append(current)

    path.reverse()
    return path


def find_route(grid, start, destination):
    frontier = [(0.0, start)]
    came_from = {}
    cost_so_far = {start: 0.0}
    visited = set()

    while frontier:
        _, current = heapq.heappop(frontier)

        if current in visited:
            continue

        visited.add(current)

        if current == destination:
            print(f"Visited {len(visited):,} cells")
            return reconstruct_path(came_from, current)

        for neighbor, movement_cost in get_neighbors(current, grid):
            new_cost = cost_so_far[current] + movement_cost

            if (
                neighbor not in cost_so_far
                or new_cost < cost_so_far[neighbor]
            ):
                cost_so_far[neighbor] = new_cost
                came_from[neighbor] = current

                priority = (
                    new_cost
                    + heuristic(neighbor, destination)
                )

                heapq.heappush(
                    frontier,
                    (priority, neighbor),
                )

    raise RuntimeError(
        "No navigable route exists between the selected points."
    )


def line_is_clear(grid, start, end):
    """
    Sample a line densely enough to check each crossed raster cell.

    Diagonal transitions must also have clear adjacent cells so the
    simplified route cannot cut across the corner of blocked land.
    """
    start_row, start_column = start
    end_row, end_column = end

    row_difference = end_row - start_row
    column_difference = end_column - start_column

    steps = max(
        abs(row_difference),
        abs(column_difference),
    ) * 4

    if steps == 0:
        return True

    previous_cell = start

    for step in range(steps + 1):
        fraction = step / steps

        row = round(
            start_row + row_difference * fraction
        )
        column = round(
            start_column + column_difference * fraction
        )

        if not (
            0 <= row < grid.shape[0]
            and 0 <= column < grid.shape[1]
        ):
            return False

        if grid[row, column] != WATER_VALUE:
            return False

        previous_row, previous_column = previous_cell

        if (
            row != previous_row
            and column != previous_column
        ):
            if (
                grid[previous_row, column] != WATER_VALUE
                or grid[row, previous_column] != WATER_VALUE
            ):
                return False

        previous_cell = (row, column)

    return True


def simplify_route(grid, route):
    """
    Retain the farthest visible vertex from each current vertex.
    """
    if len(route) <= 2:
        return route

    simplified = [route[0]]
    current_index = 0
    final_index = len(route) - 1

    while current_index < final_index:
        next_index = final_index

        while next_index > current_index + 1:
            if line_is_clear(
                grid,
                route[current_index],
                route[next_index],
            ):
                break

            next_index -= 1

        simplified.append(route[next_index])
        current_index = next_index

    return simplified


def cell_center(dataset, cell):
    row, column = cell
    return dataset.xy(row, column, offset="center")


def calculate_distance(coordinates):
    distance = 0.0

    for first, second in zip(
        coordinates,
        coordinates[1:],
    ):
        distance += math.hypot(
            second[0] - first[0],
            second[1] - first[1],
        )

    return distance


def main():
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.open(GRID_FILE) as source:
        if source.crs is None:
            raise RuntimeError("The routing grid has no CRS.")

        grid = source.read(1)

        to_grid = Transformer.from_crs(
            "EPSG:4326",
            source.crs,
            always_xy=True,
        )

        to_wgs84 = Transformer.from_crs(
            source.crs,
            "EPSG:4326",
            always_xy=True,
        )

        start_x, start_y = to_grid.transform(*START_LNG_LAT)
        end_x, end_y = to_grid.transform(*END_LNG_LAT)

        requested_start_cell = source.index(start_x, start_y)
        requested_end_cell = source.index(end_x, end_y)

        start_cell = find_nearest_water(
            grid,
            requested_start_cell,
        )

        end_cell = find_nearest_water(
            grid,
            requested_end_cell,
        )

        print(f"Start cell: {start_cell}")
        print(f"End cell:   {end_cell}")
        print("Calculating A* route...")

        original_route = find_route(
            grid,
            start_cell,
            end_cell,
        )

        print("Simplifying route...")

        simplified_route = simplify_route(
            grid,
            original_route,
        )

        projected_coordinates = [
            cell_center(source, cell)
            for cell in simplified_route
        ]

        route_coordinates = [
            list(to_wgs84.transform(x, y))
            for x, y in projected_coordinates
        ]

        start_coordinate = route_coordinates[0]
        end_coordinate = route_coordinates[-1]

        route_distance = calculate_distance(
            projected_coordinates
        )

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "Simplified water route",
                    "featureType": "water-route",
                    "distance_meters": round(route_distance, 1),
                    "distance_kilometers": round(
                        route_distance / 1000,
                        2,
                    ),
                    "original_vertices": len(original_route),
                    "simplified_vertices": len(simplified_route),
                    "safety_buffer_meters": 2000,
                    "cell_size_meters": 500,
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": route_coordinates,
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Route start",
                    "featureType": "route-start",
                    "requested_coordinates": list(
                        START_LNG_LAT
                    ),
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
                    "requested_coordinates": list(
                        END_LNG_LAT
                    ),
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

    print(f"Original vertices:   {len(original_route):,}")
    print(f"Simplified vertices: {len(simplified_route):,}")
    print(f"Route distance:      {route_distance / 1000:,.2f} km")
    print(f"Saved route to:\n{OUTPUT_FILE}")


if __name__ == "__main__":
    main()