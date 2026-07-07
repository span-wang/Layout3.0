import katex from 'katex';
import {
  Math as DocxMath,
  MathAngledBrackets,
  MathCurlyBrackets,
  MathFraction,
  MathIntegral,
  MathLimitLower,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSquareBrackets,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  ImportedXmlComponent,
  XmlComponent,
  createMathAccentCharacter,
  createMathBase,
  type MathComponent,
} from 'docx';

type KatexParser = typeof katex & {
  __parse?: (input: string, options: { throwOnError: boolean; displayMode: boolean }) => unknown[];
};

type KatexNode = Record<string, unknown>;

const texSymbolMap: Record<string, string> = {
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\varepsilon': 'ε',
  '\\zeta': 'ζ',
  '\\eta': 'η',
  '\\theta': 'θ',
  '\\vartheta': 'ϑ',
  '\\iota': 'ι',
  '\\kappa': 'κ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\nu': 'ν',
  '\\xi': 'ξ',
  '\\pi': 'π',
  '\\rho': 'ρ',
  '\\sigma': 'σ',
  '\\tau': 'τ',
  '\\upsilon': 'υ',
  '\\phi': 'φ',
  '\\varphi': 'φ',
  '\\chi': 'χ',
  '\\psi': 'ψ',
  '\\omega': 'ω',
  '\\Gamma': 'Γ',
  '\\Delta': 'Δ',
  '\\Theta': 'Θ',
  '\\Lambda': 'Λ',
  '\\Xi': 'Ξ',
  '\\Pi': 'Π',
  '\\Sigma': 'Σ',
  '\\Upsilon': 'Υ',
  '\\Phi': 'Φ',
  '\\Psi': 'Ψ',
  '\\Omega': 'Ω',
  '\\le': '≤',
  '\\leq': '≤',
  '\\ge': '≥',
  '\\geq': '≥',
  '\\ne': '≠',
  '\\neq': '≠',
  '\\times': '×',
  '\\cdot': '·',
  '\\div': '÷',
  '\\pm': '±',
  '\\mp': '∓',
  '\\to': '→',
  '\\rightarrow': '→',
  '\\Rightarrow': '⇒',
  '\\implies': '⇒',
  '\\Leftrightarrow': '⇔',
  '\\iff': '⇔',
  '\\leftarrow': '←',
  '\\in': '∈',
  '\\notin': '∉',
  '\\land': '∧',
  '\\lor': '∨',
  '\\mid': '∣',
  '\\vert': '|',
  '\\lt': '<',
  '\\gt': '>',
  '\\approx': '≈',
  '\\equiv': '≡',
  '\\infty': '∞',
  '\\partial': '∂',
  '\\nabla': '∇',
  '\\circ': '∘',
  '\\cup': '∪',
  '\\cap': '∩',
  '\\subset': '⊂',
  '\\subseteq': '⊆',
  '\\supset': '⊃',
  '\\supseteq': '⊇',
  '\\forall': '∀',
  '\\exists': '∃',
  '\\emptyset': '∅',
  '\\ldots': '…',
  '\\%': '%',
  '\\&': '&',
  '\\#': '#',
  '\\_': '_',
  '\\$': '$',
  '\\{': '{',
  '\\}': '}',
  '\\backslash': '\\',
};

const functionNameMap: Record<string, string> = {
  '\\sin': 'sin',
  '\\cos': 'cos',
  '\\tan': 'tan',
  '\\cot': 'cot',
  '\\sec': 'sec',
  '\\csc': 'csc',
  '\\log': 'log',
  '\\ln': 'ln',
  '\\exp': 'exp',
  '\\max': 'max',
  '\\min': 'min',
  '\\lim': 'lim',
};

const accentCharacterMap: Record<string, string> = {
  '\\bar': '̄',
  '\\hat': '̂',
  '\\vec': '⃗',
  '\\overline': '̅',
};

class DocxMathAccentProperties extends XmlComponent {
  constructor(accent: string) {
    super('m:accPr');
    this.root.push(createMathAccentCharacter({ accent }));
  }
}

class DocxMathAccent extends XmlComponent {
  constructor(options: { readonly accent: string; readonly children: readonly MathComponent[] }) {
    super('m:acc');
    this.root.push(new DocxMathAccentProperties(options.accent));
    this.root.push(createMathBase({ children: options.children }));
  }
}

class DocxMathDelimiterProperties extends XmlComponent {
  constructor(options: { readonly beginningCharacter: string; readonly endingCharacter: string }) {
    super('m:dPr');
    this.root.push(new ImportedXmlComponent('m:begChr', { 'm:val': options.beginningCharacter }));
    this.root.push(new ImportedXmlComponent('m:endChr', { 'm:val': options.endingCharacter }));
  }
}

class DocxMathDelimiter extends XmlComponent {
  constructor(options: {
    readonly beginningCharacter: string;
    readonly endingCharacter: string;
    readonly children: readonly MathComponent[];
  }) {
    super('m:d');
    this.root.push(
      new DocxMathDelimiterProperties({
        beginningCharacter: options.beginningCharacter,
        endingCharacter: options.endingCharacter,
      }),
    );
    this.root.push(createMathBase({ children: options.children }));
  }
}

class DocxMathEquationArray extends XmlComponent {
  constructor(rows: readonly (readonly MathComponent[])[]) {
    super('m:eqArr');
    rows.forEach((row) => {
      const rowElement = new ImportedXmlComponent('m:e');
      (row.length > 0 ? row : [new MathRun(' ')]).forEach((child) => {
        rowElement.push(child);
      });
      this.root.push(rowElement);
    });
  }
}

export function buildDocxMathFromLatex(value: string): DocxMath | null {
  const components = buildDocxMathComponentsFromLatex(value);
  return components ? new DocxMath({ children: components }) : null;
}

function buildDocxMathComponentsFromLatex(value: string): MathComponent[] | null {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  try {
    const parse = (katex as KatexParser).__parse;
    if (!parse) {
      return null;
    }

    const nodes = parse(normalizedValue, {
      displayMode: true,
      throwOnError: true,
    });

    return convertNodeList(nodes);
  } catch {
    return null;
  }
}

function convertNodeList(nodes: unknown[]): MathComponent[] | null {
  const children: MathComponent[] = [];

  for (const node of nodes) {
    const nextChildren = convertNode(node);
    if (!nextChildren) {
      return null;
    }
    children.push(...nextChildren);
  }

  return children.length > 0 ? children : [new MathRun(' ')];
}

function convertNode(node: unknown): MathComponent[] | null {
  const normalizedNode = asKatexNode(node);
  if (!normalizedNode) {
    return null;
  }

  switch (normalizedNode.type) {
    case 'mathord':
    case 'textord':
    case 'atom':
      return [new MathRun(mapTexText(readString(normalizedNode.text)))];
    case 'op':
      return convertOperatorNode(normalizedNode);
    case 'supsub':
      return convertScriptNode(normalizedNode);
    case 'genfrac':
      return convertFractionNode(normalizedNode);
    case 'sqrt':
      return convertRadicalNode(normalizedNode);
    case 'leftright':
      return convertDelimiterNode(normalizedNode);
    case 'ordgroup':
    case 'styling':
    case 'mclass':
    case 'color':
    case 'font':
      return convertBodyNode(normalizedNode);
    case 'kern':
    case 'spacing':
      return [new MathRun(' ')];
    case 'text':
      return convertTextNode(normalizedNode);
    case 'accent':
      return convertAccentNode(normalizedNode);
    case 'overline':
      return convertOverlineNode(normalizedNode);
    case 'array':
      return convertArrayNode(normalizedNode);
    case 'htmlmathml':
      return convertHtmlMathMlNode(normalizedNode);
    default:
      // 这里故意保守：未知节点不硬转，交给上层降级为原始 LaTeX，避免生成坏 DOCX。
      return null;
  }
}

function convertBodyNode(node: KatexNode): MathComponent[] | null {
  return node.body ? convertArgument(node.body) : null;
}

function convertTextNode(node: KatexNode): MathComponent[] | null {
  if (Array.isArray(node.body)) {
    return convertNodeList(node.body);
  }

  const text = readString(node.text);
  return text ? [new MathRun(text)] : null;
}

function convertAccentNode(node: KatexNode): MathComponent[] | null {
  const accent = accentCharacterMap[readString(node.label)];
  if (!accent) {
    return null;
  }

  const base = convertArgument(node.base);
  if (!base) {
    return null;
  }

  return [new DocxMathAccent({ accent, children: base }) as unknown as MathComponent];
}

function convertOverlineNode(node: KatexNode): MathComponent[] | null {
  const base = convertArgument(node.body);
  if (!base) {
    return null;
  }

  return [new DocxMathAccent({ accent: accentCharacterMap['\\overline'], children: base }) as unknown as MathComponent];
}

function convertHtmlMathMlNode(node: KatexNode): MathComponent[] | null {
  if (Array.isArray(node.mathml)) {
    return convertNodeList(node.mathml);
  }

  if (Array.isArray(node.html)) {
    return convertNodeList(node.html);
  }

  return null;
}

function convertArrayNode(node: KatexNode): MathComponent[] | null {
  if (!Array.isArray(node.body)) {
    return null;
  }

  const rows: MathComponent[][] = [];
  for (const row of node.body) {
    if (!Array.isArray(row)) {
      return null;
    }

    const rowChildren: MathComponent[] = [];
    for (const cell of row) {
      const cellChildren = convertArgument(cell);
      if (!cellChildren) {
        return null;
      }
      rowChildren.push(...cellChildren);
    }

    rows.push(rowChildren);
  }

  return [new DocxMathEquationArray(rows) as unknown as MathComponent];
}

function convertOperatorNode(node: KatexNode): MathComponent[] | null {
  const name = readString(node.name);

  if (name === '\\sum') {
    return [new MathRun('∑')];
  }

  if (name === '\\int') {
    return [new MathRun('∫')];
  }

  return [new MathRun(functionNameMap[name] ?? mapTexText(name))];
}

function convertScriptNode(node: KatexNode): MathComponent[] | null {
  const baseNode = asKatexNode(node.base);
  if (!baseNode) {
    return null;
  }

  const subScript = node.sub ? convertArgument(node.sub) : undefined;
  const superScript = node.sup ? convertArgument(node.sup) : undefined;
  if ((node.sub && !subScript) || (node.sup && !superScript)) {
    return null;
  }
  const optionalSubScript = subScript ?? undefined;
  const optionalSuperScript = superScript ?? undefined;

  if (baseNode.type === 'op') {
    const operatorName = readString(baseNode.name);
    if (operatorName === '\\sum') {
      return [
        new MathSum({
          children: [new MathRun(' ')],
          subScript: optionalSubScript,
          superScript: optionalSuperScript,
        }),
      ];
    }

    if (operatorName === '\\int') {
      return [
        new MathIntegral({
          children: [new MathRun(' ')],
          subScript: optionalSubScript,
          superScript: optionalSuperScript,
        }),
      ];
    }

    if (operatorName === '\\lim' && subScript) {
      return [
        new MathLimitLower({
          children: [new MathRun('lim')],
          limit: subScript,
        }),
      ];
    }
  }

  const base = convertNode(baseNode);
  if (!base) {
    return null;
  }

  if (subScript && superScript) {
    return [
      new MathSubSuperScript({
        children: base,
        subScript,
        superScript,
      }),
    ];
  }

  if (superScript) {
    return [
      new MathSuperScript({
        children: base,
        superScript,
      }),
    ];
  }

  if (subScript) {
    return [
      new MathSubScript({
        children: base,
        subScript,
      }),
    ];
  }

  return base;
}

function convertFractionNode(node: KatexNode): MathComponent[] | null {
  if (node.hasBarLine === false) {
    return null;
  }

  const numerator = convertArgument(node.numer);
  const denominator = convertArgument(node.denom);
  if (!numerator || !denominator) {
    return null;
  }

  return [
    new MathFraction({
      numerator,
      denominator,
    }),
  ];
}

function convertRadicalNode(node: KatexNode): MathComponent[] | null {
  const children = convertArgument(node.body);
  const degree = node.index ? convertArgument(node.index) : undefined;
  if (!children || (node.index && !degree)) {
    return null;
  }
  const optionalDegree = degree ?? undefined;

  return [
    new MathRadical({
      children,
      degree: optionalDegree,
    }),
  ];
}

function convertDelimiterNode(node: KatexNode): MathComponent[] | null {
  const body = Array.isArray(node.body) ? convertNodeList(node.body) : null;
  if (!body) {
    return null;
  }

  const left = readString(node.left);
  const right = readString(node.right);
  const normalizedLeft = normalizeDelimiterCharacter(left);
  const normalizedRight = normalizeDelimiterCharacter(right);

  if (normalizedLeft === '(' && normalizedRight === ')') {
    return [new MathRoundBrackets({ children: body })];
  }

  if (normalizedLeft === '[' && normalizedRight === ']') {
    return [new MathSquareBrackets({ children: body })];
  }

  if (normalizedLeft === '{' && normalizedRight === '}') {
    return [new MathCurlyBrackets({ children: body })];
  }

  if (normalizedLeft === '〈' && normalizedRight === '〉') {
    return [new MathAngledBrackets({ children: body })];
  }

  if (normalizedLeft === '|' && normalizedRight === '|') {
    return [new MathRun('|'), ...body, new MathRun('|')];
  }

  if ((normalizedLeft && normalizedLeft !== '.') || (normalizedRight && normalizedRight !== '.')) {
    return [
      new DocxMathDelimiter({
        beginningCharacter: normalizedLeft || '.',
        endingCharacter: normalizedRight || '.',
        children: body,
      }) as unknown as MathComponent,
    ];
  }

  const children: MathComponent[] = [];
  if (normalizedLeft && normalizedLeft !== '.') {
    children.push(new MathRun(normalizedLeft));
  }
  children.push(...body);
  if (normalizedRight && normalizedRight !== '.') {
    children.push(new MathRun(normalizedRight));
  }
  return children;
}

function convertArgument(value: unknown): MathComponent[] | null {
  if (Array.isArray(value)) {
    return convertNodeList(value);
  }

  return convertNode(value);
}

function asKatexNode(value: unknown): KatexNode | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as KatexNode;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapTexText(value: string): string {
  if (!value) {
    return '';
  }

  return texSymbolMap[value] ?? value.replaceAll('\\{', '{').replaceAll('\\}', '}');
}

function normalizeDelimiterCharacter(value: string): string {
  if (!value) {
    return '';
  }

  switch (value) {
    case '\\{':
      return '{';
    case '\\}':
      return '}';
    case '\\langle':
      return '〈';
    case '\\rangle':
      return '〉';
    default:
      return mapTexText(value);
  }
}
