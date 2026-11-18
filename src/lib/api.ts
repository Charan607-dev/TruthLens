const TOKEN_KEY = 'truthlens_auth_token';

function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Support bare hostnames from Render Blueprint fromService (`property: host`)
  if (trimmed.includes('.')) return `https://${trimmed}`;
  return trimmed;
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

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...options,
      headers,
      signal: options.signal ?? controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        'Request timed out while waiting for the TruthLens backend. Please retry in a moment.',
        408
      );
    }
    throw new ApiError(
      'Unable to reach the TruthLens backend API. Check your network connection or verify VITE_API_URL.',
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
      'Backend API returned HTML instead of JSON. Ensure VITE_API_URL is configured to your live TruthLens backend service.',
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
      throw new ApiError('Backend returned an invalid JSON response.', res.status);
    }
  }

  if (!res.ok) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed with HTTP status ${res.status}.`;
    throw new ApiError(message, res.status);
  }

  if (parsed === null) {
    throw new ApiError('Backend returned an empty JSON response.', res.status);
  }

  return parsed as T;
}
