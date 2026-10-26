from pyproj import Geod, Transformer


WGS84_GEOD = Geod(ellps="WGS84")


def coordinate_to_cell(dataset, lng_lat):
    transformer = Transformer.from_crs(
        "EPSG:4326", dataset.crs, always_xy=True
    )
    x_coordinate, y_coordinate = transformer.transform(*lng_lat)
    return dataset.index(x_coordinate, y_coordinate)


def cell_center(dataset, cell):
    row, column = cell
    return dataset.xy(row, column, offset="center")


def cells_to_projected_coordinates(dataset, cells):
    return [cell_center(dataset, cell) for cell in cells]


def normalize_longitude(longitude):
    return ((longitude + 180.0) % 360.0) - 180.0


def projected_to_wgs84(dataset, coordinates):
    transformer = Transformer.from_crs(
        dataset.crs, "EPSG:4326", always_xy=True
    )
    return [
        [normalize_longitude(longitude), latitude]
        for longitude, latitude in (
            transformer.transform(x_coordinate, y_coordinate)
            for x_coordinate, y_coordinate in coordinates
        )
    ]


def geodesic_distance_meters(coordinates):
    distance = 0.0
    for first, second in zip(coordinates, coordinates[1:]):
        _, _, segment_distance = WGS84_GEOD.inv(
            first[0], first[1], second[0], second[1]
        )
        distance += segment_distance
    return distance


def antimeridian_safe_geometry(coordinates):
    """
    Return a GeoJSON LineString or an antimeridian-safe MultiLineString.

    Coordinates must already have longitudes normalized to -180..180.
    When consecutive vertices jump more than 180 degrees, the segment is
    split at the dateline and continued from the opposite map edge.
    """
    if len(coordinates) < 2:
        raise ValueError("A route requires at least two coordinates.")

    segments = [[list(coordinates[0])]]

    for previous, current in zip(coordinates, coordinates[1:]):
        previous_longitude, previous_latitude = previous[:2]
        current_longitude, current_latitude = current[:2]
        longitude_jump = current_longitude - previous_longitude

        if abs(longitude_jump) <= 180.0:
            segments[-1].append(list(current))
            continue

        if longitude_jump < -180.0:
            # Eastward crossing: 179E to 179W.
            unwrapped_current = current_longitude + 360.0
            boundary = 180.0
            opposite_boundary = -180.0
        else:
            # Westward crossing: 179W to 179E.
            unwrapped_current = current_longitude - 360.0
            boundary = -180.0
            opposite_boundary = 180.0

        fraction = (
            (boundary - previous_longitude)
            / (unwrapped_current - previous_longitude)
        )
        crossing_latitude = previous_latitude + fraction * (
            current_latitude - previous_latitude
        )

        segments[-1].append([boundary, crossing_latitude])
        segments.append(
            [
                [opposite_boundary, crossing_latitude],
                list(current),
            ]
        )

    if len(segments) == 1:
        return {
            "type": "LineString",
            "coordinates": segments[0],
        }

    return {
        "type": "MultiLineString",
        "coordinates": segments,
    }
