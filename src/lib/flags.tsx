import type { ReactNode } from "react";

// Country flags for the Elements panel. Each flag is drawn in its own `width` × `height` area (its
// real shape, e.g. 2:1 for the Philippines) and always keeps its true colors: a recolored flag
// would be the wrong flag. Detailed emblems (Mexico's eagle, Spain's coat of arms...) are simplified.

interface Flag {
  id: string;
  label: string;
  width: number;
  height: number;
  render: () => ReactNode;
}

const WHITE = "#FFFFFF";

// Points of a star centered at (cx, cy) with `points` tips; `rotate` turns it (degrees, 0 = a tip
// straight up). `inner` is how far in the dents go, as a share of the radius.
function starPoints(cx: number, cy: number, r: number, points = 5, rotate = 0, inner = 0.382) {
  return Array.from({ length: points * 2 }, (_, i) => {
    const angle = ((rotate - 90 + (i * 180) / points) * Math.PI) / 180;
    const radius = i % 2 === 0 ? r : r * inner;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

// Equal stripes, top to bottom.
function stripes(width: number, height: number, colors: string[]) {
  const band = height / colors.length;
  return colors.map((fill, i) => <rect key={i} y={i * band} width={width} height={band} fill={fill} />);
}

// Equal bands, left to right.
function bands(width: number, height: number, colors: string[]) {
  const band = width / colors.length;
  return colors.map((fill, i) => <rect key={i} x={i * band} width={band} height={height} fill={fill} />);
}

// A Nordic cross: its upright bar starts at `x`, its crossbar at `y`, both `size` thick. An `inner`
// color draws a thinner cross inside it (Norway, Iceland), half as thick.
function nordicCross(width: number, height: number, x: number, y: number, size: number, field: string, cross: string, inner?: string) {
  const crossPath = (pad: number) => `M${x + pad} 0h${size - 2 * pad}V${height}h${-(size - 2 * pad)}ZM0 ${y + pad}H${width}v${size - 2 * pad}H0Z`;
  return (
    <>
      <rect width={width} height={height} fill={field} />
      <path d={crossPath(0)} fill={cross} />
      {inner && <path d={crossPath(size / 4)} fill={inner} />}
    </>
  );
}

// The Union Jack in a 60×30 area (also used in Australia's corner). The red diagonals are shifted
// to one side of the white ones, like the real flag.
function unionJack() {
  return (
    <>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0 0 60 30M60 0 0 30" stroke={WHITE} strokeWidth="6" />
      <polygon points="0,0 30,15 30,17.24 0,2.24" fill="#C8102E" />
      <polygon points="30,15 60,0 55.53,0 30,12.76" fill="#C8102E" />
      <polygon points="60,30 30,15 30,12.76 60,27.76" fill="#C8102E" />
      <polygon points="30,15 0,30 4.47,30 30,17.24" fill="#C8102E" />
      <path d="M30 0V30M0 15H60" stroke={WHITE} strokeWidth="10" />
      <path d="M30 0V30M0 15H60" stroke="#C8102E" strokeWidth="6" />
    </>
  );
}

// One South Korean trigram: three bars, each whole or split in the middle, centered on (0, 0).
function trigram(x: number, y: number, rotate: number, split: [boolean, boolean, boolean]) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} fill="#000000">
      {split.map((isSplit, i) =>
        isSplit ? (
          <g key={i}>
            <rect x="-12.5" y={-9 + i * 7} width="11.5" height="4" />
            <rect x="1" y={-9 + i * 7} width="11.5" height="4" />
          </g>
        ) : (
          <rect key={i} x="-12.5" y={-9 + i * 7} width="25" height="4" />
        ),
      )}
    </g>
  );
}

// The 50 stars of the USA flag: 9 rows in the blue corner, taking turns with 6 and 5 stars.
const USA_STARS = Array.from({ length: 9 }, (_, row) =>
  Array.from({ length: row % 2 === 0 ? 6 : 5 }, (_, col) => starPoints((row % 2 === 0 ? 2 * col + 1 : 2 * col + 2) * 6.333, (row + 1) * 5.385, 3.08)),
).flat();

// The 24 spokes of India's wheel.
const INDIA_SPOKES = Array.from({ length: 24 }, (_, i) => {
  const angle = (i * 15 * Math.PI) / 180;
  return `M75 50L${(75 + 13 * Math.cos(angle)).toFixed(2)} ${(50 + 13 * Math.sin(angle)).toFixed(2)}`;
}).join("");

// China's four small stars each point a tip at the big star (at 25, 25).
const CHINA_SMALL_STARS = [
  [50, 10],
  [60, 20],
  [60, 35],
  [50, 45],
].map(([x, y]) => starPoints(x, y, 5, 5, (Math.atan2(25 - y, 25 - x) * 180) / Math.PI + 90));

export const FLAGS: Flag[] = [
  {
    id: "flag-philippines",
    label: "Philippines",
    width: 200,
    height: 100,
    render: () => (
      <>
        <rect width="200" height="50" fill="#0038A8" />
        <rect y="50" width="200" height="50" fill="#CE1126" />
        <polygon points="0,0 86.6,50 0,100" fill={WHITE} />
        <g fill="#FCD116">
          {Array.from({ length: 8 }, (_, i) => (
            <polygon key={i} points="29,30 32,40 26,40" transform={`rotate(${i * 45} 29 50)`} />
          ))}
          <circle cx="29" cy="50" r="9" />
          <polygon points={starPoints(9, 10, 5)} />
          <polygon points={starPoints(9, 90, 5)} />
          <polygon points={starPoints(75, 50, 5, 5, 90)} />
        </g>
      </>
    ),
  },
  {
    id: "flag-indonesia",
    label: "Indonesia",
    width: 150,
    height: 100,
    render: () => stripes(150, 100, ["#CE1126", WHITE]),
  },
  {
    id: "flag-malaysia",
    label: "Malaysia",
    width: 200,
    height: 100,
    render: () => (
      <>
        {stripes(200, 100, Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? "#CC0001" : WHITE)))}
        <rect width="100" height="57.14" fill="#010066" />
        <circle cx="38" cy="28.57" r="20" fill="#FFCC00" />
        <circle cx="44" cy="28.57" r="17" fill="#010066" />
        <polygon points={starPoints(72, 28.57, 15, 14, 0, 0.45)} fill="#FFCC00" />
      </>
    ),
  },
  {
    id: "flag-singapore",
    label: "Singapore",
    width: 150,
    height: 100,
    render: () => (
      <>
        {stripes(150, 100, ["#EF3340", WHITE])}
        <circle cx="30" cy="25" r="17" fill={WHITE} />
        <circle cx="37" cy="25" r="16" fill="#EF3340" />
        {Array.from({ length: 5 }, (_, i) => {
          const angle = ((i * 72 - 90) * Math.PI) / 180;
          return <polygon key={i} points={starPoints(45 + 7.5 * Math.cos(angle), 25 + 7.5 * Math.sin(angle), 3)} fill={WHITE} />;
        })}
      </>
    ),
  },
  {
    id: "flag-thailand",
    label: "Thailand",
    width: 150,
    height: 100,
    render: () => stripes(150, 100, ["#A51931", WHITE, "#2D2A4A", "#2D2A4A", WHITE, "#A51931"]),
  },
  {
    id: "flag-vietnam",
    label: "Vietnam",
    width: 150,
    height: 100,
    render: () => (
      <>
        <rect width="150" height="100" fill="#DA251D" />
        <polygon points={starPoints(75, 52, 30)} fill="#FFFF00" />
      </>
    ),
  },
  {
    id: "flag-brunei",
    label: "Brunei",
    width: 200,
    height: 100,
    render: () => (
      <>
        <rect width="200" height="100" fill="#F7E017" />
        <polygon points="0,14 0,28 200,86 200,72" fill={WHITE} />
        <polygon points="0,28 0,42 200,100 200,86" fill="#000000" />
        <g fill="#CF1126">
          <path d="M78 52A22 22 0 0 0 122 52A28 28 0 0 1 78 52Z" />
          <rect x="98" y="24" width="4" height="34" />
          <path d="M88 30Q100 18 112 30Z" />
          <rect x="80" y="38" width="6" height="16" rx="2" />
          <rect x="114" y="38" width="6" height="16" rx="2" />
        </g>
      </>
    ),
  },
  {
    id: "flag-cambodia",
    label: "Cambodia",
    width: 150,
    height: 100,
    render: () => (
      <>
        {stripes(150, 100, ["#032EA1", "#E00025", "#E00025", "#032EA1"])}
        <g fill={WHITE}>
          <rect x="48" y="62" width="54" height="5" />
          <rect x="54" y="50" width="42" height="12" />
          <polygon points="69,50 75,28 81,50" />
          <polygon points="57,50 62,36 67,50" />
          <polygon points="83,50 88,36 93,50" />
          <polygon points="48,62 51,52 54,62" />
          <polygon points="96,62 99,52 102,62" />
        </g>
      </>
    ),
  },
  {
    id: "flag-laos",
    label: "Laos",
    width: 150,
    height: 100,
    render: () => (
      <>
        {stripes(150, 100, ["#CE1126", "#002868", "#002868", "#CE1126"])}
        <circle cx="75" cy="50" r="20" fill={WHITE} />
      </>
    ),
  },
  {
    id: "flag-myanmar",
    label: "Myanmar",
    width: 150,
    height: 100,
    render: () => (
      <>
        {stripes(150, 100, ["#FECB00", "#34B233", "#EA2839"])}
        <polygon points={starPoints(75, 56, 38)} fill={WHITE} />
      </>
    ),
  },
  {
    id: "flag-timor-leste",
    label: "Timor-Leste",
    width: 200,
    height: 100,
    render: () => (
      <>
        <rect width="200" height="100" fill="#DC241F" />
        <polygon points="0,0 100,50 0,100" fill="#FFC726" />
        <polygon points="0,0 66.7,50 0,100" fill="#000000" />
        <polygon points={starPoints(22, 50, 11, 5, -26)} fill={WHITE} />
      </>
    ),
  },
  {
    id: "flag-usa",
    label: "United States",
    width: 190,
    height: 100,
    render: () => (
      <>
        {stripes(190, 100, Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? "#B22234" : WHITE)))}
        <rect width="76" height="53.85" fill="#3C3B6E" />
        <g fill={WHITE}>
          {USA_STARS.map((points, i) => (
            <polygon key={i} points={points} />
          ))}
        </g>
      </>
    ),
  },
  {
    id: "flag-uk",
    label: "United Kingdom",
    width: 60,
    height: 30,
    render: unionJack,
  },
  {
    id: "flag-canada",
    label: "Canada",
    width: 200,
    height: 100,
    render: () => (
      <>
        {bands(200, 100, ["#D52B1E", WHITE, WHITE, "#D52B1E"])}
        <polygon
          points="100,14 106,26 113,22 110,40 121,29 124,35 135,33 131,45 137,48 120,62 123,68 103,65 103,84 97,84 97,65 77,68 80,62 63,48 69,45 65,33 76,35 79,29 90,40 87,22 94,26"
          fill="#D52B1E"
        />
      </>
    ),
  },
  {
    id: "flag-mexico",
    label: "Mexico",
    width: 175,
    height: 100,
    render: () => (
      <>
        {bands(175, 100, ["#006847", WHITE, "#CE1126"])}
        <path d="M72 62Q87.5 76 103 62" fill="none" stroke="#3A7728" strokeWidth="3" strokeLinecap="round" />
        <rect x="85" y="52" width="5" height="12" rx="2" fill="#3A7728" />
        <path d="M80 42Q70 32 74 22Q82 30 86 38Z" fill="#6B4423" />
        <path d="M95 42Q105 32 101 22Q93 30 89 38Z" fill="#6B4423" />
        <ellipse cx="87.5" cy="45" rx="8" ry="10" fill="#8C5A2B" />
        <circle cx="91" cy="34" r="4.5" fill="#6B4423" />
      </>
    ),
  },
  {
    id: "flag-brazil",
    label: "Brazil",
    width: 100,
    height: 70,
    render: () => (
      <>
        <rect width="100" height="70" fill="#009C3B" />
        <polygon points="8.5,35 50,6 91.5,35 50,64" fill="#FFDF00" />
        <circle cx="50" cy="35" r="17.5" fill="#002776" />
        <path d="M33 32Q50 27 66.5 39" fill="none" stroke={WHITE} strokeWidth="3" />
        <g fill={WHITE}>
          <circle cx="44" cy="42" r="1" />
          <circle cx="50" cy="45" r="1" />
          <circle cx="56" cy="42" r="1" />
          <circle cx="47" cy="48" r="0.8" />
          <circle cx="54" cy="48" r="0.8" />
        </g>
      </>
    ),
  },
  {
    id: "flag-japan",
    label: "Japan",
    width: 150,
    height: 100,
    render: () => (
      <>
        <rect width="150" height="100" fill={WHITE} />
        <circle cx="75" cy="50" r="30" fill="#BC002D" />
      </>
    ),
  },
  {
    id: "flag-south-korea",
    label: "South Korea",
    width: 150,
    height: 100,
    render: () => (
      <>
        <rect width="150" height="100" fill={WHITE} />
        <g transform="rotate(33.69 75 50)">
          <circle cx="75" cy="50" r="25" fill="#0047A0" />
          <path d="M50 50A25 25 0 0 1 100 50A12.5 12.5 0 0 1 75 50A12.5 12.5 0 0 0 50 50Z" fill="#CD2E3A" />
        </g>
        {trigram(31, 21, -56.31, [false, false, false])}
        {trigram(119, 79, -56.31, [true, true, true])}
        {trigram(119, 21, 56.31, [true, false, true])}
        {trigram(31, 79, 56.31, [false, true, false])}
      </>
    ),
  },
  {
    id: "flag-china",
    label: "China",
    width: 150,
    height: 100,
    render: () => (
      <>
        <rect width="150" height="100" fill="#EE1C25" />
        <g fill="#FFFF00">
          <polygon points={starPoints(25, 25, 15)} />
          {CHINA_SMALL_STARS.map((points, i) => (
            <polygon key={i} points={points} />
          ))}
        </g>
      </>
    ),
  },
  {
    id: "flag-india",
    label: "India",
    width: 150,
    height: 100,
    render: () => (
      <>
        {stripes(150, 100, ["#FF9933", WHITE, "#138808"])}
        <circle cx="75" cy="50" r="13" fill="none" stroke="#000080" strokeWidth="2" />
        <path d={INDIA_SPOKES} stroke="#000080" strokeWidth="0.8" />
        <circle cx="75" cy="50" r="2.5" fill="#000080" />
      </>
    ),
  },
  {
    id: "flag-australia",
    label: "Australia",
    width: 200,
    height: 100,
    render: () => (
      <>
        <rect width="200" height="100" fill="#00008B" />
        <g transform="scale(1.6667)">{unionJack()}</g>
        <g fill={WHITE}>
          <polygon points={starPoints(50, 75, 15, 7, 0, 0.45)} />
          <polygon points={starPoints(150, 20, 6.5, 7, 0, 0.45)} />
          <polygon points={starPoints(150, 84, 6.5, 7, 0, 0.45)} />
          <polygon points={starPoints(128, 46, 6.5, 7, 0, 0.45)} />
          <polygon points={starPoints(170, 40, 6.5, 7, 0, 0.45)} />
          <polygon points={starPoints(160, 58, 3.5)} />
        </g>
      </>
    ),
  },
  {
    id: "flag-france",
    label: "France",
    width: 150,
    height: 100,
    render: () => bands(150, 100, ["#0055A4", WHITE, "#EF4135"]),
  },
  {
    id: "flag-germany",
    label: "Germany",
    width: 5,
    height: 3,
    render: () => stripes(5, 3, ["#000000", "#DD0000", "#FFCE00"]),
  },
  {
    id: "flag-italy",
    label: "Italy",
    width: 150,
    height: 100,
    render: () => bands(150, 100, ["#009246", WHITE, "#CE2B37"]),
  },
  {
    id: "flag-spain",
    label: "Spain",
    width: 150,
    height: 100,
    render: () => (
      <>
        {stripes(150, 100, ["#AA151B", "#F1BF00", "#F1BF00", "#AA151B"])}
        <rect x="27" y="40" width="3" height="22" fill="#B0B0B0" />
        <rect x="52" y="40" width="3" height="22" fill="#B0B0B0" />
        <polygon points="33,38 35,32 38,36 41,31 44,36 47,32 49,38" fill="#C8102E" />
        <path d="M33 40H49V54Q49 62 41 62Q33 62 33 54Z" fill="#AA151B" />
        <rect x="37" y="45" width="8" height="8" fill="#F1BF00" />
      </>
    ),
  },
  {
    id: "flag-portugal",
    label: "Portugal",
    width: 150,
    height: 100,
    render: () => (
      <>
        <rect width="150" height="100" fill="#DA291C" />
        <rect width="60" height="100" fill="#046A38" />
        <circle cx="60" cy="50" r="18" fill="none" stroke="#FFE000" strokeWidth="3.5" />
        <path d="M51 38H69V54Q69 63 60 63Q51 63 51 54Z" fill="#DA291C" />
        <path d="M54 41H66V53Q66 59 60 59Q54 59 54 53Z" fill={WHITE} />
        <g fill="#002D72">
          <circle cx="60" cy="45" r="1.6" />
          <circle cx="56.5" cy="50" r="1.6" />
          <circle cx="60" cy="50" r="1.6" />
          <circle cx="63.5" cy="50" r="1.6" />
          <circle cx="60" cy="55" r="1.6" />
        </g>
      </>
    ),
  },
  {
    id: "flag-netherlands",
    label: "Netherlands",
    width: 150,
    height: 100,
    render: () => stripes(150, 100, ["#AE1C28", WHITE, "#21468B"]),
  },
  {
    id: "flag-belgium",
    label: "Belgium",
    width: 15,
    height: 13,
    render: () => bands(15, 13, ["#000000", "#FDDA24", "#EF3340"]),
  },
  {
    id: "flag-switzerland",
    label: "Switzerland",
    width: 100,
    height: 100,
    render: () => (
      <>
        <rect width="100" height="100" fill="#DA291C" />
        <path d="M40 20H60V40H80V60H60V80H40V60H20V40H40Z" fill={WHITE} />
      </>
    ),
  },
  {
    id: "flag-austria",
    label: "Austria",
    width: 150,
    height: 100,
    render: () => stripes(150, 100, ["#C8102E", WHITE, "#C8102E"]),
  },
  {
    id: "flag-ireland",
    label: "Ireland",
    width: 200,
    height: 100,
    render: () => bands(200, 100, ["#169B62", WHITE, "#FF883E"]),
  },
  {
    id: "flag-poland",
    label: "Poland",
    width: 8,
    height: 5,
    render: () => stripes(8, 5, [WHITE, "#DC143C"]),
  },
  {
    id: "flag-greece",
    label: "Greece",
    width: 150,
    height: 100,
    render: () => (
      <>
        {stripes(150, 100, Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? "#0D5EAF" : WHITE)))}
        <rect width="55.56" height="55.56" fill="#0D5EAF" />
        <path d="M22.22 0H33.33V55.56H22.22ZM0 22.22H55.56V33.33H0Z" fill={WHITE} />
      </>
    ),
  },
  {
    id: "flag-sweden",
    label: "Sweden",
    width: 16,
    height: 10,
    render: () => nordicCross(16, 10, 5, 4, 2, "#006AA7", "#FECC02"),
  },
  {
    id: "flag-norway",
    label: "Norway",
    width: 22,
    height: 16,
    render: () => nordicCross(22, 16, 6, 6, 4, "#BA0C2F", WHITE, "#00205B"),
  },
  {
    id: "flag-denmark",
    label: "Denmark",
    width: 37,
    height: 28,
    render: () => nordicCross(37, 28, 12, 12, 4, "#C8102E", WHITE),
  },
  {
    id: "flag-finland",
    label: "Finland",
    width: 18,
    height: 11,
    render: () => nordicCross(18, 11, 5, 4, 3, WHITE, "#002F6C"),
  },
  {
    id: "flag-iceland",
    label: "Iceland",
    width: 25,
    height: 18,
    render: () => nordicCross(25, 18, 7, 7, 4, "#02529C", WHITE, "#DC1E35"),
  },
  {
    id: "flag-new-zealand",
    label: "New Zealand",
    width: 200,
    height: 100,
    render: () => (
      <>
        <rect width="200" height="100" fill="#012169" />
        <g transform="scale(1.6667)">{unionJack()}</g>
        <g fill="#C8102E" stroke={WHITE} strokeWidth="1.5">
          <polygon points={starPoints(150, 20, 6)} />
          <polygon points={starPoints(132, 46, 6)} />
          <polygon points={starPoints(166, 40, 5)} />
          <polygon points={starPoints(150, 82, 7)} />
        </g>
      </>
    ),
  },
];
