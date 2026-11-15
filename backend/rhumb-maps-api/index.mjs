import crypto from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const TABLE_NAME = process.env.MAPS_TABLE_NAME || 'rhumb-maps';
const BUCKET_NAME = process.env.MAPS_BUCKET_NAME;
const PREVIEW_BUCKET_NAME = process.env.PREVIEW_BUCKET_NAME || 'bottle-of-rhumb-images';
const PREVIEW_FUNCTION_NAME = process.env.PREVIEW_FUNCTION_NAME;
const PUBLIC_MAP_BASE_URL = process.env.PUBLIC_MAP_BASE_URL
  || 'https://chadlanoway.github.io/Bottle_Of_Rhumb/';
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
const lambda = new LambdaClient({});

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
    if (routeKey === 'GET /maps') return listMaps(event);
    if (routeKey === 'POST /maps') return createMap(event);
    if (routeKey === 'PUT /maps/{mapId}') return updateMap(event, mapId);
    if (routeKey === 'DELETE /maps/{mapId}') return deleteMap(event, mapId);
    if (routeKey === 'POST /maps/{mapId}/preview') {
      return regeneratePreview(event, mapId);
    }
    if (routeKey === 'GET /maps/{mapId}/edit') {
      return getEditableMap(event, mapId);
    }
    if (routeKey === 'GET /maps/{mapId}') return getPublicMap(mapId);
    if (routeKey === 'GET /share/{mapId}') return getSharePage(event, mapId);
    return response(404, { error: 'Route not found.' });
  } catch (error) {
    console.error('Maps API error:', error);
    return response(500, {
      error: 'The map service encountered an unexpected error.',
    });
  }
};

async function listMaps(event) {
  const owner = authenticatedUser(event);
  if (!owner.id) return response(401, { error: 'Sign in to view your maps.' });

  const maps = [];
  let exclusiveStartKey;
  do {
    const result = await dynamo.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'ownerId = :ownerId',
      ExpressionAttributeValues: { ':ownerId': owner.id },
      ProjectionExpression: 'mapId, #title, #visibility, revision, createdAt, updatedAt, previewStatus, previewUrl, previewRevision, previewUpdatedAt',
      ExpressionAttributeNames: {
        '#title': 'title',
        '#visibility': 'visibility',
      },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    maps.push(...(result.Items || []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  maps.sort((first, second) => (
    String(second.updatedAt || '').localeCompare(String(first.updatedAt || ''))
  ));
  return response(200, { maps: maps.slice(0, 100) });
}

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

  if (metadata.previewStatus === 'pending') {
    await queuePreviewSafely(metadata);
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


  if (metadata.previewStatus === 'pending') {
    await queuePreviewSafely(metadata);
  }

  return response(200, { map: presentMap(document, metadata, true) });
}

async function deleteMap(event, mapId) {
  const owner = authenticatedUser(event);
  if (!owner.id) return response(401, { error: 'Sign in before deleting a map.' });
  if (!validMapId(mapId)) return response(400, { error: 'Invalid map ID.' });

  const existing = await getMetadata(mapId);
  if (!existing) return response(404, { error: 'Map not found.' });
  if (existing.ownerId !== owner.id) {
    return response(403, { error: 'Only the map owner can delete it.' });
  }

  await dynamo.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { mapId },
    ConditionExpression: 'ownerId = :ownerId AND revision = :revision',
    ExpressionAttributeValues: {
      ':ownerId': owner.id,
      ':revision': existing.revision,
    },
  }));
  await deleteMapDocuments(mapId);
  await deleteMapPreviews(mapId);
  return response(204, null);
}

async function regeneratePreview(event, mapId) {
  const owner = authenticatedUser(event);
  if (!owner.id) return response(401, { error: 'Sign in before regenerating a preview.' });
  if (!validMapId(mapId)) return response(400, { error: 'Invalid map ID.' });

  const existing = await getMetadata(mapId);
  if (!existing) return response(404, { error: 'Map not found.' });
  if (existing.ownerId !== owner.id) {
    return response(403, { error: 'Only the map owner can regenerate its preview.' });
  }
  if (existing.visibility !== 'published') {
    return response(400, { error: 'Publish the map before generating its social preview.' });
  }

  const previewToken = crypto.randomUUID();
  await dynamo.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { mapId },
    UpdateExpression: 'SET previewStatus = :pending, previewToken = :token, previewRevision = :revision REMOVE previewError',
    ConditionExpression: 'ownerId = :ownerId AND revision = :revision',
    ExpressionAttributeValues: {
      ':pending': 'pending',
      ':token': previewToken,
      ':revision': existing.revision,
      ':ownerId': owner.id,
    },
  }));

  const queued = { ...existing, previewStatus: 'pending', previewToken };
  await queuePreviewSafely(queued);
  const refreshed = await getMetadata(mapId);
  return response(202, { preview: presentPreview(refreshed || queued) });
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

async function getSharePage(event, mapId) {
  const metadata = validMapId(mapId) ? await getMetadata(mapId) : null;
  if (!metadata || metadata.visibility !== 'published') {
    return htmlResponse(404, shareErrorHtml('Published map not found'));
  }

  const viewerUrl = mapViewerUrl(mapId);
  const shareUrl = requestUrl(event);
  const title = metadata.title || 'Bottle of Rhumb map';
  const description = metadata.description
    || 'Explore this interactive map created with Bottle of Rhumb.';
  const imageUrl = metadata.previewStatus === 'ready' ? metadata.previewUrl : '';
  return htmlResponse(200, sharePageHtml({
    title,
    description,
    imageUrl,
    shareUrl,
    viewerUrl,
  }));
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

async function deleteMapDocuments(mapId) {
  const prefix = `maps/${mapId}/`;
  let continuationToken;
  do {
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const objects = (listed.Contents || [])
      .filter((object) => object.Key)
      .map((object) => ({ Key: object.Key }));
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: { Objects: objects, Quiet: true },
      }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function deleteMapPreviews(mapId) {
  if (!PREVIEW_BUCKET_NAME) return;
  const prefix = `map-previews/${mapId}/`;
  let continuationToken;
  do {
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: PREVIEW_BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const objects = (listed.Contents || [])
      .filter((object) => object.Key)
      .map((object) => ({ Key: object.Key }));
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: PREVIEW_BUCKET_NAME,
        Delete: { Objects: objects, Quiet: true },
      }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function queuePreviewSafely(metadata) {
  if (!PREVIEW_FUNCTION_NAME) {
    await markPreviewFailed(metadata, 'PREVIEW_FUNCTION_NAME is not configured.');
    return;
  }
  try {
    await lambda.send(new InvokeCommand({
      FunctionName: PREVIEW_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({
        mapId: metadata.mapId,
        revision: metadata.revision,
        previewToken: metadata.previewToken,
      })),
    }));
  } catch (error) {
    console.error('Preview invocation failed:', error);
    await markPreviewFailed(metadata, 'The preview worker could not be started.');
  }
}

async function markPreviewFailed(metadata, message) {
  try {
    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { mapId: metadata.mapId },
      UpdateExpression: 'SET previewStatus = :failed, previewError = :message',
      ConditionExpression: 'revision = :revision AND previewToken = :token',
      ExpressionAttributeValues: {
        ':failed': 'failed',
        ':message': message,
        ':revision': metadata.revision,
        ':token': metadata.previewToken,
      },
    }));
  } catch (error) {
    console.error('Could not record preview failure:', error);
  }
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
    mapControls: isObject(input.mapControls) ? input.mapControls : {},
    layers: input.layers,
    activeLayerId: cleanText(input.activeLayerId, 100),
    featureCollection: input.featureCollection,
  };
}

function buildMetadata(document, owner) {
  const metadata = {
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
  if (document.visibility === 'published') {
    metadata.previewStatus = 'pending';
    metadata.previewRevision = document.revision;
    metadata.previewToken = crypto.randomUUID();
  } else {
    metadata.previewStatus = 'none';
  }
  return metadata;
}

function presentMap(document, metadata, editable) {
  return {
    ...document,
    mapId: metadata.mapId,
    revision: metadata.revision,
    visibility: metadata.visibility,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    ...presentPreview(metadata),
    editable,
  };
}

function presentPreview(metadata) {
  return {
    previewStatus: metadata?.previewStatus || 'none',
    previewUrl: metadata?.previewUrl || '',
    previewRevision: metadata?.previewRevision || null,
    previewUpdatedAt: metadata?.previewUpdatedAt || null,
    previewError: metadata?.previewError || '',
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

function mapViewerUrl(mapId) {
  const url = new URL(PUBLIC_MAP_BASE_URL);
  url.searchParams.set('map', mapId);
  url.searchParams.set('view', '1');
  return url.toString();
}

function requestUrl(event) {
  const domain = event?.requestContext?.domainName;
  const path = event?.rawPath || `/share/${event?.pathParameters?.mapId || ''}`;
  return domain ? `https://${domain}${path}` : path;
}

function sharePageHtml({ title, description, imageUrl, shareUrl, viewerUrl }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImageUrl = escapeHtml(imageUrl);
  const safeShareUrl = escapeHtml(shareUrl);
  const safeViewerUrl = escapeHtml(viewerUrl);
  const imageTags = imageUrl
    ? `
    <meta property="og:image" content="${safeImageUrl}">
    <meta property="og:image:secure_url" content="${safeImageUrl}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Preview of ${safeTitle}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${safeImageUrl}">`
    : '<meta name="twitter:card" content="summary">';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} | Bottle of Rhumb</title>
  <meta name="description" content="${safeDescription}">
  <link rel="canonical" href="${safeShareUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Bottle of Rhumb">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeShareUrl}">${imageTags}
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0e1b22; color: #eef7fb; font: 16px/1.5 system-ui, sans-serif; }
    main { width: min(560px, calc(100% - 40px)); padding: 28px; border: 1px solid #426979; border-radius: 16px; background: #142a35; box-shadow: 0 18px 60px rgba(0,0,0,.35); }
    h1 { margin-top: 0; } a { color: #55b9ff; }
  </style>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeDescription}</p>
    <p>Opening the interactive map…</p>
    <p><a href="${safeViewerUrl}">Open map</a></p>
  </main>
  <script>window.setTimeout(function () { window.location.replace(${JSON.stringify(viewerUrl)}); }, 150);</script>
</body>
</html>`;
}

function shareErrorHtml(message) {
  const safeMessage = escapeHtml(message);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safeMessage}</title></head><body><h1>${safeMessage}</h1></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
    body,
  };
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: payload === null ? '' : JSON.stringify(payload),
  };
}
