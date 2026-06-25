import {
  ExtraSettingKey,
  PhMockup,
  PhMockupPrintArea,
  PhMockupPrintAreaQuad,
  PhMockupPrintAreaRect,
  PhTreeExtraSettings,
} from '../ph-products/ph-product.model';
import {
  ExtraSettingsUiStateMap,
  getExtraSettingMode,
  getExtraSettingOptionCount,
  PRINT_EXTRA_SETTING_KEYS,
  ExtraSettingsContext,
} from './ph-print-extra-settings.util';

export interface MockupPrintOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MockupPrintOverlayQuad {
  nw: { x: number; y: number };
  ne: { x: number; y: number };
  sw: { x: number; y: number };
  se: { x: number; y: number };
  box: MockupPrintOverlayRect;
  clipPath: string;
}

export type MockupPrintOverlay =
  | (MockupPrintOverlayRect & { kind: 'rect' })
  | (MockupPrintOverlayQuad & { kind: 'quad' });

function isValidMockup(mockup?: PhMockup | null): mockup is PhMockup {
  return !!mockup?.url?.trim() && !!mockup.printArea;
}

export function isQuadPrintArea(area: PhMockupPrintArea): area is PhMockupPrintAreaQuad {
  return area.shape === 'quad';
}

function readExtraUiState(
  node: PhTreeExtraSettings,
  key: ExtraSettingKey,
  uiState: ExtraSettingsUiStateMap,
): { selectedIndex: number; enabled: boolean } {
  const mode = getExtraSettingMode(node, key);
  const state = uiState[key];
  if (state) {
    return state;
  }
  if (mode === 'required') {
    return { selectedIndex: 0, enabled: true };
  }
  if (key === 'double-sided') {
    return { selectedIndex: 0, enabled: false };
  }
  return { selectedIndex: 0, enabled: false };
}

function readSelectedOptionMockupOnNode(
  node: PhTreeExtraSettings,
  key: ExtraSettingKey,
  uiState: ExtraSettingsUiStateMap,
): PhMockup | null {
  if (!node.extraSettings?.includes(key)) {
    return null;
  }

  const mode = getExtraSettingMode(node, key);
  const state = readExtraUiState(node, key, uiState);

  if (key === 'double-sided') {
    if (mode === 'optional' && !state.enabled) {
      return null;
    }
    return isValidMockup(node.doubleSided?.mockup) ? node.doubleSided!.mockup! : null;
  }

  if (mode === 'optional' && !state.enabled) {
    return null;
  }

  const optionCount = getExtraSettingOptionCount(node, key);
  if (optionCount === 0) {
    return null;
  }

  const index = Math.min(Math.max(0, state.selectedIndex), optionCount - 1);

  switch (key) {
    case 'corners': {
      const mockup = node.corners?.[index]?.mockup;
      return isValidMockup(mockup) ? mockup : null;
    }
    case 'bleed': {
      const mockup = node.bleeds?.[index]?.mockup;
      return isValidMockup(mockup) ? mockup : null;
    }
    case 'folding': {
      const mockup = node.foldings?.[index]?.mockup;
      return isValidMockup(mockup) ? mockup : null;
    }
    case 'duplex': {
      const mockup = node.duplexes?.[index]?.mockup;
      return isValidMockup(mockup) ? mockup : null;
    }
    default:
      return null;
  }
}

function resolveNodeExtraOptionMockup(
  node: PhTreeExtraSettings,
  uiState: ExtraSettingsUiStateMap,
): PhMockup | null {
  for (const key of PRINT_EXTRA_SETTING_KEYS) {
    const mockup = readSelectedOptionMockupOnNode(node, key, uiState);
    if (mockup) {
      return mockup;
    }
  }
  return null;
}

function readNodeLevelMockup(node: PhTreeExtraSettings): PhMockup | null {
  const mockup = (node as { mockup?: PhMockup }).mockup;
  return isValidMockup(mockup) ? mockup : null;
}

/**
 * Resolves product mockup for print-table mockup view.
 * Priority: color (extra option → node) → material → size → dynamic root.
 */
export function resolveMockupForPrint(
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
  dynamicRootMockup?: PhMockup | null,
): PhMockup | null {
  const levels: (PhTreeExtraSettings | null | undefined)[] = [
    ctx.color,
    ctx.material,
    ctx.size,
    ctx.dynamicRoot,
  ];

  for (const node of levels) {
    if (!node) {
      continue;
    }
    const optionMockup = resolveNodeExtraOptionMockup(node, uiState);
    if (optionMockup) {
      return optionMockup;
    }
    const nodeMockup = readNodeLevelMockup(node);
    if (nodeMockup) {
      return nodeMockup;
    }
  }

  return isValidMockup(dynamicRootMockup) ? dynamicRootMockup : null;
}

function mockupHasPrintFoldingData(mockup: PhMockup): boolean {
  return !!(
    mockup.printFolding?.enabled ||
    mockup.printFoldingCount != null
  );
}

/** Finds the nearest mockup carrying printFolding / printFoldingCount on the product tree. */
export function findPrintFoldingMockupSource(
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
): PhMockup | null {
  const levels: (PhTreeExtraSettings | null | undefined)[] = [
    ctx.color,
    ctx.material,
    ctx.size,
    ctx.dynamicRoot,
  ];

  for (const node of levels) {
    if (!node) {
      continue;
    }
    const foldingOptionMockup = readSelectedOptionMockupOnNode(node, 'folding', uiState);
    if (foldingOptionMockup && mockupHasPrintFoldingData(foldingOptionMockup)) {
      return foldingOptionMockup;
    }
    const nodeMockup = readNodeLevelMockup(node);
    if (nodeMockup && mockupHasPrintFoldingData(nodeMockup)) {
      return nodeMockup;
    }
  }

  return null;
}

/** Merges saved fold handle positions onto the mockup used for print preview. */
export function mergePrintFoldingOntoMockup(
  base: PhMockup,
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
): PhMockup {
  if (mockupHasPrintFoldingData(base)) {
    return base;
  }
  const source = findPrintFoldingMockupSource(ctx, uiState);
  if (!source) {
    return base;
  }
  return {
    ...base,
    printFolding: source.printFolding ?? base.printFolding,
    printFoldingCount: source.printFoldingCount ?? base.printFoldingCount,
  };
}

export function mockupBoundingBoxFromQuad(quad: PhMockupPrintAreaQuad): MockupPrintOverlayRect {
  const xs = [quad.nw.x, quad.ne.x, quad.sw.x, quad.se.x];
  const ys = [quad.nw.y, quad.ne.y, quad.sw.y, quad.se.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

export function buildMockupPrintOverlay(printArea: PhMockupPrintArea): MockupPrintOverlay {
  if (isQuadPrintArea(printArea)) {
    const box = mockupBoundingBoxFromQuad(printArea);
    const toLocal = (point: { x: number; y: number }) => {
      const x = box.width > 0 ? ((point.x - box.x) / box.width) * 100 : 0;
      const y = box.height > 0 ? ((point.y - box.y) / box.height) * 100 : 0;
      return `${x}% ${y}%`;
    };
    const clipPath = `polygon(${[
      printArea.nw,
      printArea.ne,
      printArea.se,
      printArea.sw,
    ]
      .map(toLocal)
      .join(', ')})`;
    return {
      kind: 'quad',
      nw: printArea.nw,
      ne: printArea.ne,
      sw: printArea.sw,
      se: printArea.se,
      box,
      clipPath,
    };
  }

  const rect = printArea as PhMockupPrintAreaRect;
  return {
    kind: 'rect',
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export function isMockupPrintOverlayQuad(
  overlay: MockupPrintOverlay,
): overlay is MockupPrintOverlayQuad & { kind: 'quad' } {
  return (overlay as { kind?: string }).kind === 'quad';
}
