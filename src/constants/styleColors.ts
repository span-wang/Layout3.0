export interface StandardColorOption {
  label: string;
  value: string;
}

// 文字颜色和高亮颜色分开维护，避免高亮入口误用文字正色。
export const standardColorOptions: StandardColorOption[] = [
  { label: '红色', value: '#ef4444' },
  { label: '黑色', value: '#111827' },
  { label: '白色', value: '#ffffff' },
  { label: '蓝色', value: '#2563eb' },
  { label: '绿色', value: '#16a34a' },
];

export const highlightColorOptions: StandardColorOption[] = [
  { label: '浅黄', value: '#FEF08A' },
  { label: '浅红', value: '#FECACA' },
  { label: '浅橙', value: '#FED7AA' },
  { label: '浅绿', value: '#BBF7D0' },
  { label: '浅蓝', value: '#BFDBFE' },
  { label: '浅紫', value: '#E9D5FF' },
];
