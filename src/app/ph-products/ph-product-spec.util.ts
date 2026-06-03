import { PhCategory, PhLabel, PhSubCategory } from '../ph-categories/ph-category.model';
import {
  PhBleed,
  PhColor,
  PhCorner,
  PhDuplex,
  PhDynamicMaterial,
  PhExtraSettingMode,
  PhFolding,
  PhMaterial,
  PhProduct,
  PhSize,
  PhTreeExtraSettings,
} from './ph-product.model';

export interface ProductSpecColorPill {
  name: string;
  hex: string;
}

export interface ProductSpecNode {
  label: string;
  detail?: string;
  colorPills?: ProductSpecColorPill[];
  children?: ProductSpecNode[];
  /** When false, label renders without bold (material lines, dimension range, color rows). */
  emphasis?: boolean;
  /** When true, detail line uses bold weight (e.g. size dimensions). */
  detailBold?: boolean;
  /** Extra-setting line (corners, bleed, etc.) — muted opacity in spec tree. */
  isExtraSetting?: boolean;
  /** Material line (fixed) or dimension range (dynamic): bold at 50% opacity. */
  isMutedBold?: boolean;
}

/** Black on light backgrounds, white on dark. */
export function getColorPillTextColor(hex: string): '#000000' | '#ffffff' {
  const rgb = parseCssColor(hex);
  if (!rgb) return '#000000';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.58 ? '#000000' : '#ffffff';
}

function parseCssColor(value: string): { r: number; g: number; b: number } | null {
  const v = (value || '').trim();
  if (!v) return null;

  const hex = v.startsWith('#') ? v.slice(1) : v;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

function resolveLabel(label: PhLabel | undefined, lang: string): string {
  if (!label) return '';
  if (lang === 'en' && label.en?.trim()) return label.en.trim();
  if (lang === 'ar' && label.ar?.trim()) return label.ar.trim();
  return label.he?.trim() || '';
}

export function getProductCategoryLine(product: PhProduct, lang: string): string {
  const { category, subCategory } = resolveCategoryLabels(product, lang);
  if (!category && !subCategory) return '';
  if (!subCategory || subCategory === category) return category;
  return `${category} > ${subCategory}`;
}

function resolveCategoryLabels(
  product: PhProduct,
  lang: string,
): { category: string; subCategory: string } {
  const category = product.category;
  if (!category || typeof category === 'string') {
    return {
      category: typeof category === 'string' ? category : '—',
      subCategory: product.subCategory || '—',
    };
  }

  const cat = category as PhCategory;
  const sub = (cat.subCategories || []).find((s: PhSubCategory) => s.key === product.subCategory);
  return {
    category: resolveLabel(cat.label, lang) || cat.key || '—',
    subCategory: sub ? resolveLabel(sub.label, lang) || sub.key : product.subCategory || '—',
  };
}

function formatExtraMode(mode: PhExtraSettingMode['mode'] | undefined, t: TranslateFn): string {
  return t(
    mode === 'optional'
      ? 'management.printing-house.spec.extra-mode.optional'
      : 'management.printing-house.spec.extra-mode.required',
  );
}

function formatCmValue(value: number | null | undefined, t: TranslateFn): string | null {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return t('management.printing-house.spec.extra-size-cm', { value: Number(value) });
}

function formatCornerValues(corners: PhCorner[], t: TranslateFn): string {
  const parts = corners.map((corner) => {
    const cm = formatCmValue(corner.radius, t);
    if (cm) {
      return cm;
    }
    return t(`management.product-create.corner-type.${corner.type}`);
  });
  return parts.filter(Boolean).join(', ');
}

function formatSizedValues(entries: PhBleed[] | PhDuplex[], t: TranslateFn): string {
  return entries
    .map((entry) => formatCmValue(entry.size, t))
    .filter((v): v is string => !!v)
    .join(', ');
}

function formatFoldingValues(foldings: PhFolding[], t: TranslateFn): string {
  return foldings
    .map((folding) => {
      const countPart = t('management.printing-house.spec.extra-folding-count', {
        count: folding.count,
      });
      const offsetCm = formatCmValue(folding.offset, t);
      if (offsetCm) {
        return t('management.printing-house.spec.extra-folding-with-offset', {
          countPart,
          offset: offsetCm,
        });
      }
      return countPart;
    })
    .join(', ');
}

function formatExtraSettingLine(name: string, values: string, mode: string, t: TranslateFn): string {
  return t('management.printing-house.spec.extra-line', { name, values, mode });
}

function extraSettingSpecNode(label: string): ProductSpecNode {
  return { label, emphasis: false, isExtraSetting: true };
}

function buildExtraSettingSpecNodes(node: PhTreeExtraSettings, t: TranslateFn): ProductSpecNode[] {
  const selected = node.extraSettings ?? [];
  if (!selected.length) {
    return [];
  }

  const nodes: ProductSpecNode[] = [];

  if (selected.includes('corners') && node.corners?.length) {
    const values = formatCornerValues(node.corners, t);
    if (values) {
      nodes.push(
        extraSettingSpecNode(
          formatExtraSettingLine(
            t('management.product-create.extra-settings.corners'),
            values,
            formatExtraMode(node.cornersSetting?.mode, t),
            t,
          ),
        ),
      );
    }
  }

  if (selected.includes('bleed') && node.bleeds?.length) {
    const values = formatSizedValues(node.bleeds, t);
    if (values) {
      nodes.push(
        extraSettingSpecNode(
          formatExtraSettingLine(
            t('management.product-create.extra-settings.bleed'),
            values,
            formatExtraMode(node.bleedSetting?.mode, t),
            t,
          ),
        ),
      );
    }
  }

  if (selected.includes('folding') && node.foldings?.length) {
    const values = formatFoldingValues(node.foldings, t);
    if (values) {
      nodes.push(
        extraSettingSpecNode(
          formatExtraSettingLine(
            t('management.product-create.extra-settings.folding'),
            values,
            formatExtraMode(node.foldingSetting?.mode, t),
            t,
          ),
        ),
      );
    }
  }

  if (selected.includes('duplex') && node.duplexes?.length) {
    const values = formatSizedValues(node.duplexes, t);
    if (values) {
      nodes.push(
        extraSettingSpecNode(
          formatExtraSettingLine(
            t('management.product-create.extra-settings.duplex'),
            values,
            formatExtraMode(node.duplexSetting?.mode, t),
            t,
          ),
        ),
      );
    }
  }

  if (selected.includes('double-sided')) {
    nodes.push(
      extraSettingSpecNode(
        t('management.printing-house.spec.extra-line-mode-only', {
          name: t('management.product-create.extra-settings.double-sided'),
          mode: formatExtraMode(node.doubleSided?.mode, t),
        }),
      ),
    );
  }

  return nodes;
}

function colorToPill(color: PhColor): ProductSpecColorPill {
  return {
    name: color.label?.he?.trim() || '—',
    hex: color.color?.trim() || '#cccccc',
  };
}

function appendMaterialColorChildren(material: PhMaterial, children: ProductSpecNode[], t: TranslateFn): void {
  const colors = material.colors || [];
  const splitColorsToRows = colors.some((color) => buildExtraSettingSpecNodes(color, t).length > 0);

  if (splitColorsToRows) {
    for (const color of colors) {
      const extraNodes = buildExtraSettingSpecNodes(color, t);
      children.push({
        label: '',
        colorPills: [colorToPill(color)],
        children: extraNodes.length ? extraNodes : undefined,
        emphasis: false,
      });
    }
  } else if (colors.length) {
    children.push({
      label: '',
      colorPills: colors.map(colorToPill),
      emphasis: false,
    });
  }

  children.push(...buildExtraSettingSpecNodes(material, t));
}

function collectExtraSettingLinesFromNode(node: PhTreeExtraSettings, t: TranslateFn): string[] {
  return buildExtraSettingSpecNodes(node, t).map((n) => n.label);
}

export function collectProductExtraSettingLines(product: PhProduct, t: TranslateFn): string[] {
  const lines: string[] = [];
  const flex = product.properties?.dimensionsFlexability ?? 'fixed';

  if (flex === 'fixed' && product.properties?.fixed?.sizes?.length) {
    for (const size of product.properties.fixed.sizes) {
      lines.push(...collectExtraSettingLinesFromNode(size, t));
      for (const material of size.materials || []) {
        lines.push(...collectExtraSettingLinesFromNode(material, t));
        for (const color of material.colors || []) {
          lines.push(...collectExtraSettingLinesFromNode(color, t));
        }
      }
    }
  }

  if (flex === 'dynamic' && product.properties?.dynamic?.materials?.length) {
    for (const material of product.properties.dynamic.materials) {
      lines.push(...collectExtraSettingLinesFromNode(material, t));
      for (const color of material.colors || []) {
        lines.push(...collectExtraSettingLinesFromNode(color, t));
      }
    }
  }

  return lines;
}

function mapColorPills(colors: PhColor[]): ProductSpecColorPill[] | undefined {
  if (!colors?.length) return undefined;
  return colors.map((c) => ({
    name: c.label?.he?.trim() || '—',
    hex: c.color?.trim() || '#cccccc',
  }));
}

function formatMaterialDisplayLine(
  rawName: string,
  weight: number,
  productName: string | undefined,
  t: TranslateFn,
  fallbackIndex: number,
  stripProductName: boolean,
): string {
  let name = rawName.trim();
  if (!name) {
    name = t('management.product-create.material-number', { n: fallbackIndex + 1 });
  }

  const productNameTrim = productName?.trim() || '';
  if (stripProductName && productNameTrim) {
    if (name === productNameTrim) {
      return t('management.printing-house.spec.material-weight-only', { g: weight });
    }
    if (name.startsWith(productNameTrim)) {
      name = name.slice(productNameTrim.length).trim();
    }
    if (!name) {
      return t('management.printing-house.spec.material-weight-only', { g: weight });
    }
  }

  return t('management.printing-house.spec.material-line', { name, g: weight });
}

function buildMaterialNodes(materials: PhMaterial[], t: TranslateFn): ProductSpecNode[] {
  return (materials || []).map((material, index) => {
    const rawName = material.label?.he?.trim() || '';
    const children: ProductSpecNode[] = [];
    appendMaterialColorChildren(material, children, t);
    return {
      label: formatMaterialDisplayLine(rawName, material.weight, undefined, t, index, false),
      children: children.length ? children : undefined,
      isMutedBold: true,
    };
  });
}

function buildDynamicMaterialNodes(
  materials: PhDynamicMaterial[],
  t: TranslateFn,
  productName?: string,
): ProductSpecNode[] {
  const stripProductName = materials.length === 1;

  return (materials || []).map((material, index) => {
    const rawName = material.label?.he?.trim() || '';
    const range = t('management.printing-house.spec.dimensions-range', {
      minL: material.minLength,
      maxL: material.maxLength,
      minH: material.minHeight,
      maxH: material.maxHeight,
    });
    const children: ProductSpecNode[] = [{ label: range, emphasis: false }];
    appendMaterialColorChildren(material, children, t);
    return {
      label: formatMaterialDisplayLine(rawName, material.weight, productName, t, index, stripProductName),
      children,
    };
  });
}

function buildSizeNodes(sizes: PhSize[], t: TranslateFn, productName?: string): ProductSpecNode[] {
  const singleSize = sizes.length === 1;
  const productNameTrim = productName?.trim() || '';

  return (sizes || []).map((size, index) => {
    const dims = t('management.printing-house.spec.size-dimensions', {
      length: size.length,
      width: size.width,
    });
    const materials = buildMaterialNodes(size.materials || [], t);
    const sizeExtras = buildExtraSettingSpecNodes(size, t);
    const children: ProductSpecNode[] = [...sizeExtras, ...materials];

    if (singleSize) {
      const sizeLabel = size.label?.he?.trim() || '';
      if (!sizeLabel || sizeLabel === productNameTrim) {
        return { label: dims, emphasis: false, children: children.length ? children : undefined };
      }
      let shortLabel = sizeLabel;
      if (productNameTrim && sizeLabel.startsWith(productNameTrim)) {
        shortLabel = sizeLabel.slice(productNameTrim.length).trim();
      }
      if (shortLabel) {
        return { label: shortLabel, detail: dims, children: children.length ? children : undefined };
      }
      return { label: dims, emphasis: false, children: children.length ? children : undefined };
    }

    const sizeLabel = size.label?.he?.trim() || '';
    const name = sizeLabel || t('management.product-create.size-number', { n: index + 1 });
    return {
      label: name,
      detail: dims,
      children: children.length ? children : undefined,
    };
  });
}

export function buildProductSpecTree(
  product: PhProduct,
  t: TranslateFn,
  lang: string,
): ProductSpecNode[] {
  const flex = product.properties?.dimensionsFlexability ?? 'fixed';
  const tree: ProductSpecNode[] = [];

  if (flex === 'fixed' && product.properties?.fixed?.sizes?.length) {
    tree.push(...buildSizeNodes(product.properties.fixed.sizes, t, product.name_he));
  }

  if (flex === 'dynamic' && product.properties?.dynamic?.materials?.length) {
    tree.push(...buildDynamicMaterialNodes(product.properties.dynamic.materials, t, product.name_he));
  }

  return tree;
}
