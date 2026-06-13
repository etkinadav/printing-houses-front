import * as THREE from 'three';
import { CornerType } from '../ph-products/ph-product.model';
import {
  PhPrint3dFloorSettings,
  PhPrint3dMaterialSettings,
} from './ph-print-3d-preview-material.model';

/** Panel depth in scene units (cm). 0.02 cm = 20% of nominal 0.1 cm sheet. */
export const PH_PRINT_3D_PANEL_THICKNESS_CM = 0.02;

export interface LoadedPreviewTexture {
  texture: THREE.Texture | null;
  blobUrl: string | null;
}

export interface PhPrint3dPreviewBuildInput {
  widthCm: number;
  heightCm: number;
  thicknessCm: number;
  cornerType: CornerType | 'none';
  cornerRadiusCm: number;
  colorTexture: THREE.Texture | null;
  colorFallback: string;
  imageTexture: THREE.Texture | null;
  material: PhPrint3dMaterialSettings;
  bumpMap: THREE.Texture | null;
}

export interface PhPrint3dPanelMeshes {
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  frontMesh: THREE.Mesh | null;
}

function assignPlanarUVs(
  geometry: THREE.BufferGeometry,
  widthCm: number,
  heightCm: number,
): void {
  const position = geometry.getAttribute('position');
  if (!position) {
    return;
  }
  const halfW = widthCm / 2;
  const halfH = heightCm / 2;
  const uvs = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uvs[i * 2] = (position.getX(i) + halfW) / widthCm;
    uvs[i * 2 + 1] = (position.getY(i) + halfH) / heightCm;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

/** Shape path is clockwise from +Z; face meshes need CCW so FrontSide faces the camera on +Z. */
function ensureCounterClockwiseShape(shape: THREE.Shape): THREE.Shape {
  const points = shape.getPoints(24);
  if (points.length < 3 || !THREE.ShapeUtils.isClockWise(points)) {
    return shape;
  }
  const ccw = new THREE.Shape();
  ccw.moveTo(points[0].x, points[0].y);
  for (let i = points.length - 1; i > 0; i -= 1) {
    ccw.lineTo(points[i].x, points[i].y);
  }
  ccw.closePath();
  return ccw;
}

function createPanelFaceGeometry(
  shape: THREE.Shape,
  widthCm: number,
  heightCm: number,
): THREE.BufferGeometry {
  const ccwShape = ensureCounterClockwiseShape(shape);
  const geometry = new THREE.ShapeGeometry(ccwShape);
  assignPlanarUVs(geometry, widthCm, heightCm);
  geometry.computeVertexNormals();
  return geometry;
}

/** Procedural fine-grain paper bump — shared across panel materials. */
export function createPaperBumpTexture(repeat = 10): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        const fiber = Math.sin(x * 0.38 + y * 0.09) * 2.2;
        const fiberCross = Math.sin(y * 0.31 - x * 0.06) * 1.6;
        const grain = (Math.random() - 0.5) * 10;
        const v = Math.max(0, Math.min(255, 128 + fiber + fiberCross + grain));
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Load tiled paper bump from URL (via API proxy when cross-origin). */
export async function loadPaperBumpTexture(
  url: string | null | undefined,
  repeat: number,
  fetchBlob?: (sourceUrl: string) => Promise<Blob | null>,
): Promise<THREE.Texture | null> {
  const trimmed = url?.trim() || '';
  if (!trimmed) {
    return null;
  }

  let blobUrl: string | null = null;
  let imageSrc = trimmed;

  if (isCrossOriginPreviewUrl(trimmed) && fetchBlob) {
    const blob = await fetchBlob(trimmed);
    if (blob) {
      blobUrl = URL.createObjectURL(blob);
      imageSrc = blobUrl;
    }
  }

  try {
    const img = await loadImageElement(imageSrc);
    const texture = new THREE.Texture(img);
    const safeRepeat = Math.max(1, repeat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(safeRepeat, safeRepeat);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
    return texture;
  } catch {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
    return null;
  }
}

interface GlossyPhotoSurfaceParams {
  roughness: number;
  metalness: number;
  bumpScale: number;
  envMapIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  ior: number;
  specularIntensity: number;
}

function resolveGlossyPhotoSurface(
  materialParams: PhPrint3dMaterialSettings,
  surface: 'body' | 'colorFace' | 'print',
): GlossyPhotoSurfaceParams {
  if (surface === 'print') {
    return {
      roughness: materialParams.printRoughness,
      metalness: materialParams.printMetalness,
      bumpScale: materialParams.printBumpScale,
      envMapIntensity: materialParams.printEnvMapIntensity,
      clearcoat: materialParams.printClearcoat,
      clearcoatRoughness: materialParams.printClearcoatRoughness,
      ior: materialParams.printIor,
      specularIntensity: materialParams.printSpecularIntensity,
    };
  }
  if (surface === 'colorFace') {
    return {
      roughness: materialParams.colorFaceRoughness,
      metalness: materialParams.colorFaceMetalness,
      bumpScale: materialParams.colorFaceBumpScale,
      envMapIntensity: materialParams.colorFaceEnvMapIntensity,
      clearcoat: materialParams.colorFaceClearcoat,
      clearcoatRoughness: materialParams.colorFaceClearcoatRoughness,
      ior: materialParams.colorFaceIor,
      specularIntensity: materialParams.colorFaceSpecularIntensity,
    };
  }
  return {
    roughness: materialParams.bodyRoughness,
    metalness: materialParams.bodyMetalness,
    bumpScale: materialParams.bodyBumpScale,
    envMapIntensity: materialParams.bodyEnvMapIntensity,
    clearcoat: materialParams.bodyClearcoat,
    clearcoatRoughness: materialParams.bodyClearcoatRoughness,
    ior: materialParams.bodyIor,
    specularIntensity: materialParams.bodySpecularIntensity,
  };
}

function applyGlossyPhotoSurface(
  material: THREE.MeshPhysicalMaterial,
  bumpMap: THREE.Texture | null,
  params: GlossyPhotoSurfaceParams,
): void {
  material.roughness = params.roughness;
  material.metalness = params.metalness;
  material.envMapIntensity = params.envMapIntensity;
  material.clearcoat = params.clearcoat;
  material.clearcoatRoughness = params.clearcoatRoughness;
  material.ior = params.ior;
  material.specularIntensity = params.specularIntensity;
  material.specularColor = new THREE.Color(0xffffff);
  if (bumpMap && params.bumpScale > 0) {
    material.bumpMap = bumpMap;
    material.bumpScale = params.bumpScale;
  }
}

function createShapeFaceMesh(
  shape: THREE.Shape,
  widthCm: number,
  heightCm: number,
  zCm: number,
  material: THREE.MeshPhysicalMaterial,
  flipY = false,
): THREE.Mesh {
  const geometry = createPanelFaceGeometry(shape, widthCm, heightCm);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = zCm;
  if (flipY) {
    mesh.rotation.y = Math.PI;
  }
  return mesh;
}

function createTexturedShapeFaceMesh(
  shape: THREE.Shape,
  widthCm: number,
  heightCm: number,
  zCm: number,
  texture: THREE.Texture,
  materialParams: PhPrint3dMaterialSettings,
  bumpMap: THREE.Texture | null,
  surface: 'colorFace' | 'print',
  options: {
    transparent?: boolean;
    alphaTest?: number;
    flipY?: boolean;
  } = {},
): THREE.Mesh {
  if (surface === 'print') {
    const useAlpha = (options.transparent ?? false) && (options.alphaTest ?? 0) > 0;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: useAlpha,
      alphaTest: useAlpha ? (options.alphaTest ?? 0.001) : 0,
      depthWrite: true,
      toneMapped: false,
      side: THREE.FrontSide,
    });
    const geometry = createPanelFaceGeometry(shape, widthCm, heightCm);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = zCm;
    if (options.flipY) {
      mesh.rotation.y = Math.PI;
    }
    return mesh;
  }

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: texture,
    transparent: options.transparent ?? false,
    alphaTest: options.alphaTest ?? 0,
    depthWrite: !(options.transparent ?? false),
    side: THREE.FrontSide,
  });

  applyGlossyPhotoSurface(
    material,
    bumpMap,
    resolveGlossyPhotoSurface(materialParams, surface),
  );

  return createShapeFaceMesh(shape, widthCm, heightCm, zCm, material, options.flipY ?? false);
}

function addColorSubstrateFace(
  group: THREE.Group,
  shape: THREE.Shape,
  widthCm: number,
  heightCm: number,
  zCm: number,
  input: PhPrint3dPreviewBuildInput,
  options: { flipY?: boolean; renderOrder?: number } = {},
): THREE.Mesh {
  const geometry = createPanelFaceGeometry(shape, widthCm, heightCm);

  const material = input.colorTexture
    ? new THREE.MeshBasicMaterial({
      map: input.colorTexture,
      toneMapped: false,
    })
    : new THREE.MeshBasicMaterial({
      color: new THREE.Color(input.colorFallback),
      toneMapped: false,
    });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = zCm;
  if (options.flipY) {
    mesh.rotation.y = Math.PI;
  }
  mesh.renderOrder = options.renderOrder ?? 1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);
  return mesh;
}

function createSolidShapeFaceMesh(
  shape: THREE.Shape,
  widthCm: number,
  heightCm: number,
  zCm: number,
  hexColor: string,
  materialParams: PhPrint3dMaterialSettings,
  bumpMap: THREE.Texture | null,
  flipY = false,
): THREE.Mesh {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hexColor),
  });
  applyGlossyPhotoSurface(
    material,
    bumpMap,
    resolveGlossyPhotoSurface(materialParams, 'colorFace'),
  );
  return createShapeFaceMesh(shape, widthCm, heightCm, zCm, material, flipY);
}

export function buildPanelShape(
  widthCm: number,
  heightCm: number,
  cornerType: CornerType | 'none',
  cornerRadiusCm: number,
): THREE.Shape {
  const w = Math.max(0.1, widthCm);
  const h = Math.max(0.1, heightCm);
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  const r = Math.min(
    Math.max(0, cornerRadiusCm),
    w / 2 - 0.01,
    h / 2 - 0.01,
  );

  const shape = new THREE.Shape();

  if (cornerType === 'none' || r <= 0) {
    shape.moveTo(x0, y0);
    shape.lineTo(x1, y0);
    shape.lineTo(x1, y1);
    shape.lineTo(x0, y1);
    shape.closePath();
    return shape;
  }

  if (cornerType === 'chamfer') {
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x1 - r, y0);
    shape.lineTo(x1, y0 + r);
    shape.lineTo(x1, y1 - r);
    shape.lineTo(x1 - r, y1);
    shape.lineTo(x0 + r, y1);
    shape.lineTo(x0, y1 - r);
    shape.lineTo(x0, y0 + r);
    shape.closePath();
    return shape;
  }

  // rounded
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x1, y1 - r);
  shape.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x0 + r, y1);
  shape.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x0, y0 + r);
  shape.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

export function createPrintPanelMeshes(input: PhPrint3dPreviewBuildInput): PhPrint3dPanelMeshes {
  const widthCm = Math.max(0.1, input.widthCm);
  const heightCm = Math.max(0.1, input.heightCm);
  const depthCm = Math.max(0.01, input.thicknessCm);
  const shape = buildPanelShape(widthCm, heightCm, input.cornerType, input.cornerRadiusCm);

  const bodyGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: depthCm,
    bevelEnabled: false,
    steps: 1,
  });
  bodyGeometry.translate(0, 0, -depthCm / 2);
  bodyGeometry.computeVertexNormals();

  // ExtrudeGeometry UVs distort texture maps — solid color on edges/sides only.
  const bodyMaterial = new THREE.MeshLambertMaterial({
    color: new THREE.Color(input.colorFallback),
  });
  if (input.bumpMap && input.material.bodyBumpScale > 0) {
    bodyMaterial.bumpMap = input.bumpMap;
    bodyMaterial.bumpScale = input.material.bodyBumpScale;
  }

  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = false;

  const group = new THREE.Group();
  group.add(bodyMesh);

  const faceInset = Math.max(0.008, depthCm * 0.4);
  const printSideColorZ = depthCm / 2 + faceInset;
  const printLayerZ = printSideColorZ + 0.004;

  // Print side (+Z) — always show selected color/texture (same as 2D preview background layer).
  addColorSubstrateFace(group, shape, widthCm, heightCm, printSideColorZ, input);

  // Back side (-Z) — same stock color/texture.
  addColorSubstrateFace(group, shape, widthCm, heightCm, -depthCm / 2 - faceInset, input, {
    flipY: true,
  });

  let frontMesh: THREE.Mesh | null = null;
  if (input.imageTexture) {
    frontMesh = createTexturedShapeFaceMesh(
      shape,
      widthCm,
      heightCm,
      printLayerZ,
      input.imageTexture,
      input.material,
      input.bumpMap,
      'print',
      {},
    );
    frontMesh.renderOrder = 3;
    frontMesh.castShadow = false;
    frontMesh.receiveShadow = false;
    group.add(frontMesh);

    addShapeSilhouetteShadowCaster(
      group,
      shape,
      widthCm,
      heightCm,
      printSideColorZ + 0.002,
      input.imageTexture,
      0.01,
    );
  } else {
    addShapeSilhouetteShadowCaster(
      group,
      shape,
      widthCm,
      heightCm,
      printSideColorZ + 0.004,
    );
  }

  // Upright on floor — print face toward +Z, bottom edge rests on surface.
  group.rotation.set(0, 0, 0);

  return { group, bodyMesh, frontMesh };
}

function applyShapeShadowCast(
  mesh: THREE.Mesh,
  alphaTexture?: THREE.Texture | null,
  alphaTest = 0.01,
): void {
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  if (alphaTexture) {
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      map: alphaTexture,
      alphaTest,
      side: THREE.DoubleSide,
    });
  }
}

/** Exact product outline (rounded/chamfer corners) — shadow-map caster only. */
function addShapeSilhouetteShadowCaster(
  group: THREE.Group,
  shape: THREE.Shape,
  widthCm: number,
  heightCm: number,
  zCm: number,
  alphaTexture?: THREE.Texture | null,
  alphaTest = 0.01,
): void {
  const geometry = createPanelFaceGeometry(shape, widthCm, heightCm);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  material.colorWrite = false;
  material.depthWrite = false;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = zCm;
  applyShapeShadowCast(mesh, alphaTexture, alphaTest);
  group.add(mesh);
}

export function updateShadowLightForPanel(
  light: THREE.DirectionalLight,
  panel: THREE.Object3D,
  surfaceY: number,
  lightOffset: { x: number; y: number; z: number },
): void {
  panel.updateWorldMatrix(true, true);
  const panelBox = new THREE.Box3().setFromObject(panel);
  if (!Number.isFinite(panelBox.min.x)) {
    return;
  }

  const center = panelBox.getCenter(new THREE.Vector3());
  const size = panelBox.getSize(new THREE.Vector3());
  const floorFocus = new THREE.Vector3(center.x, surfaceY, center.z);
  const focus = center.clone().lerp(floorFocus, 0.3);

  light.target.position.copy(focus);
  light.target.updateMatrixWorld();
  light.position.set(
    focus.x + lightOffset.x,
    focus.y + lightOffset.y,
    focus.z + lightOffset.z,
  );
  light.updateMatrixWorld();

  const span = Math.max(size.x, size.y, size.z, 14) * 2;
  const cam = light.shadow.camera;
  cam.left = -span;
  cam.right = span;
  cam.top = span;
  cam.bottom = -span;
  cam.near = 0.01;
  cam.far = span * 3 + 60;
  cam.updateProjectionMatrix();
}

/** Crop vignetted edges so floor texture tiles more cleanly. */
function createTiledFloorCanvasTexture(
  img: HTMLImageElement,
  repeat: number,
): THREE.CanvasTexture {
  const cropMargin = 0.14;
  const texW = Math.max(1, img.naturalWidth || img.width);
  const texH = Math.max(1, img.naturalHeight || img.height);
  const sx = Math.round(texW * cropMargin);
  const sy = Math.round(texH * cropMargin);
  const sw = Math.max(1, Math.round(texW * (1 - cropMargin * 2)));
  const sh = Math.max(1, Math.round(texH * (1 - cropMargin * 2)));

  const tileSize = 512;
  const canvas = document.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, tileSize, tileSize);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const safeRepeat = Math.max(1, repeat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(safeRepeat, safeRepeat);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export async function loadFloorTexture(
  url: string | null | undefined,
  repeat: number,
  fetchBlob?: (sourceUrl: string) => Promise<Blob | null>,
): Promise<THREE.Texture | null> {
  const trimmed = url?.trim() || '';
  if (!trimmed) {
    return null;
  }

  let blobUrl: string | null = null;
  let imageSrc = trimmed;

  if (isCrossOriginPreviewUrl(trimmed) && fetchBlob) {
    const blob = await fetchBlob(trimmed);
    if (blob) {
      blobUrl = URL.createObjectURL(blob);
      imageSrc = blobUrl;
    }
  }

  try {
    const img = await loadImageElement(imageSrc);
    const texture = createTiledFloorCanvasTexture(img, repeat);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
    return texture;
  } catch {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
    return null;
  }
}

export function createFloorMesh(
  texture: THREE.Texture | null,
  settings: PhPrint3dFloorSettings,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(settings.sizeCm, settings.sizeCm);
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(texture ? 0xffffff : 0xc8b08a),
    map: texture,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = settings.surfaceY;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export function applyFloorTexture(
  floorMesh: THREE.Mesh,
  texture: THREE.Texture | null,
  settings: PhPrint3dFloorSettings,
): void {
  const material = floorMesh.material as THREE.MeshLambertMaterial;
  const previous = material.map;
  if (previous && previous !== texture) {
    previous.dispose();
  }
  material.map = texture;
  material.color.set(texture ? 0xffffff : 0xc8b08a);
  material.needsUpdate = true;
}

export function alignFloorUnderObject(
  floorMesh: THREE.Mesh,
  object: THREE.Object3D,
  surfaceY: number,
): void {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  floorMesh.position.set(center.x, surfaceY, center.z);
}

/** Rest on floor surface — lowest point of bounds touches floorY + gap. */
export function placeObjectOnFloor(
  object: THREE.Object3D,
  floorY = 0,
  gap = 0.001,
): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  object.position.y += floorY + gap - box.min.y;
  object.updateMatrixWorld(true);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
    img.src = src;
  });
}

/** Match 2D preview `object-fit: cover` — crop source image, bake to canvas texture. */
export function createCoverCanvasTexture(
  img: HTMLImageElement,
  faceWidthCm: number,
  faceHeightCm: number,
  cornerType: CornerType | 'none' = 'none',
  cornerRadiusCm = 0,
  clipCorners = false,
  vividPrintColors = false,
  backgroundFillColor?: string | null,
): THREE.CanvasTexture {
  const safeFaceW = Math.max(0.1, faceWidthCm);
  const safeFaceH = Math.max(0.1, faceHeightCm);
  const faceAspect = safeFaceW / safeFaceH;
  const texW = Math.max(1, img.naturalWidth || img.width);
  const texH = Math.max(1, img.naturalHeight || img.height);
  const texAspect = texW / texH;

  let sx = 0;
  let sy = 0;
  let sw = texW;
  let sh = texH;
  if (texAspect > faceAspect) {
    sw = Math.round(texH * faceAspect);
    sx = Math.round((texW - sw) / 2);
  } else if (texAspect < faceAspect) {
    sh = Math.round(texW / faceAspect);
    sy = Math.round((texH - sh) / 2);
  }

  const maxEdge = 2048;
  const canvasW = faceAspect >= 1 ? maxEdge : Math.max(1, Math.round(maxEdge * faceAspect));
  const canvasH = faceAspect >= 1 ? Math.max(1, Math.round(maxEdge / faceAspect)) : maxEdge;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvasW, canvasH);
    const fillColor = backgroundFillColor?.trim();
    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
    if (vividPrintColors) {
      ctx.filter = 'contrast(1.14) saturate(1.1) brightness(0.97)';
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasW, canvasH);
    ctx.filter = 'none';

    const shouldMask =
      clipCorners &&
      cornerType !== 'none' &&
      Number(cornerRadiusCm) > 0;
    if (shouldMask) {
      applyFaceCornerAlphaMask(
        ctx,
        canvasW,
        canvasH,
        cornerType,
        cornerRadiusCm,
        safeFaceW,
        safeFaceH,
      );
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = true;
  texture.premultiplyAlpha = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = vividPrintColors
    ? THREE.LinearMipmapLinearFilter
    : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = vividPrintColors ? 8 : 4;
  texture.generateMipmaps = vividPrintColors;
  texture.needsUpdate = true;
  return texture;
}

function resolveCornerRadiusPx(
  canvasW: number,
  canvasH: number,
  cornerType: CornerType | 'none',
  cornerRadiusCm: number,
  faceWidthCm: number,
  faceHeightCm: number,
): number {
  if (cornerType === 'none' || Number(cornerRadiusCm) <= 0) {
    return 0;
  }
  return Math.min(
    Math.max(0, (cornerRadiusCm / faceWidthCm) * canvasW),
    Math.max(0, (cornerRadiusCm / faceHeightCm) * canvasH),
    canvasW / 2 - 1,
    canvasH / 2 - 1,
  );
}

function traceFaceCornerPath(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  cornerType: CornerType | 'none',
  rPx: number,
): void {
  ctx.beginPath();
  if (cornerType === 'none' || rPx <= 0) {
    ctx.rect(0, 0, canvasW, canvasH);
    return;
  }

  if (cornerType === 'rounded') {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(0, 0, canvasW, canvasH, rPx);
      return;
    }
    ctx.moveTo(rPx, 0);
    ctx.lineTo(canvasW - rPx, 0);
    ctx.arcTo(canvasW, 0, canvasW, rPx, rPx);
    ctx.lineTo(canvasW, canvasH - rPx);
    ctx.arcTo(canvasW, canvasH, canvasW - rPx, canvasH, rPx);
    ctx.lineTo(rPx, canvasH);
    ctx.arcTo(0, canvasH, 0, canvasH - rPx, rPx);
    ctx.lineTo(0, rPx);
    ctx.arcTo(0, 0, rPx, 0, rPx);
    ctx.closePath();
    return;
  }

  // chamfer
  ctx.moveTo(rPx, 0);
  ctx.lineTo(canvasW - rPx, 0);
  ctx.lineTo(canvasW, rPx);
  ctx.lineTo(canvasW, canvasH - rPx);
  ctx.lineTo(canvasW - rPx, canvasH);
  ctx.lineTo(rPx, canvasH);
  ctx.lineTo(0, canvasH - rPx);
  ctx.lineTo(0, rPx);
  ctx.closePath();
}

/** Punch alpha to rounded/chamfer face — reliable vs clip-before-draw. */
function applyFaceCornerAlphaMask(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  cornerType: CornerType | 'none',
  cornerRadiusCm: number,
  faceWidthCm: number,
  faceHeightCm: number,
): void {
  const rPx = resolveCornerRadiusPx(
    canvasW,
    canvasH,
    cornerType,
    cornerRadiusCm,
    faceWidthCm,
    faceHeightCm,
  );
  traceFaceCornerPath(ctx, canvasW, canvasH, cornerType, rPx);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

export function isCrossOriginPreviewUrl(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function configurePreviewTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
}

export async function loadCoverPreviewTexture(
  url: string | null | undefined,
  faceWidthCm: number,
  faceHeightCm: number,
  cornerType: CornerType | 'none' = 'none',
  cornerRadiusCm = 0,
  clipCorners = false,
  vividPrintColors = false,
  fetchBlob?: (sourceUrl: string) => Promise<Blob | null>,
  backgroundFillColor?: string | null,
): Promise<LoadedPreviewTexture> {
  const trimmed = url?.trim() || '';
  if (!trimmed) {
    return { texture: null, blobUrl: null };
  }

  let blobUrl: string | null = null;
  let imageSrc = trimmed;

  if (isCrossOriginPreviewUrl(trimmed) && fetchBlob) {
    const blob = await fetchBlob(trimmed);
    if (blob) {
      blobUrl = URL.createObjectURL(blob);
      imageSrc = blobUrl;
    }
  }

  try {
    const img = await loadImageElement(imageSrc);
    const texture = createCoverCanvasTexture(
      img,
      faceWidthCm,
      faceHeightCm,
      cornerType,
      cornerRadiusCm,
      clipCorners,
      vividPrintColors,
      backgroundFillColor,
    );
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    return { texture, blobUrl: null };
  } catch {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
    return { texture: null, blobUrl: null };
  }
}

export async function loadPreviewTexture(
  url: string | null | undefined,
  fetchBlob?: (sourceUrl: string) => Promise<Blob | null>,
): Promise<LoadedPreviewTexture> {
  const trimmed = url?.trim() || '';
  if (!trimmed) {
    return { texture: null, blobUrl: null };
  }

  let blobUrl: string | null = null;
  let sourceUrl = trimmed;

  if (isCrossOriginPreviewUrl(trimmed) && fetchBlob) {
    const blob = await fetchBlob(trimmed);
    if (blob) {
      blobUrl = URL.createObjectURL(blob);
      sourceUrl = blobUrl;
    }
  }

  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    if (!blobUrl) {
      loader.setCrossOrigin('anonymous');
    }
    loader.load(
      sourceUrl,
      (texture) => {
        configurePreviewTexture(texture);
        resolve({ texture, blobUrl });
      },
      undefined,
      () => {
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
        }
        resolve({ texture: null, blobUrl: null });
      },
    );
  });
}

export function revokePreviewTextureBlob(result: LoadedPreviewTexture | null | undefined): void {
  if (result?.blobUrl) {
    URL.revokeObjectURL(result.blobUrl);
  }
}

export function resolvePreviewColorFallback(styles: Record<string, string> | null | undefined): string {
  const raw = styles?.['backgroundColor']?.trim();
  if (raw && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) {
    return raw;
  }
  return '#e8e8e8';
}

export function resolvePreviewColorTextureUrl(
  styles: Record<string, string> | null | undefined,
): string | null {
  const image = styles?.['backgroundImage']?.trim() || '';
  const match = image.match(/url\(["']?([^"')]+)["']?\)/i);
  return match?.[1]?.trim() || null;
}

export function buildPhPrint3dPreviewSignature(input: {
  imageUrl: string | null | undefined;
  widthCm: number;
  heightCm: number;
  thicknessCm: number;
  cornerType: CornerType | 'none';
  cornerRadiusCm: number;
  sheetBackgroundStyles: Record<string, string> | null | undefined;
}): string {
  return JSON.stringify({
    imageUrl: input.imageUrl?.trim() || '',
    widthCm: Number(input.widthCm) || 0,
    heightCm: Number(input.heightCm) || 0,
    thicknessCm: Number(input.thicknessCm) || PH_PRINT_3D_PANEL_THICKNESS_CM,
    cornerType: input.cornerType,
    cornerRadiusCm: Number(input.cornerRadiusCm) || 0,
    colorUrl: resolvePreviewColorTextureUrl(input.sheetBackgroundStyles),
    colorFallback: resolvePreviewColorFallback(input.sheetBackgroundStyles),
  });
}

export function fitPerspectiveCameraToObject(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  containerWidth: number,
  containerHeight: number,
  padding = 1.28,
  floorY?: number,
): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(object);
  if (floorY != null) {
    box.min.y = Math.min(box.min.y, floorY);
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.1);

  const aspect = Math.max(containerWidth, 1) / Math.max(containerHeight, 1);
  camera.aspect = aspect;

  const fovRad = (camera.fov * Math.PI) / 180;
  const distance = (maxDim / 2 / Math.tan(fovRad / 2)) * padding;
  const elevation = floorY != null ? 0.24 : 0.34;

  camera.position.set(
    center.x + distance * 0.42,
    center.y + distance * elevation,
    center.z + distance * 0.92,
  );
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 20;
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  return center.clone();
}

export function disposeObject3D(root: THREE.Object3D | null | undefined): void {
  if (!root) {
    return;
  }
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.customDepthMaterial) {
      mesh.customDepthMaterial.dispose();
      mesh.customDepthMaterial = undefined;
    }
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => disposeMaterial(entry));
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  const std = material as THREE.MeshStandardMaterial;
  std.map?.dispose();
  std.normalMap?.dispose();
  std.roughnessMap?.dispose();
  std.metalnessMap?.dispose();
  std.aoMap?.dispose();
  // bumpMap is shared — disposed by the component
  material.dispose();
}
