import { CornerType } from '../ph-products/ph-product.model';

export interface PhPrintPreviewDimSegment {
  sizePx: number;
  labelCm: number;
}

export interface PhPrintPreviewLayoutInput {
  containerWidthPx: number;
  containerHeightPx: number;
  baseWidthCm: number;
  baseHeightCm: number;
  bleedCm: number;
  cornerType: CornerType | 'none';
  cornerRadiusCm: number;
}

export interface PhPrintPreviewLayout {
  stageWidthPx: number;
  stageHeightPx: number;
  sheetWidthPx: number;
  sheetHeightPx: number;
  baseWidthPx: number;
  baseHeightPx: number;
  bleedPx: number;
  hasBleed: boolean;
  topDimSegments: PhPrintPreviewDimSegment[];
  sideDimSegments: PhPrintPreviewDimSegment[];
  cornerRadiusPx: number;
  cornerClipPath: string | null;
  /** SVG polygon points for chamfer base-frame outline (includes diagonal edges). */
  chamferOutlinePolygonPoints: string | null;
  /** Final clip-path for the preview image (bleed + corner shape). */
  imageClipPath: string | null;
  /** Border-radius for rounded corners when clip-path is not used (no bleed). */
  imageBorderRadiusPx: number;
  /** Cross-shaped clip excluding corner squares when bleed is active. */
  bleedImageClipPath: string | null;
  /** SVG polygon points for the outer bleed-area outline. */
  bleedOutlinePolygonPoints: string | null;
}

/** Bundle gutters — keep in sync with ph-print-preview.component.scss */
export const PH_PREVIEW_DIM_BAND_PX = 16;
export const PH_PREVIEW_DIM_TOP_LABEL_PX = 29;
export const PH_PREVIEW_DIM_SIDE_GUTTER_PX = 45;
export const PH_PREVIEW_DIM_TOP_GUTTER_PX =
  PH_PREVIEW_DIM_BAND_PX + PH_PREVIEW_DIM_TOP_LABEL_PX;
/** Bottom balance — smaller than top; top must fit dim labels (45px). */
export const PH_PREVIEW_BUNDLE_PAD_BOTTOM_PX = 24;
/** Side without vertical dim labels — minimal balance only. */
export const PH_PREVIEW_BUNDLE_PAD_OPPOSITE_X_PX = 12;
export const PH_PREVIEW_BUNDLE_PAD_X_PX =
  PH_PREVIEW_DIM_SIDE_GUTTER_PX + PH_PREVIEW_BUNDLE_PAD_OPPOSITE_X_PX;
export const PH_PREVIEW_BUNDLE_PAD_Y_PX =
  PH_PREVIEW_DIM_TOP_GUTTER_PX + PH_PREVIEW_BUNDLE_PAD_BOTTOM_PX;

const MIN_CONTAINER_PX = 40;

export function formatPreviewDimCm(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.floor(value * 100) / 100;
}

export function computePhPrintPreviewLayout(
  input: PhPrintPreviewLayoutInput,
): PhPrintPreviewLayout | null {
  const baseWidthCm = Number(input.baseWidthCm);
  const baseHeightCm = Number(input.baseHeightCm);
  if (
    !Number.isFinite(baseWidthCm) ||
    !Number.isFinite(baseHeightCm) ||
    baseWidthCm <= 0 ||
    baseHeightCm <= 0 ||
    input.containerWidthPx < MIN_CONTAINER_PX ||
    input.containerHeightPx < MIN_CONTAINER_PX
  ) {
    return null;
  }

  const bleedCm = Math.max(0, Number(input.bleedCm) || 0);
  const hasBleed = bleedCm > 0;
  const totalWidthCm = baseWidthCm + (hasBleed ? bleedCm * 2 : 0);
  const totalHeightCm = baseHeightCm + (hasBleed ? bleedCm * 2 : 0);

  const availWidthPx = Math.max(
    1,
    input.containerWidthPx - PH_PREVIEW_BUNDLE_PAD_X_PX,
  );
  const availHeightPx = Math.max(
    1,
    input.containerHeightPx - PH_PREVIEW_BUNDLE_PAD_Y_PX,
  );

  let factor: number;
  if (availHeightPx / availWidthPx > totalHeightCm / totalWidthCm) {
    factor = availWidthPx / totalWidthCm;
  } else {
    factor = availHeightPx / totalHeightCm;
  }

  const sheetWidthPx = totalWidthCm * factor;
  const sheetHeightPx = totalHeightCm * factor;
  const baseWidthPx = baseWidthCm * factor;
  const baseHeightPx = baseHeightCm * factor;
  const bleedPx = bleedCm * factor;

  const topDimSegments = hasBleed
    ? [
        { sizePx: bleedPx, labelCm: formatPreviewDimCm(bleedCm) },
        { sizePx: baseWidthPx, labelCm: formatPreviewDimCm(baseWidthCm) },
        { sizePx: bleedPx, labelCm: formatPreviewDimCm(bleedCm) },
      ]
    : [{ sizePx: baseWidthPx, labelCm: formatPreviewDimCm(baseWidthCm) }];

  const sideDimSegments = hasBleed
    ? [
        { sizePx: bleedPx, labelCm: formatPreviewDimCm(bleedCm) },
        { sizePx: baseHeightPx, labelCm: formatPreviewDimCm(baseHeightCm) },
        { sizePx: bleedPx, labelCm: formatPreviewDimCm(bleedCm) },
      ]
    : [{ sizePx: baseHeightPx, labelCm: formatPreviewDimCm(baseHeightCm) }];

  const cornerRadiusPx =
    input.cornerType === 'none' || !Number.isFinite(Number(input.cornerRadiusCm))
      ? 0
      : Math.max(0, Number(input.cornerRadiusCm) * factor);

  const bleedImageClipPath = hasBleed
    ? buildBleedImageClipPath(sheetWidthPx, sheetHeightPx, bleedPx)
    : null;

  const imageShape = buildImageShapeClip(
    hasBleed,
    sheetWidthPx,
    sheetHeightPx,
    bleedPx,
    baseWidthPx,
    baseHeightPx,
    input.cornerType,
    cornerRadiusPx,
  );

  return {
    stageWidthPx: sheetWidthPx,
    stageHeightPx: sheetHeightPx,
    sheetWidthPx,
    sheetHeightPx,
    baseWidthPx,
    baseHeightPx,
    bleedPx,
    hasBleed,
    topDimSegments,
    sideDimSegments,
    cornerRadiusPx,
    cornerClipPath: buildCornerClipPath(input.cornerType, cornerRadiusPx),
    chamferOutlinePolygonPoints:
      input.cornerType === 'chamfer' && cornerRadiusPx > 0
        ? buildChamferOutlinePolygonPoints(baseWidthPx, baseHeightPx, cornerRadiusPx)
        : null,
    imageClipPath: imageShape.clipPath,
    imageBorderRadiusPx: imageShape.borderRadiusPx,
    bleedImageClipPath,
    bleedOutlinePolygonPoints: hasBleed
      ? buildBleedOutlinePolygonPoints(sheetWidthPx, sheetHeightPx, bleedPx)
      : null,
  };
}

/** SVG points for the outer edge of the bleed cross (same path as image clip). */
const BLEED_OUTLINE_STROKE_PX = 2;
const BLEED_OUTLINE_INSET_PX = BLEED_OUTLINE_STROKE_PX / 2;

function buildBleedOutlinePolygonPoints(
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
): string {
  const b = bleedPx;
  const w = sheetWidthPx;
  const h = sheetHeightPx;
  const i = BLEED_OUTLINE_INSET_PX;
  return [
    `${b},${i}`,
    `${w - b},${i}`,
    `${w - b},${b + i}`,
    `${w - i},${b + i}`,
    `${w - i},${h - b - i}`,
    `${w - b - i},${h - b - i}`,
    `${w - b - i},${h - i}`,
    `${b + i},${h - i}`,
    `${b + i},${h - b - i}`,
    `${i},${h - b - i}`,
    `${i},${b + i}`,
    `${b + i},${b + i}`,
  ].join(' ');
}

/** Image area with bleed: base + 4 arms, without the 4 corner squares. */
function buildBleedImageClipPath(
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
): string {
  const b = bleedPx;
  const w = sheetWidthPx;
  const h = sheetHeightPx;
  return `polygon(${b}px 0px, ${w - b}px 0px, ${w - b}px ${b}px, ${w}px ${b}px, ${w}px ${h - b}px, ${w - b}px ${h - b}px, ${w - b}px ${h}px, ${b}px ${h}px, ${b}px ${h - b}px, 0px ${h - b}px, 0px ${b}px, ${b}px ${b}px)`;
}

function buildImageShapeClip(
  hasBleed: boolean,
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
  baseWidthPx: number,
  baseHeightPx: number,
  cornerType: CornerType | 'none',
  cornerRadiusPx: number,
): { clipPath: string | null; borderRadiusPx: number } {
  const hasCorner = cornerType !== 'none' && cornerRadiusPx > 0;

  if (!hasCorner) {
    return {
      clipPath: hasBleed
        ? buildBleedImageClipPath(sheetWidthPx, sheetHeightPx, bleedPx)
        : null,
      borderRadiusPx: 0,
    };
  }

  if (cornerType === 'rounded') {
    if (hasBleed) {
      return {
        clipPath: buildBleedRoundedImageClipPath(
          sheetWidthPx,
          sheetHeightPx,
          bleedPx,
          cornerRadiusPx,
        ),
        borderRadiusPx: 0,
      };
    }
    return { clipPath: null, borderRadiusPx: cornerRadiusPx };
  }

  // chamfer
  if (hasBleed) {
    return {
      clipPath: buildBleedChamferImageClipPath(
        sheetWidthPx,
        sheetHeightPx,
        bleedPx,
        cornerRadiusPx,
      ),
      borderRadiusPx: 0,
    };
  }
  return {
    clipPath: buildChamferClipPathPx(baseWidthPx, baseHeightPx, cornerRadiusPx),
    borderRadiusPx: 0,
  };
}

function buildChamferClipPathPx(
  widthPx: number,
  heightPx: number,
  radiusPx: number,
): string {
  const r = radiusPx;
  const w = widthPx;
  const h = heightPx;
  return `polygon(${r}px 0px, ${w - r}px 0px, ${w}px ${r}px, ${w}px ${h - r}px, ${w - r}px ${h}px, ${r}px ${h}px, 0px ${h - r}px, 0px ${r}px)`;
}

/** Bleed cross with chamfer applied to the inner base-area corners. */
function buildBleedChamferImageClipPath(
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
  radiusPx: number,
): string {
  const b = bleedPx;
  const w = sheetWidthPx;
  const h = sheetHeightPx;
  const r = radiusPx;
  return `polygon(${b}px 0px, ${w - b}px 0px, ${w - b - r}px ${b}px, ${w - b}px ${b + r}px, ${w}px ${b}px, ${w}px ${h - b}px, ${w - b}px ${h - b - r}px, ${w - b - r}px ${h - b}px, ${w - b}px ${h}px, ${b}px ${h}px, ${b + r}px ${h - b}px, ${b}px ${h - b - r}px, 0px ${h - b}px, 0px ${b}px, ${b}px ${b + r}px, ${b + r}px ${b}px)`;
}

/** Bleed cross with rounded inner base-area corners (SVG path for clip-path). */
function buildBleedRoundedImageClipPath(
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
  radiusPx: number,
): string {
  const b = bleedPx;
  const w = sheetWidthPx;
  const h = sheetHeightPx;
  const r = radiusPx;
  const d = [
    `M ${b} 0`,
    `L ${w - b} 0`,
    `L ${w - b} ${b - r}`,
    `A ${r} ${r} 0 0 1 ${w - b - r} ${b}`,
    `L ${w} ${b}`,
    `L ${w} ${h - b}`,
    `L ${w - b + r} ${h - b}`,
    `A ${r} ${r} 0 0 1 ${w - b} ${h - b + r}`,
    `L ${w - b} ${h}`,
    `L ${b} ${h}`,
    `L ${b} ${h - b + r}`,
    `A ${r} ${r} 0 0 1 ${b + r} ${h - b}`,
    `L 0 ${h - b}`,
    `L 0 ${b}`,
    `L ${b - r} ${b}`,
    `A ${r} ${r} 0 0 1 ${b} ${b - r}`,
    'Z',
  ].join(' ');
  return `path('${d}')`;
}

/** SVG points for chamfer base frame — inset so 2px stroke stays inside bounds. */
const BASE_FRAME_STROKE_PX = 2;
const BASE_FRAME_STROKE_INSET_PX = BASE_FRAME_STROKE_PX / 2;

function buildChamferOutlinePolygonPoints(
  widthPx: number,
  heightPx: number,
  radiusPx: number,
): string {
  const r = radiusPx;
  const w = widthPx;
  const h = heightPx;
  const i = BASE_FRAME_STROKE_INSET_PX;
  return [
    `${r + i},${i}`,
    `${w - r - i},${i}`,
    `${w - i},${r + i}`,
    `${w - i},${h - r - i}`,
    `${w - r - i},${h - i}`,
    `${r + i},${h - i}`,
    `${i},${h - r - i}`,
    `${i},${r + i}`,
  ].join(' ');
}

function buildCornerClipPath(
  cornerType: CornerType | 'none',
  radiusPx: number,
): string | null {
  if (cornerType !== 'chamfer' || radiusPx <= 0) {
    return null;
  }
  const r = `${radiusPx}px`;
  return `polygon(${r} 0, calc(100% - ${r}) 0, 100% ${r}, 100% calc(100% - ${r}), calc(100% - ${r}) 100%, ${r} 100%, 0 calc(100% - ${r}), 0 ${r})`;
}
