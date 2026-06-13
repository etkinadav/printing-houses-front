import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhFilesService } from '../ph-files/ph-files.service';
import { CornerType } from '../ph-products/ph-product.model';
import {
  DEFAULT_PH_PRINT_3D_FLOOR,
  DEFAULT_PH_PRINT_3D_LIGHTING,
  DEFAULT_PH_PRINT_3D_MATERIAL,
  PhPrint3dFloorSettings,
  PhPrint3dLightingSettings,
  PhPrint3dMaterialSettings,
} from './ph-print-3d-preview-material.model';
import {
  clonePhPrint3dPreviewTuningSnapshot,
  createDefaultPhPrint3dPreviewTuningSnapshot,
  DEFAULT_PH_PRINT_3D_CAMERA_TUNING,
  DEFAULT_PH_PRINT_3D_RENDERER_TUNING,
  PhPrint3dPreviewCameraTuning,
  PhPrint3dPreviewRendererTuning,
  PhPrint3dPreviewTuningSnapshot,
} from './ph-print-3d-preview-tuning.model';
import {
  alignFloorUnderObject,
  applyFloorTexture,
  buildPhPrint3dPreviewSignature,
  createFloorMesh,
  createPaperBumpTexture,
  createPrintPanelMeshes,
  disposeObject3D,
  updatePreviewLightsForPanel,
  fitPerspectiveCameraToObject,
  loadCoverPreviewTexture,
  loadCompositePrintFaceTexture,
  loadFloorTexture,
  loadPaperBumpTexture,
  LoadedPreviewTexture,
  PH_PRINT_3D_PANEL_THICKNESS_CM,
  placeObjectOnFloor,
  resolvePreviewColorFallback,
  resolvePreviewColorTextureUrl,
  revokePreviewTextureBlob,
} from './ph-print-3d-preview.util';

@Component({
  selector: 'app-ph-print-3d-preview',
  templateUrl: './ph-print-3d-preview.component.html',
  styleUrls: ['./ph-print-3d-preview.component.scss'],
  host: { class: 'd-block w-100 h-100' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhPrint3dPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() imageUrl: string | null = null;
  @Input() widthCm = 0;
  @Input() heightCm = 0;
  @Input() thicknessCm = PH_PRINT_3D_PANEL_THICKNESS_CM;
  @Input() cornerType: CornerType | 'none' = 'none';
  @Input() cornerRadiusCm = 0;
  @Input() sheetBackgroundStyles: Record<string, string> = { backgroundColor: '#ffffff' };
  @Input() isDarkMode = false;

  /** PBR paper params — wire to product / color later. */
  materialSettings: PhPrint3dMaterialSettings = { ...DEFAULT_PH_PRINT_3D_MATERIAL };

  /** Scene lighting — wire to theme / product later. */
  lightingSettings: PhPrint3dLightingSettings = { ...DEFAULT_PH_PRINT_3D_LIGHTING };

  /** Wood floor — wire to product / theme later. */
  floorSettings: PhPrint3dFloorSettings = { ...DEFAULT_PH_PRINT_3D_FLOOR };

  /** Dev tuning — camera / renderer (not persisted). */
  cameraTuning: PhPrint3dPreviewCameraTuning = { ...DEFAULT_PH_PRINT_3D_CAMERA_TUNING };
  rendererTuning: PhPrint3dPreviewRendererTuning = { ...DEFAULT_PH_PRINT_3D_RENDERER_TUNING };

  @ViewChild('host') host?: ElementRef<HTMLElement>;

  loading = true;

  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private panelGroup?: THREE.Group;
  private floorMesh?: THREE.Mesh;
  private keyLight?: THREE.DirectionalLight;
  private fillLight?: THREE.DirectionalLight;
  private rimLight?: THREE.DirectionalLight;
  private ambientLight?: THREE.AmbientLight;
  private hemisphereLight?: THREE.HemisphereLight;
  private panelLightsRig?: THREE.Group;
  private resizeObserver?: ResizeObserver;
  private animationFrameId: number | null = null;
  private buildGeneration = 0;
  private builtSignature = '';
  private pendingRebuild = false;
  private appliedBumpMapRepeat = DEFAULT_PH_PRINT_3D_MATERIAL.bumpMapRepeat;
  private appliedFloorTextureRepeat = DEFAULT_PH_PRINT_3D_FLOOR.textureRepeat;
  private colorTextureResult: LoadedPreviewTexture | null = null;
  private imageTextureResult: LoadedPreviewTexture | null = null;
  private paperBumpMap?: THREE.Texture;

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private phFilesService: PhFilesService,
  ) {}

  getTuningSnapshot(): PhPrint3dPreviewTuningSnapshot {
    return clonePhPrint3dPreviewTuningSnapshot({
      lighting: this.lightingSettings,
      material: this.materialSettings,
      floor: this.floorSettings,
      camera: this.cameraTuning,
      renderer: this.rendererTuning,
    });
  }

  applyTuningSnapshot(snapshot: PhPrint3dPreviewTuningSnapshot): void {
    const cloned = clonePhPrint3dPreviewTuningSnapshot(snapshot);
    this.lightingSettings = cloned.lighting;
    this.materialSettings = cloned.material;
    this.floorSettings = cloned.floor;
    this.cameraTuning = cloned.camera;
    this.rendererTuning = cloned.renderer;
    void this.applyRuntimeTunings(true);
  }

  resetTuningsToDefaults(): void {
    this.applyTuningSnapshot(createDefaultPhPrint3dPreviewTuningSnapshot());
  }

  getMutableTuningRoots(): PhPrint3dPreviewTuningSnapshot {
    return {
      lighting: this.lightingSettings,
      material: this.materialSettings,
      floor: this.floorSettings,
      camera: this.cameraTuning,
      renderer: this.rendererTuning,
    };
  }

  async applyRuntimeTunings(refitCamera = false): Promise<void> {
    if (!this.scene) {
      return;
    }

    const lighting = this.lightingSettings;

    if (this.ambientLight) {
      this.ambientLight.intensity = lighting.ambientIntensity;
    }

    if (this.hemisphereLight) {
      this.hemisphereLight.color.set(lighting.hemisphereSkyColor);
      this.hemisphereLight.groundColor.set(lighting.hemisphereGroundColor);
      this.hemisphereLight.intensity = lighting.hemisphereIntensity;
    }

    if (this.keyLight) {
      this.keyLight.color.set(lighting.keyLightColor);
      this.keyLight.intensity = lighting.keyLightIntensity;
      this.keyLight.castShadow = true;
      this.keyLight.shadow.intensity = lighting.shadowOpacity;
      this.keyLight.shadow.radius = Math.max(0, lighting.shadowRadius);
      this.keyLight.shadow.bias = lighting.shadowBias;
      this.keyLight.shadow.normalBias = lighting.shadowNormalBias;
      if (
        this.keyLight.shadow.mapSize.x !== lighting.shadowMapSize ||
        this.keyLight.shadow.mapSize.y !== lighting.shadowMapSize
      ) {
        this.keyLight.shadow.mapSize.set(lighting.shadowMapSize, lighting.shadowMapSize);
      }
      if (this.renderer) {
        this.renderer.shadowMap.needsUpdate = true;
      }
    }

    if (this.floorMesh) {
      this.floorMesh.receiveShadow = true;
    }

    if (this.fillLight) {
      this.fillLight.color.set(lighting.fillLightColor);
      this.fillLight.intensity = lighting.fillLightIntensity;
    }

    if (this.rimLight) {
      this.rimLight.color.set(lighting.rimLightColor);
      this.rimLight.intensity = lighting.rimLightIntensity;
    }

    if (this.renderer) {
      this.renderer.toneMappingExposure = this.rendererTuning.toneMappingExposure;
      const shadowTypeMap: Record<PhPrint3dPreviewRendererTuning['shadowMapType'], THREE.ShadowMapType> = {
        PCFSoft: THREE.PCFSoftShadowMap,
        PCF: THREE.PCFShadowMap,
        Basic: THREE.BasicShadowMap,
      };
      this.renderer.shadowMap.type = shadowTypeMap[this.rendererTuning.shadowMapType];
      const host = this.host?.nativeElement;
      if (host) {
        const ratio = Math.min(window.devicePixelRatio || 1, this.rendererTuning.pixelRatioMax);
        this.renderer.setPixelRatio(ratio);
      }
    }

    if (this.camera) {
      this.camera.fov = this.cameraTuning.fov;
      this.camera.updateProjectionMatrix();
    }

    this.applyPanelMaterialTunings();

    if (this.floorMesh) {
      const floorMat = this.floorMesh.material as THREE.MeshLambertMaterial;
      if (floorMat.map) {
        floorMat.map.repeat.set(this.floorSettings.textureRepeat, this.floorSettings.textureRepeat);
        floorMat.map.needsUpdate = true;
        floorMat.color.set(0xffffff);
      } else {
        floorMat.color.set(this.floorSettings.surfaceColor);
      }
    }

    if (this.floorSettings.textureUrl && this.floorSettings.textureRepeat !== this.appliedFloorTextureRepeat) {
      this.appliedFloorTextureRepeat = this.floorSettings.textureRepeat;
      await this.loadFloor();
    }

    if (this.materialSettings.bumpMapRepeat !== this.appliedBumpMapRepeat) {
      this.appliedBumpMapRepeat = this.materialSettings.bumpMapRepeat;
      await this.loadPaperBumpMap();
      if (this.panelGroup) {
        this.pendingRebuild = true;
        this.builtSignature = '';
        this.flushRebuildIfNeeded();
      }
    }

    if (refitCamera) {
      this.refitCameraToPanel();
    }

    this.syncPanelLights();
  }

  private syncPanelLights(): void {
    if (!this.keyLight || !this.panelGroup) {
      return;
    }
    updatePreviewLightsForPanel(
      {
        keyLight: this.keyLight,
        fillLight: this.fillLight,
        rimLight: this.rimLight,
      },
      this.panelGroup,
      this.floorSettings.surfaceY,
      this.lightingSettings,
    );
    if (this.renderer) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  private setupPanelLightsRig(): void {
    if (!this.scene || !this.keyLight || !this.fillLight || !this.rimLight) {
      return;
    }

    this.panelLightsRig = new THREE.Group();
    this.panelLightsRig.name = 'panelLightsRig';

    const attach = (light: THREE.DirectionalLight): void => {
      const target = new THREE.Object3D();
      this.scene?.remove(light);
      if (light.target.parent) {
        light.target.removeFromParent();
      }
      this.panelLightsRig?.add(target);
      this.panelLightsRig?.add(light);
      light.target = target;
    };

    attach(this.keyLight);
    attach(this.fillLight);
    attach(this.rimLight);

    this.scene.add(this.panelLightsRig);
  }

  private attachLightsToPanel(panel: THREE.Group): void {
    if (!this.panelLightsRig) {
      return;
    }
    this.panelLightsRig.removeFromParent();
    panel.add(this.panelLightsRig);
    this.syncPanelLights();
  }

  private detachLightsFromPanel(): void {
    if (!this.panelLightsRig || !this.scene) {
      return;
    }
    if (this.panelLightsRig.parent) {
      this.panelLightsRig.removeFromParent();
    }
    this.scene.add(this.panelLightsRig);
  }

  private applyPanelMaterialTunings(): void {
    if (!this.panelGroup) {
      return;
    }
    const bump = this.paperBumpMap ?? null;
    const { bodyBumpScale } = this.materialSettings;

    this.panelGroup.traverse((node) => {
      const mesh = node as THREE.Mesh;
      const material = mesh.material;
      if (!material || Array.isArray(material)) {
        return;
      }
      const lambert = material as THREE.MeshLambertMaterial;
      if (lambert.isMeshLambertMaterial) {
        if (bump && bodyBumpScale > 0) {
          lambert.bumpMap = bump;
          lambert.bumpScale = bodyBumpScale;
        } else {
          lambert.bumpMap = null;
          lambert.bumpScale = 0;
        }
        lambert.needsUpdate = true;
      }
    });
  }

  private refitCameraToPanel(): void {
    const host = this.host?.nativeElement;
    if (!this.camera || !this.panelGroup || !host) {
      return;
    }
    const target = fitPerspectiveCameraToObject(
      this.camera,
      this.panelGroup,
      Math.max(1, host.clientWidth),
      Math.max(1, host.clientHeight),
      this.cameraTuning.fitPadding,
      this.floorSettings.surfaceY,
    );
    this.controls?.target.copy(target);
    this.controls?.update();
  }

  ngAfterViewInit(): void {
    void this.bootstrapScene();
  }

  private async bootstrapScene(): Promise<void> {
    this.initScene();
    await Promise.all([this.loadPaperBumpMap(), this.loadFloor()]);
    this.flushRebuildIfNeeded();
    this.setupResizeObserver();
  }

  private async loadPaperBumpMap(): Promise<void> {
    const { bumpMapUrl, bumpMapRepeat } = this.materialSettings;
    const loaded = await loadPaperBumpTexture(
      bumpMapUrl,
      bumpMapRepeat,
      this.fetchPreviewBlob,
    );
    this.paperBumpMap?.dispose();
    this.paperBumpMap =
      loaded ?? createPaperBumpTexture(bumpMapRepeat);
  }

  private async loadFloor(): Promise<void> {
    const { textureUrl, textureRepeat } = this.floorSettings;
    const loaded = await loadFloorTexture(
      textureUrl,
      textureRepeat,
      this.fetchPreviewBlob,
    );
    if (!this.scene || !this.floorMesh) {
      loaded?.dispose();
      return;
    }
    applyFloorTexture(this.floorMesh, loaded, this.floorSettings);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['imageUrl'] ||
      changes['widthCm'] ||
      changes['heightCm'] ||
      changes['thicknessCm'] ||
      changes['cornerType'] ||
      changes['cornerRadiusCm'] ||
      changes['sheetBackgroundStyles']
    ) {
      this.pendingRebuild = true;
      this.flushRebuildIfNeeded();
    }
    if (changes['isDarkMode'] && this.scene) {
      this.applySceneBackground();
    }
  }

  ngOnDestroy(): void {
    this.buildGeneration += 1;
    this.resizeObserver?.disconnect();
    if (this.animationFrameId != null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.controls?.dispose();
    this.clearPanelAssets();
    if (this.floorMesh) {
      const floorMat = this.floorMesh.material as THREE.MeshLambertMaterial;
      floorMat.map?.dispose();
      floorMat.dispose();
      this.floorMesh.geometry.dispose();
    }
    this.paperBumpMap?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.parentElement?.removeChild(this.renderer.domElement);
  }

  private currentBuildSignature(): string {
    return buildPhPrint3dPreviewSignature({
      imageUrl: this.imageUrl,
      widthCm: this.widthCm,
      heightCm: this.heightCm,
      thicknessCm: this.thicknessCm,
      cornerType: this.cornerType,
      cornerRadiusCm: this.cornerRadiusCm,
      sheetBackgroundStyles: this.sheetBackgroundStyles,
    });
  }

  private flushRebuildIfNeeded(): void {
    if (!this.scene || !this.pendingRebuild) {
      return;
    }

    const signature = this.currentBuildSignature();
    if (signature === this.builtSignature) {
      this.pendingRebuild = false;
      return;
    }

    this.pendingRebuild = false;
    this.builtSignature = signature;
    void this.rebuildPanel();
  }

  private initScene(): void {
    const host = this.host?.nativeElement;
    if (!host) {
      return;
    }

    const lighting = this.lightingSettings;

    this.scene = new THREE.Scene();
    this.applySceneBackground();

    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    this.camera = new THREE.PerspectiveCamera(this.cameraTuning.fov, width / height, 0.01, 2000);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = this.rendererTuning.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 500;

    const ambient = new THREE.AmbientLight(0xffffff, lighting.ambientIntensity);
    this.ambientLight = ambient;
    this.scene.add(ambient);

    const hemisphere = new THREE.HemisphereLight(
      lighting.hemisphereSkyColor,
      lighting.hemisphereGroundColor,
      lighting.hemisphereIntensity,
    );
    this.hemisphereLight = hemisphere;
    this.scene.add(hemisphere);

    this.keyLight = new THREE.DirectionalLight(
      lighting.keyLightColor,
      lighting.keyLightIntensity,
    );
    this.keyLight.castShadow = true;
    this.keyLight.shadow.intensity = lighting.shadowOpacity;
    this.keyLight.shadow.mapSize.set(lighting.shadowMapSize, lighting.shadowMapSize);
    this.keyLight.shadow.radius = lighting.shadowRadius;
    this.keyLight.shadow.bias = lighting.shadowBias;
    this.keyLight.shadow.normalBias = lighting.shadowNormalBias;
    this.keyLight.shadow.camera.near = 0.01;
    this.keyLight.shadow.camera.far = 250;

    this.fillLight = new THREE.DirectionalLight(
      lighting.fillLightColor,
      lighting.fillLightIntensity,
    );

    this.rimLight = new THREE.DirectionalLight(
      lighting.rimLightColor,
      lighting.rimLightIntensity,
    );

    this.setupPanelLightsRig();

    this.floorMesh = createFloorMesh(null, this.floorSettings);
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    this.startRenderLoop();
  }

  private applySceneBackground(): void {
    if (!this.scene) {
      return;
    }
    this.scene.background = this.isDarkMode ? new THREE.Color(0x171717) : null;
  }

  private setupResizeObserver(): void {
    const host = this.host?.nativeElement;
    if (!host || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(host);
  }

  private onResize(): void {
    const host = this.host?.nativeElement;
    if (!host || !this.renderer || !this.camera) {
      return;
    }
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    this.renderer.setSize(width, height);
    if (this.panelGroup) {
      const target = fitPerspectiveCameraToObject(
        this.camera,
        this.panelGroup,
        width,
        height,
        this.cameraTuning.fitPadding,
        this.floorSettings.surfaceY,
      );
      this.controls?.target.copy(target);
    } else {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  private setLoading(loading: boolean): void {
    if (this.loading === loading) {
      return;
    }
    this.loading = loading;
    this.cdr.markForCheck();
  }

  private fetchPreviewBlob = (url: string): Promise<Blob | null> =>
    this.phFilesService.fetchPreviewTextureBlob(url);

  private clearPanelAssets(): void {
    this.detachLightsFromPanel();
    if (this.panelGroup) {
      this.scene?.remove(this.panelGroup);
      disposeObject3D(this.panelGroup);
      this.panelGroup = undefined;
    }
    this.colorTextureResult?.texture?.dispose();
    revokePreviewTextureBlob(this.colorTextureResult);
    this.imageTextureResult?.texture?.dispose();
    revokePreviewTextureBlob(this.imageTextureResult);
    this.colorTextureResult = null;
    this.imageTextureResult = null;
  }

  private async rebuildPanel(): Promise<void> {
    const generation = ++this.buildGeneration;
    this.setLoading(true);

    const widthCm = Number(this.widthCm);
    const heightCm = Number(this.heightCm);
    const depthCm = Math.max(0.01, Number(this.thicknessCm) || PH_PRINT_3D_PANEL_THICKNESS_CM);
    if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm) || widthCm <= 0 || heightCm <= 0) {
      this.setLoading(false);
      return;
    }

    this.clearPanelAssets();

    const colorUrl = resolvePreviewColorTextureUrl(this.sheetBackgroundStyles);
    const colorFallback = resolvePreviewColorFallback(this.sheetBackgroundStyles);
    const [colorTextureResult, imageTextureResult] = await Promise.all([
      loadCoverPreviewTexture(
        colorUrl,
        widthCm,
        heightCm,
        this.cornerType,
        Number(this.cornerRadiusCm) || 0,
        false,
        false,
        this.fetchPreviewBlob,
      ),
      loadCompositePrintFaceTexture(
        this.imageUrl,
        colorUrl,
        colorFallback,
        widthCm,
        heightCm,
        this.cornerType,
        Number(this.cornerRadiusCm) || 0,
        this.fetchPreviewBlob,
      ),
    ]);

    if (generation !== this.buildGeneration) {
      colorTextureResult.texture?.dispose();
      revokePreviewTextureBlob(colorTextureResult);
      imageTextureResult.texture?.dispose();
      revokePreviewTextureBlob(imageTextureResult);
      return;
    }

    this.colorTextureResult = colorTextureResult;
    this.imageTextureResult = imageTextureResult;

    const built = createPrintPanelMeshes({
      widthCm,
      heightCm,
      thicknessCm: depthCm,
      cornerType: this.cornerType,
      cornerRadiusCm: Number(this.cornerRadiusCm) || 0,
      colorTexture: colorTextureResult.texture,
      colorFallback,
      imageTexture: imageTextureResult.texture,
      material: this.materialSettings,
      bumpMap: this.paperBumpMap ?? null,
    });

    this.panelGroup = built.group;
    this.scene?.add(this.panelGroup);

    placeObjectOnFloor(this.panelGroup, this.floorSettings.surfaceY);
    this.attachLightsToPanel(this.panelGroup);

    if (this.floorMesh) {
      alignFloorUnderObject(
        this.floorMesh,
        this.panelGroup,
        this.floorSettings.surfaceY,
      );
    }

    if (this.renderer) {
      this.renderer.shadowMap.needsUpdate = true;
    }

    const host = this.host?.nativeElement;
    if (this.camera && host) {
      const target = fitPerspectiveCameraToObject(
        this.camera,
        this.panelGroup,
        Math.max(1, host.clientWidth),
        Math.max(1, host.clientHeight),
        this.cameraTuning.fitPadding,
        this.floorSettings.surfaceY,
      );
      this.controls?.target.copy(target);
      this.controls?.update();
    }

    this.setLoading(false);
  }

  private startRenderLoop(): void {
    this.ngZone.runOutsideAngular(() => {
      const tick = () => {
        this.animationFrameId = requestAnimationFrame(tick);
        this.controls?.update();
        if (this.renderer && this.scene && this.camera) {
          this.renderer.render(this.scene, this.camera);
        }
      };
      tick();
    });
  }
}
