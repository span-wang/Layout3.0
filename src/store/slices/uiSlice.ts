import type { UISlice, StoreSlice } from '@/store/types';

export const createUiSlice: StoreSlice<UISlice> = (set) => ({
  activeLeftPanelTab: '文件',
  isLeftPanelOpen: true,
  isRightPanelOpen: true,
  workspaceViewMode: 'split',
  setActiveLeftPanelTab: (tab) =>
    set((state) => {
      state.activeLeftPanelTab = tab;
    }),
  toggleLeftPanel: () =>
    set((state) => {
      state.isLeftPanelOpen = !state.isLeftPanelOpen;
    }),
  toggleRightPanel: () =>
    set((state) => {
      state.isRightPanelOpen = !state.isRightPanelOpen;
    }),
  setWorkspaceViewMode: (mode) =>
    set((state) => {
      state.workspaceViewMode = mode;
    }),
});
