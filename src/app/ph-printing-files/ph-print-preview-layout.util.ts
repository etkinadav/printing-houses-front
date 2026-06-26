import { CornerType } from '../ph-products/ph-product.model';
import type { PhSheetClipSpec } from '../ph-canvas/ph-canvas-sheet-clip.util';

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
  /** Professional trim bleed cm — inner safe-area guide (ignores duplex margin). */
  trimBleedCm?: number;
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
  /** Cap sheet height (px) — preview stays centered when the host is taller. */
  maxSheetHeightPx?: number;
}

/** Max printable sheet height in the desktop canvas preview pane. */
export const PH_PREVIEW_MAX_SHEET_HEIGHT_PX = 450;

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
  /** Inner trim-bleed guide inside the base print area (not duplex strips). */
  hasTrimBleedGuide: boolean;
  trimBleedGuidePolygonPoints: string | null;
  trimBleedGuidePath: string | null;
  /** Clip spec for the trim-bleed safe zone (sheet coordinates; canvas dimming). */
  trimBleedInteriorClipSpec: PhSheetClipSpec | null;
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

  const maxSheetHeightPx = Number(input.maxSheetHeightPx);
  if (maxSheetHeightPx > 0 && totalHeightCm * factor > maxSheetHeightPx) {
    factor = maxSheetHeightPx / totalHeightCm;
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
    ...buildTrimBleedGuideLayout(
      input.trimBleedCm,
      factor,
      baseWidthPx,
      baseHeightPx,
      bleedPx,
      input.cornerType,
      cornerRadiusPx,
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

/** Panel edges only (excludes offset gaps) — N folds → N+1 panel boundaries. */
export function computePreviewFoldPanelBoundariesPx(
  foldCount: number | undefined,
  offsetCm: number | undefined,
  baseWidthPx: number,
  baseWidthCm: number,
): number[] {
  const all = computePreviewFoldBoundariesPx(
    foldCount,
    offsetCm,
    baseWidthPx,
    baseWidthCm,
  );
  if (all.length < 2) {
    return [];
  }

  const offsetCmVal = Math.max(0, Number(offsetCm) || 0);
  if (offsetCmVal <= 0) {
    return all;
  }

  const panelBounds = [all[0]];
  for (let index = 1; index < all.length - 1; index += 2) {
    panelBounds.push(all[index]);
  }
  panelBounds.push(all[all.length - 1]);
  return panelBounds;
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

const TRIM_BLEED_GUIDE_STROKE_PX = 1;
const TRIM_BLEED_GUIDE_STROKE_INSET_PX = TRIM_BLEED_GUIDE_STROKE_PX / 2;

function buildTrimBleedGuideLayout(
  trimBleedCm: number | undefined,
  factor: number,
  baseWidthPx: number,
  baseHeightPx: number,
  duplexBleedPx: number,
  cornerType: CornerType | 'none',
  cornerRadiusPx: number,
): Pick<
  PhPrintPreviewLayout,
  | 'hasTrimBleedGuide'
  | 'trimBleedGuidePolygonPoints'
  | 'trimBleedGuidePath'
  | 'trimBleedInteriorClipSpec'
> {
  const empty = {
    hasTrimBleedGuide: false,
    trimBleedGuidePolygonPoints: null,
    trimBleedGuidePath: null,
    trimBleedInteriorClipSpec: null,
  };

  const trimBleedPx = Math.max(0, Number(trimBleedCm) || 0) * factor;
  if (trimBleedPx <= 0 || baseWidthPx <= 0 || baseHeightPx <= 0) {
    return empty;
  }

  const insetPx = clampTrimBleedInsetPx(
    trimBleedPx,
    baseWidthPx,
    baseHeightPx,
    cornerType,
    cornerRadiusPx,
  );
  if (insetPx <= 0) {
    return empty;
  }

  const interiorClipSpec = buildTrimBleedInteriorClipSpec(
    baseWidthPx,
    baseHeightPx,
    duplexBleedPx,
    insetPx,
    cornerType,
    cornerRadiusPx,
  );
  if (!interiorClipSpec) {
    return empty;
  }

  const hasCorner = cornerType !== 'none' && cornerRadiusPx > 0;
  if (hasCorner && cornerType === 'rounded') {
    return {
      hasTrimBleedGuide: true,
      trimBleedGuidePolygonPoints: null,
      trimBleedGuidePath: buildTrimBleedRoundedGuidePathD(
        baseWidthPx,
        baseHeightPx,
        cornerRadiusPx,
        insetPx,
      ),
      trimBleedInteriorClipSpec: interiorClipSpec,
    };
  }

  if (hasCorner && cornerType === 'chamfer') {
    const chamferPoints = buildTrimBleedChamferGuidePoints(
      baseWidthPx,
      baseHeightPx,
      cornerRadiusPx,
      insetPx,
    );
    return {
      hasTrimBleedGuide: !!chamferPoints,
      trimBleedGuidePolygonPoints: chamferPoints,
      trimBleedGuidePath: null,
      trimBleedInteriorClipSpec: interiorClipSpec,
    };
  }

  return {
    hasTrimBleedGuide: true,
    trimBleedGuidePolygonPoints: buildTrimBleedRectGuidePoints(
      baseWidthPx,
      baseHeightPx,
      insetPx,
    ),
    trimBleedGuidePath: null,
    trimBleedInteriorClipSpec: interiorClipSpec,
  };
}

function clampTrimBleedInsetPx(
  insetPx: number,
  baseWidthPx: number,
  baseHeightPx: number,
  cornerType: CornerType | 'none',
  cornerRadiusPx: number,
): number {
  const maxInset = Math.min(baseWidthPx, baseHeightPx) / 2 - TRIM_BLEED_GUIDE_STROKE_INSET_PX - 0.5;
  let t = Math.min(insetPx, maxInset);
  if (t <= 0) {
    return 0;
  }

  if (cornerType !== 'none' && cornerRadiusPx > 0) {
    if (cornerType === 'chamfer') {
      const sqrt2 = Math.SQRT2;
      const r = cornerRadiusPx;
      const chamferLimit = Math.min(
        (baseWidthPx - 2 * r) / (2 * sqrt2 - 2),
        (baseHeightPx - 2 * r) / (2 * sqrt2 - 2),
      );
      if (Number.isFinite(chamferLimit) && chamferLimit > 0) {
        t = Math.min(t, chamferLimit);
      }
    } else {
      const innerW = baseWidthPx - 2 * t;
      const innerH = baseHeightPx - 2 * t;
      if (innerW <= 2 * cornerRadiusPx + 1 || innerH <= 2 * cornerRadiusPx + 1) {
        const fitByWidth = (baseWidthPx - 2 * cornerRadiusPx - 1) / 2;
        const fitByHeight = (baseHeightPx - 2 * cornerRadiusPx - 1) / 2;
        t = Math.min(t, fitByWidth, fitByHeight);
      }
    }
  }

  return t > TRIM_BLEED_GUIDE_STROKE_INSET_PX ? t : 0;
}

function buildTrimBleedRectGuidePoints(
  widthPx: number,
  heightPx: number,
  insetPx: number,
): string {
  const w = widthPx;
  const h = heightPx;
  const t = insetPx + TRIM_BLEED_GUIDE_STROKE_INSET_PX;
  return [
    `${t},${t}`,
    `${w - t},${t}`,
    `${w - t},${h - t}`,
    `${t},${h - t}`,
  ].join(' ');
}

/** Clip spec for trim-bleed safe zone in sheet coordinates (includes duplex offset). */
function buildTrimBleedInteriorClipSpec(
  baseWidthPx: number,
  baseHeightPx: number,
  duplexBleedPx: number,
  insetPx: number,
  cornerType: CornerType | 'none',
  cornerRadiusPx: number,
): PhSheetClipSpec | null {
  const ox = duplexBleedPx;
  const oy = duplexBleedPx;
  const w = baseWidthPx;
  const h = baseHeightPx;
  const t = insetPx;

  if (t <= 0 || w - 2 * t < 1 || h - 2 * t < 1) {
    return null;
  }

  const bounds = {
    left: ox + t,
    top: oy + t,
    width: w - 2 * t,
    height: h - 2 * t,
  };

  if (cornerType === 'rounded' && cornerRadiusPx > 0) {
    return {
      type: 'rounded',
      radiusPx: Math.max(0, cornerRadiusPx - t),
      bounds,
    };
  }

  if (cornerType === 'chamfer' && cornerRadiusPx > 0) {
    const points = buildOffsetChamferPolygonPoints(w, h, cornerRadiusPx, t);
    if (points.length < 3) {
      return null;
    }
    return {
      type: 'polygon',
      points: points.map((point) => ({ x: point.x + ox, y: point.y + oy })),
    };
  }

  return { type: 'rect', bounds };
}

function buildTrimBleedChamferGuidePoints(
  widthPx: number,
  heightPx: number,
  chamferPx: number,
  insetPx: number,
): string | null {
  const points = buildOffsetChamferPolygonPoints(
    widthPx,
    heightPx,
    chamferPx,
    insetPx + TRIM_BLEED_GUIDE_STROKE_INSET_PX,
  );
  if (points.length < 3) {
    return null;
  }
  return points.map(({ x, y }) => `${x},${y}`).join(' ');
}

/**
 * Inward parallel offset of the chamfer octagon by distance d.
 * Diagonal edges stay parallel to the outer chamfer — length shrinks uniformly.
 */
function buildOffsetChamferPolygonPoints(
  widthPx: number,
  heightPx: number,
  chamferPx: number,
  offsetPx: number,
): Array<{ x: number; y: number }> {
  const w = widthPx;
  const h = heightPx;
  const r = chamferPx;
  const d = offsetPx;
  const sqrt2 = Math.SQRT2;

  if (d <= 0 || r <= 0 || w <= 2 * r + 2 * d || h <= 2 * r + 2 * d) {
    return [];
  }

  const topY = d;
  const bottomY = h - d;
  const leftX = d;
  const rightX = w - d;

  const trDiag = w - r - d * sqrt2;
  const tlSum = r + d * sqrt2;
  const brSum = w + h - r - d * sqrt2;
  const blDiag = r - h + d * sqrt2;

  const topLeftX = tlSum - topY;
  const topRightX = trDiag + topY;
  if (topRightX - topLeftX < 0.5) {
    return [];
  }

  return [
    { x: topLeftX, y: topY },
    { x: topRightX, y: topY },
    { x: rightX, y: rightX - trDiag },
    { x: rightX, y: brSum - rightX },
    { x: brSum - bottomY, y: bottomY },
    { x: blDiag + bottomY, y: bottomY },
    { x: leftX, y: leftX - blDiag },
    { x: leftX, y: tlSum - leftX },
  ];
}

function buildTrimBleedRoundedGuidePathD(
  widthPx: number,
  heightPx: number,
  radiusPx: number,
  insetPx: number,
  originX = 0,
  originY = 0,
): string {
  const strokeInset =
    originX === 0 && originY === 0 ? TRIM_BLEED_GUIDE_STROKE_INSET_PX : 0;
  return buildTrimBleedRoundedPathAt(
    widthPx,
    heightPx,
    radiusPx,
    insetPx,
    originX,
    originY,
    strokeInset,
  );
}

function buildTrimBleedRoundedPathAt(
  widthPx: number,
  heightPx: number,
  radiusPx: number,
  insetPx: number,
  originX: number,
  originY: number,
  strokeInsetPx: number,
): string {
  const w = widthPx;
  const h = heightPx;
  const t = insetPx + strokeInsetPx;
  const ox = originX;
  const oy = originY;
  const r = Math.max(0, radiusPx - insetPx);
  if (r <= 0.5) {
    return `M ${ox + t} ${oy + t} L ${ox + w - t} ${oy + t} L ${ox + w - t} ${oy + h - t} L ${ox + t} ${oy + h - t} Z`;
  }
  return [
    `M ${ox + t + r} ${oy + t}`,
    `L ${ox + w - t - r} ${oy + t}`,
    `A ${r} ${r} 0 0 1 ${ox + w - t} ${oy + t + r}`,
    `L ${ox + w - t} ${oy + h - t - r}`,
    `A ${r} ${r} 0 0 1 ${ox + w - t - r} ${oy + h - t}`,
    `L ${ox + t + r} ${oy + h - t}`,
    `A ${r} ${r} 0 0 1 ${ox + t} ${oy + h - t - r}`,
    `L ${ox + t} ${oy + t + r}`,
    `A ${r} ${r} 0 0 1 ${ox + t + r} ${oy + t}`,
    'Z',
  ].join(' ');
}
