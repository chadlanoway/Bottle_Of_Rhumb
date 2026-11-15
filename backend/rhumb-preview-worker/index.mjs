import { chromium } from 'playwright';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const TABLE_NAME = process.env.MAPS_TABLE_NAME || 'rhumb-maps';
const PREVIEW_BUCKET_NAME = process.env.PREVIEW_BUCKET_NAME;
const PREVIEW_CDN_BASE_URL = trimSlash(process.env.PREVIEW_CDN_BASE_URL || '');
const PUBLIC_MAP_BASE_URL = process.env.PUBLIC_MAP_BASE_URL
  || 'https://chadlanoway.github.io/Bottle_Of_Rhumb/';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

export async function handler(event) {
  const mapId = cleanId(event?.mapId);
  const revision = Number(event?.revision);
  const previewToken = String(event?.previewToken || '');

  if (!PREVIEW_BUCKET_NAME || !PREVIEW_CDN_BASE_URL) {
    throw new Error('PREVIEW_BUCKET_NAME and PREVIEW_CDN_BASE_URL are required.');
  }
  if (!mapId || !Number.isInteger(revision) || revision < 1 || !previewToken) {
    throw new Error('mapId, revision, and previewToken are required.');
  }

  const metadata = await getMetadata(mapId);
  if (
    !metadata
    || metadata.visibility !== 'published'
    || Number(metadata.revision) !== revision
    || metadata.previewToken !== previewToken
  ) {
    console.log('Ignoring stale or unpublished preview request.', { mapId, revision });
    return { ignored: true };
  }

  await updateStatus(mapId, revision, previewToken, 'processing');
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
        '--use-gl=swiftshader',
      ],
    });

    const page = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });
    page.on('console', (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => console.error('[browser:pageerror]', error));

    const viewerUrl = buildViewerUrl(mapId, revision);
    await page.goto(viewerUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => window.__RHUMB_SCREENSHOT_READY__ === true,
      null,
      { timeout: 75_000 },
    );
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(750);

    const jpeg = await page.screenshot({
      type: 'jpeg',
      quality: 88,
      fullPage: false,
      animations: 'disabled',
    });
    const generatedAt = new Date().toISOString();
    const stamp = Date.now();
    const key = `map-previews/${mapId}/revision-${String(revision).padStart(8, '0')}-${stamp}.jpg`;
    const previewUrl = `${PREVIEW_CDN_BASE_URL}/${key}`;

    await s3.send(new PutObjectCommand({
      Bucket: PREVIEW_BUCKET_NAME,
      Key: key,
      Body: jpeg,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
      ServerSideEncryption: 'AES256',
      Metadata: {
        mapid: mapId,
        revision: String(revision),
      },
    }));

    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { mapId },
      UpdateExpression: 'SET previewStatus = :ready, previewKey = :key, previewUrl = :url, previewRevision = :revision, previewUpdatedAt = :updatedAt REMOVE previewError',
      ConditionExpression: 'revision = :revision AND previewToken = :token',
      ExpressionAttributeValues: {
        ':ready': 'ready',
        ':key': key,
        ':url': previewUrl,
        ':revision': revision,
        ':updatedAt': generatedAt,
        ':token': previewToken,
      },
    }));

    return { mapId, revision, previewUrl };
  } catch (error) {
    console.error('Preview generation failed:', error);
    await updateStatus(
      mapId,
      revision,
      previewToken,
      'failed',
      cleanError(error),
    );
    throw error;
  } finally {
    await browser?.close();
  }
}

async function getMetadata(mapId) {
  const result = await dynamo.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { mapId },
    ConsistentRead: true,
  }));
  return result.Item || null;
}

async function updateStatus(mapId, revision, previewToken, status, errorMessage = '') {
  const values = {
    ':status': status,
    ':revision': revision,
    ':token': previewToken,
  };
  const update = errorMessage
    ? 'SET previewStatus = :status, previewError = :error'
    : 'SET previewStatus = :status REMOVE previewError';
  if (errorMessage) values[':error'] = errorMessage;

  try {
    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { mapId },
      UpdateExpression: update,
      ConditionExpression: 'revision = :revision AND previewToken = :token',
      ExpressionAttributeValues: values,
    }));
  } catch (error) {
    if (error.name !== 'ConditionalCheckFailedException') throw error;
    console.log('Preview status update ignored because a newer save exists.');
  }
}

function buildViewerUrl(mapId, revision) {
  const url = new URL(PUBLIC_MAP_BASE_URL);
  url.searchParams.set('map', mapId);
  url.searchParams.set('view', '1');
  url.searchParams.set('capture', '1');
  url.searchParams.set('revision', String(revision));
  return url.toString();
}

function cleanId(value) {
  const text = String(value || '');
  return /^[A-Za-z0-9_-]{8,80}$/.test(text) ? text : '';
}

function cleanError(error) {
  return String(error?.message || 'Preview generation failed.').slice(0, 500);
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}
