// A slide's background: a soft color or gradient. Used by the Background panel and by the presentation importer,
// so both offer the same choices.
import { GRADIENT_PREFIX, MESH_PREFIX, RADIAL_PREFIX } from "./constants";

// Soft colors the Background panel offers. All light, so the dark text stays easy to read.
export const BACKGROUND_COLORS = [
  "#FEF3C7",
  "#FFEDD5",
  "#FFE4E6",
  "#FCE7F3",
  "#EDE9FE",
  "#E0E7FF",
  "#E0F2FE",
  "#CCFBF1",
  "#DCFCE7",
  "#F5F5F4",
];

// Gradients the Background panel offers (soft ones first, then stronger light ones). Most are two colors drawn from
// the top of the slide to the bottom, stored like any gradient color ("gradient:#from,#to"); the round ones at the end
// go from the middle out ("radial:#middle,…,#edge"). All light, so the dark text stays easy to read.
export const BACKGROUND_GRADIENTS = [
  ["#FEF9C3", "#DCFCE7"],
  ["#FEF3C7", "#FFE4E6"],
  ["#FFEDD5", "#FCE7F3"],
  ["#EDE9FE", "#E0F2FE"],
  ["#E0E7FF", "#FCE7F3"],
  ["#CCFBF1", "#E0E7FF"],
  ["#E0F2FE", "#DCFCE7"],
  ["#F5F5F4", "#EDE9FE"],
  ["#FFE4E6", "#EDE9FE"],
  ["#FEF3C7", "#E0F2FE"],
  ["#DCFCE7", "#CCFBF1"],
  ["#FCE7F3", "#E0F2FE"],
  ["#FFEDD5", "#FEF9C3"],
  ["#EDE9FE", "#FCE7F3"],
  ["#F5F5F4", "#E0F2FE"],
  ["#FDE68A", "#FCA5A5"],
  ["#C4B5FD", "#93C5FD"],
  ["#86EFAC", "#67E8F9"],
  ["#FDBA74", "#F9A8D4"],
  ["#F9A8D4", "#C4B5FD"],
  ["#A5B4FC", "#5EEAD4"],
  ["#FDE68A", "#86EFAC"],
  ["#7DD3FC", "#C4B5FD"],
  ["#FCA5A5", "#FDBA74"],
  ["#BEF264", "#FDE047"],
  ["#FEF08A", "#A5F3FC"],
  ["#FECDD3", "#BFDBFE"],
  ["#D9F99D", "#A7F3D0"],
  ["#FED7AA", "#DDD6FE"],
  ["#99F6E4", "#FEF08A"],
  ["#FBCFE8", "#FEF3C7"],
  ["#BAE6FD", "#FBCFE8"],
  ["#DDD6FE", "#A7F3D0"],
  ["#FECACA", "#FEF08A"],
  ["#C7D2FE", "#F5D0FE"],
]
  .map(([from, to]) => `${GRADIENT_PREFIX}${from},${to}`)
  .concat(`${RADIAL_PREFIX}#F0FFF7,#F0A3E9,#D3BFFF`);

// Soft blends the Background panel offers: one color per corner (top-left, top-right, bottom-left,
// bottom-right) melting into each other. Stored as "mesh:#tl,#tr,#bl,#br". All light, so the dark text stays easy to read.
export const BACKGROUND_MESHES = [
  ["#A8C4E6", "#FFD3DC", "#F8F9FD", "#8F9BD0"],
  ["#FFD8B5", "#E9D5FF", "#FFF7ED", "#C4B5FD"],
  ["#A7F3D0", "#BAE6FD", "#F0FDF4", "#93C5FD"],
  ["#FDE68A", "#FBCFE8", "#FFF7ED", "#FDBA74"],
  ["#DDD6FE", "#FCE7F3", "#F5F3FF", "#C7D2FE"],
  ["#BAE6FD", "#CCFBF1", "#F0F9FF", "#A5B4FC"],
  ["#D9F99D", "#FEF08A", "#F7FEE7", "#86EFAC"],
  ["#FBCFE8", "#BFDBFE", "#FDF2F8", "#DDD6FE"],
  ["#FEF3C7", "#FECDD3", "#FFFBEB", "#FDA4AF"],
  ["#99F6E4", "#FED7AA", "#F0FDFA", "#F9A8D4"],
].map((corners) => `${MESH_PREFIX}${corners.join(",")}`);
