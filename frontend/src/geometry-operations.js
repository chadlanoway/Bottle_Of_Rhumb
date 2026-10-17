const INTERNAL_PROPERTIES = new Set([
  'mode',
  'selected',
  'currentlyDrawing',
  'committedCoordinateCount',
  'provisionalCoordinateCount',
  'marker',
  'markerId',
]);

export function runGeometryOperation(input, operation, options = {}) {
  const features = (Array.isArray(input) ? input : [input]).filter((feature) => feature?.geometry);
  if (features.length === 0) throw new Error('Select at least one feature first.');
  const feature = features.at(-1);

  const coordinates = features.flatMap((candidate) => (
    flattenCoordinates(candidate.geometry.coordinates)
  ));
  if (coordinates.length === 0) throw new Error('The selected features have no coordinates.');

  switch (operation) {
    case 'centroid': {
      requireSingleFeature(features, 'Create centroid');
      const centroidCoordinates = coordinatesForCentroid(feature.geometry);

      return result([makeFeature(feature, 'centroid', {
        type: 'Point',
        coordinates: coordinateMean(centroidCoordinates),
      })], 'Centroid added.');
    }

    case 'extent':
      return result(
        [makeFeature(feature, 'extent', extentPolygon(coordinates), sourceProperties(features))],
        `Extent box added from ${featureCountLabel(features)}.`,
      );

    case 'hull': {
      const ring = convexHull(coordinates);
      if (ring.length < 4) {
        throw new Error('A convex hull needs at least three non-collinear coordinates.');
      }
      return result([makeFeature(feature, 'convex hull', {
        type: 'Polygon',
        coordinates: [ring],
      }, sourceProperties(features))], `Convex hull added from ${featureCountLabel(features)}.`);
    }

    case 'points': {
      let vertexNumber = 0;
      const points = features.flatMap((source) => (
        flattenCoordinates(source.geometry.coordinates).map((coordinate) => {
          vertexNumber += 1;
          return makeFeature(
            source,
            `vertex ${vertexNumber}`,
            { type: 'Point', coordinates: coordinate.map(roundCoordinate) },
            { vertexNumber, ...sourceProperties(features) },
          );
        })
      ));
      return result(points, `${points.length} vertex point${points.length === 1 ? '' : 's'} added.`);
    }

    case 'simplify': {
      requireSingleFeature(features, 'Simplify');
      if (!['LineString', 'Polygon'].includes(feature.geometry.type)) {
        throw new Error('Simplify works on lines and polygons.');
      }
      const tolerance = Number(options.tolerance);
      if (!Number.isFinite(tolerance) || tolerance <= 0) {
        throw new Error('Enter a simplify tolerance greater than zero.');
      }
      const geometry = simplifyGeometry(feature.geometry, tolerance);
      return result([makeFeature(feature, 'simplified', geometry, {
        simplifyTolerance: tolerance,
      })], 'Simplified copy added.');
    }

    default:
      throw new Error(`Unknown geometry operation: ${operation}`);
  }
}

function requireSingleFeature(features, operationName) {
  if (features.length !== 1) {
    throw new Error(`${operationName} works with one selected feature at a time.`);
  }
}

function featureCountLabel(features) {
  return `${features.length} selected feature${features.length === 1 ? '' : 's'}`;
}

function sourceProperties(features) {
  return {
    sourceFeatureIds: features
      .map((feature) => feature.id)
      .filter((id) => id !== null && id !== undefined),
  };
}

function coordinatesForCentroid(geometry) {
  if (geometry.type === 'Point') {
    return [geometry.coordinates];
  }

  if (geometry.type === 'LineString') {
    return geometry.coordinates;
  }

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.flatMap((ring) => {
      const first = ring[0];
      const last = ring.at(-1);

      const isClosed =
        first?.[0] === last?.[0] &&
        first?.[1] === last?.[1];

      return isClosed ? ring.slice(0, -1) : ring;
    });
  }

  return flattenCoordinates(geometry.coordinates);
}

function result(features, message) {
  return { type: 'FeatureCollection', features, message };
}

function makeFeature(source, suffix, geometry, extraProperties = {}) {
  const properties = Object.fromEntries(
    Object.entries(source.properties ?? {}).filter(([key]) => !INTERNAL_PROPERTIES.has(key)),
  );
  const baseName = properties.name || source.geometry.type;

  return {
    type: 'Feature',
    properties: {
      ...properties,
      ...extraProperties,
      name: `${baseName} — ${suffix}`,
      derivedFrom: source.id ?? null,
      featureType: undefined,
    },
    geometry,
  };
}

function flattenCoordinates(value, output = []) {
  if (!Array.isArray(value)) return output;
  if (Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    output.push([value[0], value[1]]);
    return output;
  }
  for (const child of value) flattenCoordinates(child, output);
  return output;
}

function coordinateMean(coordinates) {
  const total = coordinates.reduce(
    (sum, coordinate) => [
      sum[0] + coordinate[0],
      sum[1] + coordinate[1],
    ],
    [0, 0],
  );

  return [
    roundCoordinate(total[0] / coordinates.length),
    roundCoordinate(total[1] / coordinates.length),
  ];
}

function roundCoordinate(value) {
  return Number(value.toFixed(6));
}

function extentPolygon(coordinates) {
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  const latitudes = coordinates.map((coordinate) => coordinate[1]);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);

  if (west === east || south === north) {
    throw new Error('An extent box needs coordinates with both width and height.');
  }

  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

function convexHull(coordinates) {
  const points = [...new Map(
    coordinates.map((point) => [`${point[0]},${point[1]}`, point]),
  ).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  if (points.length < 3) return [];
  const lower = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length >= 3 ? [...hull, hull[0]] : [];
}

function cross(origin, a, b) {
  return (a[0] - origin[0]) * (b[1] - origin[1])
    - (a[1] - origin[1]) * (b[0] - origin[0]);
}

function simplifyGeometry(geometry, tolerance) {
  if (geometry.type === 'LineString') {
    return { ...geometry, coordinates: simplifyLine(geometry.coordinates, tolerance) };
  }

  const rings = geometry.coordinates.map((ring) => {
    const openRing = sameCoordinate(ring[0], ring.at(-1)) ? ring.slice(0, -1) : [...ring];
    let simplified = simplifyLine(openRing, tolerance);
    if (simplified.length < 3) simplified = openRing;
    return [...simplified, simplified[0]];
  });
  return { ...geometry, coordinates: rings };
}

function simplifyLine(coordinates, tolerance) {
  if (coordinates.length <= 2) return coordinates.map((coordinate) => [...coordinate]);
  const squareTolerance = tolerance * tolerance;
  const keep = new Set([0, coordinates.length - 1]);
  simplifySection(coordinates, 0, coordinates.length - 1, squareTolerance, keep);
  return coordinates.filter((_, index) => keep.has(index)).map((coordinate) => [...coordinate]);
}

function simplifySection(points, first, last, squareTolerance, keep) {
  let maxDistance = squareTolerance;
  let splitIndex = -1;
  for (let index = first + 1; index < last; index += 1) {
    const distance = segmentDistanceSquared(points[index], points[first], points[last]);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }
  if (splitIndex === -1) return;
  keep.add(splitIndex);
  simplifySection(points, first, splitIndex, squareTolerance, keep);
  simplifySection(points, splitIndex, last, squareTolerance, keep);
}

function segmentDistanceSquared(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;
  if (dx !== 0 || dy !== 0) {
    const ratio = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (ratio > 1) {
      x = end[0];
      y = end[1];
    } else if (ratio > 0) {
      x += dx * ratio;
      y += dy * ratio;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function sameCoordinate(a, b) {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1];
}
