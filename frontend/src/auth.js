const TOKEN_KEY = 'rhumb-cognito-session';
const PKCE_KEY = 'rhumb-cognito-pkce';

export async function initializeAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');

  if (code) {
    const pending = readSession(PKCE_KEY);
    if (!pending || pending.state !== returnedState) {
      throw new Error('The Cognito sign-in response could not be verified. Sign in again.');
    }

    const session = await exchangeCode(code, pending.verifier);
    writeLocal(TOKEN_KEY, session);
    removeSession(PKCE_KEY);
    window.history.replaceState({}, '', pending.returnUrl || appUrl());
    return describeSession(session);
  }

  let stored = readLocal(TOKEN_KEY);
  if (!stored?.access_token) return null;

  if (tokenExpired(stored.access_token)) {
    if (!stored.refresh_token) {
      removeLocal(TOKEN_KEY);
      return null;
    }
    try {
      const refreshed = await refreshTokens(stored.refresh_token);
      stored = { ...stored, ...refreshed, refresh_token: stored.refresh_token };
      writeLocal(TOKEN_KEY, stored);
    } catch {
      removeLocal(TOKEN_KEY);
      return null;
    }
  }

  return describeSession(stored);
}

export async function signIn(mode = 'login') {
  const config = getConfig();
  const verifier = randomUrlSafe(64);
  const state = randomUrlSafe(32);
  const challenge = await sha256UrlSafe(verifier);
  writeSession(PKCE_KEY, {
    verifier,
    state,
    returnUrl: `${window.location.pathname}${window.location.search}`,
  });

  const path = mode === 'signup' ? '/signup' : '/oauth2/authorize';
  const url = new URL(path, `${config.domain}/`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  window.location.assign(url.toString());
}

export function signOut() {
  const config = getConfig();
  removeLocal(TOKEN_KEY);
  const url = new URL('/logout', `${config.domain}/`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('logout_uri', config.redirectUri);
  window.location.assign(url.toString());
}

async function exchangeCode(code, verifier) {
  const config = getConfig();
  return tokenRequest(config, {
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
  });
}

async function refreshTokens(refreshToken) {
  const config = getConfig();
  return tokenRequest(config, {
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
  });
}

async function tokenRequest(config, values) {
  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.error_description || 'Cognito sign-in failed.');
  }
  return payload;
}

function describeSession(tokens) {
  const claims = decodeJwt(tokens.id_token || tokens.access_token);
  return {
    accessToken: tokens.access_token,
    email: claims.email
      || claims.username
      || claims['cognito:username']
      || 'Signed-in user',
    subject: claims.sub,
  };
}

function getConfig() {
  const domain = String(import.meta.env.VITE_COGNITO_DOMAIN || '').replace(/\/$/, '');
  const clientId = String(import.meta.env.VITE_COGNITO_CLIENT_ID || '');
  if (!domain || !clientId) {
    throw new Error(
      'Cognito is not configured. Add VITE_COGNITO_DOMAIN and VITE_COGNITO_CLIENT_ID.',
    );
  }
  return {
    domain,
    clientId,
    redirectUri: import.meta.env.VITE_COGNITO_REDIRECT_URI || appUrl(),
  };
}

function appUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

function tokenExpired(token) {
  const claims = decodeJwt(token);
  return !claims.exp || claims.exp * 1000 <= Date.now() + 30_000;
}

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function randomUrlSafe(length) {
  return base64Url(crypto.getRandomValues(new Uint8Array(length)));
}

async function sha256UrlSafe(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readLocal(key) { return readStorage(window.localStorage, key); }
function readSession(key) { return readStorage(window.sessionStorage, key); }
function writeLocal(key, value) { writeStorage(window.localStorage, key, value); }
function writeSession(key, value) { writeStorage(window.sessionStorage, key, value); }
function removeLocal(key) { try { window.localStorage.removeItem(key); } catch { /* unavailable */ } }
function removeSession(key) { try { window.sessionStorage.removeItem(key); } catch { /* unavailable */ } }

function readStorage(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}

function writeStorage(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Browser storage is blocked. Open the app in a normal browser tab.');
  }
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}
