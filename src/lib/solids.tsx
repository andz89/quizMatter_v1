import type { ReactNode } from "react";

// Our own small 3D renderer for the solid shapes (cube, cone, sphere, ...), drawn as flat SVG so
// color, gradients, drag, and resize work like every other element. Axes: x right, y up, z toward
// the viewer. Every solid is convex and centered on the origin, which keeps the math simple.

type Vec3 = [number, number, number];

export interface Rotation3d {
  x: number; // tilt in degrees — positive shows more of the top
  y: number; // turn in degrees — negative shows more of the right side
}

export const DEFAULT_ROTATION_3D: Rotation3d = { x: 20, y: -30 };

interface SolidModel {
  vertices: Vec3[];
  // Each face is a list of vertex indices, in order around the face.
  faces: number[][];
}

interface PreparedSolid extends SolidModel {
  normals: Vec3[]; // outward unit normal of each face
  edges: { a: number; b: number; f1: number; f2: number; sharp: boolean }[];
  scale: number; // fits the solid inside the 0–100 viewBox at any angle
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(...v);
  return [v[0] / len, v[1] / len, v[2] / len];
};

/** Points on a circle of radius r, as [a, b] pairs — used for round bases. */
const circle = (r: number, count: number): [number, number][] =>
  range(count).map((i) => [r * Math.cos((i / count) * 2 * Math.PI), r * Math.sin((i / count) * 2 * Math.PI)]);

/** A flat 2D outline pushed out into 3D (box, cylinder, prism): two copies of it, joined by side walls. */
function extrude(profile: [number, number][], toPoint: (p: [number, number], end: number) => Vec3): SolidModel {
  const n = profile.length;
  return {
    vertices: [...profile.map((p) => toPoint(p, -1)), ...profile.map((p) => toPoint(p, 1))],
    faces: [range(n), range(n).map((i) => i + n), ...range(n).map((i) => [i, (i + 1) % n, ((i + 1) % n) + n, i + n])],
  };
}

/** A flat base (in the x–z plane at height baseY) joined to one top point (cone, pyramid). */
function toApex(base: [number, number][], baseY: number, apexY: number): SolidModel {
  const n = base.length;
  return {
    vertices: [...base.map(([x, z]): Vec3 => [x, baseY, z]), [0, apexY, 0]],
    faces: [range(n), ...range(n).map((i) => [i, (i + 1) % n, n])],
  };
}

function sphere(rings: number, segments: number): SolidModel {
  const vertices: Vec3[] = [[0, 1, 0]];
  for (let r = 1; r < rings; r++) {
    const lat = (r / rings) * Math.PI;
    for (const [x, z] of circle(Math.sin(lat), segments)) vertices.push([x, Math.cos(lat), z]);
  }
  const bottom = vertices.push([0, -1, 0]) - 1;
  // Index of the j-th point on ring r (rings are numbered from 1).
  const at = (r: number, j: number) => 1 + (r - 1) * segments + (j % segments);

  const faces: number[][] = [];
  for (let j = 0; j < segments; j++) {
    faces.push([0, at(1, j), at(1, j + 1)]);
    for (let r = 1; r < rings - 1; r++) faces.push([at(r, j), at(r, j + 1), at(r + 1, j + 1), at(r + 1, j)]);
    faces.push([bottom, at(rings - 1, j + 1), at(rings - 1, j)]);
  }
  return { vertices, faces };
}

/** Top half of a sphere with a flat round base, moved down so it sits centered on the origin. */
function hemisphere(rings: number, segments: number): SolidModel {
  const vertices: Vec3[] = [[0, 0.5, 0]];
  for (let r = 1; r <= rings; r++) {
    const lat = (r / rings) * (Math.PI / 2);
    for (const [x, z] of circle(Math.sin(lat), segments)) vertices.push([x, Math.cos(lat) - 0.5, z]);
  }
  const at = (r: number, j: number) => 1 + (r - 1) * segments + (j % segments);

  const faces: number[][] = [range(segments).map((j) => at(rings, j))];
  for (let j = 0; j < segments; j++) {
    faces.push([0, at(1, j), at(1, j + 1)]);
    for (let r = 1; r < rings; r++) faces.push([at(r, j), at(r, j + 1), at(r + 1, j + 1), at(r + 1, j)]);
  }
  return { vertices, faces };
}

/** Solids made only of equal triangles (octahedron, icosahedron): every 3 corners that are all
 * one edge apart form a face. */
function triangleSolid(vertices: Vec3[], edge: number): SolidModel {
  const isEdge = (a: number, b: number) => Math.abs(Math.hypot(...sub(vertices[a], vertices[b])) - edge) < 1e-6;
  const faces: number[][] = [];
  for (let a = 0; a < vertices.length; a++)
    for (let b = a + 1; b < vertices.length; b++)
      for (let c = b + 1; c < vertices.length; c++)
        if (isEdge(a, b) && isEdge(b, c) && isEdge(a, c)) faces.push([a, b, c]);
  return { vertices, faces };
}

const PHI = (1 + Math.sqrt(5)) / 2;

// Adjacent faces bending more than this count as a real edge (cube corner, cylinder rim) and get a
// line; smaller bends are the tiny facets of a round surface and stay line-free so it looks smooth.
const SHARP_EDGE_COS = Math.cos((30 * Math.PI) / 180);

function prepare(model: SolidModel): PreparedSolid {
  const { vertices, faces } = model;

  const normals = faces.map((face) => {
    const [p0, p1, p2] = face.map((i) => vertices[i]);
    const n = normalize(cross(sub(p1, p0), sub(p2, p0)));
    // The solid is convex around the origin, so the outward normal points the same way as the face's center.
    const center = face.reduce<Vec3>((c, i) => [c[0] + vertices[i][0], c[1] + vertices[i][1], c[2] + vertices[i][2]], [0, 0, 0]);
    return dot(n, center) < 0 ? ([-n[0], -n[1], -n[2]] as Vec3) : n;
  });

  // Every edge is shared by exactly two faces; pair them up.
  const edgeFaces = new Map<string, { a: number; b: number; faces: number[] }>();
  faces.forEach((face, f) =>
    face.forEach((a, k) => {
      const b = face[(k + 1) % face.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const entry = edgeFaces.get(key) ?? { a, b, faces: [] };
      entry.faces.push(f);
      edgeFaces.set(key, entry);
    }),
  );
  const edges = [...edgeFaces.values()].map(({ a, b, faces: [f1, f2] }) => ({
    a,
    b,
    f1,
    f2,
    sharp: dot(normals[f1], normals[f2]) < SHARP_EDGE_COS,
  }));

  const radius = Math.max(...vertices.map((v) => Math.hypot(...v)));
  return { ...model, normals, edges, scale: 46 / radius };
}

export const SOLIDS: Record<string, PreparedSolid> = {
  cube: prepare(extrude([[-1, -1], [1, -1], [1, 1], [-1, 1]], ([x, y], z) => [x, y, z])),
  cuboid: prepare(extrude([[-1.4, -0.8], [1.4, -0.8], [1.4, 0.8], [-1.4, 0.8]], ([x, y], z) => [x, y, z * 0.8])),
  cylinder: prepare(extrude(circle(0.8, 64), ([x, z], y) => [x, y * 0.9, z])),
  cone: prepare(toApex(circle(0.9, 64), -0.7, 1)),
  sphere: prepare(sphere(24, 48)),
  pyramid: prepare(toApex([[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]], -0.6, 0.9)),
  // Lying on its side, with the triangle ends facing left and right.
  "triangular-prism": prepare(extrude([[-0.9, -0.7], [0.9, -0.7], [0, 0.9]], ([z, y], x) => [x * 1.2, y, z])),
  "pentagonal-prism": prepare(extrude(circle(0.9, 5), ([x, z], y) => [x, y * 0.8, z])),
  "hexagonal-prism": prepare(extrude(circle(0.9, 6), ([x, z], y) => [x, y * 0.8, z])),
  "triangular-pyramid": prepare(toApex(circle(1, 3), -0.6, 0.9)),
  "pentagonal-pyramid": prepare(toApex(circle(0.95, 5), -0.6, 0.9)),
  "hexagonal-pyramid": prepare(toApex(circle(0.95, 6), -0.6, 0.9)),
  // A cone with its tip cut off: the top circle is smaller than the bottom one.
  frustum: prepare(extrude(circle(0.9, 64), ([x, z], end) => (end > 0 ? [x * 0.55, 0.7, z * 0.55] : [x, -0.7, z]))),
  hemisphere: prepare(hemisphere(12, 48)),
  octahedron: prepare(
    triangleSolid([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], Math.SQRT2),
  ),
  icosahedron: prepare(
    triangleSolid(
      [-1, 1].flatMap((a) => [-PHI, PHI].flatMap((b): Vec3[] => [[0, a, b], [a, b, 0], [b, 0, a]])),
      2,
    ),
  ),
};

// Light comes from the top-left, slightly in front.
const LIGHT = normalize([-0.5, 0.7, 0.6]);

/** Draws a solid at the given rotation into the shared 0–100 viewBox. */
export function renderSolid(solid: PreparedSolid, color: string, rotation: Rotation3d = DEFAULT_ROTATION_3D): ReactNode {
  const tilt = (rotation.x * Math.PI) / 180;
  const turn = (rotation.y * Math.PI) / 180;
  const [cosX, sinX, cosY, sinY] = [Math.cos(tilt), Math.sin(tilt), Math.cos(turn), Math.sin(turn)];

  // Turn around the up/down axis first, then tilt around the side-to-side axis.
  const rotate = ([x, y, z]: Vec3): Vec3 => {
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    return [x1, y * cosX - z1 * sinX, y * sinX + z1 * cosX];
  };

  // Flatten to the screen by dropping depth (no perspective), flipping y since SVG y points down.
  const points = solid.vertices.map((v) => {
    const [x, y] = rotate(v);
    return `${(50 + x * solid.scale).toFixed(2)} ${(50 - y * solid.scale).toFixed(2)}`;
  });
  const normals = solid.normals.map(rotate);
  const isVisible = (f: number) => normals[f][2] > 1e-6;
  // Faces seen exactly edge-on count as neither, so a straight-on view doesn't dash over the outline.
  const isHidden = (f: number) => normals[f][2] < -1e-6;

  // On a convex solid the visible faces never overlap, so no back-to-front sorting is needed.
  // Faces with the same shade share one path, so neighboring facets of a round surface show no seams.
  let basePath = "";
  const shadePaths = new Map<string, string>();
  solid.faces.forEach((face, f) => {
    if (!isVisible(f)) return;
    const d = `M${face.map((i) => points[i]).join("L")}Z`;
    basePath += d;
    const light = dot(normals[f], LIGHT);
    const shade = light > 0.6 ? `#fff|${((light - 0.6) * 0.72).toFixed(2)}` : `#000|${((0.6 - light) * 0.42).toFixed(2)}`;
    shadePaths.set(shade, (shadePaths.get(shade) ?? "") + d);
  });

  let edgePath = "";
  let hiddenEdgePath = "";
  for (const { a, b, f1, f2, sharp } of solid.edges) {
    const line = `M${points[a]}L${points[b]}`;
    const [v1, v2] = [isVisible(f1), isVisible(f2)];
    if (v1 !== v2 || (sharp && v1)) edgePath += line; // outline, or a real edge in front
    else if (sharp && isHidden(f1) && isHidden(f2)) hiddenEdgePath += line; // a real edge at the back
  }

  return (
    <g stroke="#000" strokeOpacity="0.3" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d={basePath} fill={color} stroke="none" />
      {[...shadePaths].map(([shade, d]) => {
        const [fill, opacity] = shade.split("|");
        return <path key={shade} d={d} fill={fill} fillOpacity={opacity} stroke="none" />;
      })}
      <path d={edgePath} fill="none" />
      <path d={hiddenEdgePath} fill="none" strokeDasharray="4 3" />
    </g>
  );
}
