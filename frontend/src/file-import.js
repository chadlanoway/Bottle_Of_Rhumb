import toGeoJSON from '@mapbox/togeojson';

const SUPPORTED_EXTENSION = /\.(geojson|json|kml|gpx)$/i;

export function isSupportedSpatialFile(file) {
  return Boolean(file?.name && SUPPORTED_EXTENSION.test(file.name));
}

export function spatialFileLayerName(filename) {
  return filename.replace(SUPPORTED_EXTENSION, '') || 'Imported layer';
}

export async function readSpatialFile(file) {
  if (!file) throw new Error('Choose a GeoJSON, KML, or GPX file.');

  const text = await file.text();
  const extension = file.name.split('.').pop()?.toLowerCase();
  let collection;

  if (extension === 'geojson' || extension === 'json') {
    try {
      collection = JSON.parse(text);
    } catch (error) {
      throw new Error(`The JSON file could not be parsed: ${error.message}`);
    }
  } else if (extension === 'kml' || extension === 'gpx') {
    collection = convertXml(text, extension);
  } else {
    throw new Error('Unsupported file type. Use GeoJSON, JSON, KML, or GPX.');
  }

  const normalized = normalizeCollection(collection);
  if (normalized.features.length === 0) {
    throw new Error(`The ${extension?.toUpperCase() ?? 'selected'} file did not contain any supported map features.`);
  }
  return normalized;
}

function convertXml(text, extension) {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = document.querySelector('parsererror');
  if (parserError) {
    throw new Error(`The ${extension.toUpperCase()} file contains invalid XML.`);
  }

  const rootName = document.documentElement?.localName?.toLowerCase();
  if (extension === 'kml' && rootName !== 'kml') {
    throw new Error('The selected file does not appear to be valid KML.');
  }
  if (extension === 'gpx' && rootName !== 'gpx') {
    throw new Error('The selected file does not appear to be valid GPX.');
  }

  return extension === 'kml'
    ? toGeoJSON.kml(document)
    : toGeoJSON.gpx(document);
}

function normalizeCollection(value) {
  if (!value || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error('The imported data did not produce a valid GeoJSON FeatureCollection.');
  }

  return {
    type: 'FeatureCollection',
    features: value.features.flatMap((feature, index) => normalizeFeature(feature, index)),
  };
}

function normalizeFeature(feature, sourceIndex) {
  if (!feature || feature.type !== 'Feature' || !feature.geometry) return [];
  return explodeGeometry(feature.geometry).map((geometry, partIndex) => ({
    type: 'Feature',
    properties: {
      ...(feature.properties ?? {}),
      ...(partIndex > 0 ? { importedPart: partIndex + 1 } : {}),
    },
    geometry: roundGeometry(geometry),
    id: feature.id ?? undefined,
    _sourceIndex: sourceIndex,
  })).map(({ _sourceIndex, ...normalized }) => normalized);
}

function explodeGeometry(geometry) {
  const coordinates = geometry.coordinates;
  switch (geometry.type) {
    case 'Point':
    case 'LineString':
    case 'Polygon':
      return [geometry];
    case 'MultiPoint':
      return coordinates.map((point) => ({ type: 'Point', coordinates: point }));
    case 'MultiLineString':
      return coordinates.map((line) => ({ type: 'LineString', coordinates: line }));
    case 'MultiPolygon':
      return coordinates.map((polygon) => ({ type: 'Polygon', coordinates: polygon }));
    case 'GeometryCollection':
      return (geometry.geometries ?? []).flatMap(explodeGeometry);
    default:
      return [];
  }
}

function roundGeometry(geometry) {
  return {
    ...geometry,
    coordinates: roundCoordinates(geometry.coordinates),
  };
}

function roundCoordinates(value) {
  if (!Array.isArray(value)) return value;
  if (Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    return [
      Number(value[0].toFixed(6)),
      Number(value[1].toFixed(6)),
    ];
  }
  return value.map(roundCoordinates);
}
