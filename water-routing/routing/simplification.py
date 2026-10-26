from .pathfinding import WATER_VALUE


def unwrap_route_columns(route, width):
    if not route:
        return []

    unwrapped = [route[0]]
    previous_column = route[0][1]

    for row, wrapped_column in route[1:]:
        candidates = (
            wrapped_column - width,
            wrapped_column,
            wrapped_column + width,
        )
        column = min(candidates, key=lambda value: abs(value - previous_column))
        unwrapped.append((row, column))
        previous_column = column

    return unwrapped


def line_is_clear(grid, start, end, wrap_columns=False):
    start_row, start_column = start
    end_row, end_column = end
    height, width = grid.shape

    row_difference = end_row - start_row
    column_difference = end_column - start_column
    steps = max(abs(row_difference), abs(column_difference)) * 4
    if steps == 0:
        return True

    previous_row = start_row
    previous_column = start_column

    for step in range(steps + 1):
        fraction = step / steps
        row = round(start_row + row_difference * fraction)
        column = round(start_column + column_difference * fraction)

        if not 0 <= row < height:
            return False

        wrapped_column = column % width if wrap_columns else column
        if not 0 <= wrapped_column < width:
            return False
        if grid[row, wrapped_column] != WATER_VALUE:
            return False

        previous_wrapped = (
            previous_column % width if wrap_columns else previous_column
        )

        if row != previous_row and column != previous_column:
            if (
                grid[previous_row, wrapped_column] != WATER_VALUE
                or grid[row, previous_wrapped] != WATER_VALUE
            ):
                return False

        previous_row = row
        previous_column = column

    return True


def simplify_route(grid, route, wrap_columns=False):
    if len(route) <= 2:
        return route

    working_route = (
        unwrap_route_columns(route, grid.shape[1])
        if wrap_columns
        else route
    )

    simplified = [working_route[0]]
    current_index = 0
    final_index = len(working_route) - 1

    while current_index < final_index:
        next_index = final_index
        while next_index > current_index + 1:
            if line_is_clear(
                grid,
                working_route[current_index],
                working_route[next_index],
                wrap_columns,
            ):
                break
            next_index -= 1

        simplified.append(working_route[next_index])
        current_index = next_index

    return simplified
