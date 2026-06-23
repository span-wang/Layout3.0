export interface FontFamilyOption {
  label: string;
  value: string;
}

export interface FontFamilyGroup {
  label: string;
  options: FontFamilyOption[];
}

export const fontFamilyPlaceholderValue = '__default-font__';

// 顶部快捷栏与右侧对象属性共用同一份字体列表，避免两边出现不一致。
export const textFontFamilyGroups: FontFamilyGroup[] = [
  {
    label: '中文字体',
    options: [
      { label: '宋体', value: 'SimSun' },
      { label: '黑体', value: 'SimHei' },
      { label: '微软雅黑', value: 'Microsoft YaHei' },
      { label: '楷体', value: 'KaiTi' },
    ],
  },
  {
    label: '西文字体',
    options: [
      { label: 'Arial', value: 'Arial' },
      { label: 'Times New Roman', value: 'Times New Roman' },
      { label: 'Georgia', value: 'Georgia' },
      { label: 'Verdana', value: 'Verdana' },
      { label: 'Tahoma', value: 'Tahoma' },
    ],
  },
];
