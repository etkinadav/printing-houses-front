import * as THREE from 'three';
import { CornerType } from '../ph-products/ph-product.model';

export const PH_PRINT_3D_PANEL_THICKNESS_CM = 0.1;

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

function createShapeFaceMesh(
  shape: THREE.Shape,
  widthCm: number,
  heightCm: number,
  zCm: number,
  material: THREE.MeshStandardMaterial,
  flipY = false,
): THREE.Mesh {
  const geometry = new THREE.ShapeGeometry(shape);
  assignPlanarUVs(geometry, widthCm, heightCm);
  geometry.computeVertexNormals();
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
  options: {
    transparent?: boolean;
    alphaTest?: number;
    roughness?: number;
    metalness?: number;
    flipY?: boolean;
  } = {},
): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    transparent: options.transparent ?? false,
    alphaTest: options.alphaTest ?? 0,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.04,
    depthWrite: !(options.transparent ?? false),
    side: THREE.FrontSide,
  });
  return createShapeFaceMesh(shape, widthCm, heightCm, zCm, material, options.flipY ?? false);
}

function createSolidShapeFaceMesh(
  shape: THREE.Shape,
  widthCm: number,
  heightCm: number,
  zCm: number,
  hexColor: string,
  flipY = false,
): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hexColor),
    roughness: 0.72,
    metalness: 0.04,
  });
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
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(input.colorFallback),
    roughness: 0.72,
    metalness: 0.04,
  });

  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(bodyMesh);

  if (input.colorTexture) {
    const backColorMesh = createTexturedShapeFaceMesh(
      shape,
      widthCm,
      heightCm,
      -depthCm / 2 - 0.001,
      input.colorTexture,
      { flipY: true },
    );
    backColorMesh.castShadow = true;
    backColorMesh.receiveShadow = true;
    group.add(backColorMesh);

    const frontColorMesh = createTexturedShapeFaceMesh(
      shape,
      widthCm,
      heightCm,
      depthCm / 2 + 0.001,
      input.colorTexture,
    );
    frontColorMesh.renderOrder = 1;
    frontColorMesh.castShadow = false;
    frontColorMesh.receiveShadow = false;
    group.add(frontColorMesh);
  } else if (input.imageTexture) {
    const frontColorMesh = createSolidShapeFaceMesh(
      shape,
      widthCm,
      heightCm,
      depthCm / 2 + 0.001,
      input.colorFallback,
    );
    frontColorMesh.renderOrder = 1;
    frontColorMesh.castShadow = false;
    frontColorMesh.receiveShadow = false;
    group.add(frontColorMesh);
  }

  let frontMesh: THREE.Mesh | null = null;
  if (input.imageTexture) {
    frontMesh = createTexturedShapeFaceMesh(
      shape,
      widthCm,
      heightCm,
      depthCm / 2 + 0.002,
      input.imageTexture,
      {
        transparent: true,
        alphaTest: 0.001,
        roughness: 0.38,
        metalness: 0.02,
      },
    );
    frontMesh.renderOrder = 2;
    frontMesh.castShadow = false;
    frontMesh.receiveShadow = false;
    group.add(frontMesh);
  }

  group.rotation.x = -0.12;
  group.rotation.y = 0.28;

  return { group, bodyMesh, frontMesh };
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
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasW, canvasH);

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
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
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
  fetchBlob?: (sourceUrl: string) => Promise<Blob | null>,
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
): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.1);

  const aspect = Math.max(containerWidth, 1) / Math.max(containerHeight, 1);
  camera.aspect = aspect;

  const fovRad = (camera.fov * Math.PI) / 180;
  const distance = (maxDim / 2 / Math.tan(fovRad / 2)) * padding;

  camera.position.set(
    center.x + distance * 0.42,
    center.y + distance * 0.34,
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
  material.dispose();
}
