import type { ReactNode } from "react";

// Cartoon students, full body, facing front: a big round head, big eyes, flat colors, and soft
// see-through shading instead of outlines. Every kid is built from the same parts (hair, clothes,
// pose), so a new kid is just a new mix. All share one 120×210 drawing area, centered on x = 60.
// The element color goes on the main piece of clothing; skin, hair, and the rest stay fixed.

interface KidLook {
  skin: string;
  hair: string;
  hairStyle: "swoop" | "spiky" | "curly" | "pigtails" | "long" | "bob" | "bun";
  eyes: string;
  // "pinafore" = a dress with shoulder straps over a t-shirt in `under`. "barong" = the Filipino
  // barong Tagalog: long, untucked, long sleeves, embroidered front.
  topStyle: "tee" | "polo" | "striped" | "blouse" | "dress" | "pinafore" | "barong";
  top: string;
  under?: string;
  bottom?: "shorts" | "pants" | "skirt"; // dresses and pinafores have none
  bottomColor?: string;
  plaid?: boolean; // checkered skirt, like a school uniform
  tie?: string; // school ribbon tie at the collar
  shoes: string;
  accent?: string; // hair ties, headband, or hair clip
  girl?: boolean; // eyelashes, and white socks on kids
  adult?: boolean; // a grown-up: longer body, smaller head
  glasses?: boolean;
  book?: string; // cover color of a book held against the chest (left arm)
  // "wave" = right arm raised, waving; "cheer" = both arms up, shouting hooray; "think" = finger
  // on the chin, other arm folded, eyes looking up. "read" = both hands hold an open book (cover
  // color = `book`) in front, eyes looking down at it. Missing = arms down.
  pose?: "wave" | "cheer" | "think" | "read";
  mouth?: "open" | "cheer" | "hmm"; // missing = closed smile
  happyEyes?: boolean; // closed, curved-up eyes, like laughing
  question?: string; // color of a "?" floating by the head
  backpack?: string;
}

const INK = "#3A2A24";
const MOUTH = "#8C2F39";
const SKIN = { light: "#FFDCC5", peach: "#F7C6A3", tan: "#E2A574", brown: "#B9784D", deep: "#8A5433" };
const HAIR = { black: "#2B2426", darkBrown: "#3D2A22", brown: "#6B3F24", chestnut: "#8E4A2B", blonde: "#F2C14E", ginger: "#D9642B" };
const EYES = { blue: "#3E7BD6", brown: "#7A4A2A", darkBrown: "#4A2E1F", green: "#3C9A5F" };
// Filipino school uniform colors.
const UNIFORM_WHITE = "#FFFFFF";
const SCHOOL_SHOES = "#1F1A1A";
const BARONG = "#F3EAD6";

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

// Hair behind the head (drawn before the body).
function renderBackHair({ hair, hairStyle }: KidLook) {
  if (hairStyle === "long") return <path d="M26 56C22 18 98 18 94 56L98 104Q86 111 77 102H43Q34 111 22 104Z" fill={hair} />;
  if (hairStyle === "bob") return <path d="M25 58C21 18 99 18 95 58C95 70 93 79 88 84Q84 86 80 82H40Q36 86 32 84C27 79 25 70 25 58Z" fill={hair} />;
  if (hairStyle === "bun") return <circle cx="60" cy="19" r="11" fill={hair} />;
  if (hairStyle === "pigtails") {
    return (
      <>
        {[22, flip(22)].map((x) => (
          <ellipse key={x} cx={x} cy="70" rx="8" ry="16" fill={hair} transform={`rotate(${x < 60 ? 22 : -22} ${x} 70)`} />
        ))}
      </>
    );
  }
  return null;
}

// Hair in front, over the top of the head.
function renderFrontHair({ hair, hairStyle, accent }: KidLook) {
  switch (hairStyle) {
    case "swoop":
      return (
        <>
          <path d="M28 57C22 30 40 14 62 16C84 16 98 32 92 57C90 48 88 42 84 38C76 44 60 44 48 36C42 42 34 47 30 59Z" fill={hair} />
          <path d="M50 20C56 7 72 6 80 15C71 13 62 15 55 23Z" fill={hair} />
          {shine(<path d="M44 24C52 19 62 18 70 20C62 22 54 24 48 28Z" />)}
        </>
      );
    case "spiky":
      return (
        <>
          <path
            d="M28 56C24 38 32 24 42 21Q42 12 52 14Q58 5 67 11Q78 7 80 18Q90 20 88 30C94 38 94 48 92 56C88 47 84 42 78 40Q72 44 66 40Q58 45 50 40Q44 44 40 38C34 43 30 49 28 56Z"
            fill={hair}
          />
          {shine(<path d="M46 26C52 22 60 21 66 22C60 24 54 26 49 30Z" />)}
        </>
      );
    case "curly": {
      // Curls around the top of the head, plus a second row filling the crown.
      const curl = (angle: number, radius: number, r: number) => {
        const rad = (angle * Math.PI) / 180;
        return <circle key={`${angle}-${radius}`} cx={60 + radius * Math.cos(rad)} cy={50 + radius * Math.sin(rad)} r={r} />;
      };
      return (
        <g fill={hair}>
          {[-172, -152, -132, -112, -90, -68, -48, -28, -8].map((a) => curl(a, 29, 8.5))}
          {[-150, -120, -90, -60, -30].map((a) => curl(a, 20, 8))}
        </g>
      );
    }
    case "pigtails":
      return (
        <>
          {/* Soft, rounded bangs straight across the forehead */}
          <path d="M29 55C24 27 44 17 60 17C76 17 96 27 91 55C89 47 87 42 84 39Q78 42 72 37Q66 41 60 37Q54 41 48 37Q42 42 36 39C33 43 30 48 29 55Z" fill={hair} />
          {shine(<path d="M40 28C46 23 52 21 56 21C52 25 47 28 43 31Z" />)}
          {/* Bows where the pigtails are tied */}
          {[24, flip(24)].map((x) => (
            <g key={x} fill={accent}>
              <path d={`M${x} 56L${x - 6} 51.5V60.5ZM${x} 56L${x + 6} 51.5V60.5Z`} stroke={accent} strokeWidth="1.5" strokeLinejoin="round" />
              <circle cx={x} cy="56" r="2.2" />
            </g>
          ))}
        </>
      );
    case "long":
      return (
        <>
          <path d="M29 55C26 28 44 20 60 20C78 20 96 28 91 55C86 42 76 36 64 36C56 40 44 44 36 46C32 48 30 51 29 55Z" fill={hair} />
          <path d="M31 45C36 23 84 23 89 45" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" />
        </>
      );
    case "bob":
      return (
        <>
          <path d="M29 51C28 26 46 20 60 20C74 20 92 26 91 51C87 45 81 42 74 42H46C39 42 33 45 29 51Z" fill={hair} />
          <rect x="74" y="33" width="11" height="4.5" rx="2.2" fill={accent} transform="rotate(-20 79 35)" />
        </>
      );
    case "bun":
      // Neatly pulled back, with a side part; the bun itself is behind (see renderBackHair).
      return (
        <>
          <path d="M29 55C24 26 44 17 60 17C76 17 96 26 91 55C88 44 80 36 64 35C50 36 36 42 29 55Z" fill={hair} />
          {shine(<path d="M44 26C50 22 56 21 60 21C56 24 50 27 46 30Z" />)}
        </>
      );
  }
}

function renderFace(look: KidLook) {
  const { eyes, girl, mouth, happyEyes, pose } = look;
  // A thinking kid looks up and to the side, with one eyebrow raised; a reading kid looks down.
  const thinking = pose === "think";
  const lookX = thinking ? 1.8 : pose === "read" ? 0 : 0.6;
  const lookY = thinking ? -1.8 : pose === "read" ? 1.8 : 0;
  return (
    <>
      {[48, 72].map((x) => (
        <g key={x}>
          {happyEyes ? (
            <>
              <path d={`M${x - 5.5} 59Q${x} 51.5 ${x + 5.5} 59`} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
              {girl && (
                <path
                  d={x < 60 ? `M${x - 5.2} 57.6L${x - 7.6} 55.8` : `M${x + 5.2} 57.6L${x + 7.6} 55.8`}
                  stroke={INK}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              )}
            </>
          ) : (
            <>
              <ellipse cx={x} cy="57" rx="5.6" ry="6.6" fill="#FFFFFF" />
              <circle cx={x + lookX} cy={58 + lookY} r="4.2" fill={eyes} />
              <circle cx={x + lookX} cy={58 + lookY} r="2.1" fill="#1A1414" />
              <circle cx={x + lookX + 1.6} cy={55.6 + lookY} r="1.5" fill="#FFFFFF" />
              <circle cx={x + lookX - 1.6} cy={60.2 + lookY} r="0.7" fill="#FFFFFF" />
              <path d={`M${x - 6} 53.5Q${x} 48 ${x + 6} 53.5`} fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}
          {girl && !happyEyes && (
            // Two short, soft lashes at the outer corner.
            <path
              d={
                x < 60
                  ? `M${x - 5.2} 52.6Q${x - 6.6} 51.9 ${x - 7.2} 50.8M${x - 3.8} 51.2Q${x - 4.8} 50 ${x - 5} 48.9`
                  : `M${x + 5.2} 52.6Q${x + 6.6} 51.9 ${x + 7.2} 50.8M${x + 3.8} 51.2Q${x + 4.8} 50 ${x + 5} 48.9`
              }
              fill="none"
              stroke={INK}
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          )}
          <path
            d={thinking && x < 60 ? `M${x - 5} 43.5Q${x} 39 ${x + 5} 41.8` : `M${x - 5} 45.5Q${x} 42.5 ${x + 5} 45`}
            fill="none"
            stroke={INK}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </g>
      ))}
      <path d="M58.3 65Q60 66.8 61.7 65" fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth="1.4" strokeLinecap="round" />
      {mouth === "open" && (
        <>
          {/* A small, sweet open smile */}
          <path d="M53.5 70.5Q60 72 66.5 70.5Q64.5 78 60 78Q55.5 78 53.5 70.5Z" fill={MOUTH} />
          <path d="M55 71.2Q60 72.6 65 71.2L64.6 72.8Q60 74 55.4 72.8Z" fill="#FFFFFF" />
          <path d="M56.5 76.2Q60 74 63.5 76.2Q60 78.4 56.5 76.2Z" fill="#F07C8C" />
        </>
      )}
      {mouth === "cheer" && (
        <>
          {/* A big, wide-open "hooray!" mouth */}
          <path d="M51.5 69.5Q60 71.5 68.5 69.5Q67 83 60 83Q53 83 51.5 69.5Z" fill={MOUTH} />
          <path d="M53 70.2Q60 72.2 67 70.2L66.6 72.4Q60 74 53.4 72.4Z" fill="#FFFFFF" />
          <path d="M54.8 79.6Q60 75.6 65.2 79.6Q60 83 54.8 79.6Z" fill="#F07C8C" />
        </>
      )}
      {look.glasses && (
        <g fill="none" stroke={INK} strokeWidth="1.6">
          <circle cx="48" cy="57" r="8.5" fill="#FFFFFF" fillOpacity="0.12" />
          <circle cx="72" cy="57" r="8.5" fill="#FFFFFF" fillOpacity="0.12" />
          <path d="M56.5 56Q60 54 63.5 56M39.5 55L30.5 53M80.5 55L89.5 53" strokeLinecap="round" />
        </g>
      )}
      {/* "Hmm…": a small mouth pulled to one side */}
      {mouth === "hmm" && <path d="M55.5 73Q61 72.8 65.5 70.4" fill="none" stroke={MOUTH} strokeWidth="1.8" strokeLinecap="round" />}
      {!mouth && <path d="M52.5 70.5Q60 77 67.5 70.5" fill="none" stroke={MOUTH} strokeWidth="1.8" strokeLinecap="round" />}
      {[40, 80].map((x) => (
        <ellipse key={x} cx={x} cy="67" rx="5" ry="3" fill="#FF7A7A" fillOpacity="0.4" />
      ))}
    </>
  );
}

// Raised left arm for each pose: shoulder → elbow → wrist, the hand (center and tilt), and the
// sleeve. The right arm is the mirror image.
const RAISED_ARMS: Record<"wave" | "cheer", { arm: [number, number][]; hand: { x: number; y: number; turn: number }; sleeve: [number, number][] }> = {
  wave: { arm: [[42, 98], [27, 104], [20, 86]], hand: { x: 19, y: 81, turn: 0 }, sleeve: [[44, 97], [34, 101]] },
  cheer: { arm: [[43, 97], [28, 87], [17, 70]], hand: { x: 14.5, y: 65.5, turn: -28 }, sleeve: [[44, 97], [35, 91]] },
};

function renderKid(look: KidLook) {
  const { skin, topStyle, top, shoes, pose, backpack } = look;
  const isDress = topStyle === "dress" || topStyle === "pinafore";
  // The shirt itself: a pinafore's straps and bib go over a t-shirt in `under`.
  const shirt = topStyle === "pinafore" ? (look.under ?? "#FFFFFF") : top;
  const skirtColor = isDress ? top : look.bottomColor;

  // Open hand (palm, four fingers, thumb) centered on (cx, cy), fingers up, turned by `turn`
  // degrees. `mirror` -1 = a left hand (thumb on the other side).
  const openHand = (cx: number, cy: number, turn: number, mirror: 1 | -1) => (
    <g transform={`translate(${cx} ${cy}) rotate(${turn}) scale(${mirror} 1)`}>
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

  // A sleeve over an arm: short (`short` points), or for a barong, long — the whole arm, stopping
  // just before the wrist.
  const longSleeves = topStyle === "barong";
  const sleeve = (arm: [number, number][], short: [number, number][]) => {
    if (!longSleeves) return limb(short, shirt, 12);
    const [[x1, y1], [x2, y2]] = arm.slice(-2);
    const length = Math.hypot(x2 - x1, y2 - y1);
    const cuff: [number, number] = [x2 - ((x2 - x1) * 3.5) / length, y2 - ((y2 - y1) * 3.5) / length];
    return limb([short[0], ...arm.slice(1, -1), cuff], shirt, 10.5);
  };

  // One arm and its sleeve. Arms hang just outside the shirt; "wave" bends the right arm up
  // at the elbow; "cheer" throws both arms up in a V. Points are for the left arm, mirrored for the right.
  const arm = (side: 1 | -1) => {
    if (pose === "think") {
      // Right arm: elbow down, forearm up to the chin (the hand is drawn over the face, later).
      // Left arm: folded across the tummy, hand holding the right elbow.
      return side > 0 ? (
        <g key={side}>
          {limb([[78, 98], [92, 124]], skin, 8)}
          {limb([[76, 97], [83, 110]], shirt, 12)}
          {/* The forearm crosses in front of the chest, up to the chin */}
          {limb([[92, 124], [68, 93]], skin, 8)}
        </g>
      ) : (
        <g key={side}>
          {limb([[42, 98], [37, 117], [82, 125]], skin, 8)}
          <ellipse cx="88" cy="125" rx="5.4" ry="4.6" fill={skin} />
          {limb([[44, 97], [39, 109]], shirt, 12)}
        </g>
      );
    }
    if (pose === "read") {
      // Elbows out, hands in front of the tummy; the book and the hands holding it are drawn later.
      const at = (points: [number, number][]) => points.map(([px, py]) => [side < 0 ? px : flip(px), py] as [number, number]);
      return (
        <g key={side}>
          {limb(at([[42, 98], [30, 114], [36, 118]]), skin, 8)}
          {sleeve(at([[42, 98], [30, 114], [36, 118]]), at([[44, 97], [38, 108]]))}
        </g>
      );
    }
    if (look.book && side < 0) {
      // Left arm folded across the tummy, holding a book against the chest.
      const arm: [number, number][] = [[42, 98], [37, 117], [64, 126]];
      return (
        <g key={side}>
          <rect x="62" y="99" width="25" height="31" rx="2" fill={look.book} />
          {shadow(<rect x="62" y="99" width="4" height="31" rx="1.5" />)}
          <rect x="84.5" y="100.5" width="2" height="28" fill="#FFFFFF" />
          <rect x="68" y="106" width="13" height="5" rx="1" fill="#FFFFFF" fillOpacity="0.8" />
          {limb(arm, skin, 8)}
          {sleeve(arm, [[44, 97], [39, 109]])}
          <ellipse cx="69" cy="125.5" rx="5.4" ry="4.6" fill={skin} />
        </g>
      );
    }
    const x = (v: number) => (side < 0 ? v : flip(v));
    const armPose = pose === "cheer" || (pose === "wave" && side > 0) ? pose : "down";
    const at = (points: [number, number][]) => points.map(([px, py]) => [x(px), py] as [number, number]);
    if (armPose === "down") {
      return (
        <g key={side}>
          {limb(at([[42, 98], [34, 117], [31, 133]]), skin, 8)}
          {sleeve(at([[42, 98], [34, 117], [31, 133]]), at([[44, 97], [39, 110]]))}
          <ellipse cx={x(30.5)} cy="137" rx="4.8" ry="5.4" fill={skin} />
          {topStyle === "striped" && shine(limb(at([[41.5, 104], [40.5, 108]]), "#FFF", 11, "butt"))}
        </g>
      );
    }
    const raised = RAISED_ARMS[armPose];
    return (
      <g key={side}>
        {limb(at(raised.arm), skin, 8)}
        {sleeve(at(raised.arm), at(raised.sleeve))}
        {openHand(x(raised.hand.x), raised.hand.y, side * -raised.hand.turn, side > 0 ? 1 : -1)}
      </g>
    );
  };

  // A grown-up is the same drawing with the body stretched taller and wider (feet stay put) and the
  // head made smaller, sitting on the taller neck.
  const bodyT = look.adult ? "translate(60 206) scale(1.1 1.13) translate(-60 -206)" : undefined;
  const headT = look.adult ? "translate(60 64) scale(0.8) translate(-60 -80)" : undefined;
  // A barong is worn untucked, so it hangs lower.
  const hem = topStyle === "barong" ? 148 : 136;
  // Left and right edge of the skirt at height y (it flares from 40–80 at the waist to 30–90 at the hem).
  const skirtEdge = (y: number) => 40 - ((y - 128) * 10) / 42;

  return (
    <>
      <g transform={bodyT}>
        {backpack && (
          <>
            <rect x="30" y="97" width="60" height="42" rx="12" fill={backpack} />
            {shadow(<rect x="30" y="97" width="60" height="42" rx="12" />)}
          </>
        )}
      </g>
      <g transform={headT}>{renderBackHair(look)}</g>

      <g transform={bodyT}>
      {/* Legs, socks, shoes */}
      {limb([[52, 138], [51, 197]], skin, 10, "butt")}
      {limb([[68, 138], [69, 197]], skin, 10, "butt")}
      {look.girl && !look.adult &&
        [51, 69].map((x) => (
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
          </g>
        );
      })}

      {/* Shorts, pants, or skirt */}
      {look.bottom === "pants" && (
        <>
          <path d="M39 132H81L79 196H63L60 150L57 196H41Z" fill={look.bottomColor} />
          {shadow(<path d="M75 132H81L79 196H73Z" />)}
        </>
      )}
      {look.bottom === "shorts" && (
        <>
          <path d="M39 132H81L81 163H62L60 152L58 163H39Z" fill={look.bottomColor} />
          {shadow(<path d="M75 132H81V163H75Z" />)}
        </>
      )}
      {(look.bottom === "skirt" || isDress) && (
        <>
          <path d="M40 128H80L90 170Q60 175 30 170Z" fill={skirtColor} />
          {shadow(<path d="M72 128H80L90 170Q84 171.5 79 172Z" />)}
          {[48, 60, 72].map((x) => (
            <path key={x} d={`M${x} 136L${x + (x - 60) * 0.35} 172`} stroke="#000" strokeOpacity="0.08" strokeWidth="1.5" />
          ))}
          {look.plaid && (
            <>
              {/* Checks: light bands across, thin dark lines down */}
              {[139, 153].map((y) => (
                <path key={y} d={`M${skirtEdge(y) + 0.5} ${y}H${flip(skirtEdge(y)) - 0.5}`} stroke="#FFF" strokeOpacity="0.28" strokeWidth="4" />
              ))}
              {[164].map((y) => (
                <path key={y} d={`M${skirtEdge(y) + 0.5} ${y}H${flip(skirtEdge(y)) - 0.5}`} stroke="#000" strokeOpacity="0.15" strokeWidth="1.2" />
              ))}
              {[54, 66].map((x) => (
                <path key={x} d={`M${x} 129L${x + (x - 60) * 0.4} 171`} stroke="#FFF" strokeOpacity="0.28" strokeWidth="3" />
              ))}
            </>
          )}
        </>
      )}

      {/* Shirt, then arms and sleeves on top */}
      <path d={`M39 101Q39 91 50 91H70Q81 91 81 101L82 ${hem}H38Z`} fill={shirt} />
      {topStyle === "barong" && (
        // Embroidery: dotted lines down both sides of the front, and buttons down the middle.
        <g fill="none" stroke="#B8A27A" strokeWidth="1" strokeLinecap="round">
          {[48, 52, 68, 72].map((x) => (
            <path key={x} d={`M${x} 97V${hem - 6}`} strokeDasharray="0.5 3" strokeWidth="1.4" />
          ))}
          <path d={`M50 97V${hem - 6}M70 97V${hem - 6}`} strokeOpacity="0.6" />
          {[104, 116, 128].map((y) => (
            <circle key={y} cx="60" cy={y} r="1" fill="#B8A27A" stroke="none" />
          ))}
        </g>
      )}
      {topStyle === "striped" && shine([104, 114, 124].map((y) => <rect key={y} x="39" y={y} width="42" height="4.5" />))}
      {topStyle === "pinafore" && (
        <>
          <path d="M46 106H74V132H46Z" fill={top} />
          <path d="M47 107L49 91M73 107L71 91" stroke={top} strokeWidth="4" />
          {[50, 70].map((x) => (
            <circle key={x} cx={x} cy="109" r="1.6" fill="#FFFFFF" fillOpacity="0.8" />
          ))}
        </>
      )}
      {topStyle === "dress" && <rect x="39" y="126" width="42" height="4" fill="#000" fillOpacity="0.2" />}
      {shadow(<path d={`M74 91Q81 91 81 101L82 ${hem}H76Z`} />)}
      {/* Right arm first, so a folded left arm's hand can sit on the right elbow */}
      {arm(1)}
      {arm(-1)}
      {pose === "read" && (
        // The open book, seen from the back: pages peek over the top, the two covers meet at the
        // spine in the middle, and a hand holds each side.
        <>
          <path d="M37 101Q48 95 60 100Q72 95 83 101V106H37Z" fill="#FFFFFF" stroke="#000" strokeOpacity="0.12" strokeWidth="0.8" />
          <path d="M34 102Q47 99 60 104V131Q47 126 34 129Z" fill={look.book} />
          <path d="M86 102Q73 99 60 104V131Q73 126 86 129Z" fill={look.book} />
          {shadow(<path d="M86 102Q73 99 60 104V131Q73 126 86 129Z" />)}
          {[35, flip(35)].map((x) => (
            <ellipse key={x} cx={x} cy="117" rx="4.6" ry="5.4" fill={skin} />
          ))}
        </>
      )}

      {backpack &&
        [48, flip(48)].map((x) => (
          <path key={x} d={`M${x} 92Q${x < 60 ? x - 3 : x + 3} 110 ${x < 60 ? x - 1 : x + 1} 126`} fill="none" stroke={backpack} strokeWidth="4" strokeLinecap="round" />
        ))}

      {/* Neck and collar */}
      <rect x="54" y="80" width="12" height="14" fill={skin} />
      {shadow(<rect x="54" y="80" width="12" height="8" />)}
      {topStyle === "polo" && (
        <>
          <path d="M53 90L60 96L51 99ZM67 90L60 96L69 99Z" fill="#FFFFFF" fillOpacity="0.85" stroke="#000" strokeOpacity="0.12" strokeWidth="0.8" strokeLinejoin="round" />
          <path d="M60 96V106" stroke="#000" strokeOpacity="0.15" strokeWidth="1.2" />
        </>
      )}
      {topStyle === "blouse" && (
        <>
          {/* Round collar; a faint edge keeps it visible on a white blouse */}
          <path d="M60 94Q52 102 47 94Q52 90 60 94ZM60 94Q68 102 73 94Q68 90 60 94Z" fill="#FFFFFF" stroke="#000" strokeOpacity="0.12" strokeWidth="0.8" />
          {[104, 114, 124].map((y) => (
            <circle key={y} cx="60" cy={y} r="1.3" fill="#FFFFFF" stroke="#000" strokeOpacity="0.1" strokeWidth="0.6" />
          ))}
        </>
      )}
      {topStyle === "barong" && <path d="M54 91L60 95L66 91" fill="none" stroke="#B8A27A" strokeWidth="1.4" strokeLinejoin="round" />}
      {look.tie && (
        // School ribbon: a bow with two tails.
        <g fill={look.tie}>
          <path d="M60 95L52 91V99ZM60 95L68 91V99Z" />
          <path d="M58.5 96L55 106L58.8 105ZM61.5 96L65 106L61.2 105Z" />
          <circle cx="60" cy="95" r="2.2" />
        </g>
      )}
      </g>

      {/* Head */}
      <g transform={headT}>
        {[30, flip(30)].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy="56" rx="5" ry="6.5" fill={skin} />
            {shadow(<ellipse cx={x} cy="56" rx="2.2" ry="3.5" />)}
          </g>
        ))}
        <path d="M29 50C29 20 91 20 91 50C91 73 78 86 60 86C42 86 29 73 29 50Z" fill={skin} />
        {renderFace(look)}
        {renderFrontHair(look)}
      </g>

      {/* Thinking: a fist under the chin with the pointer finger on the cheek */}
      {pose === "think" && (
        <>
          {limb([[70.5, 85], [74.5, 74.5]], skin, 3.6)}
          {shadow(<ellipse cx="68.5" cy="90.5" rx="6.6" ry="6.8" />)}
          <ellipse cx="67.5" cy="89" rx="6.2" ry="6.6" fill={skin} />
          <path d="M62.5 88.5H70.5M63 92H70.5" stroke="#000" strokeOpacity="0.15" strokeWidth="1.1" strokeLinecap="round" />
        </>
      )}
      {look.question && (
        <g fill={look.question}>
          <path d="M100 13Q100 5 107 5Q114 5 114 12Q114 17 107.5 19.5V24" fill="none" stroke={look.question} strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="107.5" cy="31" r="2.3" />
        </g>
      )}
    </>
  );
}

export const KID_VIEWBOX = "0 0 120 210";

export const KIDS: { id: string; label: string; defaultColor: string; render: (color: string) => ReactNode }[] = [
  {
    id: "kid-boy-1",
    label: "Boy 1",
    defaultColor: "#D93B3B",
    render: (color) =>
      renderKid({ skin: SKIN.peach, hair: HAIR.brown, hairStyle: "swoop", eyes: EYES.blue, topStyle: "tee", top: color, bottom: "shorts", bottomColor: "#2F5DA8", shoes: "#3A2A24", backpack: "#3B82F6" }),
  },
  {
    id: "kid-boy-2",
    label: "Boy 2",
    defaultColor: "#F5C518",
    render: (color) =>
      renderKid({ skin: SKIN.brown, hair: HAIR.black, hairStyle: "curly", eyes: EYES.brown, topStyle: "polo", top: color, bottom: "pants", bottomColor: "#3E8FA8", shoes: "#2F3A4A", pose: "wave", mouth: "open" }),
  },
  {
    id: "kid-boy-3",
    label: "Boy 3",
    defaultColor: "#4A9BD9",
    render: (color) =>
      renderKid({ skin: SKIN.light, hair: HAIR.ginger, hairStyle: "spiky", eyes: EYES.green, topStyle: "striped", top: color, bottom: "pants", bottomColor: "#A8672E", shoes: "#5A3A2A", mouth: "open", backpack: "#22A06B" }),
  },
  {
    id: "kid-girl-1",
    label: "Girl 1",
    defaultColor: "#EC5CA0",
    render: (color) =>
      renderKid({ skin: SKIN.light, hair: HAIR.black, hairStyle: "pigtails", eyes: EYES.blue, topStyle: "blouse", top: color, bottom: "skirt", bottomColor: "#9C3D6E", shoes: "#8A4A2A", accent: "#F472B6", girl: true, pose: "wave", mouth: "open" }),
  },
  {
    id: "kid-girl-2",
    label: "Girl 2",
    defaultColor: "#6CC04A",
    render: (color) =>
      renderKid({ skin: SKIN.tan, hair: HAIR.chestnut, hairStyle: "long", eyes: EYES.brown, topStyle: "dress", top: color, shoes: "#C0392B", accent: "#FACC15", girl: true, backpack: "#8B5CF6" }),
  },
  {
    id: "kid-girl-3",
    label: "Girl 3",
    defaultColor: "#5B7DB1",
    render: (color) =>
      renderKid({ skin: SKIN.peach, hair: HAIR.blonde, hairStyle: "bob", eyes: EYES.blue, topStyle: "pinafore", top: color, under: "#8FD3F0", shoes: "#E0457B", accent: "#EC4899", girl: true, pose: "wave" }),
  },

  // Jolly kids shouting "hooray!": both arms up and a big open mouth.
  {
    id: "kid-cheer-boy-1",
    label: "Hooray Boy 1",
    defaultColor: "#22A06B",
    render: (color) =>
      renderKid({ skin: SKIN.tan, hair: HAIR.black, hairStyle: "swoop", eyes: EYES.brown, topStyle: "tee", top: color, bottom: "shorts", bottomColor: "#2F5DA8", shoes: "#D93B3B", pose: "cheer", mouth: "cheer", happyEyes: true }),
  },
  {
    id: "kid-cheer-boy-2",
    label: "Hooray Boy 2",
    defaultColor: "#F97316",
    render: (color) =>
      renderKid({ skin: SKIN.light, hair: HAIR.brown, hairStyle: "spiky", eyes: EYES.blue, topStyle: "striped", top: color, bottom: "pants", bottomColor: "#3B5BA8", shoes: "#3A2A24", pose: "cheer", mouth: "cheer" }),
  },
  {
    id: "kid-cheer-boy-3",
    label: "Hooray Boy 3",
    defaultColor: "#3B82F6",
    render: (color) =>
      renderKid({ skin: SKIN.deep, hair: HAIR.black, hairStyle: "curly", eyes: EYES.brown, topStyle: "polo", top: color, bottom: "shorts", bottomColor: "#C9A46A", shoes: "#2F3A4A", pose: "cheer", mouth: "cheer", happyEyes: true }),
  },
  {
    id: "kid-cheer-girl-1",
    label: "Hooray Girl 1",
    defaultColor: "#A855F7",
    render: (color) =>
      renderKid({ skin: SKIN.peach, hair: HAIR.brown, hairStyle: "pigtails", eyes: EYES.green, topStyle: "blouse", top: color, bottom: "skirt", bottomColor: "#F5C518", shoes: "#8A4A2A", accent: "#FACC15", girl: true, pose: "cheer", mouth: "cheer", happyEyes: true }),
  },
  {
    id: "kid-cheer-girl-2",
    label: "Hooray Girl 2",
    defaultColor: "#EC4899",
    render: (color) =>
      renderKid({ skin: SKIN.brown, hair: HAIR.black, hairStyle: "long", eyes: EYES.brown, topStyle: "dress", top: color, shoes: "#7C3AED", accent: "#38BDF8", girl: true, pose: "cheer", mouth: "cheer" }),
  },
  {
    id: "kid-cheer-girl-3",
    label: "Hooray Girl 3",
    defaultColor: "#E5484D",
    render: (color) =>
      renderKid({ skin: SKIN.light, hair: HAIR.ginger, hairStyle: "bob", eyes: EYES.blue, topStyle: "pinafore", top: color, under: "#FFE9B8", shoes: "#3A2A24", accent: "#22C55E", girl: true, pose: "cheer", mouth: "cheer", happyEyes: true }),
  },

  // Thinking kids: finger on the chin, looking up, "hmm…", with a question mark.
  {
    id: "kid-think-boy-1",
    label: "Thinking Boy 1",
    defaultColor: "#6366F1",
    render: (color) =>
      renderKid({ skin: SKIN.peach, hair: HAIR.chestnut, hairStyle: "swoop", eyes: EYES.green, topStyle: "polo", top: color, bottom: "pants", bottomColor: "#374151", shoes: "#3A2A24", pose: "think", mouth: "hmm", question: "#F59E0B" }),
  },
  {
    id: "kid-think-boy-2",
    label: "Thinking Boy 2",
    defaultColor: "#14B8A6",
    render: (color) =>
      renderKid({ skin: SKIN.brown, hair: HAIR.black, hairStyle: "spiky", eyes: EYES.brown, topStyle: "tee", top: color, bottom: "shorts", bottomColor: "#A8672E", shoes: "#2F3A4A", pose: "think", mouth: "hmm", question: "#3B82F6" }),
  },
  {
    id: "kid-think-boy-3",
    label: "Thinking Boy 3",
    defaultColor: "#EF4444",
    render: (color) =>
      renderKid({ skin: SKIN.light, hair: HAIR.blonde, hairStyle: "curly", eyes: EYES.blue, topStyle: "striped", top: color, bottom: "pants", bottomColor: "#2F5DA8", shoes: "#5A3A2A", pose: "think", mouth: "hmm", question: "#8B5CF6", backpack: "#F59E0B" }),
  },
  {
    id: "kid-think-girl-1",
    label: "Thinking Girl 1",
    defaultColor: "#F97316",
    render: (color) =>
      renderKid({ skin: SKIN.tan, hair: HAIR.brown, hairStyle: "long", eyes: EYES.brown, topStyle: "dress", top: color, shoes: "#7C3AED", accent: "#EC4899", girl: true, pose: "think", mouth: "hmm", question: "#3B82F6" }),
  },
  {
    id: "kid-think-girl-2",
    label: "Thinking Girl 2",
    defaultColor: "#0EA5E9",
    render: (color) =>
      renderKid({ skin: SKIN.deep, hair: HAIR.black, hairStyle: "pigtails", eyes: EYES.brown, topStyle: "blouse", top: color, bottom: "skirt", bottomColor: "#1E3A8A", shoes: "#3A2A24", accent: "#FACC15", girl: true, pose: "think", mouth: "hmm", question: "#EC4899" }),
  },
  {
    id: "kid-think-girl-3",
    label: "Thinking Girl 3",
    defaultColor: "#22C55E",
    render: (color) =>
      renderKid({ skin: SKIN.peach, hair: HAIR.chestnut, hairStyle: "bob", eyes: EYES.green, topStyle: "pinafore", top: color, under: "#FDE2E4", shoes: "#E0457B", accent: "#F59E0B", girl: true, pose: "think", mouth: "hmm", question: "#F59E0B" }),
  },

  // Reading kids: holding an open book in front, eyes down on the page.
  {
    id: "kid-read-boy",
    label: "Reading Boy",
    defaultColor: "#F59E0B",
    render: (color) =>
      renderKid({ skin: SKIN.tan, hair: HAIR.black, hairStyle: "swoop", eyes: EYES.brown, topStyle: "tee", top: color, bottom: "shorts", bottomColor: "#2F5DA8", shoes: "#3A2A24", pose: "read", book: "#3B82F6" }),
  },
  {
    id: "kid-read-girl",
    label: "Reading Girl",
    defaultColor: "#A855F7",
    render: (color) =>
      renderKid({ skin: SKIN.peach, hair: HAIR.darkBrown, hairStyle: "pigtails", eyes: EYES.brown, topStyle: "blouse", top: color, bottom: "skirt", bottomColor: "#1E3A8A", shoes: "#8A4A2A", accent: "#F472B6", girl: true, pose: "read", book: "#EF4444" }),
  },

  // Filipino students in school uniform: white polo or blouse, with `color` on the shorts, pants, or
  // skirt (and the girls' ribbon tie), which is what changes from school to school.
  {
    id: "ph-student-boy-1",
    label: "Filipino Boy 1",
    defaultColor: "#1E3A8A",
    render: (color) =>
      renderKid({ skin: SKIN.tan, hair: HAIR.black, hairStyle: "swoop", eyes: EYES.darkBrown, topStyle: "polo", top: UNIFORM_WHITE, bottom: "shorts", bottomColor: color, shoes: SCHOOL_SHOES, backpack: "#2563EB" }),
  },
  {
    id: "ph-student-boy-2",
    label: "Filipino Boy 2",
    defaultColor: "#27324F",
    render: (color) =>
      renderKid({ skin: SKIN.brown, hair: HAIR.black, hairStyle: "spiky", eyes: EYES.darkBrown, topStyle: "polo", top: UNIFORM_WHITE, bottom: "pants", bottomColor: color, shoes: SCHOOL_SHOES, pose: "wave", mouth: "open" }),
  },
  {
    id: "ph-student-girl-1",
    label: "Filipino Girl 1",
    defaultColor: "#1D4ED8",
    render: (color) =>
      renderKid({ skin: SKIN.peach, hair: HAIR.black, hairStyle: "long", eyes: EYES.darkBrown, topStyle: "blouse", top: UNIFORM_WHITE, tie: color, bottom: "skirt", bottomColor: color, plaid: true, shoes: SCHOOL_SHOES, accent: "#1E3A8A", girl: true, backpack: "#EC4899" }),
  },
  {
    id: "ph-student-girl-2",
    label: "Filipino Girl 2",
    defaultColor: "#8B1E3F",
    render: (color) =>
      renderKid({ skin: SKIN.brown, hair: HAIR.darkBrown, hairStyle: "pigtails", eyes: EYES.darkBrown, topStyle: "blouse", top: UNIFORM_WHITE, tie: color, bottom: "skirt", bottomColor: color, plaid: true, shoes: SCHOOL_SHOES, accent: color, girl: true, pose: "wave", mouth: "open" }),
  },

  // Filipino teachers: grown-ups in school-teacher clothes.
  {
    id: "ph-teacher-woman-1",
    label: "Filipina Teacher 1",
    defaultColor: "#0F766E",
    render: (color) =>
      renderKid({ adult: true, skin: SKIN.tan, hair: HAIR.black, hairStyle: "bun", eyes: EYES.darkBrown, topStyle: "blouse", top: color, bottom: "skirt", bottomColor: "#1F2A44", shoes: SCHOOL_SHOES, girl: true, glasses: true, book: "#B91C1C" }),
  },
  {
    id: "ph-teacher-woman-2",
    label: "Filipina Teacher 2",
    defaultColor: "#BE185D",
    render: (color) =>
      renderKid({ adult: true, skin: SKIN.peach, hair: HAIR.darkBrown, hairStyle: "long", eyes: EYES.darkBrown, topStyle: "blouse", top: color, bottom: "pants", bottomColor: "#374151", shoes: SCHOOL_SHOES, girl: true, pose: "wave", mouth: "open" }),
  },
  {
    id: "ph-teacher-man-1",
    label: "Filipino Teacher 1",
    defaultColor: "#1F2937",
    // The barong stays its natural cream color; `color` goes on the pants.
    render: (color) =>
      renderKid({ adult: true, skin: SKIN.brown, hair: HAIR.black, hairStyle: "swoop", eyes: EYES.darkBrown, topStyle: "barong", top: BARONG, bottom: "pants", bottomColor: color, shoes: SCHOOL_SHOES, book: "#1D4ED8" }),
  },
  {
    id: "ph-teacher-man-2",
    label: "Filipino Teacher 2",
    defaultColor: "#2563EB",
    render: (color) =>
      renderKid({ adult: true, skin: SKIN.tan, hair: HAIR.black, hairStyle: "spiky", eyes: EYES.darkBrown, topStyle: "polo", top: color, bottom: "pants", bottomColor: "#3F3A36", shoes: SCHOOL_SHOES, glasses: true, pose: "wave", mouth: "open" }),
  },
];
