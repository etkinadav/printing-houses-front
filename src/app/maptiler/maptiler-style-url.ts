import { environment } from 'src/environments/environment';
import type { RequestTransformFunction } from 'maplibre-gl';

const MAPTILER_API_ORIGIN = 'https://api.maptiler.com';
const MAPTILER_PROXY_PATH = '/maptiler-api';

type MapEnv = {
  production?: boolean;
  mapStyleUrl?: string;
  /**
   * On localhost, use direct MapTiler URLs (needs https://localhost:4443 in key allowed origins).
   * Default false: requests go through the dev-server proxy (recommended for local dev).
   */
  useMapTilerDirectOnLocalhost?: boolean;
  mapTilerApiKey?: string;
  mapTilerMapId?: string;
};

function envConfig(): MapEnv {
  return environment as MapEnv;
}

export function isBrowserLocalhost(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function shouldUseMapTilerProxy(): boolean {
  const env = envConfig();
  return !env.production && isBrowserLocalhost() && !env.useMapTilerDirectOnLocalhost;
}

function mapTilerStylePath(): string {
  const env = envConfig();
  const key = env.mapTilerApiKey ?? '';
  const mapId = env.mapTilerMapId ?? '';
  return `/maps/${mapId}/style.json?key=${encodeURIComponent(key)}`;
}

/** Custom MapTiler map — same map as phprint / mean-corse-01. */
export function getMapTilerStyleUrl(): string {
  const env = envConfig();
  if (env.mapStyleUrl?.trim()) {
    return env.mapStyleUrl.trim();
  }

  const path = mapTilerStylePath();
  if (shouldUseMapTilerProxy()) {
    return `${window.location.origin}${MAPTILER_PROXY_PATH}${path}`;
  }
  return `${MAPTILER_API_ORIGIN}${path}`;
}

/** Always the custom MapTiler style (proxy on localhost dev). */
export function getMapStyleUrl(): string {
  return getMapTilerStyleUrl();
}

/** Rewrite tile/sprite/glyph requests through the dev proxy on localhost. */
export function getMapTransformRequest(): RequestTransformFunction | undefined {
  if (!shouldUseMapTilerProxy() || typeof window === 'undefined') {
    return undefined;
  }

  const proxyPrefix = `${window.location.origin}${MAPTILER_PROXY_PATH}`;

  return (url: string) => {
    if (url.startsWith(MAPTILER_API_ORIGIN)) {
      return { url: url.replace(MAPTILER_API_ORIGIN, proxyPrefix) };
    }
    return { url };
  };
}
