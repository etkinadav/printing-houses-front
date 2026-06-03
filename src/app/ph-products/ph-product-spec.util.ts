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

function buildColorNodes(colors: PhColor[]): ProductSpecNode[] {
  if (!colors?.length) return [];
  return [
    {
      label: '',
      colorPills: colors.map((c) => ({
        name: c.label?.he?.trim() || '—',
        hex: c.color?.trim() || '#cccccc',
      })),
    },
  ];
}

function buildMaterialNodes(materials: PhMaterial[], t: TranslateFn): ProductSpecNode[] {
  return (materials || []).map((material, index) => {
    const name = material.label?.he?.trim() || t('management.product-create.material-number', { n: index + 1 });
    const weight = t('management.printing-house.spec.weight', { g: material.weight });
    return {
      label: name,
      detail: weight,
      children: buildColorNodes(material.colors || []),
    };
  });
}

function buildDynamicMaterialNodes(materials: PhDynamicMaterial[], t: TranslateFn): ProductSpecNode[] {
  return (materials || []).map((material, index) => {
    const name = material.label?.he?.trim() || t('management.product-create.material-number', { n: index + 1 });
    const weight = t('management.printing-house.spec.weight', { g: material.weight });
    const range = t('management.printing-house.spec.dimensions-range', {
      minL: material.minLength,
      maxL: material.maxLength,
      minH: material.minHeight,
      maxH: material.maxHeight,
    });
    return {
      label: name,
      detail: `${weight} · ${range}`,
      children: buildColorNodes(material.colors || []),
    };
  });
}

function buildSizeNodes(sizes: PhSize[], t: TranslateFn): ProductSpecNode[] {
  return (sizes || []).map((size, index) => {
    const name = size.label?.he?.trim() || t('management.product-create.size-number', { n: index + 1 });
    const dims = t('management.printing-house.spec.size-dimensions', {
      length: size.length,
      width: size.width,
    });
    const materials = buildMaterialNodes(size.materials || [], t);
    return {
      label: name,
      detail: dims,
      children: materials,
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
    tree.push(...buildSizeNodes(product.properties.fixed.sizes, t));
  }

  if (flex === 'dynamic' && product.properties?.dynamic?.materials?.length) {
    tree.push(...buildDynamicMaterialNodes(product.properties.dynamic.materials, t));
  }

  return tree;
}
