const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let memoryDraftMapId = null;

export async function uploadPopupImage(apiUrl, file, featureId) {
  if (!apiUrl) throw new Error('VITE_IMAGE_UPLOAD_API_URL is not configured.');
  if (!file || !ALLOWED_TYPES.has(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('The image must be 8 MB or smaller.');
  }

  const mapId = getDraftMapId();
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create-upload',
      mapId,
      featureId: String(featureId),
      contentType: file.type,
      fileSize: file.size,
    }),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(payload.error || `Upload setup failed (${response.status}).`);

  const upload = await fetch(payload.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
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
