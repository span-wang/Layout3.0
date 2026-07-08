import type { UISlice, StoreSlice } from '@/store/types';

export const createUiSlice: StoreSlice<UISlice> = (set) => ({
  activeLeftPanelTab: '文件',
  isLeftPanelOpen: true,
  isRightPanelOpen: true,
  workspaceViewMode: 'preview',
  activeRightPanelTab: '页面设置',
  activePageSettingsTab: '页面规格',
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
  setActiveRightPanelTab: (tab) =>
    set((state) => {
      state.activeRightPanelTab = tab;
    }),
  setActivePageSettingsTab: (tab) =>
    set((state) => {
      state.activePageSettingsTab = tab;
    }),
});
