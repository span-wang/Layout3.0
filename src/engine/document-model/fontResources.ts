import type { FontFamilyGroup } from '@/constants/fontFamilies';
import { resolveAssetSrc } from '@/utils/filePath';
import type { LayoutFontFormat, LayoutFontResource, LayoutResource } from './types';

export interface ImportedFontFilePayload {
  filePath: string;
  fileName: string;
}

const supportedFontFormatsByExtension: Record<string, LayoutFontFormat> = {
  '.ttf': 'truetype',
  '.otf': 'opentype',
  '.woff': 'woff',
  '.woff2': 'woff2',
};

function getFileExtension(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : '';
}

function trimFontExtension(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex >= 0 ? fileName.slice(0, extensionIndex) : fileName;
}

function sanitizeFontDisplayName(fileName: string): string {
  const displayName = trimFontExtension(fileName).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return displayName || '导入字体';
}

function createFontResourceId(filePath: string): string {
  let hash = 0;
  for (let index = 0; index < filePath.length; index += 1) {
    hash = (hash * 31 + filePath.charCodeAt(index)) >>> 0;
  }
  return `font-resource-${hash.toString(36)}`;
}

function createProjectFontFamily(id: string): string {
  return `LAYOUT3_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function getFontFormatFromFileName(fileName: string): LayoutFontFormat | null {
  return supportedFontFormatsByExtension[getFileExtension(fileName)] ?? null;
}

export function isLayoutFontResource(resource: LayoutResource): resource is LayoutFontResource {
  return resource.type === 'font';
}

export function createFontResourceFromImportedFile(payload: ImportedFontFilePayload): LayoutFontResource {
  const format = getFontFormatFromFileName(payload.fileName);
  if (!format) {
    throw new Error('暂不支持该字体格式');
  }

  const id = createFontResourceId(payload.filePath);
  return {
    id,
    type: 'font',
    src: payload.filePath,
    displayName: sanitizeFontDisplayName(payload.fileName),
    fontFamily: createProjectFontFamily(id),
    format,
    originalFileName: payload.fileName,
    importedAt: new Date().toISOString(),
  };
}

export function mergeFontResource(resources: LayoutResource[], fontResource: LayoutFontResource): LayoutResource[] {
  const existingFontIndex = resources.findIndex(
    (resource) =>
      resource.type === 'font' &&
      (resource.id === fontResource.id ||
        resource.src === fontResource.src ||
        resource.fontFamily === fontResource.fontFamily),
  );

  if (existingFontIndex < 0) {
    return [...resources, fontResource];
  }

  return resources.map((resource, index) => (index === existingFontIndex ? fontResource : resource));
}

export function mergeFontResources(
  resources: LayoutResource[],
  fontResources: LayoutFontResource[],
): LayoutResource[] {
  return fontResources.reduce(
    (nextResources, fontResource) => mergeFontResource(nextResources, fontResource),
    resources,
  );
}

export function getFontResources(resources: LayoutResource[] | undefined | null): LayoutFontResource[] {
  return (resources ?? []).filter(isLayoutFontResource);
}

export function buildFontFamilyGroupsWithImportedFonts(
  baseGroups: FontFamilyGroup[],
  resources: LayoutResource[] | undefined | null,
): FontFamilyGroup[] {
  const importedFonts = getFontResources(resources);
  if (importedFonts.length === 0) {
    return baseGroups;
  }

  return [
    ...baseGroups,
    {
      label: '导入字体',
      options: importedFonts.map((font) => ({
        label: font.displayName,
        value: font.fontFamily,
      })),
    },
  ];
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 构建字体 CSS 声明。
 *
 * @param resources 文档资源列表
 * @param workspaceRootPath 工作区根路径（可选），用于解析相对字体路径
 */
export function buildFontFaceCss(
  resources: LayoutResource[] | undefined | null,
  workspaceRootPath?: string | null,
): string {
  return getFontResources(resources)
    .map((font) => {
      // 如果是相对路径，拼凑完整路径
      let fontSrc = font.src;
      if (workspaceRootPath && !/^[a-zA-Z]:[\\/]/.test(fontSrc) && !fontSrc.startsWith('/') && !fontSrc.startsWith('\\\\')) {
        fontSrc = `${workspaceRootPath}/${fontSrc}`;
      }
      const fontUrl = resolveAssetSrc(fontSrc);
      return [
        '@font-face {',
        `  font-family: "${escapeCssString(font.fontFamily)}";`,
        `  src: url("${escapeCssString(fontUrl)}") format("${font.format}");`,
        '  font-weight: 100 900;',
        '  font-style: normal;',
        '  font-display: swap;',
        '}',
      ].join('\n');
    })
    .join('\n');
}

