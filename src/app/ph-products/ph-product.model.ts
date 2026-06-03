import { PhCategory } from '../ph-categories/ph-category.model';

export type DimensionsFlexability = 'fixed' | 'dynamic';
export type ExtraSettingKey = 'corners' | 'bleed' | 'folding' | 'duplex' | 'double-sided';
export type ExtraSettingMode = 'required' | 'optional';
/** @deprecated Use ExtraSettingMode */
export type DoubleSidedMode = ExtraSettingMode;
export type CornerType = 'rounded' | 'chamfer';

export interface PhProductLabel {
  he: string;
}

export interface PhColor {
  color: string;
  label: PhProductLabel;
}

export interface PhMaterial {
  weight: number;
  label: PhProductLabel;
  colors: PhColor[];
}

export interface PhDynamicMaterial extends PhMaterial {
  minLength: number;
  maxLength: number;
  minHeight: number;
  maxHeight: number;
}

export interface PhSize {
  length: number;
  width: number;
  label: PhProductLabel;
  materials: PhMaterial[];
}

export interface PhProductProperties {
  dimensionsFlexability: DimensionsFlexability;
  fixed?: {
    sizes: PhSize[];
  };
  dynamic?: {
    materials: PhDynamicMaterial[];
  };
}

export interface PhProduct {
  _id: string;
  printingHouseId?: string;
  name_he: string;
  name_en?: string;
  name_ar?: string;
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
  printingHouseId: string;
  name_he: string;
  category: string;
  subCategory: string;
  properties: PhProductProperties;
}

export interface UpdatePhProductPayload {
  name_he: string;
  category: string;
  subCategory: string;
  properties: PhProductProperties;
}
