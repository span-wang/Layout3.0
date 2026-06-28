import { cloneStyleSettings, normalizeBlockSpacingPresets } from '@/engine/style/styleSettings';
import type { BlockSpacingPreset, StyleSettings } from '@/engine/style/types';

const BLOCK_SPACING_PRESET_LIBRARY_STORAGE_KEY = 'layout3.blockSpacingPresetLibrary.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getStorage(): StorageLike | null {
  const maybeStorage = (globalThis as typeof globalThis & { localStorage?: StorageLike }).localStorage;
  if (
    !maybeStorage ||
    typeof maybeStorage.getItem !== 'function' ||
    typeof maybeStorage.setItem !== 'function' ||
    typeof maybeStorage.removeItem !== 'function'
  ) {
    return null;
  }

  return maybeStorage;
}

function normalizePresetName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isSamePresetIdentity(left: BlockSpacingPreset, right: BlockSpacingPreset): boolean {
  return left.id === right.id || normalizePresetName(left.name) === normalizePresetName(right.name);
}

export function mergeCustomBlockSpacingPresets(
  preferredPresets: unknown,
  fallbackPresets: unknown,
): BlockSpacingPreset[] {
  const mergedPresets: BlockSpacingPreset[] = [];

  for (const preset of normalizeBlockSpacingPresets(preferredPresets)) {
    if (!mergedPresets.some((existingPreset) => isSamePresetIdentity(existingPreset, preset))) {
      mergedPresets.push(preset);
    }
  }

  for (const preset of normalizeBlockSpacingPresets(fallbackPresets)) {
    if (!mergedPresets.some((existingPreset) => isSamePresetIdentity(existingPreset, preset))) {
      mergedPresets.push(preset);
    }
  }

  return mergedPresets;
}

export function loadBlockSpacingPresetLibrary(): BlockSpacingPreset[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(BLOCK_SPACING_PRESET_LIBRARY_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    return normalizeBlockSpacingPresets(JSON.parse(rawValue));
  } catch {
    return [];
  }
}

export function saveBlockSpacingPresetLibrary(presets: unknown): BlockSpacingPreset[] {
  const nextPresets = mergeCustomBlockSpacingPresets(presets, []);
  const storage = getStorage();

  if (!storage) {
    return nextPresets;
  }

  try {
    storage.setItem(BLOCK_SPACING_PRESET_LIBRARY_STORAGE_KEY, JSON.stringify(nextPresets));
  } catch {
    // 本机预设库写失败时不阻断当前文档编辑，只回退为本次内存结果。
  }

  return nextPresets;
}

export function clearBlockSpacingPresetLibrary(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(BLOCK_SPACING_PRESET_LIBRARY_STORAGE_KEY);
  } catch {
    // 忽略本机存储清理失败，避免影响业务链路。
  }
}

export function mergeBlockSpacingPresetLibraryIntoStyleSettings(styleSettings: StyleSettings): StyleSettings {
  const nextStyleSettings = cloneStyleSettings(styleSettings);
  // 当前文档预设优先，本机预设库只补齐缺少的跨文件可复用项。
  const mergedPresets = mergeCustomBlockSpacingPresets(
    nextStyleSettings.customBlockSpacingPresets,
    loadBlockSpacingPresetLibrary(),
  );

  nextStyleSettings.customBlockSpacingPresets = saveBlockSpacingPresetLibrary(mergedPresets);
  return nextStyleSettings;
}
