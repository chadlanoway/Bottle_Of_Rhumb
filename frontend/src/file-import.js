import toGeoJSON from '@mapbox/togeojson';
import Papa from 'papaparse';

const SUPPORTED_EXTENSION = /\.(geojson|json|kml|gpx|csv)$/i;
const LATITUDE_NAMES = ['latitude', 'lat', 'y', 'ycoord', 'y_coord'];
const LONGITUDE_NAMES = ['longitude', 'lon', 'lng', 'long', 'x', 'xcoord', 'x_coord'];
const NAME_NAMES = ['name', 'title', 'label', 'location', 'site'];
const FULL_ADDRESS_NAMES = ['address', 'full_address', 'formatted_address', 'mailing_address', 'location_address'];
const STREET_NAMES = ['street', 'street_address', 'address_1', 'address1', 'address_line_1', 'address_line1'];
const CITY_NAMES = ['city', 'town', 'village', 'municipality', 'locality'];
const STATE_NAMES = ['state', 'province', 'region', 'state_code'];
const POSTAL_NAMES = ['zip', 'zipcode', 'zip_code', 'postal', 'postcode', 'postal_code'];
const COUNTRY_NAMES = ['country', 'country_code'];

export function isSupportedSpatialFile(file) {
  return Boolean(file?.name && SUPPORTED_EXTENSION.test(file.name));
}

export function spatialFileLayerName(filename) {
  return filename.replace(SUPPORTED_EXTENSION, '') || 'Imported layer';
}

export async function readSpatialFile(file, options = {}) {
  if (!file) throw new Error('Choose a GeoJSON, KML, GPX, or CSV file.');

  const text = await file.text();
  const extension = file.name.split('.').pop()?.toLowerCase();
  let collection;

  if (extension === 'csv') {
    return readCsv(text, options);
  } else if (extension === 'geojson' || extension === 'json') {
    try {
      collection = JSON.parse(text);
    } catch (error) {
      throw new Error(`The JSON file could not be parsed: ${error.message}`);
    }
  } else if (extension === 'kml' || extension === 'gpx') {
    collection = convertXml(text, extension);
  } else {
    throw new Error('Unsupported file type. Use GeoJSON, JSON, KML, GPX, or CSV.');
  }

  const normalized = normalizeCollection(collection);
  if (normalized.features.length === 0) {
    throw new Error(`The ${extension?.toUpperCase() ?? 'selected'} file did not contain any supported map features.`);
  }
  return normalized;
}

async function readCsv(text, options) {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const fatal = parsed.errors.find((error) => error.type === 'Quotes' || error.type === 'Delimiter');
  if (fatal) throw new Error(`The CSV could not be parsed: ${fatal.message}`);

  const fields = (parsed.meta.fields ?? []).filter(Boolean);
  if (fields.length === 0) throw new Error('The CSV does not contain a header row.');

  const latitudeField = findColumn(fields, LATITUDE_NAMES);
  const longitudeField = findColumn(fields, LONGITUDE_NAMES);
  if (!latitudeField || !longitudeField) {
    return readAddressCsv(parsed.data, fields, options);
  }

  const nameField = findColumn(fields, NAME_NAMES);
  const features = [];
  const skippedRows = [];
  let skippedRowCount = 0;

  parsed.data.forEach((row, index) => {
    const latitude = parseCoordinate(row[latitudeField]);
    const longitude = parseCoordinate(row[longitudeField]);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      skippedRowCount += 1;
      if (skippedRows.length < 100) skippedRows.push(index + 2);
      return;
    }

    const properties = {};
    for (const field of fields) {
      properties[field] = coerceCsvValue(row[field]);
    }
    properties.source = 'csv-import';
    properties.csvRow = index + 2;
    if (nameField && String(row[nameField] ?? '').trim()) {
      properties.name = String(row[nameField]).trim();
    }

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          Number(longitude.toFixed(6)),
          Number(latitude.toFixed(6)),
        ],
      },
      properties,
    });
  });

  if (features.length === 0) {
    throw new Error('The CSV did not contain any valid latitude/longitude rows.');
  }

  return {
    type: 'FeatureCollection',
    features,
    importReport: {
      type: 'csv',
      totalRows: parsed.data.length,
      importedRows: features.length,
      skippedRows,
      skippedRowCount,
      latitudeField,
      longitudeField,
      numericFields: findNumericFields(features, fields),
    },
  };
}

async function readAddressCsv(rows, fields, options) {
  if (typeof options.geocodeAddresses !== 'function') {
    throw new Error(
      'This CSV does not contain latitude/longitude columns. Configure the address-geocoding API to import address-only CSV files.',
    );
  }

  const fullAddressField = findColumn(fields, FULL_ADDRESS_NAMES);
  const componentFields = [
    findColumn(fields, STREET_NAMES),
    findColumn(fields, CITY_NAMES),
    findColumn(fields, STATE_NAMES),
    findColumn(fields, POSTAL_NAMES),
    findColumn(fields, COUNTRY_NAMES),
  ].filter(Boolean);
  const addressFields = fullAddressField ? [fullAddressField] : [...new Set(componentFields)];
  if (addressFields.length === 0) {
    throw new Error(
      'No coordinate or address columns were found. Use latitude/longitude, an address column, or street/city/state/ZIP columns.',
    );
  }

  const candidates = [];
  const skippedRows = [];
  let skippedRowCount = 0;
  rows.forEach((row, index) => {
    const address = addressFields
      .map((field) => String(row[field] ?? '').trim())
      .filter(Boolean)
      .join(', ');
    if (!address) {
      skippedRowCount += 1;
      if (skippedRows.length < 100) skippedRows.push(index + 2);
      return;
    }
    candidates.push({ row, rowNumber: index + 2, address });
  });

  if (candidates.length === 0) {
    throw new Error('The CSV did not contain any non-empty addresses to geocode.');
  }
  if (candidates.length > 1000) {
    throw new Error('Address CSV imports are limited to 1,000 non-empty rows per file.');
  }

  const results = await options.geocodeAddresses(candidates.map((candidate) => candidate.address));
  if (!Array.isArray(results)) throw new Error('The geocoding service returned an invalid result.');

  const nameField = findColumn(fields, NAME_NAMES);
  const features = [];
  const unmatchedRows = [];
  let unmatchedRowCount = 0;
  candidates.forEach((candidate, index) => {
    const result = results[index];
    const latitude = Number(result?.lat);
    const longitude = Number(result?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      skippedRowCount += 1;
      unmatchedRowCount += 1;
      if (skippedRows.length < 100) skippedRows.push(candidate.rowNumber);
      if (unmatchedRows.length < 100) unmatchedRows.push(candidate.rowNumber);
      return;
    }

    const properties = {};
    for (const field of fields) properties[field] = coerceCsvValue(candidate.row[field]);
    properties.source = 'csv-geocoded';
    properties.csvRow = candidate.rowNumber;
    properties.geocodedAddress = result.formatted ?? candidate.address;
    properties.geocodingConfidence = Number.isFinite(result.rank?.confidence)
      ? result.rank.confidence
      : null;
    properties.geocodingMatchType = result.rank?.match_type ?? null;
    properties.geocodingResultType = result.result_type ?? null;
    properties.geocodingPlaceId = result.place_id ?? null;
    if (nameField && String(candidate.row[nameField] ?? '').trim()) {
      properties.name = String(candidate.row[nameField]).trim();
    }

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))],
      },
      properties,
    });
  });

  if (features.length === 0) {
    throw new Error('Geoapify could not match any of the addresses in this CSV.');
  }

  return {
    type: 'FeatureCollection',
    features,
    importReport: {
      type: 'csv',
      coordinateSource: 'geoapify',
      totalRows: rows.length,
      importedRows: features.length,
      geocodedRows: features.length,
      skippedRows,
      skippedRowCount,
      unmatchedRows,
      unmatchedRowCount,
      addressFields,
      latitudeField: null,
      longitudeField: null,
      numericFields: findNumericFields(features, fields),
    },
  };
}

function normalizeColumnName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function findColumn(fields, aliases) {
  return fields.find((field) => aliases.includes(normalizeColumnName(field))) ?? null;
}

function parseCoordinate(value) {
  if (typeof value === 'number') return value;
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  return normalized === '' ? Number.NaN : Number(normalized);
}

function coerceCsvValue(value) {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text.replace(/,/g, ''))) {
    const number = Number(text.replace(/,/g, ''));
    if (Number.isFinite(number)) return number;
  }
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  return text;
}

function findNumericFields(features, fields) {
  return fields.filter((field) => {
    const values = features
      .map((feature) => feature.properties?.[field])
      .filter((value) => value !== null && value !== undefined);
    return values.length > 0 && values.every(Number.isFinite);
  });
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
