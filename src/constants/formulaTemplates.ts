export interface FormulaTemplateDefinition {
  id: string;
  label: string;
  preview: string;
  value: string;
}

export interface FormulaTemplateGroup {
  id: string;
  label: string;
  templates: FormulaTemplateDefinition[];
}

export const formulaTemplateGroups: FormulaTemplateGroup[] = [
  {
    id: 'basic',
    label: '基础',
    templates: [
      { id: 'blank', label: '空白公式', preview: '直接输入', value: '' },
      { id: 'fraction', label: '分式', preview: 'a / b', value: '\\frac{a}{b}' },
      { id: 'superscript', label: '上标', preview: 'x^n', value: 'x^{n}' },
      { id: 'subscript', label: '下标', preview: 'x_i', value: 'x_{i}' },
      { id: 'subsuperscript', label: '上下标', preview: 'x_i^2', value: 'x_{i}^{2}' },
      { id: 'sqrt', label: '根号', preview: 'sqrt(x)', value: '\\sqrt{x}' },
      { id: 'nth-root', label: 'n 次根', preview: 'n√x', value: '\\sqrt[n]{x}' },
    ],
  },
  {
    id: 'brackets',
    label: '括号',
    templates: [
      { id: 'parentheses', label: '小括号', preview: '(x)', value: '\\left( x \\right)' },
      { id: 'brackets', label: '中括号', preview: '[x]', value: '\\left[ x \\right]' },
      { id: 'braces', label: '大括号', preview: '{x}', value: '\\left\\{ x \\right\\}' },
      { id: 'absolute', label: '绝对值', preview: '|x|', value: '\\left| x \\right|' },
    ],
  },
  {
    id: 'matrix',
    label: '矩阵',
    templates: [
      {
        id: 'matrix-2x2',
        label: '2 x 2 矩阵',
        preview: '[a b; c d]',
        value: '\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}',
      },
      {
        id: 'matrix-3x3',
        label: '3 x 3 矩阵',
        preview: '[a b c; d e f; g h i]',
        value: '\\begin{bmatrix}\na & b & c \\\\\nd & e & f \\\\\ng & h & i\n\\end{bmatrix}',
      },
      {
        id: 'determinant-2x2',
        label: '行列式',
        preview: '|a b; c d|',
        value: '\\begin{vmatrix}\na & b \\\\\nc & d\n\\end{vmatrix}',
      },
      {
        id: 'cases',
        label: '分段函数',
        preview: 'cases',
        value: '\\begin{cases}\na, & x > 0 \\\\\nb, & x \\le 0\n\\end{cases}',
      },
    ],
  },
  {
    id: 'calculus',
    label: '运算',
    templates: [
      {
        id: 'sum',
        label: '求和',
        preview: 'Σ',
        value: '\\sum_{i=1}^{n} x_i',
      },
      {
        id: 'integral',
        label: '积分',
        preview: '∫',
        value: '\\int_{a}^{b} f(x) \\, dx',
      },
      {
        id: 'limit',
        label: '极限',
        preview: 'lim',
        value: '\\lim_{x \\to 0} f(x)',
      },
    ],
  },
];
