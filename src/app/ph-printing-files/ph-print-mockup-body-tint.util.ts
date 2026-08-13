import { phCanvasProxiedImageUrl } from '../ph-canvas/ph-canvas.model';

const MAX_TINT_EDGE_PX = 2048;

/** Rec. 709 luminance (same basis as CSS mix-blend-mode: color). */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * CSS non-separable `color` blend: hue+sat from tint, luminosity from source.
 * @see https://www.w3.org/TR/compositing-1/#blendingcolor
 */
function setLuminosity(
  r: number,
  g: number,
  b: number,
  targetLum: number,
): [number, number, number] {
  const d = targetLum - luminance(r, g, b);
  return clipColor(r + d, g + d, b + d);
}

function clipColor(r: number, g: number, b: number): [number, number, number] {
  const L = luminance(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    const denom = L - n || 1;
    r = L + ((r - L) * L) / denom;
    g = L + ((g - L) * L) / denom;
    b = L + ((b - L) * L) / denom;
  }
  if (x > 255) {
    const denom = x - L || 1;
    r = L + ((r - L) * (255 - L)) / denom;
    g = L + ((g - L) * (255 - L)) / denom;
    b = L + ((b - L) * (255 - L)) / denom;
  }
  return [clampByte(r), clampByte(g), clampByte(b)];
}

export function extractCssUrl(value: string | null | undefined): string | null {
  const raw = (value || '').trim();
  if (!raw || raw === 'none') {
    return null;
  }
  const match = raw.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
  const url = match?.[2]?.trim();
  return url || null;
}

export function parseCssColor(
  value: string | null | undefined,
): [number, number, number] | null {
  const raw = (value || '').trim();
  if (!raw || raw === 'transparent') {
    return null;
  }

  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }

  const rgb = raw.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+)?\s*\)$/i,
  );
  if (rgb) {
    return [
      clampByte(Number(rgb[1])),
      clampByte(Number(rgb[2])),
      clampByte(Number(rgb[3])),
    ];
  }

  return null;
}

function isNearWhite(rgb: [number, number, number]): boolean {
  return rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250;
}

/** True when a non-white color or a texture should recolor the mockup PNG. */
export function shouldTintMockupBody(
  styles: Record<string, string> | null | undefined,
): boolean {
  if (!styles) {
    return false;
  }
  if (extractCssUrl(styles['backgroundImage'])) {
    return true;
  }
  const rgb = parseCssColor(styles['backgroundColor']);
  return !!rgb && !isNearWhite(rgb);
}

export function mockupBodyTintKey(
  mockupUrl: string,
  styles: Record<string, string> | null | undefined,
): string {
  const bg = styles ?? {};
  return `${mockupUrl}|${bg['backgroundColor'] ?? ''}|${bg['backgroundImage'] ?? ''}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('MOCKUP_TINT_IMAGE_LOAD_FAILED'));
    img.src = url;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
): void {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (iw <= 0 || ih <= 0) {
    return;
  }
  const scale = Math.max(width / iw, height / ih);
  const tw = iw * scale;
  const th = ih * scale;
  ctx.drawImage(image, (width - tw) / 2, (height - th) / 2, tw, th);
}

/**
 * Recolor opaque mockup pixels. Transparent pixels stay transparent.
 * Solid color keeps mockup shading (CSS "color" blend). Texture is lighting-modulated.
 */
export async function tintMockupPng(
  mockupUrl: string,
  styles: Record<string, string>,
): Promise<string> {
  const mockup = await loadImage(phCanvasProxiedImageUrl(mockupUrl));
  const srcW = mockup.naturalWidth || mockup.width;
  const srcH = mockup.naturalHeight || mockup.height;
  if (srcW <= 0 || srcH <= 0) {
    throw new Error('MOCKUP_TINT_EMPTY_IMAGE');
  }

  const scale = Math.min(1, MAX_TINT_EDGE_PX / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('MOCKUP_TINT_NO_CONTEXT');
  }

  ctx.drawImage(mockup, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const textureUrl = extractCssUrl(styles['backgroundImage']);
  if (textureUrl) {
    const texture = await loadImage(phCanvasProxiedImageUrl(textureUrl));
    const texCanvas = document.createElement('canvas');
    texCanvas.width = width;
    texCanvas.height = height;
    const texCtx = texCanvas.getContext('2d');
    if (!texCtx) {
      throw new Error('MOCKUP_TINT_NO_CONTEXT');
    }
    drawCover(texCtx, texture, width, height);
    const texData = texCtx.getImageData(0, 0, width, height).data;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) {
        continue;
      }
      const light = luminance(data[i], data[i + 1], data[i + 2]) / 255;
      data[i] = clampByte(texData[i] * light);
      data[i + 1] = clampByte(texData[i + 1] * light);
      data[i + 2] = clampByte(texData[i + 2] * light);
    }
  } else {
    const tint = parseCssColor(styles['backgroundColor']);
    if (!tint) {
      return canvas.toDataURL('image/png');
    }
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) {
        continue;
      }
      const [r, g, b] = setLuminosity(
        tint[0],
        tint[1],
        tint[2],
        luminance(data[i], data[i + 1], data[i + 2]),
      );
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
