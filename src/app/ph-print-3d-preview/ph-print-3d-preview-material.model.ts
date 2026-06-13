/** Glossy photo-paper PBR — tune per product / color later via @Input or product config. */
export interface PhPrint3dMaterialSettings {
  /** Base substrate (body edges, solid faces). */
  bodyRoughness: number;
  bodyMetalness: number;
  bodyBumpScale: number;
  bodyEnvMapIntensity: number;
  bodyClearcoat: number;
  bodyClearcoatRoughness: number;
  bodyIor: number;
  bodySpecularIntensity: number;

  /** Color / texture substrate faces. */
  colorFaceRoughness: number;
  colorFaceMetalness: number;
  colorFaceBumpScale: number;
  colorFaceEnvMapIntensity: number;
  colorFaceClearcoat: number;
  colorFaceClearcoatRoughness: number;
  colorFaceIor: number;
  colorFaceSpecularIntensity: number;

  /** Print layer — glossy photo paper ink surface. */
  printRoughness: number;
  printMetalness: number;
  printBumpScale: number;
  printEnvMapIntensity: number;
  printClearcoat: number;
  printClearcoatRoughness: number;
  printIor: number;
  printSpecularIntensity: number;

  /** Optional image URL for paper bump map (loaded via preview-texture proxy). */
  bumpMapUrl: string | null;
  /** Tile repeat for bump map UVs. */
  bumpMapRepeat: number;
}

/** Scene lighting — tune per theme / product later. */
export interface PhPrint3dLightingSettings {
  toneMappingExposure: number;
  ambientIntensity: number;
  hemisphereSkyColor: string;
  hemisphereGroundColor: string;
  hemisphereIntensity: number;
  keyLightColor: string;
  keyLightIntensity: number;
  keyLightPosition: { x: number; y: number; z: number };
  fillLightColor: string;
  fillLightIntensity: number;
  fillLightPosition: { x: number; y: number; z: number };
  /** Soft rim — edge gloss without mirror-like hotspots. */
  rimLightColor: string;
  rimLightIntensity: number;
  rimLightPosition: { x: number; y: number; z: number };
  /** PMREM blur for scene.environment (lower = softer reflections). */
  environmentBlur: number;
  shadowMapSize: number;
  shadowRadius: number;
  shadowOpacity: number;
}

export const DEFAULT_PH_PRINT_3D_BUMP_MAP_URL =
  'https://everytexture.com/wp-content/uploads/2020/03/everytexture.com-stock-paper-texture-00104-1024x768.jpg';

export const DEFAULT_PH_PRINT_3D_FLOOR_TEXTURE_URL =
  'https://png.pngtree.com/background/20250314/original/pngtree-high-resolution-close-up-of-light-beige-wood-grain-texture-picture-image_16339835.jpg';

/** Wood floor under the product. */
export interface PhPrint3dFloorSettings {
  textureUrl: string | null;
  textureRepeat: number;
  /** Square floor plane side length (cm). */
  sizeCm: number;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  /** World Y of the floor surface. */
  surfaceY: number;
}

export const DEFAULT_PH_PRINT_3D_FLOOR: PhPrint3dFloorSettings = {
  textureUrl: DEFAULT_PH_PRINT_3D_FLOOR_TEXTURE_URL,
  textureRepeat: 10,
  sizeCm: 200,
  roughness: 0.52,
  metalness: 0,
  envMapIntensity: 0.1,
  surfaceY: 0,
};

export const DEFAULT_PH_PRINT_3D_MATERIAL: PhPrint3dMaterialSettings = {
  bodyRoughness: 0.42,
  bodyMetalness: 0,
  bodyBumpScale: 0.014,
  bodyEnvMapIntensity: 0.18,
  bodyClearcoat: 0.12,
  bodyClearcoatRoughness: 0.38,
  bodyIor: 1.42,
  bodySpecularIntensity: 0.55,

  colorFaceRoughness: 0.48,
  colorFaceMetalness: 0,
  colorFaceBumpScale: 0.004,
  colorFaceEnvMapIntensity: 0.06,
  colorFaceClearcoat: 0.04,
  colorFaceClearcoatRoughness: 0.65,
  colorFaceIor: 1.42,
  colorFaceSpecularIntensity: 0.28,

  printRoughness: 0.58,
  printMetalness: 0,
  printBumpScale: 0,
  printEnvMapIntensity: 0.03,
  printClearcoat: 0,
  printClearcoatRoughness: 1,
  printIor: 1.4,
  printSpecularIntensity: 0.18,

  bumpMapUrl: DEFAULT_PH_PRINT_3D_BUMP_MAP_URL,
  bumpMapRepeat: 5,
};

export const DEFAULT_PH_PRINT_3D_LIGHTING: PhPrint3dLightingSettings = {
  toneMappingExposure: 1,
  ambientIntensity: 0.32,
  hemisphereSkyColor: '#eef1f6',
  hemisphereGroundColor: '#c8cdd6',
  hemisphereIntensity: 0,
  keyLightColor: '#ffffff',
  keyLightIntensity: 0.58,
  keyLightPosition: { x: 12, y: 44, z: 10 },
  fillLightColor: '#ffffff',
  fillLightIntensity: 0,
  fillLightPosition: { x: -9, y: 4, z: -3 },
  rimLightColor: '#ffffff',
  rimLightIntensity: 0,
  rimLightPosition: { x: 2, y: 7, z: -11 },
  environmentBlur: 0.11,
  shadowMapSize: 4096,
  shadowRadius: 3,
  shadowOpacity: 1,
};
