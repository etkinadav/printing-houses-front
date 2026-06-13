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
  /** Fixed offset from panel focus — fallback when no camera; also used for fill / rim. */
  keyLightPosition: { x: number; y: number; z: number };
  /** Pull key light toward the viewer as a fraction of camera–panel distance. */
  keyLightTowardCameraRatio: number;
  /** Lift key light above the panel focus (fraction of camera–panel distance). */
  keyLightElevationRatio: number;
  /** Subtle sideways offset for natural asymmetry (fraction of distance). */
  keyLightLateralRatio: number;
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
  /** PCF soft shadow blur — higher = softer edges (Three.js shadow.radius). */
  shadowRadius: number;
  shadowOpacity: number;
  shadowBias: number;
  shadowNormalBias: number;
}

export const DEFAULT_PH_PRINT_3D_BUMP_MAP_URL =
  'https://everytexture.com/wp-content/uploads/2020/03/everytexture.com-stock-paper-texture-00104-1024x768.jpg';

export const DEFAULT_PH_PRINT_3D_FLOOR_TEXTURE_URL =
  'https://png.pngtree.com/background/20250314/original/pngtree-high-resolution-close-up-of-light-beige-wood-grain-texture-picture-image_16339835.jpg';

/** Horizontal floor plane under the product. */
export interface PhPrint3dFloorSettings {
  textureUrl: string | null;
  textureRepeat: number;
  /** Solid surface color when no texture is set. */
  surfaceColor: string;
  /** Square floor plane side length (cm). */
  sizeCm: number;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  /** World Y of the floor surface. */
  surfaceY: number;
}

export const DEFAULT_PH_PRINT_3D_FLOOR: PhPrint3dFloorSettings = {
  textureUrl: null,
  textureRepeat: 10,
  surfaceColor: '#ffffff',
  sizeCm: 200,
  roughness: 0.66,
  metalness: 0.69,
  envMapIntensity: 1.55,
  surfaceY: 4.75,
};

export const DEFAULT_PH_PRINT_3D_MATERIAL: PhPrint3dMaterialSettings = {
  bodyRoughness: 0.51,
  bodyMetalness: 0.87,
  bodyBumpScale: 0.074,
  bodyEnvMapIntensity: 0.63,
  bodyClearcoat: 0.73,
  bodyClearcoatRoughness: 0.41,
  bodyIor: 1.82,
  bodySpecularIntensity: 1.28,

  colorFaceRoughness: 0.26,
  colorFaceMetalness: 0.32,
  colorFaceBumpScale: 0.04,
  colorFaceEnvMapIntensity: 1.27,
  colorFaceClearcoat: 0.04,
  colorFaceClearcoatRoughness: 0.65,
  colorFaceIor: 1.42,
  colorFaceSpecularIntensity: 0.85,

  printRoughness: 0.65,
  printMetalness: 0.49,
  printBumpScale: 0.057,
  printEnvMapIntensity: 0.03,
  printClearcoat: 0,
  printClearcoatRoughness: 1,
  printIor: 1.4,
  printSpecularIntensity: 0.18,

  bumpMapUrl: DEFAULT_PH_PRINT_3D_BUMP_MAP_URL,
  bumpMapRepeat: 30,
};

export const DEFAULT_PH_PRINT_3D_LIGHTING: PhPrint3dLightingSettings = {
  toneMappingExposure: 1,
  ambientIntensity: 0.24,
  hemisphereSkyColor: '#eef1f6',
  hemisphereGroundColor: '#d8dce4',
  hemisphereIntensity: 0.12,
  keyLightColor: '#ffffff',
  keyLightIntensity: 2,
  keyLightPosition: { x: 0, y: 55, z: 48 },
  keyLightTowardCameraRatio: 0.38,
  keyLightElevationRatio: 0.52,
  keyLightLateralRatio: 0.05,
  fillLightColor: '#ffffff',
  fillLightIntensity: 1.5,
  fillLightPosition: { x: -51, y: 74, z: -35 },
  rimLightColor: '#ffffff',
  rimLightIntensity: 1.06,
  rimLightPosition: { x: -39, y: 21, z: 49 },
  environmentBlur: 0.11,
  shadowMapSize: 4096,
  shadowRadius: 8,
  shadowOpacity: 0.48,
  shadowBias: -0.00015,
  shadowNormalBias: 0.018,
};
