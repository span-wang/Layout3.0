/// <reference types="vite/client" />

import type { LayoutAPI } from '../electron/preload';

declare global {
  interface Window {
    layoutAPI: LayoutAPI;
  }
}
