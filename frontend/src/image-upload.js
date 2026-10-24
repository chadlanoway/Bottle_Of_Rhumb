import * as exifr from 'exifr';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let memoryDraftMapId = null;

export function isSupportedPopupImage(file) {
  return Boolean(file) && (
    ALLOWED_TYPES.has(file.type)
    || (file.type === '' && ALLOWED_EXTENSIONS.test(file.name ?? ''))
  );
}

export async function readImageGps(file) {
  if (!isSupportedPopupImage(file)) return null;

  try {
    const location = await exifr.gps(file);
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return {
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
    };
  } catch {
    return null;
  }
}

export async function uploadPopupImage(apiUrl, file, featureId) {
  if (!apiUrl) throw new Error('VITE_IMAGE_UPLOAD_API_URL is not configured.');
  if (!isSupportedPopupImage(file)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('The image must be 8 MB or smaller.');
  }

  const contentType = file.type || contentTypeFromName(file.name);

  const mapId = getDraftMapId();
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create-upload',
      mapId,
      featureId: String(featureId),
      contentType,
      fileSize: file.size,
    }),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(payload.error || `Upload setup failed (${response.status}).`);

  const upload = await fetch(payload.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      ...(payload.uploadHeaders || {}),
    },
    body: file,
  });
  if (!upload.ok) throw new Error(`S3 upload failed (${upload.status}).`);

  return {
    imageKey: payload.imageKey,
    imageUrl: payload.imageUrl,
    mapId,
  };
}

function contentTypeFromName(name = '') {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

function getDraftMapId() {
  const storageKey = 'rhumb-draft-map-id';

  try {
    let mapId = window.localStorage.getItem(storageKey);

    if (!mapId) {
      mapId = `draft-${crypto.randomUUID()}`;
      window.localStorage.setItem(storageKey, mapId);
    }

    return mapId;
  } catch {
    if (!memoryDraftMapId) {
      memoryDraftMapId = `draft-${crypto.randomUUID()}`;
    }

    return memoryDraftMapId;
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
