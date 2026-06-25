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
  mockup?: PhMockup;
}

export interface PhBleed {
  size: number | null;
  mockup?: PhMockup;
}

export interface PhDuplex {
  size: number | null;
  mockup?: PhMockup;
}

export interface PhFolding {
  count: number;
  offset: number | null;
  mockup?: PhMockup;
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
  doubleSided?: PhExtraSettingMode & { mockup?: PhMockup };
}

export interface PhColor extends PhTreeExtraSettings {
  color: string;
  label: PhProductLabel;
  mockup?: PhMockup;
}

export interface PhMaterial extends PhTreeExtraSettings {
  weight?: number | null;
  label: PhProductLabel;
  colors: PhColor[];
  mockup?: PhMockup;
}

export interface PhDynamicMaterial extends PhMaterial {
  minLength: number;
  maxLength: number;
  minHeight: number;
  maxHeight: number;
  defaultLength: number;
  defaultHeight: number;
}

/** Normalized point on a mockup image (0–1 fractions of image width/height). */
export interface PhMockupPoint {
  x: number;
  y: number;
}

/** Axis-aligned print area on a mockup image. */
export interface PhMockupPrintAreaRect {
  shape?: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Free-form quadrilateral print area — four corners relative to original image size. */
export interface PhMockupPrintAreaQuad {
  shape: 'quad';
  nw: PhMockupPoint;
  ne: PhMockupPoint;
  sw: PhMockupPoint;
  se: PhMockupPoint;
}

export type PhMockupPrintArea = PhMockupPrintAreaRect | PhMockupPrintAreaQuad;

/** Per-corner shape params for mockup print area (fractions relative to local print bounds). */
export interface PhMockupPrintCornerParams {
  h: number;
  v: number;
  bulgeH: number;
  bulgeV: number;
}

/** Optional shaped corners on a mockup print area preview. */
export interface PhMockupPrintCorners {
  enabled: boolean;
  type: CornerType;
  nw: PhMockupPrintCornerParams;
  ne: PhMockupPrintCornerParams;
  sw: PhMockupPrintCornerParams;
  se: PhMockupPrintCornerParams;
}

/** Normalized point on the mockup image (0–1). */
export interface PhMockupPrintFoldingPoint {
  x: number;
  y: number;
}

/** Top/bottom fold handle pair — dashed guide connects top to bottom. */
export interface PhMockupPrintFoldingPair {
  top: PhMockupPrintFoldingPoint;
  bottom: PhMockupPrintFoldingPoint;
}

/** Fold guides on mockup print area (editable orange handles). */
export interface PhMockupPrintFolding {
  enabled: boolean;
  count: number;
  pairs: PhMockupPrintFoldingPair[];
}

export interface PhMockup {
  url: string;
  printArea: PhMockupPrintArea;
  printCorners?: PhMockupPrintCorners;
  printFolding?: PhMockupPrintFolding;
  /** @deprecated use printFolding */
  printFoldingCount?: number;
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
  dynamic?: PhTreeExtraSettings & {
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
