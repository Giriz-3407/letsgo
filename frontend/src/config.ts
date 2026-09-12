/**
 * Centralized Application Configuration
 * Automatically handles local development vs production deployment (Vercel + Render).
 */

const getApiBaseUrl = (): string => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return 'http://localhost:8000';
};

export const API_BASE_URL = getApiBaseUrl();

/**
 * Derives WebSocket base URL from HTTP API base URL.
 * http://localhost:8000 -> ws://localhost:8000
 * https://my-backend.onrender.com -> wss://my-backend.onrender.com
 */
export const getWsBaseUrl = (): string => {
  const wsProtocol = API_BASE_URL.startsWith('https:') ? 'wss:' : 'ws:';
  const host = API_BASE_URL.replace(/^https?:\/\//, '');
  return `${wsProtocol}//${host}`;
};

export const WS_BASE_URL = getWsBaseUrl();

/**
 * Resolves absolute or relative media URLs (e.g. /api/videos/sample/stream)
 * against the configured API_BASE_URL for HTML5 <video> elements.
 */
export const resolveMediaUrl = (url?: string | null): string => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
    return url;
  }
  const cleanPath = url.startsWith('/') ? url : `/${url}`;
  return `${API_BASE_URL}${cleanPath}`;
};
