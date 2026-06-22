const supportedDocumentExtensions = new Set(['.md', '.layout', '.json']);
const visibleWorkspaceExtensions = new Set([
  '.md',
  '.layout',
  '.json',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
]);

function normalizeSeparators(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function restoreSeparators(filePath: string, useBackslash: boolean): string {
  return useBackslash ? filePath.replaceAll('/', '\\') : filePath;
}

export function getBaseNameFromPath(filePath: string): string {
  const normalized = normalizeSeparators(filePath);
  const segments = normalized.split('/');
  return segments[segments.length - 1] || '未命名文档';
}

export function getDirectoryNameFromPath(directoryPath: string): string {
  const normalized = normalizeSeparators(directoryPath);
  const segments = normalized.split('/');
  return segments[segments.length - 1] || directoryPath;
}

export function getParentPath(targetPath: string): string {
  const normalized = normalizeSeparators(targetPath);
  const parentIndex = normalized.lastIndexOf('/');

  if (parentIndex < 0) {
    return '';
  }

  return restoreSeparators(normalized.slice(0, parentIndex), targetPath.includes('\\'));
}

export function getFileExtension(filePath: string): string {
  const baseName = getBaseNameFromPath(filePath);
  const extensionIndex = baseName.lastIndexOf('.');
  return extensionIndex >= 0 ? baseName.slice(extensionIndex).toLowerCase() : '';
}

export function isOpenableDocumentPath(filePath: string): boolean {
  return supportedDocumentExtensions.has(getFileExtension(filePath));
}

export function isVisibleWorkspaceFilePath(filePath: string): boolean {
  return visibleWorkspaceExtensions.has(getFileExtension(filePath));
}

export function isPathWithin(targetPath: string, ancestorPath: string): boolean {
  const normalizedTarget = normalizeSeparators(targetPath);
  const normalizedAncestor = normalizeSeparators(ancestorPath);

  return (
    normalizedTarget === normalizedAncestor ||
    normalizedTarget.startsWith(`${normalizedAncestor}/`)
  );
}

export function replacePathPrefix(
  targetPath: string,
  sourcePrefix: string,
  replacementPrefix: string,
): string {
  const normalizedTarget = normalizeSeparators(targetPath);
  const normalizedSource = normalizeSeparators(sourcePrefix);
  const normalizedReplacement = normalizeSeparators(replacementPrefix);
  const useBackslash =
    targetPath.includes('\\') || sourcePrefix.includes('\\') || replacementPrefix.includes('\\');

  if (normalizedTarget === normalizedSource) {
    return restoreSeparators(normalizedReplacement, useBackslash);
  }

  const nestedPrefix = `${normalizedSource}/`;
  if (normalizedTarget.startsWith(nestedPrefix)) {
    const nextPath = `${normalizedReplacement}${normalizedTarget.slice(normalizedSource.length)}`;
    return restoreSeparators(nextPath, useBackslash);
  }

  return targetPath;
}

