import { environment } from 'src/environments/environment';

/**
 * Builds the MapTiler Cloud style URL for MapLibre GL.
 * Set `mapTilerApiKey` and `mapTilerMapId` in `src/environments/environment*.ts`.
 */
export function getMapTilerStyleUrl(): string {
  const key = (environment as any).mapTilerApiKey ?? '';
  const mapId = (environment as any).mapTilerMapId ?? '';
  return `https://api.maptiler.com/maps/${mapId}/style.json?key=${encodeURIComponent(key)}`;
}

