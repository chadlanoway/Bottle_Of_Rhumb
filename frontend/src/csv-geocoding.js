const GEOCODING_API_URL = String(import.meta.env.VITE_GEOCODING_API_URL || '').trim();
const MAX_POLL_ATTEMPTS = 60;

export async function geocodeCsvAddresses(addresses, accessToken, onStatus = () => {}) {
  if (!GEOCODING_API_URL) {
    throw new Error('VITE_GEOCODING_API_URL is not configured.');
  }
  if (!accessToken) {
    throw new Error('Sign in before importing a CSV that needs address geocoding.');
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('No addresses were provided for geocoding.');
  }

  onStatus(`Submitting ${addresses.length.toLocaleString()} address${addresses.length === 1 ? '' : 'es'}…`);
  const submitted = await request({ action: 'submit', addresses }, accessToken);
  if (submitted.status === 'complete') return submitted.results ?? [];
  if (!submitted.jobId) throw new Error('The geocoding service did not return a job ID.');

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const delay = attempt < 3 ? 3000 : attempt < 10 ? 5000 : 10000;
    onStatus(`Geocoding addresses… ${attempt === 0 ? 'job submitted' : `check ${attempt + 1}`}`);
    await wait(delay);
    const result = await request({ action: 'status', jobId: submitted.jobId }, accessToken);
    if (result.status === 'complete') return result.results ?? [];
    if (result.status !== 'pending') {
      throw new Error(result.error || 'The geocoding job failed.');
    }
  }

  throw new Error('The geocoding job did not finish within the five-minute wait period.');
}

async function request(body, accessToken) {
  const response = await fetch(GEOCODING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Geocoding request failed (${response.status}).`);
  }
  return payload;
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
