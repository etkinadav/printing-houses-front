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

export const DEFAULT_PH_PRINT_3D_MATERIAL: PhPrint3dMaterialSettings = {
  bodyRoughness: 0.42,
  bodyMetalness: 0,
  bodyBumpScale: 0.014,
  bodyEnvMapIntensity: 0.18,
  bodyClearcoat: 0.12,
  bodyClearcoatRoughness: 0.38,
  bodyIor: 1.42,
  bodySpecularIntensity: 0.55,

  colorFaceRoughness: 0.26,
  colorFaceMetalness: 0,
  colorFaceBumpScale: 0.008,
  colorFaceEnvMapIntensity: 0.28,
  colorFaceClearcoat: 0.38,
  colorFaceClearcoatRoughness: 0.24,
  colorFaceIor: 1.46,
  colorFaceSpecularIntensity: 0.72,

  printRoughness: 0.17,
  printMetalness: 0,
  printBumpScale: 0.003,
  printEnvMapIntensity: 0.38,
  printClearcoat: 0.48,
  printClearcoatRoughness: 0.2,
  printIor: 1.48,
  printSpecularIntensity: 0.82,

  bumpMapUrl: DEFAULT_PH_PRINT_3D_BUMP_MAP_URL,
  bumpMapRepeat: 5,
};

export const DEFAULT_PH_PRINT_3D_LIGHTING: PhPrint3dLightingSettings = {
  toneMappingExposure: 0.96,
  ambientIntensity: 0.09,
  hemisphereSkyColor: '#eef1f6',
  hemisphereGroundColor: '#c8cdd6',
  hemisphereIntensity: 0.26,
  keyLightColor: '#fff9f0',
  keyLightIntensity: 0.68,
  keyLightPosition: { x: 12, y: 11, z: 5 },
  fillLightColor: '#e6eeff',
  fillLightIntensity: 0.16,
  fillLightPosition: { x: -9, y: 4, z: -3 },
  rimLightColor: '#fff6ea',
  rimLightIntensity: 0.12,
  rimLightPosition: { x: 2, y: 7, z: -11 },
  environmentBlur: 0.065,
  shadowMapSize: 2048,
  shadowRadius: 8,
  shadowOpacity: 0.21,
};
