import type { ReactNode } from "react";

export type ElementCategory = "shape" | "icon" | "decorative" | "cloud" | "number" | "letter" | "symbol";

interface ElementAsset {
  id: string;
  category: ElementCategory;
  label: string;
  render: (color: string) => ReactNode;
}

// Renders a single character centered in the shared 0–100 viewBox — used for numbers, letters, and
// symbols, since hand-drawing 40+ individual vector glyphs wouldn't be practical or consistent.
function renderGlyph(char: string, color: string) {
  return (
    <text x="50" y="54" textAnchor="middle" dominantBaseline="central" fontSize="80" fontWeight="700" fill={color}>
      {char}
    </text>
  );
}

// A cloud silhouette (adapted from the common "cloud" icon shape, redrawn at 0–24 scale so it can be
// reused at different sizes/positions via a wrapping transform for each cloud variant below).
const CLOUD_PATH =
  "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z";

// Every asset shares a 0–100 viewBox so element width/height map to it uniformly.
export const ELEMENT_LIBRARY: ElementAsset[] = [
  // Shapes
  {
    id: "rectangle",
    category: "shape",
    label: "Rectangle",
    render: (color) => <rect x="8" y="18" width="84" height="64" rx="8" fill={color} />,
  },
  {
    id: "circle",
    category: "shape",
    label: "Circle",
    render: (color) => <circle cx="50" cy="50" r="42" fill={color} />,
  },
  {
    id: "triangle",
    category: "shape",
    label: "Triangle",
    render: (color) => <polygon points="50,10 90,88 10,88" fill={color} />,
  },
  {
    id: "diamond",
    category: "shape",
    label: "Diamond",
    render: (color) => <polygon points="50,4 96,50 50,96 4,50" fill={color} />,
  },
  {
    id: "star",
    category: "shape",
    label: "Star",
    render: (color) => <path d="M50 5 61 37 96 37 67 57 78 90 50 70 22 90 33 57 4 37 39 37Z" fill={color} />,
  },

  // Icons
  {
    id: "heart",
    category: "icon",
    label: "Heart",
    render: (color) => (
      <path
        d="M50 88C50 88 12 62 12 34C12 18 24 8 38 8C44 8 50 12 50 20C50 12 56 8 62 8C76 8 88 18 88 34C88 62 50 88 50 88Z"
        fill={color}
      />
    ),
  },
  {
    id: "bolt",
    category: "icon",
    label: "Bolt",
    render: (color) => <path d="M56 6 24 52h18l-6 42 40-52H58Z" fill={color} />,
  },
  {
    id: "check-circle",
    category: "icon",
    label: "Check",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="7" />
        <path d="M32 52 46 66 70 34" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    id: "arrow-right",
    category: "icon",
    label: "Arrow",
    render: (color) => (
      <>
        <line x1="10" y1="50" x2="80" y2="50" stroke={color} strokeWidth="7" strokeLinecap="round" />
        <path d="M58 26 86 50 58 74" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    id: "lightbulb",
    category: "icon",
    label: "Idea",
    render: (color) => (
      <>
        <path
          d="M50 10a26 26 0 0 0-15 47c3 2 5 6 5 10h20c0-4 2-8 5-10A26 26 0 0 0 50 10Z"
          fill="none"
          stroke={color}
          strokeWidth="6"
        />
        <line x1="40" y1="82" x2="60" y2="82" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <line x1="43" y1="92" x2="57" y2="92" stroke={color} strokeWidth="6" strokeLinecap="round" />
      </>
    ),
  },

  // Decorative
  {
    id: "dots",
    category: "decorative",
    label: "Dots",
    render: (color) => (
      <>
        <circle cx="26" cy="68" r="9" fill={color} />
        <circle cx="56" cy="38" r="15" fill={color} />
        <circle cx="80" cy="72" r="7" fill={color} />
      </>
    ),
  },
  {
    id: "wave",
    category: "decorative",
    label: "Wave",
    render: (color) => <path d="M5 60 Q27 30 50 60 T95 60" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />,
  },
  {
    id: "sparkle",
    category: "decorative",
    label: "Sparkle",
    render: (color) => <path d="M50 4 59 41 96 50 59 59 50 96 41 59 4 50 41 41Z" fill={color} />,
  },
  {
    id: "ring",
    category: "decorative",
    label: "Ring",
    render: (color) => <circle cx="50" cy="50" r="36" fill="none" stroke={color} strokeWidth="9" />,
  },
  {
    id: "confetti",
    category: "decorative",
    label: "Confetti",
    render: (color) => (
      <>
        <rect x="20" y="20" width="14" height="6" rx="2" fill={color} transform="rotate(20 27 23)" />
        <rect x="60" y="15" width="12" height="6" rx="2" fill={color} transform="rotate(-15 66 18)" />
        <rect x="70" y="60" width="14" height="6" rx="2" fill={color} transform="rotate(35 77 63)" />
        <rect x="15" y="65" width="10" height="6" rx="2" fill={color} transform="rotate(-25 20 68)" />
        <circle cx="50" cy="45" r="4" fill={color} />
      </>
    ),
  },

  // Clouds
  {
    id: "cloud",
    category: "cloud",
    label: "Cloud",
    render: (color) => (
      <g transform="translate(5,15) scale(3.75)">
        <path d={CLOUD_PATH} fill={color} />
      </g>
    ),
  },
  {
    id: "cloud-outline",
    category: "cloud",
    label: "Cloud outline",
    render: (color) => (
      <g transform="translate(5,15) scale(3.75)">
        <path d={CLOUD_PATH} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: "cloud-rain",
    category: "cloud",
    label: "Rain cloud",
    render: (color) => (
      <>
        <g transform="translate(5,8) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
        <line x1="30" y1="80" x2="24" y2="94" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="50" y1="80" x2="44" y2="94" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="70" y1="80" x2="64" y2="94" stroke={color} strokeWidth="5" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "cloud-sun",
    category: "cloud",
    label: "Sun cloud",
    render: (color) => (
      <>
        <circle cx="32" cy="30" r="16" fill={color} />
        <line x1="32" y1="2" x2="32" y2="10" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="8" y1="30" x2="0" y2="30" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="12" y1="10" x2="7" y2="5" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <g transform="translate(18,35) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
      </>
    ),
  },
  {
    id: "cloud-storm",
    category: "cloud",
    label: "Storm cloud",
    render: (color) => (
      <>
        <g transform="translate(5,6) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
        <path d="M54 66 40 86h12l-8 20 26-30H56Z" fill={color} />
      </>
    ),
  },
  {
    id: "cloud-snow",
    category: "cloud",
    label: "Snow cloud",
    render: (color) => (
      <>
        <g transform="translate(5,8) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
        <circle cx="30" cy="84" r="4.5" fill={color} />
        <circle cx="50" cy="90" r="4.5" fill={color} />
        <circle cx="70" cy="84" r="4.5" fill={color} />
      </>
    ),
  },
  {
    id: "cloud-moon",
    category: "cloud",
    label: "Moon cloud",
    render: (color) => (
      <>
        <path d="M32 12a18 18 0 1 0 12 31 22 22 0 0 1 -12-31Z" fill={color} />
        <g transform="translate(18,35) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
      </>
    ),
  },
  {
    id: "cloud-double",
    category: "cloud",
    label: "Double cloud",
    render: (color) => (
      <>
        <g transform="translate(0,42) scale(2.6)">
          <path d={CLOUD_PATH} fill={color} opacity="0.55" />
        </g>
        <g transform="translate(28,18) scale(3.4)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
      </>
    ),
  },

  // Numbers
  ...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => ({
    id: `number-${digit}`,
    category: "number" as const,
    label: digit,
    render: (color: string) => renderGlyph(digit, color),
  })),

  // Alphabet
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => ({
    id: `letter-${letter}`,
    category: "letter" as const,
    label: letter,
    render: (color: string) => renderGlyph(letter, color),
  })),

  // Symbols
  ...[
    { char: "!", label: "Exclamation" },
    { char: "?", label: "Question" },
    { char: "+", label: "Plus" },
    { char: "−", label: "Minus" },
    { char: "×", label: "Multiply" },
    { char: "÷", label: "Divide" },
    { char: "%", label: "Percent" },
    { char: "&", label: "Ampersand" },
    { char: "@", label: "At" },
    { char: "#", label: "Hash" },
    { char: "*", label: "Asterisk" },
    { char: "=", label: "Equals" },
  ].map(({ char, label }) => ({
    id: `symbol-${label.toLowerCase()}`,
    category: "symbol" as const,
    label,
    render: (color: string) => renderGlyph(char, color),
  })),
];

export function getElementAsset(assetId: string): ElementAsset | undefined {
  return ELEMENT_LIBRARY.find((asset) => asset.id === assetId);
}

export const ELEMENT_CATEGORY_LABELS: Record<ElementCategory, string> = {
  shape: "Shapes",
  icon: "Icons",
  decorative: "Decorative",
  cloud: "Clouds",
  number: "Numbers",
  letter: "Alphabet",
  symbol: "Symbols",
};

export const DEFAULT_ELEMENT_COLOR = "#191A2C";
export const DEFAULT_ELEMENT_SIZE = 140;
