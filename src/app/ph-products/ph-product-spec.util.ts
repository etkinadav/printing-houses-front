import { PhCategory, PhLabel, PhSubCategory } from '../ph-categories/ph-category.model';
import {
  PhColor,
  PhDynamicMaterial,
  PhMaterial,
  PhProduct,
  PhSize,
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
  /** When false, label renders without bold (materials). */
  emphasis?: boolean;
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
    return {
      label: formatMaterialDisplayLine(rawName, material.weight, undefined, t, index, false),
      colorPills: mapColorPills(material.colors || []),
      emphasis: false,
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
    const pills = mapColorPills(material.colors || []);
    const children: ProductSpecNode[] = [
      { label: range, emphasis: false },
    ];
    if (pills?.length) {
      children.push({ label: '', colorPills: pills, emphasis: false });
    }
    return {
      label: formatMaterialDisplayLine(rawName, material.weight, productName, t, index, stripProductName),
      emphasis: false,
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

    if (singleSize) {
      const sizeLabel = size.label?.he?.trim() || '';
      if (!sizeLabel || sizeLabel === productNameTrim) {
        return { label: dims, children: materials, emphasis: false };
      }
      let shortLabel = sizeLabel;
      if (productNameTrim && sizeLabel.startsWith(productNameTrim)) {
        shortLabel = sizeLabel.slice(productNameTrim.length).trim();
      }
      const label = shortLabel ? `${shortLabel} ${dims}` : dims;
      return { label, children: materials, emphasis: false };
    }

    const sizeLabel = size.label?.he?.trim() || '';
    const name = sizeLabel || t('management.product-create.size-number', { n: index + 1 });
    return {
      label: name,
      detail: dims,
      children: materials,
      emphasis: false,
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
