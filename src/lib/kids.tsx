import type { ReactNode } from "react";

// Two cartoon Filipino schoolboys, full body, facing front: a big round head, big eyes, flat
// colors, and soft see-through shading instead of outlines. Both are built from the same parts
// (hair, clothes, pose) in one 120×210 drawing area, centered on x = 60. The element color goes on
// the shorts (and the neckerchief); skin, hair, and the rest stay fixed.

interface KidLook {
  skin: string;
  hair: string;
  hairStyle: "swoop" | "spiky";
  eyes: string;
  top: string; // the polo shirt
  bottomColor: string; // the shorts
  scarf?: string; // neckerchief: a scarf knotted at the collar, with two wide tails
  trim?: string; // polo collar and sleeve edges in a second color
  patch?: boolean; // small Philippine flag on the chest
  sneakers?: boolean; // shoes with a white sole and laces
  shoes: string;
  book?: string; // cover color of a book held against the chest (left arm)
  // "wave" = right arm raised, waving. "fist" = left arm raised with a fist, right hand holding
  // the backpack strap.
  pose: "wave" | "fist";
  backpack?: string;
}

const INK = "#3A2A24";
const MOUTH = "#8C2F39";
const SKIN = { peach: "#F7C6A3", tan: "#E2A574" };
const HAIR_BLACK = "#2B2426";
const EYES_DARK_BROWN = "#4A2E1F";
const UNIFORM_WHITE = "#FFFFFF";

// See-through black or white on top of a color, so shading works on any color.
const shadow = (shape: ReactNode) => <g fill="#000" fillOpacity="0.12">{shape}</g>;
const shine = (shape: ReactNode) => <g fill="#FFF" fillOpacity="0.3">{shape}</g>;

// Mirror an x position to the right side of the body.
const flip = (x: number) => 120 - x;

// Round arm or leg drawn as a thick line through the given points.
function limb(points: [number, number][], color: string, width: number, cap: "round" | "butt" = "round") {
  return (
    <path
      d={`M${points.map((p) => p.join(" ")).join("L")}`}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap={cap}
      strokeLinejoin="round"
    />
  );
}

// Hair in front, over the top of the head.
function renderHair({ hair, hairStyle }: KidLook) {
  if (hairStyle === "swoop") {
    return (
      <>
        <path d="M28 57C22 30 40 14 62 16C84 16 98 32 92 57C90 48 88 42 84 38C76 44 60 44 48 36C42 42 34 47 30 59Z" fill={hair} />
        <path d="M50 20C56 7 72 6 80 15C71 13 62 15 55 23Z" fill={hair} />
        {shine(<path d="M44 24C52 19 62 18 70 20C62 22 54 24 48 28Z" />)}
      </>
    );
  }
  return (
    <>
      <path
        d="M28 56C24 38 32 24 42 21Q42 12 52 14Q58 5 67 11Q78 7 80 18Q90 20 88 30C94 38 94 48 92 56C88 47 84 42 78 40Q72 44 66 40Q58 45 50 40Q44 44 40 38C34 43 30 49 28 56Z"
        fill={hair}
      />
      {shine(<path d="M46 26C52 22 60 21 66 22C60 24 54 26 49 30Z" />)}
    </>
  );
}

// Eyes looking a little to the side, eyebrows, nose, a small open smile, and rosy cheeks.
function renderFace({ eyes }: KidLook) {
  return (
    <>
      {[48, 72].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="57" rx="5.6" ry="6.6" fill="#FFFFFF" />
          <circle cx={x + 0.6} cy="58" r="4.2" fill={eyes} />
          <circle cx={x + 0.6} cy="58" r="2.1" fill="#1A1414" />
          <circle cx={x + 2.2} cy="55.6" r="1.5" fill="#FFFFFF" />
          <circle cx={x - 1} cy="60.2" r="0.7" fill="#FFFFFF" />
          <path d={`M${x - 6} 53.5Q${x} 48 ${x + 6} 53.5`} fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
          <path d={`M${x - 5} 45.5Q${x} 42.5 ${x + 5} 45`} fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
        </g>
      ))}
      <path d="M58.3 65Q60 66.8 61.7 65" fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M53.5 70.5Q60 72 66.5 70.5Q64.5 78 60 78Q55.5 78 53.5 70.5Z" fill={MOUTH} />
      <path d="M55 71.2Q60 72.6 65 71.2L64.6 72.8Q60 74 55.4 72.8Z" fill="#FFFFFF" />
      <path d="M56.5 76.2Q60 74 63.5 76.2Q60 78.4 56.5 76.2Z" fill="#F07C8C" />
      {[40, 80].map((x) => (
        <ellipse key={x} cx={x} cy="67" rx="5" ry="3" fill="#FF7A7A" fillOpacity="0.4" />
      ))}
    </>
  );
}

function renderKid(look: KidLook) {
  const { skin, top: shirt, shoes, pose, backpack } = look;

  // Open hand (palm, four fingers, thumb) centered on (cx, cy), fingers up.
  const openHand = (cx: number, cy: number) => (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r="5.2" fill={skin} />
      {(
        [
          [[-3, -3], [-4.2, -10]],
          [[-0.4, -4], [-0.4, -11.8]],
          [[2.2, -3.6], [3.4, -10.6]],
          [[4.2, -1.4], [6.4, -6.4]],
          [[-4, 1], [-7.6, -2.6]],
        ] as [number, number][][]
      ).map((finger) => (
        <g key={finger.join()}>{limb(finger, skin, 2.8)}</g>
      ))}
    </g>
  );

  // A short sleeve over an arm, with an optional thin `trim` edge: the full sleeve in the trim
  // color, then a slightly shorter one on top.
  const sleeve = (short: [number, number][]) => {
    if (!look.trim) return limb(short, shirt, 12);
    const [[x1, y1], [x2, y2]] = short;
    const length = Math.hypot(x2 - x1, y2 - y1);
    const inner: [number, number] = [x2 - ((x2 - x1) * 2.5) / length, y2 - ((y2 - y1) * 2.5) / length];
    return (
      <>
        {limb(short, look.trim, 12)}
        {limb([short[0], inner], shirt, 12)}
      </>
    );
  };

  // One arm and its sleeve (side -1 = left of the picture, 1 = right).
  const arm = (side: 1 | -1) => {
    if (look.book && side < 0) {
      // Left arm folded across the tummy, holding a book against the chest.
      return (
        <g key={side}>
          <rect x="62" y="99" width="25" height="31" rx="2" fill={look.book} />
          {shadow(<rect x="62" y="99" width="4" height="31" rx="1.5" />)}
          <rect x="84.5" y="100.5" width="2" height="28" fill="#FFFFFF" />
          <rect x="68" y="106" width="13" height="5" rx="1" fill="#FFFFFF" fillOpacity="0.8" />
          {limb([[42, 98], [37, 117], [64, 126]], skin, 8)}
          {sleeve([[44, 97], [39, 109]])}
          <ellipse cx="69" cy="125.5" rx="5.4" ry="4.6" fill={skin} />
        </g>
      );
    }
    if (pose === "fist") {
      // Left arm: bent up, with a fist in the air. Right arm: hand on the chest, holding the
      // backpack strap (the hand is drawn later, over the strap).
      return side < 0 ? (
        <g key={side}>
          {limb([[42, 98], [26, 97], [21, 78]], skin, 8)}
          {sleeve([[44, 97], [34, 97.5]])}
          <ellipse cx="20.5" cy="73" rx="6" ry="6.4" fill={skin} />
          <path d="M16 71.5H24.5M16.5 75H24" stroke="#000" strokeOpacity="0.15" strokeWidth="1.1" strokeLinecap="round" />
        </g>
      ) : (
        <g key={side}>
          {limb([[78, 98], [89, 113], [76, 110]], skin, 8)}
          {sleeve([[76, 97], [84, 106]])}
        </g>
      );
    }
    // Waving: the right arm bends up at the elbow, with an open hand.
    return (
      <g key={side}>
        {limb([[flip(42), 98], [flip(27), 104], [flip(20), 86]], skin, 8)}
        {sleeve([[flip(44), 97], [flip(34), 101]])}
        {openHand(flip(19), 81)}
      </g>
    );
  };

  return (
    <>
      {backpack && (
        <>
          <rect x="30" y="97" width="60" height="42" rx="12" fill={backpack} />
          {shadow(<rect x="30" y="97" width="60" height="42" rx="12" />)}
        </>
      )}

      {/* Legs, white socks, shoes */}
      {limb([[52, 138], [51, 197]], skin, 10, "butt")}
      {limb([[68, 138], [69, 197]], skin, 10, "butt")}
      {[51, 69].map((x) => (
        <g key={x}>
          <rect x={x - 5} y="186" width="10" height="11" fill="#FFFFFF" />
          <rect x={x - 5} y="186" width="10" height="2.5" fill="#000" fillOpacity="0.1" />
        </g>
      ))}
      {[-1, 1].map((side) => {
        const x = (v: number) => (side < 0 ? v : flip(v));
        return (
          <g key={side}>
            <path d={`M${x(58)} 196V201Q${x(58)} 206 ${x(52)} 206H${x(41)}Q${x(37)} 206 ${x(38)} 202Q${x(40)} 196 ${x(46)} 196Z`} fill={shoes} />
            {shine(<ellipse cx={x(46)} cy="199" rx="3.5" ry="1.4" />)}
            {look.sneakers && (
              <>
                <path d={`M${x(58)} 202.5Q${x(57.6)} 206 ${x(52)} 206H${x(41)}Q${x(37)} 206 ${x(38)} 202.5Z`} fill="#FFFFFF" />
                <path d={`M${x(48)} 198.6L${x(52)} 197.4M${x(48.5)} 201L${x(52.5)} 199.8`} stroke="#FFFFFF" strokeWidth="1.1" strokeLinecap="round" />
              </>
            )}
          </g>
        );
      })}

      {/* Shorts */}
      <path d="M39 132H81L81 163H62L60 152L58 163H39Z" fill={look.bottomColor} />
      {shadow(<path d="M75 132H81V163H75Z" />)}

      {/* Shirt, then arms and sleeves on top */}
      <path d="M39 101Q39 91 50 91H70Q81 91 81 101L82 136H38Z" fill={shirt} />
      {shadow(<path d="M74 91Q81 91 81 101L82 136H76Z" />)}
      {arm(1)}
      {arm(-1)}

      {backpack &&
        [48, flip(48)].map((x) => (
          <path key={x} d={`M${x} 92Q${x < 60 ? x - 3 : x + 3} 110 ${x < 60 ? x - 1 : x + 1} 126`} fill="none" stroke={backpack} strokeWidth="4" strokeLinecap="round" />
        ))}

      {/* Neck and polo collar */}
      <rect x="54" y="80" width="12" height="14" fill={skin} />
      {shadow(<rect x="54" y="80" width="12" height="8" />)}
      <path d="M53 90L60 96L51 99ZM67 90L60 96L69 99Z" fill="#FFFFFF" fillOpacity="0.85" stroke="#000" strokeOpacity="0.12" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M60 96V106" stroke="#000" strokeOpacity="0.15" strokeWidth="1.2" />
      {look.trim && (
        <path d="M53 90L60 96L51 99ZM67 90L60 96L69 99Z" fill={look.trim} stroke="#000" strokeOpacity="0.12" strokeWidth="0.8" strokeLinejoin="round" />
      )}
      {look.patch && (
        // Philippine flag: blue over red, a white triangle with a gold sun.
        <g>
          <rect x="49" y="104" width="10" height="3.5" fill="#0038A8" />
          <rect x="49" y="107.5" width="10" height="3.5" fill="#CE1126" />
          <path d="M49 104L54.5 107.5L49 111Z" fill="#FFFFFF" />
          <circle cx="50.9" cy="107.5" r="1" fill="#FCD116" />
          <rect x="49" y="104" width="10" height="7" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="0.6" />
        </g>
      )}
      {look.scarf && (
        // Neckerchief: wrapped around the collar, knotted in front, two wide tails.
        <g fill={look.scarf}>
          <path d="M51 90Q60 98 69 90L70 93.5Q60 102 50 93.5Z" />
          <path d="M58.5 98L50 110L56.5 111.5ZM61.5 98L70 110L63.5 111.5Z" />
          {shadow(<path d="M61.5 98L70 110L63.5 111.5Z" />)}
          <circle cx="60" cy="98" r="3.4" />
        </g>
      )}
      {pose === "fist" && (
        // Right hand gripping the backpack strap.
        <>
          <ellipse cx="74.5" cy="109.5" rx="5" ry="5.4" fill={skin} />
          <path d="M70.5 108.5H77M71 111.5H77" stroke="#000" strokeOpacity="0.15" strokeWidth="1" strokeLinecap="round" />
        </>
      )}

      {/* Head */}
      {[30, flip(30)].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="56" rx="5" ry="6.5" fill={skin} />
          {shadow(<ellipse cx={x} cy="56" rx="2.2" ry="3.5" />)}
        </g>
      ))}
      <path d="M29 50C29 20 91 20 91 50C91 73 78 86 60 86C42 86 29 73 29 50Z" fill={skin} />
      {renderFace(look)}
      {renderHair(look)}
    </>
  );
}

export const KID_VIEWBOX = "0 0 120 210";

export const KIDS: { id: string; label: string; defaultColor: string; render: (color: string) => ReactNode }[] = [
  {
    id: "ph-student-boy-3",
    label: "Filipino Boy 3",
    defaultColor: "#6B4226",
    // Fist up, proud: red collar and sleeve edges, a flag on the chest, and sneakers.
    render: (color) =>
      renderKid({ skin: SKIN.tan, hair: HAIR_BLACK, hairStyle: "spiky", eyes: EYES_DARK_BROWN, top: UNIFORM_WHITE, trim: "#D93B3B", patch: true, bottomColor: color, shoes: "#6D4AA8", sneakers: true, backpack: "#22A06B", pose: "fist" }),
  },
  {
    id: "ph-student-boy-4",
    label: "Filipino Boy 4",
    defaultColor: "#1D4ED8",
    // Waving, with a book under the arm and a neckerchief; `color` goes on the scarf and shorts.
    render: (color) =>
      renderKid({ skin: SKIN.peach, hair: HAIR_BLACK, hairStyle: "swoop", eyes: EYES_DARK_BROWN, top: UNIFORM_WHITE, scarf: color, bottomColor: color, shoes: "#7A4A2A", book: "#C08457", pose: "wave" }),
  },
];
