import heapq
import math


WATER_VALUE = 0


def _column_distance(first_column, second_column, width, wrap_columns):
    difference = abs(first_column - second_column)
    if wrap_columns:
        difference = min(difference, width - difference)
    return difference


def heuristic(first, second, width, wrap_columns=False):
    row_difference = abs(first[0] - second[0])
    column_difference = _column_distance(
        first[1], second[1], width, wrap_columns
    )
    diagonal = min(row_difference, column_difference)
    straight = max(row_difference, column_difference) - diagonal
    return diagonal * math.sqrt(2) + straight


def get_neighbors(grid, node, wrap_columns=False):
    row, column = node
    height, width = grid.shape
    directions = (
        (-1, 0, 1.0),
        (1, 0, 1.0),
        (0, -1, 1.0),
        (0, 1, 1.0),
        (-1, -1, math.sqrt(2)),
        (-1, 1, math.sqrt(2)),
        (1, -1, math.sqrt(2)),
        (1, 1, math.sqrt(2)),
    )

    for row_offset, column_offset, movement_cost in directions:
        new_row = row + row_offset
        raw_column = column + column_offset

        if not 0 <= new_row < height:
            continue

        if wrap_columns:
            new_column = raw_column % width
        elif 0 <= raw_column < width:
            new_column = raw_column
        else:
            continue

        if grid[new_row, new_column] != WATER_VALUE:
            continue

        # A diagonal cannot squeeze between two blocked corner cells.
        if row_offset and column_offset:
            if (
                grid[row, new_column] != WATER_VALUE
                or grid[new_row, column] != WATER_VALUE
            ):
                continue

        yield (new_row, new_column), movement_cost


def find_nearest_water(
    grid,
    starting_cell,
    max_radius_cells=100,
    wrap_columns=False,
):
    starting_row, starting_column = starting_cell
    height, width = grid.shape

    if wrap_columns:
        starting_column %= width

    if (
        0 <= starting_row < height
        and 0 <= starting_column < width
        and grid[starting_row, starting_column] == WATER_VALUE
    ):
        return starting_row, starting_column

    for radius in range(1, max_radius_cells + 1):
        candidates = []
        for row in range(starting_row - radius, starting_row + radius + 1):
            if not 0 <= row < height:
                continue

            for raw_column in range(
                starting_column - radius,
                starting_column + radius + 1,
            ):
                if wrap_columns:
                    column = raw_column % width
                elif 0 <= raw_column < width:
                    column = raw_column
                else:
                    continue

                if grid[row, column] != WATER_VALUE:
                    continue

                distance = math.hypot(
                    row - starting_row,
                    raw_column - starting_column,
                )
                candidates.append((distance, (row, column)))

        if candidates:
            return min(candidates, key=lambda item: item[0])[1]

    raise RuntimeError("Could not find navigable water near the point.")


def _reconstruct_path(came_from, current):
    path = [current]
    while current in came_from:
        current = came_from[current]
        path.append(current)
    path.reverse()
    return path


def find_route(grid, start, destination, wrap_columns=False):
    height, width = grid.shape
    if not (0 <= start[0] < height and 0 <= destination[0] < height):
        raise ValueError("Start or destination row is outside the grid.")

    start = (start[0], start[1] % width)
    destination = (destination[0], destination[1] % width)

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
            return _reconstruct_path(came_from, current), len(visited)

        for neighbor, movement_cost in get_neighbors(
            grid, current, wrap_columns
        ):
            new_cost = cost_so_far[current] + movement_cost
            if neighbor not in cost_so_far or new_cost < cost_so_far[neighbor]:
                cost_so_far[neighbor] = new_cost
                came_from[neighbor] = current
                priority = new_cost + heuristic(
                    neighbor,
                    destination,
                    width,
                    wrap_columns,
                )
                heapq.heappush(frontier, (priority, neighbor))

    raise RuntimeError("No navigable route exists between the points.")
