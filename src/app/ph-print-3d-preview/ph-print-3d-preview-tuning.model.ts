import {
  DEFAULT_PH_PRINT_3D_FLOOR,
  DEFAULT_PH_PRINT_3D_LIGHTING,
  DEFAULT_PH_PRINT_3D_MATERIAL,
  PhPrint3dFloorSettings,
  PhPrint3dLightingSettings,
  PhPrint3dMaterialSettings,
} from './ph-print-3d-preview-material.model';

export interface PhPrint3dPreviewCameraTuning {
  fov: number;
  fitPadding: number;
}

export interface PhPrint3dPreviewRendererTuning {
  toneMappingExposure: number;
  shadowMapType: 'PCFSoft' | 'PCF' | 'Basic';
  pixelRatioMax: number;
}

export interface PhPrint3dPreviewTuningSnapshot {
  lighting: PhPrint3dLightingSettings;
  material: PhPrint3dMaterialSettings;
  floor: PhPrint3dFloorSettings;
  camera: PhPrint3dPreviewCameraTuning;
  renderer: PhPrint3dPreviewRendererTuning;
}

export type PhPrint3dTuningFieldType = 'number' | 'color' | 'select';

export interface PhPrint3dTuningField {
  path: string;
  label: string;
  group: string;
  type: PhPrint3dTuningFieldType;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export const DEFAULT_PH_PRINT_3D_CAMERA_TUNING: PhPrint3dPreviewCameraTuning = {
  fov: 38,
  fitPadding: 1.32,
};

export const DEFAULT_PH_PRINT_3D_RENDERER_TUNING: PhPrint3dPreviewRendererTuning = {
  toneMappingExposure: 3,
  shadowMapType: 'PCFSoft',
  pixelRatioMax: 2,
};

export function createDefaultPhPrint3dPreviewTuningSnapshot(): PhPrint3dPreviewTuningSnapshot {
  return clonePhPrint3dPreviewTuningSnapshot({
    lighting: {
      ...DEFAULT_PH_PRINT_3D_LIGHTING,
      keyLightPosition: { ...DEFAULT_PH_PRINT_3D_LIGHTING.keyLightPosition },
      fillLightPosition: { ...DEFAULT_PH_PRINT_3D_LIGHTING.fillLightPosition },
      rimLightPosition: { ...DEFAULT_PH_PRINT_3D_LIGHTING.rimLightPosition },
    },
    material: { ...DEFAULT_PH_PRINT_3D_MATERIAL },
    floor: { ...DEFAULT_PH_PRINT_3D_FLOOR },
    camera: { ...DEFAULT_PH_PRINT_3D_CAMERA_TUNING },
    renderer: { ...DEFAULT_PH_PRINT_3D_RENDERER_TUNING },
  });
}

export function clonePhPrint3dPreviewTuningSnapshot(
  source: PhPrint3dPreviewTuningSnapshot,
): PhPrint3dPreviewTuningSnapshot {
  return JSON.parse(JSON.stringify(source)) as PhPrint3dPreviewTuningSnapshot;
}

export function getTuningValue(snapshot: PhPrint3dPreviewTuningSnapshot, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, snapshot as unknown);
}

export function setTuningValue(
  snapshot: PhPrint3dPreviewTuningSnapshot,
  path: string,
  value: unknown,
): void {
  const keys = path.split('.');
  let cursor: Record<string, unknown> = snapshot as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const next = cursor[key];
    if (next == null || typeof next !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function num(
  path: string,
  label: string,
  group: string,
  min: number,
  max: number,
  step: number,
): PhPrint3dTuningField {
  return { path, label, group, type: 'number', min, max, step };
}

function color(path: string, label: string, group: string): PhPrint3dTuningField {
  return { path, label, group, type: 'color' };
}

export const PH_PRINT_3D_TUNING_FIELDS: PhPrint3dTuningField[] = [
  num('renderer.toneMappingExposure', 'ח exposure', 'רנדרר', 0.2, 3, 0.01),
  {
    path: 'renderer.shadowMapType',
    label: 'סוג shadow map',
    group: 'רנדרר',
    type: 'select',
    options: [
      { value: 'PCFSoft', label: 'PCFSoft' },
      { value: 'PCF', label: 'PCF' },
      { value: 'Basic', label: 'Basic' },
    ],
  },
  num('renderer.pixelRatioMax', 'Pixel ratio מקס׳', 'רנדרר', 1, 3, 0.5),

  num('camera.fov', 'FOV מצלמה', 'מצלמה', 20, 80, 1),
  num('camera.fitPadding', 'ריווח מסגור', 'מצלמה', 1, 2.5, 0.01),

  num('lighting.ambientIntensity', 'Ambient — עוצמה', 'Ambient', 0, 1, 0.01),
  color('lighting.hemisphereSkyColor', 'Hemisphere — שמיים', 'Hemisphere'),
  color('lighting.hemisphereGroundColor', 'Hemisphere — קרקע', 'Hemisphere'),
  num('lighting.hemisphereIntensity', 'Hemisphere — עוצמה', 'Hemisphere', 0, 1, 0.01),

  color('lighting.keyLightColor', 'Key — צבע', 'Key light'),
  num('lighting.keyLightIntensity', 'Key — עוצמה', 'Key light', 0, 2, 0.01),
  num('lighting.keyLightPosition.y', 'Key — Y (יחסי למודל)', 'Key light', -20, 120, 1),
  num('lighting.keyLightPosition.z', 'Key — Z (מלפנים, צל מאחור)', 'Key light', 1, 120, 1),

  color('lighting.fillLightColor', 'Fill — צבע', 'Fill light'),
  num('lighting.fillLightIntensity', 'Fill — עוצמה', 'Fill light', 0, 1.5, 0.01),
  num('lighting.fillLightPosition.x', 'Fill — X (יחסי למודל)', 'Fill light', -120, 120, 1),
  num('lighting.fillLightPosition.y', 'Fill — Y (יחסי למודל)', 'Fill light', -20, 120, 1),
  num('lighting.fillLightPosition.z', 'Fill — Z (יחסי למודל)', 'Fill light', -120, 120, 1),

  color('lighting.rimLightColor', 'Rim — צבע', 'Rim light'),
  num('lighting.rimLightIntensity', 'Rim — עוצמה', 'Rim light', 0, 1.5, 0.01),
  num('lighting.rimLightPosition.x', 'Rim — X (יחסי למודל)', 'Rim light', -120, 120, 1),
  num('lighting.rimLightPosition.y', 'Rim — Y (יחסי למודל)', 'Rim light', -20, 120, 1),
  num('lighting.rimLightPosition.z', 'Rim — Z (יחסי למודל)', 'Rim light', -120, 120, 1),

  num('lighting.shadowOpacity', 'צל — עוצמה', 'צללים', 0, 1, 0.01),
  num('lighting.shadowRadius', 'צל — טשטוש קצוות', 'צללים', 0, 32, 0.25),
  num('lighting.shadowMapSize', 'צל — רזולוציה', 'צללים', 512, 8192, 512),
  num('lighting.shadowBias', 'צל — bias', 'צללים', -0.01, 0.01, 0.00001),
  num('lighting.shadowNormalBias', 'צל — normal bias', 'צללים', 0, 0.2, 0.001),

  num('material.bodyRoughness', 'Body — roughness', 'חומר — Body', 0, 1, 0.01),
  num('material.bodyMetalness', 'Body — metalness', 'חומר — Body', 0, 1, 0.01),
  num('material.bodyBumpScale', 'Body — bump scale', 'חומר — Body', 0, 0.08, 0.001),
  num('material.bodyEnvMapIntensity', 'Body — env map', 'חומר — Body', 0, 2, 0.01),
  num('material.bodyClearcoat', 'Body — clearcoat', 'חומר — Body', 0, 1, 0.01),
  num('material.bodyClearcoatRoughness', 'Body — clearcoat rough', 'חומר — Body', 0, 1, 0.01),
  num('material.bodyIor', 'Body — IOR', 'חומר — Body', 1, 2.5, 0.01),
  num('material.bodySpecularIntensity', 'Body — specular', 'חומר — Body', 0, 2, 0.01),

  num('material.colorFaceRoughness', 'Color — roughness', 'חומר — Color', 0, 1, 0.01),
  num('material.colorFaceMetalness', 'Color — metalness', 'חומר — Color', 0, 1, 0.01),
  num('material.colorFaceBumpScale', 'Color — bump scale', 'חומר — Color', 0, 0.08, 0.001),
  num('material.colorFaceEnvMapIntensity', 'Color — env map', 'חומר — Color', 0, 2, 0.01),
  num('material.colorFaceClearcoat', 'Color — clearcoat', 'חומר — Color', 0, 1, 0.01),
  num('material.colorFaceClearcoatRoughness', 'Color — clearcoat rough', 'חומר — Color', 0, 1, 0.01),
  num('material.colorFaceIor', 'Color — IOR', 'חומר — Color', 1, 2.5, 0.01),
  num('material.colorFaceSpecularIntensity', 'Color — specular', 'חומר — Color', 0, 2, 0.01),

  num('material.printRoughness', 'Print — roughness', 'חומר — Print', 0, 1, 0.01),
  num('material.printMetalness', 'Print — metalness', 'חומר — Print', 0, 1, 0.01),
  num('material.printBumpScale', 'Print — bump scale', 'חומר — Print', 0, 0.08, 0.001),
  num('material.printEnvMapIntensity', 'Print — env map', 'חומר — Print', 0, 2, 0.01),
  num('material.printClearcoat', 'Print — clearcoat', 'חומר — Print', 0, 1, 0.01),
  num('material.printClearcoatRoughness', 'Print — clearcoat rough', 'חומר — Print', 0, 1, 0.01),
  num('material.printIor', 'Print — IOR', 'חומר — Print', 1, 2.5, 0.01),
  num('material.printSpecularIntensity', 'Print — specular', 'חומר — Print', 0, 2, 0.01),

  num('material.bumpMapRepeat', 'Bump — repeat', 'Bump map', 1, 30, 1),

  num('floor.textureRepeat', 'רצפה — repeat', 'רצפה', 1, 40, 1),
  color('floor.surfaceColor', 'רצפה — צבע', 'רצפה'),
  num('floor.sizeCm', 'רצפה — גודל (cm)', 'רצפה', 50, 400, 10),
  num('floor.roughness', 'רצפה — roughness', 'רצפה', 0, 1, 0.01),
  num('floor.metalness', 'רצפה — metalness', 'רצפה', 0, 1, 0.01),
  num('floor.envMapIntensity', 'רצפה — env map', 'רצפה', 0, 2, 0.01),
  num('floor.surfaceY', 'רצפה — Y', 'רצפה', -5, 5, 0.01),
];

export const PH_PRINT_3D_TUNING_GROUPS: string[] = [
  'רנדרר',
  'מצלמה',
  'Ambient',
  'Hemisphere',
  'Key light',
  'Fill light',
  'Rim light',
  'צללים',
  'חומר — Body',
  'חומר — Color',
  'חומר — Print',
  'Bump map',
  'רצפה',
];
