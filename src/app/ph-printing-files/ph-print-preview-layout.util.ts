import { CornerType } from '../ph-products/ph-product.model';

export interface PhPrintPreviewDimSegment {
  sizePx: number;
  labelCm: number;
}

export interface PhPrintPreviewFoldLine {
  /** Horizontal position within the main image area (base frame), px from left. */
  leftPx: number;
}

export interface PhPrintPreviewLayoutInput {
  containerWidthPx: number;
  containerHeightPx: number;
  baseWidthCm: number;
  baseHeightCm: number;
  /** Margin addition cm (duplex / תוספת שוליים). */
  marginCm: number;
  cornerType: CornerType | 'none';
  cornerRadiusCm: number;
  /** Number of folds — 0 hides fold lines. */
  foldingCount?: number;
  /** Fold offset cm — splits each fold line into two when > 0. */
  foldingOffsetCm?: number;
  /** Fit sheet to full container — skip dim-label gutters (mockup embed). */
  skipDimGutters?: boolean;
  /** Lower minimum for mockup embed (print slot can be small). */
  minContainerPx?: number;
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
  /** True when rounded/chamfer corners are active. */
  hasCornerShape: boolean;
  /** Clip entire sheet (removes white bleed areas outside the green border). */
  sheetClipPath: string | null;
  sheetBorderRadiusPx: number;
  /** Full-sheet SVG outline when bleed + corners (replaces cross + base outlines). */
  sheetOutlinePolygonPoints: string | null;
  sheetOutlinePath: string | null;
  /** Cross-shaped clip excluding corner squares when bleed is active. */
  bleedImageClipPath: string | null;
  /** SVG polygon points for the outer bleed-area outline. */
  bleedOutlinePolygonPoints: string | null;
  /** Vertical dashed fold guides within the main image area. */
  foldingLines: PhPrintPreviewFoldLine[];
  /** Per-panel width dims below the main top line (base area only). */
  baseFoldDimSegments: PhPrintPreviewDimSegment[];
  hasFoldDims: boolean;
}

/** Bundle gutters — keep in sync with ph-print-preview.component.scss */
export const PH_PREVIEW_DIM_BAND_PX = 16;
export const PH_PREVIEW_DIM_TOP_LABEL_PX = 29;
export const PH_PREVIEW_DIM_SIDE_GUTTER_PX = 45;
export const PH_PREVIEW_DIM_TOP_GUTTER_PX =
  PH_PREVIEW_DIM_BAND_PX + PH_PREVIEW_DIM_TOP_LABEL_PX;
/** Fold row label space above its band — keep in sync with ph-print-preview.component.scss */
export const PH_PREVIEW_DIM_TOP_FOLD_LABEL_PX = 18;
/** Second top dim row height — keep in sync with ph-print-preview.component.scss */
export const PH_PREVIEW_DIM_TOP_FOLD_BAND_PX = 16;
/** Extra lift for the full-width top dim row only (fold row stays put). */
export const PH_PREVIEW_DIM_TOP_MAIN_FOLD_EXTRA_RAISE_PX = 12;
export const PH_PREVIEW_TOP_GUTTER_FOLD_EXTRA_PX =
  PH_PREVIEW_DIM_TOP_FOLD_BAND_PX +
  PH_PREVIEW_DIM_TOP_FOLD_LABEL_PX +
  PH_PREVIEW_DIM_TOP_MAIN_FOLD_EXTRA_RAISE_PX;
/** Bottom balance — smaller than top; top must fit dim labels (45px). */
export const PH_PREVIEW_BUNDLE_PAD_BOTTOM_PX = 24;
/** Side without vertical dim labels — minimal balance only. */
export const PH_PREVIEW_BUNDLE_PAD_OPPOSITE_X_PX = 12;
export const PH_PREVIEW_BUNDLE_PAD_X_PX =
  PH_PREVIEW_DIM_SIDE_GUTTER_PX + PH_PREVIEW_BUNDLE_PAD_OPPOSITE_X_PX;
export const PH_PREVIEW_BUNDLE_PAD_Y_PX =
  PH_PREVIEW_DIM_TOP_GUTTER_PX + PH_PREVIEW_BUNDLE_PAD_BOTTOM_PX;

export function computePhPrintPreviewTopGutterPx(hasFoldDims: boolean): number {
  return (
    PH_PREVIEW_DIM_TOP_GUTTER_PX +
    (hasFoldDims ? PH_PREVIEW_TOP_GUTTER_FOLD_EXTRA_PX : 0)
  );
}

/** Vertical gap between stacked duplex previews — keep in sync with ph-print-preview.component.scss */
export const PH_PREVIEW_DUPLEX_STACK_GAP_PX = 0;

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
  const minContainerPx = input.minContainerPx ?? MIN_CONTAINER_PX;
  if (
    !Number.isFinite(baseWidthCm) ||
    !Number.isFinite(baseHeightCm) ||
    baseWidthCm <= 0 ||
    baseHeightCm <= 0 ||
    input.containerWidthPx < minContainerPx ||
    input.containerHeightPx < minContainerPx
  ) {
    return null;
  }

  const bleedCm = Math.max(0, Number(input.marginCm) || 0);
  const hasBleed = bleedCm > 0;
  const totalWidthCm = baseWidthCm + (hasBleed ? bleedCm * 2 : 0);
  const totalHeightCm = baseHeightCm + (hasBleed ? bleedCm * 2 : 0);

  const skipDimGutters = !!input.skipDimGutters;
  const hasFoldDims = skipDimGutters
    ? false
    : willHaveFoldDims(
        input.foldingCount,
        input.foldingOffsetCm,
        baseWidthCm,
      );
  const topGutterPx = computePhPrintPreviewTopGutterPx(hasFoldDims);
  const bundlePadYPx = topGutterPx + PH_PREVIEW_BUNDLE_PAD_BOTTOM_PX;

  const availWidthPx = skipDimGutters
    ? Math.max(1, input.containerWidthPx)
    : Math.max(1, input.containerWidthPx - PH_PREVIEW_BUNDLE_PAD_X_PX);
  const availHeightPx = skipDimGutters
    ? Math.max(1, input.containerHeightPx)
    : Math.max(1, input.containerHeightPx - bundlePadYPx);

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

  const hasCornerShape =
    input.cornerType !== 'none' && cornerRadiusPx > 0;
  const activeCornerType =
    input.cornerType !== 'none' ? input.cornerType : null;

  const sheetOutline =
    hasBleed && hasCornerShape && activeCornerType
      ? buildBleedCornerSheetOutline(
          sheetWidthPx,
          sheetHeightPx,
          bleedPx,
          cornerRadiusPx,
          activeCornerType,
        )
      : { polygonPoints: null, path: null };

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
    hasCornerShape,
    sheetClipPath: hasCornerShape ? imageShape.clipPath : null,
    sheetBorderRadiusPx: hasCornerShape ? imageShape.borderRadiusPx : 0,
    sheetOutlinePolygonPoints: sheetOutline.polygonPoints,
    sheetOutlinePath: sheetOutline.path,
    bleedImageClipPath,
    bleedOutlinePolygonPoints:
      hasBleed && !hasCornerShape
        ? buildBleedOutlinePolygonPoints(sheetWidthPx, sheetHeightPx, bleedPx)
        : null,
    foldingLines: computePreviewFoldingLines(
      input.foldingCount,
      input.foldingOffsetCm,
      baseWidthPx,
      baseWidthCm,
    ),
    ...buildBaseFoldDimLayout(
      input.foldingCount,
      input.foldingOffsetCm,
      baseWidthPx,
      baseWidthCm,
    ),
  };
}

function buildBaseFoldDimLayout(
  foldCount: number | undefined,
  offsetCm: number | undefined,
  baseWidthPx: number,
  baseWidthCm: number,
): Pick<PhPrintPreviewLayout, 'baseFoldDimSegments' | 'hasFoldDims'> {
  const baseFoldDimSegments = computePreviewFoldDimSegments(
    foldCount,
    offsetCm,
    baseWidthPx,
    baseWidthCm,
  );
  return {
    baseFoldDimSegments,
    hasFoldDims: baseFoldDimSegments.length > 0,
  };
}

function willHaveFoldDims(
  foldCount: number | undefined,
  _offsetCm: number | undefined,
  baseWidthCm: number,
): boolean {
  const count = Math.floor(Number(foldCount));
  return Number.isFinite(count) && count > 0 && baseWidthCm > 0;
}

/** Fold guides: count N → lines at k/(N+1); with offset, equal panels + fixed offset gaps. */
export function computePreviewFoldingLines(
  foldCount: number | undefined,
  offsetCm: number | undefined,
  baseWidthPx: number,
  baseWidthCm: number,
): PhPrintPreviewFoldLine[] {
  const boundariesPx = computePreviewFoldBoundariesPx(
    foldCount,
    offsetCm,
    baseWidthPx,
    baseWidthCm,
  );
  if (boundariesPx.length < 2) {
    return [];
  }
  return boundariesPx
    .slice(1, -1)
    .map((leftPx) => ({ leftPx: snapPreviewFoldLinePx(leftPx) }));
}

/** Panel / offset boundaries left-to-right across the main image width. */
export function computePreviewFoldBoundariesPx(
  foldCount: number | undefined,
  offsetCm: number | undefined,
  baseWidthPx: number,
  baseWidthCm: number,
): number[] {
  const count = Math.floor(Number(foldCount));
  if (!Number.isFinite(count) || count <= 0 || baseWidthPx <= 0 || baseWidthCm <= 0) {
    return [];
  }

  const widthFactor = baseWidthPx / baseWidthCm;
  const offsetCmVal = Math.max(0, Number(offsetCm) || 0);
  const offsetPx = offsetCmVal * widthFactor;

  if (offsetPx <= 0) {
    const boundaries = [0];
    for (let k = 1; k <= count; k += 1) {
      boundaries.push((baseWidthPx * k) / (count + 1));
    }
    boundaries.push(baseWidthPx);
    return boundaries;
  }

  const totalOffsetCm = count * offsetCmVal;
  const panelCm = (baseWidthCm - totalOffsetCm) / (count + 1);
  if (!Number.isFinite(panelCm) || panelCm <= 0) {
    return [];
  }

  const panelPx = panelCm * widthFactor;
  const boundaries = [0];

  for (let k = 1; k <= count; k += 1) {
    boundaries.push(k * panelPx + (k - 1) * offsetPx);
    boundaries.push(k * panelPx + k * offsetPx);
  }
  boundaries.push(baseWidthPx);

  return boundaries;
}

/** Snap fold guide x to half-pixels for consistent 1px stroke rendering. */
function snapPreviewFoldLinePx(value: number): number {
  return Math.round(value * 2) / 2;
}

/** Regions between consecutive fold boundaries (includes offset gaps as own segments). */
export function computePreviewFoldDimSegments(
  foldCount: number | undefined,
  offsetCm: number | undefined,
  baseWidthPx: number,
  baseWidthCm: number,
): PhPrintPreviewDimSegment[] {
  const boundariesPx = computePreviewFoldBoundariesPx(
    foldCount,
    offsetCm,
    baseWidthPx,
    baseWidthCm,
  );
  if (boundariesPx.length < 2 || baseWidthPx <= 0 || baseWidthCm <= 0) {
    return [];
  }

  const segments: PhPrintPreviewDimSegment[] = [];

  for (let index = 0; index < boundariesPx.length - 1; index += 1) {
    const sizePx = boundariesPx[index + 1] - boundariesPx[index];
    if (sizePx <= 0.5) {
      continue;
    }
    const widthCm = (sizePx / baseWidthPx) * baseWidthCm;
    segments.push({
      sizePx,
      labelCm: formatPreviewDimCm(widthCm),
    });
  }

  return segments;
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
function buildBleedChamferOutlinePointList(
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
  radiusPx: number,
): Array<[number, number]> {
  const b = bleedPx;
  const w = sheetWidthPx;
  const h = sheetHeightPx;
  const r = radiusPx;
  return [
    [b, 0],
    [w - b, 0],
    [w - b - r, b],
    [w - b, b + r],
    [w, b],
    [w, h - b],
    [w - b, h - b - r],
    [w - b - r, h - b],
    [w - b, h],
    [b, h],
    [b + r, h - b],
    [b, h - b - r],
    [0, h - b],
    [0, b],
    [b, b + r],
    [b + r, b],
  ];
}

function pointsToClipPolygon(points: Array<[number, number]>): string {
  return `polygon(${points.map(([x, y]) => `${x}px ${y}px`).join(', ')})`;
}

function pointsToSvgPoints(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

function buildBleedChamferImageClipPath(
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
  radiusPx: number,
): string {
  return pointsToClipPolygon(
    buildBleedChamferOutlinePointList(
      sheetWidthPx,
      sheetHeightPx,
      bleedPx,
      radiusPx,
    ),
  );
}

function buildBleedRoundedPathD(
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
  radiusPx: number,
): string {
  const b = bleedPx;
  const w = sheetWidthPx;
  const h = sheetHeightPx;
  const r = radiusPx;
  return [
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
}

/** Bleed cross with rounded inner base-area corners (SVG path for clip-path). */
function buildBleedRoundedImageClipPath(
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
  radiusPx: number,
): string {
  return `path('${buildBleedRoundedPathD(sheetWidthPx, sheetHeightPx, bleedPx, radiusPx)}')`;
}

function buildBleedCornerSheetOutline(
  sheetWidthPx: number,
  sheetHeightPx: number,
  bleedPx: number,
  radiusPx: number,
  cornerType: CornerType,
): { polygonPoints: string | null; path: string | null } {
  if (cornerType === 'chamfer') {
    return {
      polygonPoints: pointsToSvgPoints(
        buildBleedChamferOutlinePointList(
          sheetWidthPx,
          sheetHeightPx,
          bleedPx,
          radiusPx,
        ),
      ),
      path: null,
    };
  }
  return {
    polygonPoints: null,
    path: buildBleedRoundedPathD(
      sheetWidthPx,
      sheetHeightPx,
      bleedPx,
      radiusPx,
    ),
  };
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
