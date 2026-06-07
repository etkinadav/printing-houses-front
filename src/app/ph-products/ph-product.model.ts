import { PhCategory } from '../ph-categories/ph-category.model';
import { PhPrintingHouse } from '../ph-printing-house/ph-printing-house.model';

/** Populated on public catalog (`GET /ph-products`). */
export type PhProductPrintingHouseSummary = Pick<
  PhPrintingHouse,
  '_id' | 'name' | 'logoUrl' | 'logo' | 'address'
>;

export type DimensionsFlexability = 'fixed' | 'dynamic';
export type ExtraSettingKey = 'corners' | 'bleed' | 'folding' | 'duplex' | 'double-sided';
export type ExtraSettingMode = 'required' | 'optional';
/** @deprecated Use ExtraSettingMode */
export type DoubleSidedMode = ExtraSettingMode;
export type CornerType = 'rounded' | 'chamfer';

export interface PhProductLabel {
  he: string;
}

export interface PhExtraSettingMode {
  mode: ExtraSettingMode;
}

export interface PhCorner {
  type: CornerType;
  radius: number | null;
}

export interface PhBleed {
  size: number | null;
}

export interface PhDuplex {
  size: number | null;
}

export interface PhFolding {
  count: number;
  offset: number | null;
}

/** Extra settings attached to a size, material, or color tree node. */
export interface PhTreeExtraSettings {
  extraSettings?: ExtraSettingKey[];
  cornersSetting?: PhExtraSettingMode;
  bleedSetting?: PhExtraSettingMode;
  foldingSetting?: PhExtraSettingMode;
  duplexSetting?: PhExtraSettingMode;
  corners?: PhCorner[];
  bleeds?: PhBleed[];
  duplexes?: PhDuplex[];
  foldings?: PhFolding[];
  doubleSided?: PhExtraSettingMode;
}

export interface PhColor extends PhTreeExtraSettings {
  color: string;
  label: PhProductLabel;
}

export interface PhMaterial extends PhTreeExtraSettings {
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

/** Print area on a mockup image — normalized 0–1 fractions of image width/height. */
export interface PhMockupPrintArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhMockup {
  url: string;
  printArea: PhMockupPrintArea;
}

export interface PhSize extends PhTreeExtraSettings {
  length: number;
  width: number;
  label: PhProductLabel;
  materials: PhMaterial[];
  mockup?: PhMockup;
}

export interface PhProductProperties {
  dimensionsFlexability: DimensionsFlexability;
  fixed?: {
    sizes: PhSize[];
  };
  dynamic?: {
    mockup?: PhMockup;
    materials: PhDynamicMaterial[];
  };
}

export interface PhProduct {
  _id: string;
  printingHouseId?: string | PhProductPrintingHouseSummary;
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
