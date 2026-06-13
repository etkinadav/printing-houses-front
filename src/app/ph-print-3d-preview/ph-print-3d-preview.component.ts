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
  alignFloorUnderObject,
  applyFloorTexture,
  buildPhPrint3dPreviewSignature,
  createFloorMesh,
  createPaperBumpTexture,
  createPrintPanelMeshes,
  disposeObject3D,
  updateShadowLightForPanel,
  fitPerspectiveCameraToObject,
  loadCoverPreviewTexture,
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
  readonly materialSettings: PhPrint3dMaterialSettings = { ...DEFAULT_PH_PRINT_3D_MATERIAL };

  /** Scene lighting — wire to theme / product later. */
  readonly lightingSettings: PhPrint3dLightingSettings = { ...DEFAULT_PH_PRINT_3D_LIGHTING };

  /** Wood floor — wire to product / theme later. */
  readonly floorSettings: PhPrint3dFloorSettings = { ...DEFAULT_PH_PRINT_3D_FLOOR };

  @ViewChild('host') host?: ElementRef<HTMLElement>;

  loading = true;

  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private panelGroup?: THREE.Group;
  private floorMesh?: THREE.Mesh;
  private keyLight?: THREE.DirectionalLight;
  private resizeObserver?: ResizeObserver;
  private animationFrameId: number | null = null;
  private buildGeneration = 0;
  private builtSignature = '';
  private pendingRebuild = false;
  private colorTextureResult: LoadedPreviewTexture | null = null;
  private imageTextureResult: LoadedPreviewTexture | null = null;
  private paperBumpMap?: THREE.Texture;

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private phFilesService: PhFilesService,
  ) {}

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
    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 2000);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
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
    this.scene.add(ambient);

    this.keyLight = new THREE.DirectionalLight(
      lighting.keyLightColor,
      lighting.keyLightIntensity,
    );
    this.keyLight.castShadow = true;
    this.keyLight.shadow.intensity = lighting.shadowOpacity;
    this.keyLight.shadow.mapSize.set(lighting.shadowMapSize, lighting.shadowMapSize);
    this.keyLight.shadow.radius = lighting.shadowRadius;
    this.keyLight.shadow.bias = -0.0003;
    this.keyLight.shadow.normalBias = 0.002;
    this.keyLight.shadow.camera.near = 0.01;
    this.keyLight.shadow.camera.far = 250;
    this.keyLight.position.set(
      lighting.keyLightPosition.x,
      lighting.keyLightPosition.y,
      lighting.keyLightPosition.z,
    );
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.floorMesh = createFloorMesh(null, this.floorSettings);
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
        1.32,
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
      loadCoverPreviewTexture(
        this.imageUrl,
        widthCm,
        heightCm,
        this.cornerType,
        Number(this.cornerRadiusCm) || 0,
        false,
        true,
        this.fetchPreviewBlob,
        colorFallback,
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

    if (this.floorMesh) {
      alignFloorUnderObject(
        this.floorMesh,
        this.panelGroup,
        this.floorSettings.surfaceY,
      );
    }

    if (this.keyLight) {
      updateShadowLightForPanel(
        this.keyLight,
        this.panelGroup,
        this.floorSettings.surfaceY,
        this.lightingSettings.keyLightPosition,
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
        1.32,
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
