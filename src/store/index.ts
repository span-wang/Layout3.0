import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { createDocumentSlice } from '@/store/slices/documentSlice';
import { createStyleSlice } from '@/store/slices/styleSlice';
import { createUiSlice } from '@/store/slices/uiSlice';
import type { AppStore } from '@/store/types';

export const useAppStore = create<AppStore>()(
  immer((...args) => ({
    ...createDocumentSlice(...args),
    ...createStyleSlice(...args),
    ...createUiSlice(...args),
  })),
);
