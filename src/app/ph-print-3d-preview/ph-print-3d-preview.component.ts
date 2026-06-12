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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PhFilesService } from '../ph-files/ph-files.service';
import { CornerType } from '../ph-products/ph-product.model';
import {
  DEFAULT_PH_PRINT_3D_LIGHTING,
  DEFAULT_PH_PRINT_3D_MATERIAL,
  PhPrint3dLightingSettings,
  PhPrint3dMaterialSettings,
} from './ph-print-3d-preview-material.model';
import {
  buildPhPrint3dPreviewSignature,
  createPaperBumpTexture,
  createPrintPanelMeshes,
  disposeObject3D,
  fitPerspectiveCameraToObject,
  loadCoverPreviewTexture,
  loadPaperBumpTexture,
  LoadedPreviewTexture,
  PH_PRINT_3D_PANEL_THICKNESS_CM,
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

  @ViewChild('host') host?: ElementRef<HTMLElement>;

  loading = true;

  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private panelGroup?: THREE.Group;
  private shadowPlane?: THREE.Mesh;
  private keyLight?: THREE.DirectionalLight;
  private resizeObserver?: ResizeObserver;
  private animationFrameId: number | null = null;
  private buildGeneration = 0;
  private builtSignature = '';
  private pendingRebuild = false;
  private colorTextureResult: LoadedPreviewTexture | null = null;
  private imageTextureResult: LoadedPreviewTexture | null = null;
  private paperBumpMap?: THREE.Texture;
  private environmentMap?: THREE.Texture;
  private pmremGenerator?: THREE.PMREMGenerator;

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
    await this.loadPaperBumpMap();
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
    this.shadowPlane?.geometry.dispose();
    (this.shadowPlane?.material as THREE.Material | undefined)?.dispose();
    this.paperBumpMap?.dispose();
    this.environmentMap?.dispose();
    this.pmremGenerator?.dispose();
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = lighting.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    host.appendChild(this.renderer.domElement);

    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    this.environmentMap = this.pmremGenerator.fromScene(
      roomEnv,
      lighting.environmentBlur,
    ).texture;
    this.scene.environment = this.environmentMap;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 500;

    const ambient = new THREE.AmbientLight(0xffffff, lighting.ambientIntensity);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(
      lighting.hemisphereSkyColor,
      lighting.hemisphereGroundColor,
      lighting.hemisphereIntensity,
    );
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(
      lighting.keyLightColor,
      lighting.keyLightIntensity,
    );
    this.keyLight.position.set(
      lighting.keyLightPosition.x,
      lighting.keyLightPosition.y,
      lighting.keyLightPosition.z,
    );
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(lighting.shadowMapSize, lighting.shadowMapSize);
    this.keyLight.shadow.radius = lighting.shadowRadius;
    this.keyLight.shadow.bias = -0.0002;
    this.keyLight.shadow.normalBias = 0.025;
    this.keyLight.shadow.camera.near = 0.1;
    this.keyLight.shadow.camera.far = 120;
    const shadowSpan = 40;
    this.keyLight.shadow.camera.left = -shadowSpan;
    this.keyLight.shadow.camera.right = shadowSpan;
    this.keyLight.shadow.camera.top = shadowSpan;
    this.keyLight.shadow.camera.bottom = -shadowSpan;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    const fill = new THREE.DirectionalLight(
      lighting.fillLightColor,
      lighting.fillLightIntensity,
    );
    fill.position.set(
      lighting.fillLightPosition.x,
      lighting.fillLightPosition.y,
      lighting.fillLightPosition.z,
    );
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(
      lighting.rimLightColor,
      lighting.rimLightIntensity,
    );
    rim.position.set(
      lighting.rimLightPosition.x,
      lighting.rimLightPosition.y,
      lighting.rimLightPosition.z,
    );
    this.scene.add(rim);

    const shadowMat = new THREE.ShadowMaterial({ opacity: lighting.shadowOpacity });
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), shadowMat);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);

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

    const box = new THREE.Box3().setFromObject(this.panelGroup);
    const center = box.getCenter(new THREE.Vector3());
    if (this.shadowPlane) {
      this.shadowPlane.position.set(center.x, box.min.y - 0.06, center.z);
    }
    if (this.keyLight) {
      this.keyLight.target.position.copy(center);
      this.keyLight.target.updateMatrixWorld();
    }

    const host = this.host?.nativeElement;
    if (this.camera && host) {
      const target = fitPerspectiveCameraToObject(
        this.camera,
        this.panelGroup,
        Math.max(1, host.clientWidth),
        Math.max(1, host.clientHeight),
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
