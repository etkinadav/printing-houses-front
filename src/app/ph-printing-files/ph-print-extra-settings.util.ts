import {
  ExtraSettingKey,
  ExtraSettingMode,
  PhBleed,
  PhColor,
  PhCorner,
  PhDuplex,
  PhDynamicMaterial,
  PhFolding,
  PhMaterial,
  PhProduct,
  PhSize,
  PhTreeExtraSettings,
} from '../ph-products/ph-product.model';
import { PhPrintingFileExtraSelections, PhPrintingFilePrintSettings } from './ph-printing-file.model';

export const PRINT_EXTRA_SETTING_KEYS: ExtraSettingKey[] = [
  'corners',
  'bleed',
  'folding',
  'duplex',
  'double-sided',
];

export interface ExtraSettingsContext {
  size: PhSize | null;
  material: PhMaterial | null;
  color: PhColor | null;
}

export interface ExtraSettingUiState {
  selectedIndex: number;
  enabled: boolean;
}

export type ExtraSettingsUiStateMap = Partial<Record<ExtraSettingKey, ExtraSettingUiState>>;

export interface PrintExtraSettingOption {
  index: number;
  label: string;
  signature: string;
}

export type PrintExtraSettingDisplay = 'single-toggle' | 'multi-buttons' | 'boolean-toggle';

export interface PrintExtraSettingRow {
  key: ExtraSettingKey;
  settingTitle: string;
  singleRowLabel: string;
  toggleOffLabel: string;
  toggleOnLabel: string;
  display: PrintExtraSettingDisplay;
  mode: ExtraSettingMode;
  options: PrintExtraSettingOption[];
  selectedIndex: number;
  enabled: boolean;
  wrap: boolean;
}

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

const SETTINGS_BUTTONS_WRAP_SCORE_THRESHOLD = 30;

/** UI / persisted sentinel for optional multi-option rows: user chose "without". */
export const EXTRA_OPTION_NONE_INDEX = -1;

export function buildExtraSettingsContext(
  size: PhSize | null,
  material: PhMaterial | null,
  color: PhColor | null,
): ExtraSettingsContext {
  return { size, material, color };
}

export function resolveExtraSettingNode(
  ctx: ExtraSettingsContext,
  key: ExtraSettingKey,
): PhTreeExtraSettings | null {
  if (ctx.color?.extraSettings?.includes(key)) {
    return ctx.color;
  }
  if (ctx.material?.extraSettings?.includes(key)) {
    return ctx.material;
  }
  if (ctx.size?.extraSettings?.includes(key)) {
    return ctx.size;
  }
  return null;
}

export function isExtraSettingApplicable(ctx: ExtraSettingsContext, key: ExtraSettingKey): boolean {
  return resolveExtraSettingNode(ctx, key) != null;
}

/** True when double-sided is configured on the resolved tree node and mode is required. */
export function isDoubleSidedRequired(ctx: ExtraSettingsContext): boolean {
  const node = resolveExtraSettingNode(ctx, 'double-sided');
  if (!node) {
    return false;
  }
  return getExtraSettingMode(node, 'double-sided') === 'required';
}

function nodeHasDoubleSidedRequired(node: PhTreeExtraSettings | null | undefined): boolean {
  if (!node?.extraSettings?.includes('double-sided')) {
    return false;
  }
  return getExtraSettingMode(node, 'double-sided') === 'required';
}

/** True when any size/material/color on the product requires double-sided. */
export function productHasDoubleSidedRequired(product: PhProduct | null | undefined): boolean {
  if (!product?.properties) {
    return false;
  }

  const checkNode = (node: PhTreeExtraSettings | null | undefined): boolean =>
    nodeHasDoubleSidedRequired(node);

  for (const size of product.properties.fixed?.sizes ?? []) {
    if (checkNode(size)) {
      return true;
    }
    for (const material of size.materials ?? []) {
      if (checkNode(material)) {
        return true;
      }
      for (const color of material.colors ?? []) {
        if (checkNode(color)) {
          return true;
        }
      }
    }
  }

  for (const material of product.properties.dynamic?.materials ?? []) {
    if (checkNode(material)) {
      return true;
    }
    for (const color of material.colors ?? []) {
      if (checkNode(color)) {
        return true;
      }
    }
  }

  return false;
}

/** True when the resolved tree context crosses into or out of required double-sided mode. */
export function didDoubleSidedRequiredChange(
  previousCtx: ExtraSettingsContext,
  nextCtx: ExtraSettingsContext,
): boolean {
  return isDoubleSidedRequired(previousCtx) !== isDoubleSidedRequired(nextCtx);
}

export function getExtraSettingMode(
  node: PhTreeExtraSettings,
  key: ExtraSettingKey,
): ExtraSettingMode {
  switch (key) {
    case 'corners':
      return node.cornersSetting?.mode ?? 'required';
    case 'bleed':
      return node.bleedSetting?.mode ?? 'required';
    case 'folding':
      return node.foldingSetting?.mode ?? 'required';
    case 'duplex':
      return node.duplexSetting?.mode ?? 'required';
    case 'double-sided':
      return node.doubleSided?.mode ?? 'required';
    default:
      return 'required';
  }
}

export function getExtraSettingOptionCount(node: PhTreeExtraSettings, key: ExtraSettingKey): number {
  switch (key) {
    case 'corners':
      return node.corners?.length ?? 0;
    case 'bleed':
      return node.bleeds?.length ?? 0;
    case 'folding':
      return node.foldings?.length ?? 0;
    case 'duplex':
      return node.duplexes?.length ?? 0;
    case 'double-sided':
      return 0;
    default:
      return 0;
  }
}

export function isExtraSettingVisible(ctx: ExtraSettingsContext, key: ExtraSettingKey): boolean {
  const node = resolveExtraSettingNode(ctx, key);
  if (!node) {
    return false;
  }
  const mode = getExtraSettingMode(node, key);
  const optionCount = getExtraSettingOptionCount(node, key);
  if (mode === 'optional') {
    return true;
  }
  if (key === 'double-sided' && mode === 'required') {
    return true;
  }
  if (mode === 'required' && optionCount === 1) {
    return true;
  }
  return optionCount > 1;
}

function formatCm(t: TranslateFn, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '';
  }
  return t('management.printing-house.spec.extra-size-cm', { value: Number(value) });
}

function cornerTypeLabel(t: TranslateFn, type: PhCorner['type'], short = false): string {
  if (short && type === 'rounded') {
    return t('printing-table.extra.corner-type.rounded-short');
  }
  if (short && type === 'chamfer') {
    return t('printing-table.extra.corner-type.chamfer-short');
  }
  return t(`management.product-create.corner-type.${type}`);
}

export function getExtraSettingTitle(key: ExtraSettingKey, t: TranslateFn): string {
  return t(`management.product-create.extra-settings.${key}`);
}

export function getExtraOptionSignature(
  key: ExtraSettingKey,
  node: PhTreeExtraSettings,
  index: number,
): string {
  switch (key) {
    case 'corners': {
      const corner = node.corners?.[index];
      return corner ? `${corner.type}:${corner.radius ?? ''}` : String(index);
    }
    case 'bleed': {
      const bleed = node.bleeds?.[index];
      return bleed ? String(bleed.size ?? '') : String(index);
    }
    case 'folding': {
      const folding = node.foldings?.[index];
      return folding ? `${folding.count}:${folding.offset ?? ''}` : String(index);
    }
    case 'duplex': {
      const duplex = node.duplexes?.[index];
      return duplex ? String(duplex.size ?? '') : String(index);
    }
    case 'double-sided':
      return 'double-sided';
    default:
      return String(index);
  }
}

export function findExtraOptionIndexBySignature(
  node: PhTreeExtraSettings,
  key: ExtraSettingKey,
  signature: string,
): number {
  const count = getExtraSettingOptionCount(node, key);
  for (let index = 0; index < count; index += 1) {
    if (getExtraOptionSignature(key, node, index) === signature) {
      return index;
    }
  }
  return -1;
}

function formatCornerSingleLabel(corner: PhCorner, t: TranslateFn): string {
  const cm = formatCm(t, corner.radius);
  const type = cornerTypeLabel(t, corner.type, false);
  if (cm) {
    return t('printing-table.extra.corner-single-line', { type, size: cm });
  }
  return type;
}

function formatCornerOptionLabel(corner: PhCorner, t: TranslateFn): string {
  const cm = formatCm(t, corner.radius);
  const type = cornerTypeLabel(t, corner.type, true);
  if (cm) {
    return t('printing-table.extra.corner-option', { type, size: cm });
  }
  return type;
}

function formatSizedSingleLabel(size: number | null | undefined, title: string, t: TranslateFn): string {
  const cm = formatCm(t, size);
  if (cm) {
    return t('printing-table.extra.sized-single-line', { title, size: cm });
  }
  return title;
}

function formatSizedOptionLabel(size: number | null | undefined, t: TranslateFn): string {
  return formatCm(t, size) || '—';
}

function formatFoldingSingleLabel(folding: PhFolding, _title: string, t: TranslateFn): string {
  return formatFoldingOptionLabel(folding, t);
}

function formatFoldingOptionLabel(folding: PhFolding, t: TranslateFn): string {
  const countPart = t('management.printing-house.spec.extra-folding-count', {
    count: folding.count,
  });
  const offset = folding.offset;
  const hasOffset =
    offset != null && !Number.isNaN(Number(offset)) && Number(offset) !== 0;
  const offsetCm = hasOffset ? formatCm(t, offset) : '';
  if (offsetCm) {
    return t('printing-table.extra.folding-option', { countPart, offset: offsetCm });
  }
  return countPart;
}

export function buildExtraSettingOptions(
  node: PhTreeExtraSettings,
  key: ExtraSettingKey,
  t: TranslateFn,
): PrintExtraSettingOption[] {
  switch (key) {
    case 'corners':
      return (node.corners ?? []).map((corner, index) => ({
        index,
        label: formatCornerOptionLabel(corner, t),
        signature: getExtraOptionSignature(key, node, index),
      }));
    case 'bleed':
      return (node.bleeds ?? []).map((bleed, index) => ({
        index,
        label: formatSizedOptionLabel(bleed.size, t),
        signature: getExtraOptionSignature(key, node, index),
      }));
    case 'folding':
      return (node.foldings ?? []).map((folding, index) => ({
        index,
        label: formatFoldingOptionLabel(folding, t),
        signature: getExtraOptionSignature(key, node, index),
      }));
    case 'duplex':
      return (node.duplexes ?? []).map((duplex, index) => ({
        index,
        label: formatSizedOptionLabel(duplex.size, t),
        signature: getExtraOptionSignature(key, node, index),
      }));
    default:
      return [];
  }
}

function buildSingleRowLabel(node: PhTreeExtraSettings, key: ExtraSettingKey, t: TranslateFn): string {
  const title = getExtraSettingTitle(key, t);
  switch (key) {
    case 'corners': {
      const corner = node.corners?.[0];
      return corner ? formatCornerSingleLabel(corner, t) : title;
    }
    case 'bleed': {
      const bleed = node.bleeds?.[0];
      return bleed ? formatSizedSingleLabel(bleed.size, title, t) : title;
    }
    case 'folding': {
      const folding = node.foldings?.[0];
      return folding ? formatFoldingSingleLabel(folding, title, t) : title;
    }
    case 'duplex': {
      const duplex = node.duplexes?.[0];
      return duplex ? formatSizedSingleLabel(duplex.size, title, t) : title;
    }
    case 'double-sided':
      return title;
    default:
      return title;
  }
}

function settingsButtonsShouldWrap(labels: string[], extraPerButton = 0): boolean {
  const count = labels.length;
  if (count === 0) {
    return false;
  }
  const letterSum = labels.reduce(
    (sum, label) => sum + (label?.trim().length ?? 0) + extraPerButton,
    0,
  );
  const score = letterSum + (count - 1) * 5;
  return score > SETTINGS_BUTTONS_WRAP_SCORE_THRESHOLD;
}

function getEnabledField(key: ExtraSettingKey): keyof PhPrintingFileExtraSelections {
  switch (key) {
    case 'corners':
      return 'cornersEnabled';
    case 'bleed':
      return 'bleedEnabled';
    case 'folding':
      return 'foldingEnabled';
    case 'duplex':
      return 'duplexEnabled';
    case 'double-sided':
      return 'doubleSidedEnabled';
    default:
      return 'cornersEnabled';
  }
}

function getIndexField(key: ExtraSettingKey): keyof PhPrintingFileExtraSelections | null {
  switch (key) {
    case 'corners':
      return 'cornersIndex';
    case 'bleed':
      return 'bleedIndex';
    case 'folding':
      return 'foldingIndex';
    case 'duplex':
      return 'duplexIndex';
    case 'double-sided':
      return null;
    default:
      return null;
  }
}

function readEnabled(saved: PhPrintingFileExtraSelections | undefined, key: ExtraSettingKey): boolean {
  const field = getEnabledField(key);
  return saved?.[field] === true;
}

function readIndex(saved: PhPrintingFileExtraSelections | undefined, key: ExtraSettingKey): number {
  const field = getIndexField(key);
  if (!field) {
    return 0;
  }
  const raw = saved?.[field];
  return Number.isInteger(raw) && (raw as number) >= 0 ? (raw as number) : 0;
}

export function resolveSelectedBleed(
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
): { size: number } | null {
  return resolveSelectedSizedExtra(ctx, uiState, 'bleed', 'bleeds');
}

/** Margin addition strips in print preview — product key `duplex` (הדפסת דופן / תוספת שוליים). */
export function resolveSelectedDuplex(
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
): { size: number } | null {
  return resolveSelectedSizedExtra(ctx, uiState, 'duplex', 'duplexes');
}

function resolveSelectedSizedExtra(
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
  key: 'bleed' | 'duplex',
  listKey: 'bleeds' | 'duplexes',
): { size: number } | null {
  const node = resolveExtraSettingNode(ctx, key);
  if (!node) {
    return null;
  }
  const mode = getExtraSettingMode(node, key);
  const optionCount = getExtraSettingOptionCount(node, key);
  if (optionCount === 0) {
    return null;
  }
  const state = uiState[key] ?? buildDefaultExtraUiState(ctx, key);
  if (mode === 'optional' && !state.enabled) {
    return null;
  }
  const index = Math.min(Math.max(0, state.selectedIndex), optionCount - 1);
  const entry = node[listKey]?.[index];
  const size = Number(entry?.size);
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }
  return { size };
}

export function resolveSelectedFolding(
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
): PhFolding | null {
  const node = resolveExtraSettingNode(ctx, 'folding');
  if (!node) {
    return null;
  }
  const mode = getExtraSettingMode(node, 'folding');
  const optionCount = getExtraSettingOptionCount(node, 'folding');
  if (optionCount === 0) {
    return null;
  }
  const state = uiState['folding'] ?? buildDefaultExtraUiState(ctx, 'folding');
  if (mode === 'optional' && !state.enabled) {
    return null;
  }
  const index = Math.min(Math.max(0, state.selectedIndex), optionCount - 1);
  return node.foldings?.[index] ?? null;
}

export function resolveSelectedCorner(
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
): PhCorner | null {
  const node = resolveExtraSettingNode(ctx, 'corners');
  if (!node) {
    return null;
  }
  const mode = getExtraSettingMode(node, 'corners');
  const optionCount = getExtraSettingOptionCount(node, 'corners');
  if (optionCount === 0) {
    return null;
  }
  const state = uiState['corners'] ?? buildDefaultExtraUiState(ctx, 'corners');
  if (mode === 'optional' && !state.enabled) {
    return null;
  }
  const index = Math.min(Math.max(0, state.selectedIndex), optionCount - 1);
  return node.corners?.[index] ?? null;
}

export function buildDefaultExtraUiState(
  ctx: ExtraSettingsContext,
  key: ExtraSettingKey,
): ExtraSettingUiState {
  const node = resolveExtraSettingNode(ctx, key);
  if (!node) {
    return { selectedIndex: 0, enabled: false };
  }
  const mode = getExtraSettingMode(node, key);
  const optionCount = getExtraSettingOptionCount(node, key);
  if (mode === 'required') {
    return { selectedIndex: 0, enabled: true };
  }
  if (key === 'double-sided') {
    return { selectedIndex: 0, enabled: false };
  }
  return { selectedIndex: 0, enabled: false };
}

export function buildDefaultExtraUiStateMap(ctx: ExtraSettingsContext): ExtraSettingsUiStateMap {
  const map: ExtraSettingsUiStateMap = {};
  for (const key of PRINT_EXTRA_SETTING_KEYS) {
    if (isExtraSettingApplicable(ctx, key)) {
      map[key] = buildDefaultExtraUiState(ctx, key);
    }
  }
  return map;
}

export function syncExtraUiStateFromSaved(
  ctx: ExtraSettingsContext,
  saved: PhPrintingFileExtraSelections | undefined,
): ExtraSettingsUiStateMap {
  const map: ExtraSettingsUiStateMap = {};
  for (const key of PRINT_EXTRA_SETTING_KEYS) {
    const node = resolveExtraSettingNode(ctx, key);
    if (!node) {
      continue;
    }
    const mode = getExtraSettingMode(node, key);
    const optionCount = getExtraSettingOptionCount(node, key);
    const defaultState = buildDefaultExtraUiState(ctx, key);
    let selectedIndex = readIndex(saved, key);
    if (optionCount > 0) {
      selectedIndex = Math.min(Math.max(0, selectedIndex), optionCount - 1);
    } else {
      selectedIndex = 0;
    }

    let enabled = mode === 'required' ? true : readEnabled(saved, key);
    if (mode === 'optional' && saved?.[getEnabledField(key)] == null) {
      enabled = defaultState.enabled;
    }
    if (mode === 'required' && optionCount <= 1) {
      enabled = true;
      selectedIndex = 0;
    }

    map[key] = {
      selectedIndex,
      enabled: enabled ?? defaultState.enabled,
    };
  }
  return map;
}

export function reconcileExtraUiStateOnTreeChange(
  ctx: ExtraSettingsContext,
  previousCtx: ExtraSettingsContext,
  previous: ExtraSettingsUiStateMap,
): ExtraSettingsUiStateMap {
  const map: ExtraSettingsUiStateMap = {};
  for (const key of PRINT_EXTRA_SETTING_KEYS) {
    const node = resolveExtraSettingNode(ctx, key);
    if (!node) {
      continue;
    }
    const prevNode = resolveExtraSettingNode(previousCtx, key);
    const mode = getExtraSettingMode(node, key);
    const optionCount = getExtraSettingOptionCount(node, key);
    const prev = previous[key] ?? buildDefaultExtraUiState(ctx, key);

    if (key === 'double-sided') {
      map[key] = {
        selectedIndex: 0,
        enabled: mode === 'required' ? true : prev.enabled,
      };
      continue;
    }

    let selectedIndex = 0;
    if (optionCount > 0 && prevNode) {
      const prevCount = getExtraSettingOptionCount(prevNode, key);
      const prevIndex = Math.min(Math.max(0, prev.selectedIndex), Math.max(0, prevCount - 1));
      const signature = getExtraOptionSignature(key, prevNode, prevIndex);
      const matched = findExtraOptionIndexBySignature(node, key, signature);
      selectedIndex = matched >= 0 ? matched : 0;
    }

    let enabled = mode === 'required' ? true : prev.enabled;
    if (mode === 'required' && optionCount <= 1) {
      enabled = true;
      selectedIndex = 0;
    }

    map[key] = { selectedIndex, enabled };
  }
  return map;
}

export function buildPersistedExtraSelections(
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
): PhPrintingFileExtraSelections {
  const persisted: PhPrintingFileExtraSelections = {};

  const assignEnabled = (field: keyof PhPrintingFileExtraSelections, value: boolean): void => {
    (persisted as Record<string, boolean | number | undefined>)[field] = value;
  };
  const assignIndex = (field: keyof PhPrintingFileExtraSelections, value: number): void => {
    (persisted as Record<string, boolean | number | undefined>)[field] = value;
  };

  for (const key of PRINT_EXTRA_SETTING_KEYS) {
    const node = resolveExtraSettingNode(ctx, key);
    if (!node) {
      continue;
    }
    const mode = getExtraSettingMode(node, key);
    const optionCount = getExtraSettingOptionCount(node, key);
    const state = uiState[key] ?? buildDefaultExtraUiState(ctx, key);
    const enabledField = getEnabledField(key);
    const indexField = getIndexField(key);

    if (key === 'double-sided') {
      assignEnabled(enabledField, mode === 'required' ? true : state.enabled);
      continue;
    }

    if (mode === 'required' && optionCount <= 1) {
      if (indexField) {
        assignIndex(indexField, 0);
      }
      assignEnabled(enabledField, true);
      continue;
    }

    if (mode === 'optional' && optionCount <= 1) {
      assignEnabled(enabledField, state.enabled);
      if (state.enabled && indexField) {
        assignIndex(indexField, 0);
      }
      continue;
    }

    if (mode === 'optional' && optionCount > 1) {
      assignEnabled(enabledField, state.enabled);
      if (state.enabled && indexField) {
        assignIndex(
          indexField,
          Math.min(Math.max(0, state.selectedIndex), Math.max(0, optionCount - 1)),
        );
      }
      continue;
    }

    if (indexField) {
      assignIndex(
        indexField,
        Math.min(Math.max(0, state.selectedIndex), Math.max(0, optionCount - 1)),
      );
    }
    assignEnabled(enabledField, true);
  }
  return persisted;
}

export function appendExtraSelectionsToPrintSettings(
  settings: PhPrintingFilePrintSettings,
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
): PhPrintingFilePrintSettings {
  return {
    ...settings,
    ...buildPersistedExtraSelections(ctx, uiState),
  };
}

export function validateExtraSelections(
  ctx: ExtraSettingsContext,
  saved: PhPrintingFileExtraSelections | undefined,
): boolean {
  for (const key of PRINT_EXTRA_SETTING_KEYS) {
    const node = resolveExtraSettingNode(ctx, key);
    if (!node) {
      continue;
    }
    const mode = getExtraSettingMode(node, key);
    const optionCount = getExtraSettingOptionCount(node, key);

    if (key === 'double-sided') {
      if (mode === 'optional' && saved?.doubleSidedEnabled == null) {
        return false;
      }
      continue;
    }

    if (mode === 'required' && optionCount <= 1) {
      continue;
    }

    if (mode === 'optional' && optionCount <= 1) {
      if (saved?.[getEnabledField(key)] == null) {
        return false;
      }
      continue;
    }

    if (mode === 'optional' && optionCount > 1) {
      const optionalEnabled = readEnabled(saved, key);
      if (!optionalEnabled) {
        continue;
      }
      const index = readIndex(saved, key);
      if (optionCount <= 0 || index < 0 || index >= optionCount) {
        return false;
      }
      continue;
    }

    if (mode === 'required') {
      const index = readIndex(saved, key);
      if (optionCount <= 0 || index < 0 || index >= optionCount) {
        return false;
      }
    }
  }
  return true;
}

function buildBooleanToggleLabels(
  key: ExtraSettingKey,
  node: PhTreeExtraSettings,
  t: TranslateFn,
): { off: string; on: string } {
  if (key === 'double-sided') {
    return {
      off: t('printing-table.sides-one'),
      on: t('printing-table.sides-two'),
    };
  }
  const options = buildExtraSettingOptions(node, key, t);
  const settingTitle = getExtraSettingTitle(key, t);
  return {
    off: t('printing-table.extra.without-setting'),
    on: options[0]?.label ?? buildSingleRowLabel(node, key, t),
  };
}

export function buildVisibleExtraSettingRows(
  ctx: ExtraSettingsContext,
  uiState: ExtraSettingsUiStateMap,
  t: TranslateFn,
): PrintExtraSettingRow[] {
  const rows: PrintExtraSettingRow[] = [];
  for (const key of PRINT_EXTRA_SETTING_KEYS) {
    if (!isExtraSettingVisible(ctx, key)) {
      continue;
    }
    const node = resolveExtraSettingNode(ctx, key)!;
    const mode = getExtraSettingMode(node, key);
    const optionCount = getExtraSettingOptionCount(node, key);
    const state = uiState[key] ?? buildDefaultExtraUiState(ctx, key);
    const settingTitle = getExtraSettingTitle(key, t);
    const baseOptions = buildExtraSettingOptions(node, key, t);
    const options =
      mode === 'optional' && optionCount > 1
        ? [
            {
              index: EXTRA_OPTION_NONE_INDEX,
              label: t('printing-table.extra.without-setting'),
              signature: '__none__',
            },
            ...baseOptions,
          ]
        : baseOptions;
    const singleRowLabel = buildSingleRowLabel(node, key, t);
    const toggleLabels = buildBooleanToggleLabels(key, node, t);

    let display: PrintExtraSettingDisplay = 'multi-buttons';
    if (key === 'double-sided') {
      display = mode === 'required' ? 'single-toggle' : 'boolean-toggle';
    } else if (optionCount <= 1 && mode === 'optional') {
      display = 'boolean-toggle';
    } else if (optionCount <= 1) {
      display = 'single-toggle';
    }

    rows.push({
      key,
      settingTitle,
      singleRowLabel,
      toggleOffLabel: toggleLabels.off,
      toggleOnLabel: toggleLabels.on,
      display,
      mode,
      options,
      selectedIndex: state.selectedIndex,
      enabled: state.enabled,
      wrap: settingsButtonsShouldWrap(options.map((option) => option.label)),
    });
  }
  return rows;
}
