import {
  CornerType,
  PhColor,
  PhDynamicMaterial,
  PhMaterial,
  PhMockup,
  PhProduct,
  PhSize,
} from '../ph-products/ph-product.model';
import { isColorTextureUrl } from '../ph-products/ph-color-texture.util';
import {
  PhCanvas,
  PhCanvasPlacement,
  PhCanvasSide,
} from '../ph-canvas/ph-canvas.model';
import {
  remapPlacementsToBaseSheet,
  renderCanvasSideComposite,
} from '../ph-canvas/ph-canvas-composite.util';
import { PhPrintingFile, PhPrintingFilePrintSettings } from '../ph-printing-files/ph-printing-file.model';
import {
  buildExtraSettingsContext,
  ExtraSettingsContext,
  ExtraSettingsUiStateMap,
  resolveSelectedCorner,
  resolveSelectedDuplex,
  resolveSelectedFolding,
  syncExtraUiStateFromSaved,
} from '../ph-printing-files/ph-print-extra-settings.util';
import {
  mergePrintFoldingOntoMockup,
  resolveMockupForPrint,
} from '../ph-printing-files/ph-print-mockup.util';

export interface PhHomeCatalogMockupViewModel {
  mockup: PhMockup;
  compositeUrl: string | null;
  baseWidthCm: number;
  baseHeightCm: number;
  cornerType: CornerType | 'none';
  cornerRadiusCm: number;
  foldingCount: number;
  foldingOffsetCm: number;
  sheetBackgroundStyles: Record<string, string>;
  dynamicDimensionsActive: boolean;
}

function pickColor(
  material: PhMaterial | PhDynamicMaterial | null | undefined,
  colorIndex: number,
): PhColor | null {
  const colors = material?.colors ?? [];
  if (!colors.length) {
    return null;
  }
  const idx = Math.min(Math.max(0, colorIndex), colors.length - 1);
  return colors[idx] ?? null;
}

function colorSwatchStyles(color: PhColor | null): Record<string, string> {
  if (!color) {
    return { backgroundColor: '#ffffff' };
  }
  const raw = color.color?.trim() || '#cccccc';
  if (isColorTextureUrl(raw)) {
    return {
      backgroundColor: '#e8e8e8',
      backgroundImage: `url("${raw}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }
  return { backgroundColor: raw };
}

function resolveProductTree(
  product: PhProduct,
  settings: PhPrintingFilePrintSettings | undefined,
): {
  ctx: ExtraSettingsContext;
  ui: ExtraSettingsUiStateMap;
  baseWidthCm: number;
  baseHeightCm: number;
  dynamicDimensionsActive: boolean;
  sheetBackgroundStyles: Record<string, string>;
} {
  const fixedSizes = product.properties?.fixed?.sizes ?? [];
  const dynamic = product.properties?.dynamic;
  const isDynamic = !!dynamic && fixedSizes.length === 0;
  const ps = settings ?? {};

  if (!isDynamic) {
    const rawSizeIndex =
      ps.sizeIndex != null && Number.isFinite(Number(ps.sizeIndex))
        ? Number(ps.sizeIndex)
        : 0;
    const sizeIndex = fixedSizes.length
      ? Math.min(Math.max(0, Math.floor(rawSizeIndex)), fixedSizes.length - 1)
      : 0;
    const size: PhSize | null = fixedSizes[sizeIndex] ?? null;
    const materials = size?.materials ?? [];
    const rawMaterialIndex =
      ps.materialIndex != null && Number.isFinite(Number(ps.materialIndex))
        ? Number(ps.materialIndex)
        : 0;
    const materialIndex = materials.length
      ? Math.min(Math.max(0, Math.floor(rawMaterialIndex)), materials.length - 1)
      : 0;
    const material = materials[materialIndex] ?? null;
    const colorIndex =
      ps.colorIndex != null && Number.isFinite(Number(ps.colorIndex))
        ? Number(ps.colorIndex)
        : 0;
    const color = pickColor(material, colorIndex);
    const ctx = buildExtraSettingsContext(size, material, color);
    return {
      ctx,
      ui: syncExtraUiStateFromSaved(ctx, ps),
      baseWidthCm: Number(size?.width ?? 0),
      baseHeightCm: Number(size?.length ?? 0),
      dynamicDimensionsActive: false,
      sheetBackgroundStyles: colorSwatchStyles(color),
    };
  }

  const materials = dynamic?.materials ?? [];
  const materialIndex =
    ps.materialIndex != null && Number.isFinite(Number(ps.materialIndex))
      ? Number(ps.materialIndex)
      : 0;
  const material =
    materials[Math.min(Math.max(0, materialIndex), Math.max(0, materials.length - 1))] ?? null;
  const colorIndex =
    ps.colorIndex != null && Number.isFinite(Number(ps.colorIndex))
      ? Number(ps.colorIndex)
      : 0;
  const color = pickColor(material, colorIndex);
  const ctx = buildExtraSettingsContext(null, material, color, dynamic ?? null);
  return {
    ctx,
    ui: syncExtraUiStateFromSaved(ctx, ps),
    baseWidthCm: Number(ps.widthCm ?? (material as PhDynamicMaterial | null)?.defaultHeight ?? 0),
    baseHeightCm: Number(ps.lengthCm ?? (material as PhDynamicMaterial | null)?.defaultLength ?? 0),
    dynamicDimensionsActive: true,
    sheetBackgroundStyles: colorSwatchStyles(color),
  };
}

function sidePlacements(sides: PhCanvasSide[] | undefined, side: 'front' | 'back'): PhCanvasPlacement[] {
  return sides?.find((entry) => entry.side === side)?.placements ?? [];
}

/**
 * Build the same mockup-simulation inputs used by print-table mockup mode,
 * from a product + its public catalog canvas payload.
 */
export async function buildHomeCatalogMockupViewModel(
  product: PhProduct,
  canvas: Pick<PhCanvas, 'printSettings' | 'sides'>,
  files: PhPrintingFile[],
): Promise<PhHomeCatalogMockupViewModel | null> {
  const tree = resolveProductTree(product, canvas.printSettings);
  let mockup = resolveMockupForPrint(
    tree.ctx,
    tree.ui,
    product.properties?.dynamic?.mockup,
  );
  if (!mockup) {
    return null;
  }

  const foldingCount = (() => {
    const count = resolveSelectedFolding(tree.ctx, tree.ui)?.count;
    return Number.isFinite(Number(count)) ? Math.floor(Number(count)) : 0;
  })();
  const foldingOffsetCm = (() => {
    const offset = resolveSelectedFolding(tree.ctx, tree.ui)?.offset;
    return Number.isFinite(Number(offset)) ? Number(offset) : 0;
  })();

  if (foldingCount > 0) {
    mockup = mergePrintFoldingOntoMockup(mockup, tree.ctx, tree.ui) ?? mockup;
  }

  const duplexMarginCm = resolveSelectedDuplex(tree.ctx, tree.ui)?.size ?? 0;
  const frontPlacements = remapPlacementsToBaseSheet(
    sidePlacements(canvas.sides, 'front'),
    tree.baseWidthCm,
    tree.baseHeightCm,
    duplexMarginCm,
  );

  const compositeUrl = await renderCanvasSideComposite(
    frontPlacements,
    files,
    tree.baseWidthCm,
    tree.baseHeightCm,
    { marginCm: 0 },
  );

  const corner = resolveSelectedCorner(tree.ctx, tree.ui);

  return {
    mockup,
    compositeUrl,
    baseWidthCm: tree.baseWidthCm,
    baseHeightCm: tree.baseHeightCm,
    cornerType: corner?.type ?? 'none',
    cornerRadiusCm: Number.isFinite(Number(corner?.radius)) ? Number(corner?.radius) : 0,
    foldingCount,
    foldingOffsetCm,
    sheetBackgroundStyles: tree.sheetBackgroundStyles,
    dynamicDimensionsActive: tree.dynamicDimensionsActive,
  };
}

/**
 * Empty product mockup (no catalog design) — mockup photo only, no print composite.
 */
export function buildEmptyHomeCatalogMockupViewModel(
  product: PhProduct,
): PhHomeCatalogMockupViewModel | null {
  const tree = resolveProductTree(product, undefined);
  const mockup = resolveMockupForPrint(
    tree.ctx,
    tree.ui,
    product.properties?.dynamic?.mockup,
  );
  if (!mockup?.url?.trim()) {
    return null;
  }

  const corner = resolveSelectedCorner(tree.ctx, tree.ui);

  return {
    mockup,
    compositeUrl: null,
    baseWidthCm: tree.baseWidthCm,
    baseHeightCm: tree.baseHeightCm,
    cornerType: corner?.type ?? 'none',
    cornerRadiusCm: Number.isFinite(Number(corner?.radius)) ? Number(corner?.radius) : 0,
    // Keep fold layers off so the empty mockup is just the product photo.
    foldingCount: 0,
    foldingOffsetCm: 0,
    sheetBackgroundStyles: tree.sheetBackgroundStyles,
    dynamicDimensionsActive: tree.dynamicDimensionsActive,
  };
}

/** True when the product has a mockup image that can be shown on the home catalog. */
export function productHasHomeMockupImage(product: PhProduct | null | undefined): boolean {
  if (!product) {
    return false;
  }
  return !!buildEmptyHomeCatalogMockupViewModel(product);
}
