import crypto from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const TABLE_NAME = process.env.MAPS_TABLE_NAME || 'rhumb-maps';
const BUCKET_NAME = process.env.MAPS_BUCKET_NAME;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

export const handler = async (event) => {
  try {
    if (!BUCKET_NAME) {
      return response(500, { error: 'MAPS_BUCKET_NAME is not configured.' });
    }

    const method = event?.requestContext?.http?.method || event?.httpMethod;
    const routeKey = event?.routeKey
      || `${method} ${event?.resource || event?.rawPath}`;
    const mapId = event?.pathParameters?.mapId;

    if (method === 'OPTIONS') return response(204, null);
    if (routeKey === 'POST /maps') return createMap(event);
    if (routeKey === 'PUT /maps/{mapId}') return updateMap(event, mapId);
    if (routeKey === 'GET /maps/{mapId}/edit') {
      return getEditableMap(event, mapId);
    }
    if (routeKey === 'GET /maps/{mapId}') return getPublicMap(mapId);
    return response(404, { error: 'Route not found.' });
  } catch (error) {
    console.error('Maps API error:', error);
    return response(500, {
      error: 'The map service encountered an unexpected error.',
    });
  }
};

async function createMap(event) {
  const owner = authenticatedUser(event);
  if (!owner.id) return response(401, { error: 'Sign in before saving a map.' });

  const input = parseBody(event.body);
  const validationError = validateInput(input);
  if (validationError) return response(400, { error: validationError });

  const mapId = crypto.randomUUID();
  const revision = 1;
  const now = new Date().toISOString();
  const documentKey = revisionKey(mapId, revision);
  const document = buildDocument(input, {
    mapId,
    revision,
    createdAt: now,
    updatedAt: now,
  });
  const metadata = buildMetadata(document, {
    ownerId: owner.id,
    ownerEmail: owner.email,
    documentKey,
  });

  await writeDocument(documentKey, document);
  try {
    await dynamo.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: metadata,
      ConditionExpression: 'attribute_not_exists(mapId)',
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return response(409, { error: 'That map ID is already in use. Save again.' });
    }
    throw error;
  }

  return response(201, { map: presentMap(document, metadata, true) });
}

async function updateMap(event, mapId) {
  const owner = authenticatedUser(event);
  if (!owner.id) return response(401, { error: 'Sign in before updating a map.' });
  if (!validMapId(mapId)) return response(400, { error: 'Invalid map ID.' });

  const existing = await getMetadata(mapId);
  if (!existing) return response(404, { error: 'Map not found.' });
  if (existing.ownerId !== owner.id) {
    return response(403, { error: 'Only the map owner can update it.' });
  }

  const input = parseBody(event.body);
  const validationError = validateInput(input);
  if (validationError) return response(400, { error: validationError });
  if (Number(input.revision) !== Number(existing.revision)) {
    return response(409, {
      error: 'This map changed in another tab. Reload it before saving again.',
    });
  }

  const revision = existing.revision + 1;
  const documentKey = revisionKey(mapId, revision);
  const document = buildDocument(input, {
    mapId,
    revision,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  const metadata = buildMetadata(document, {
    ownerId: owner.id,
    ownerEmail: existing.ownerEmail || owner.email,
    documentKey,
  });

  await writeDocument(documentKey, document);
  try {
    await dynamo.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: metadata,
      ConditionExpression: 'ownerId = :ownerId AND revision = :revision',
      ExpressionAttributeValues: {
        ':ownerId': owner.id,
        ':revision': existing.revision,
      },
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return response(409, {
        error: 'This map changed while it was being saved. Reload and try again.',
      });
    }
    throw error;
  }

  return response(200, { map: presentMap(document, metadata, true) });
}

async function getEditableMap(event, mapId) {
  const owner = authenticatedUser(event);
  if (!owner.id) return response(401, { error: 'Sign in to edit this map.' });
  const metadata = validMapId(mapId) ? await getMetadata(mapId) : null;
  if (!metadata) return response(404, { error: 'Map not found.' });
  if (metadata.ownerId !== owner.id) {
    return response(403, { error: 'Only the map owner can edit it.' });
  }
  const document = await readDocument(metadata.documentKey);
  return response(200, { map: presentMap(document, metadata, true) });
}

async function getPublicMap(mapId) {
  const metadata = validMapId(mapId) ? await getMetadata(mapId) : null;
  if (!metadata || metadata.visibility !== 'published') {
    return response(404, { error: 'Published map not found.' });
  }
  const document = await readDocument(metadata.documentKey);
  return response(200, { map: presentMap(document, metadata, false) });
}

async function getMetadata(mapId) {
  const result = await dynamo.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { mapId },
  }));
  return result.Item || null;
}

async function writeDocument(key, document) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(document),
    ContentType: 'application/json; charset=utf-8',
    ServerSideEncryption: 'AES256',
  }));
}

async function readDocument(key) {
  const result = await s3.send(new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  }));
  return JSON.parse(await result.Body.transformToString());
}

function buildDocument(input, identity) {
  return {
    ...identity,
    schemaVersion: 2,
    title: cleanText(input.title, 120) || 'Untitled map',
    description: cleanText(input.description, 1_000),
    visibility: input.visibility === 'published' ? 'published' : 'draft',
    basemapId: cleanText(input.basemapId, 60) || 'positron',
    projection: input.projection === 'globe' ? 'globe' : 'mercator',
    view: normalizeView(input.view),
    legend: isObject(input.legend) ? input.legend : {},
    layers: input.layers,
    activeLayerId: cleanText(input.activeLayerId, 100),
    featureCollection: input.featureCollection,
  };
}

function buildMetadata(document, owner) {
  return {
    mapId: document.mapId,
    ownerId: owner.ownerId,
    ownerEmail: owner.ownerEmail,
    title: document.title,
    description: document.description,
    visibility: document.visibility,
    revision: document.revision,
    schemaVersion: document.schemaVersion,
    documentKey: owner.documentKey,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function presentMap(document, metadata, editable) {
  return {
    ...document,
    mapId: metadata.mapId,
    revision: metadata.revision,
    visibility: metadata.visibility,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    editable,
  };
}

function validateInput(input) {
  if (!isObject(input)) return 'The request body must be a JSON object.';
  if (!Array.isArray(input.layers)) return 'layers must be an array.';
  if (input.layers.length > 250) return 'A map may contain at most 250 layers.';
  if (
    input.featureCollection?.type !== 'FeatureCollection'
    || !Array.isArray(input.featureCollection.features)
  ) {
    return 'featureCollection must be a valid GeoJSON FeatureCollection.';
  }
  if (input.featureCollection.features.length > 50_000) {
    return 'A map may contain at most 50,000 features.';
  }
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_DOCUMENT_BYTES) {
    return 'This map exceeds the current 5 MB save limit.';
  }
  return null;
}

function authenticatedUser(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims || {};
  return {
    id: claims.sub || null,
    email: cleanText(claims.email, 320),
  };
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try { return JSON.parse(body); } catch { return {}; }
}

function validMapId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

function revisionKey(mapId, revision) {
  return `maps/${mapId}/revisions/${String(revision).padStart(8, '0')}.json`;
}

function normalizeView(value) {
  if (!isObject(value) || !Array.isArray(value.center)) return null;
  const center = [Number(value.center[0]), Number(value.center[1])];
  if (!center.every(Number.isFinite)) return null;
  return {
    center,
    zoom: finiteNumber(value.zoom, 0),
    bearing: finiteNumber(value.bearing, 0),
    pitch: finiteNumber(value.pitch, 0),
  };
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    },
    body: payload === null ? '' : JSON.stringify(payload),
  };
}
