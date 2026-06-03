import { PhCategory, PhLabel, PhSubCategory } from '../ph-categories/ph-category.model';
import {
  PhColor,
  PhDynamicMaterial,
  PhMaterial,
  PhProduct,
  PhSize,
} from './ph-product.model';

export interface ProductSpecNode {
  label: string;
  detail?: string;
  colorHex?: string;
  children?: ProductSpecNode[];
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

function buildColorNodes(colors: PhColor[], t: TranslateFn): ProductSpecNode[] {
  if (!colors?.length) return [];
  return [
    {
      label: t('management.printing-house.spec.colors'),
      children: colors.map((c) => ({
        label: c.label?.he?.trim() || c.color,
        detail: c.color,
        colorHex: c.color,
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
      children: buildColorNodes(material.colors || [], t),
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
      children: buildColorNodes(material.colors || [], t),
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
      children: materials.length
        ? [{ label: t('management.printing-house.spec.materials'), children: materials }]
        : [],
    };
  });
}

export function buildProductSpecTree(
  product: PhProduct,
  t: TranslateFn,
  lang: string,
): ProductSpecNode[] {
  const flex = product.properties?.dimensionsFlexability ?? 'fixed';
  const flexLabel =
    flex === 'fixed'
      ? t('properties.dimensionsFlexability.fixed')
      : t('properties.dimensionsFlexability.dynamic');

  const tree: ProductSpecNode[] = [
    { label: t('management.printing-house.spec.dimensions-type'), detail: flexLabel },
  ];

  if (flex === 'fixed' && product.properties?.fixed?.sizes?.length) {
    tree.push({
      label: t('management.printing-house.spec.sizes'),
      children: buildSizeNodes(product.properties.fixed.sizes, t),
    });
  }

  if (flex === 'dynamic' && product.properties?.dynamic?.materials?.length) {
    tree.push({
      label: t('management.printing-house.spec.materials'),
      children: buildDynamicMaterialNodes(product.properties.dynamic.materials, t),
    });
  }

  return tree;
}
