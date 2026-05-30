import { PhCategory, PhLabel } from '../ph-categories/ph-category.model';

export type DimensionsFlexability = 'fixed' | 'dynamic';

export interface PhColor {
  color: string;
  label: PhLabel;
}

export interface PhMaterial {
  weight: number;
  label: PhLabel;
  colors: PhColor[];
}

export interface PhSize {
  length: number;
  width: number;
  label: PhLabel;
  materials: PhMaterial[];
}

export interface PhProductProperties {
  dimensionsFlexability: DimensionsFlexability;
  fixed?: {
    sizes: PhSize[];
  };
  dynamic?: {
    minLength: number;
    maxLength: number;
    minWidth: number;
    maxWidth: number;
    materials: PhMaterial[];
  };
}

export interface PhProduct {
  _id: string;
  name_he: string;
  name_en: string;
  name_ar: string;
  category: PhCategory | string;
  subCategory: string;
  properties: PhProductProperties;
}

export interface PhSubCategoryGroup {
  name: string;
  products: PhProduct[];
}

export interface PhCategoryGroup {
  name: string;
  subCategories: PhSubCategoryGroup[];
}

export interface CreatePhProductPayload {
  name_he: string;
  name_en: string;
  name_ar: string;
  category: string;
  subCategory: string;
  properties: PhProductProperties;
}
