const TOKEN_KEY = 'truthlens_auth_token';

function normalizeApiBase(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  // Support Render Blueprint `fromService` `property: host` (slug without domain or domain without scheme)
  if (!trimmed.includes('.')) {
    return trimmed === 'localhost' ? 'http://localhost:3000' : `https://${trimmed}.onrender.com`;
  }
  return `https://${trimmed}`;
}

const API_BASE = normalizeApiBase(import.meta.env.VITE_API_URL || '');

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore storage restrictions
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const targetUrl = apiUrl(path);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(targetUrl, {
      ...options,
      headers,
      signal: options.signal ?? controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        'Request timed out while waiting for the TruthLens backend. If your Render backend is waking up from sleep, retry in a few seconds.',
        408
      );
    }
    throw new ApiError(
      API_BASE
        ? `Unable to reach the TruthLens backend at ${API_BASE}. Verify the backend service is running and CORS allows this origin.`
        : 'Unable to reach the TruthLens backend API. Check your network connection or set VITE_API_URL.',
      0
    );
  } finally {
    window.clearTimeout(timeoutId);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();
  const trimmedText = rawText.trim();

  if (
    contentType.includes('text/html') ||
    trimmedText.startsWith('<!doctype') ||
    trimmedText.startsWith('<html')
  ) {
    throw new ApiError(
      API_BASE
        ? `Backend request (${targetUrl}) returned HTML (HTTP ${res.status}) instead of JSON. Check that VITE_API_URL points to the Node.js TruthLens server.`
        : 'Received HTML instead of API JSON. If deployed as a Render Static Site, set VITE_API_URL to your deployed backend URL and redeploy.',
      res.status || 502
    );
  }

  let parsed: unknown = null;
  if (trimmedText.length > 0) {
    try {
      parsed = JSON.parse(trimmedText);
    } catch {
      if (!res.ok) {
        throw new ApiError(`Server error (${res.status}): ${trimmedText.slice(0, 140)}`, res.status);
      }
      throw new ApiError('Backend returned malformed JSON.', res.status);
    }
  }

  if (!res.ok) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : !API_BASE && import.meta.env.PROD
          ? `Backend endpoint not found (HTTP ${res.status}). Set VITE_API_URL on the Render Static Site to your backend URL and rebuild.`
          : `Request failed with HTTP status ${res.status}.`;
    throw new ApiError(message, res.status);
  }

  if (parsed === null) {
    throw new ApiError(
      !API_BASE && import.meta.env.PROD
        ? `No backend API response received (HTTP ${res.status}, empty body). Your Static Site received the request without forwarding it to a backend — set VITE_API_URL to your deployed TruthLens backend URL and rebuild.`
        : `Backend at ${targetUrl} returned an empty response (HTTP ${res.status}). Check your Render backend service logs and health endpoint.`,
      res.status
    );
  }

  return parsed as T;
}
