import { protocol } from 'electron';

export const layoutAssetProtocolScheme = 'layout-asset';

protocol.registerSchemesAsPrivileged([
  {
    scheme: layoutAssetProtocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function decodeAssetPath(url: string): string {
  const parsed = new URL(url);
  const encodedPath = parsed.pathname.replace(/^\/+/, '');
  return decodeURIComponent(encodedPath);
}

export function toLayoutAssetUrl(filePath: string): string {
  return `${layoutAssetProtocolScheme}://local/${encodeURIComponent(filePath)}`;
}

export function registerAssetProtocol(): void {
  protocol.registerFileProtocol(layoutAssetProtocolScheme, (request, callback) => {
    const decodedPath = decodeAssetPath(request.url);
    callback(decodedPath);
  });
}
