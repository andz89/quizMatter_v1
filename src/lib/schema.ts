import { z } from "zod";

export const optionSchema = z.object({
  id: z.string(),
  text: z.string(),
  // Styled version of `text` (bold, color…), as HTML from the text editor. Missing on older quizzes.
  html: z.string().optional(),
});

export const svgElementSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: z.string(),
  // null = freely placed on the canvas; "question" or an option's id = bound to that
  // container, positioned relative to it, and moves with it (e.g. on option reorder).
  containerId: z.string().nullable(),
  // Elements sharing a groupId are one group: a click selects them all. Members are always in the
  // same container. Missing = not grouped.
  groupId: z.string().optional(),
  // Only used by solid (3D) shapes: tilt (x) and turn (y) in degrees. Missing = the default angle.
  rotation3d: z.object({ x: z.number(), y: z.number() }).optional(),
  // Flat (2D) spin in degrees around the element's center. Missing = 0. Not used by solids.
  rotation: z.number().optional(),
  // Only used by the clocks: the time they show (hours 1–12, minutes 0–59). Missing = 10:10.
  // `pm` is only shown by the digital clock; missing = AM.
  clockTime: z.object({ hours: z.number(), minutes: z.number(), pm: z.boolean().optional() }).optional(),
  // Only used by number lines: first number, how much each tick counts up by, and which tick
  // positions show an empty box instead of a number. Centered (integer) lines ignore `start`.
  // Missing = start 0, step 1, nothing hidden.
  numberLine: z.object({ start: z.number(), step: z.number(), hidden: z.array(z.number()) }).optional(),
  // Only used by fraction bars/circles: equal parts and how many are shaded. Missing = 4 parts, 1 shaded.
  fraction: z.object({ parts: z.number(), shaded: z.number() }).optional(),
  // Only used by the counting frame: how many dots, and the grid size (missing rows/columns = 2×5).
  // Missing = 5 dots on a 2×5 grid.
  tenFrame: z.object({ count: z.number(), rows: z.number().optional(), columns: z.number().optional() }).optional(),
  // Only used by base-ten blocks: how many flats (100), rods (10) and cubes (1), 0–9 each.
  baseTen: z.object({ hundreds: z.number(), tens: z.number(), ones: z.number() }).optional(),
  // Only used by the thermometer: the temperature shown, in °C (-20 to 50).
  thermometer: z.object({ value: z.number() }).optional(),
  // Only used by the bar graph: one entry per bar, left to right; values are 0–10.
  barGraph: z.object({ bars: z.array(z.object({ label: z.string(), value: z.number() })) }).optional(),
  // Only used by the protractor: the angle between its two lines, 0–180°.
  protractor: z.object({ angle: z.number() }).optional(),
});

export const slideSchema = z.object({
  id: z.string(),
  question: z.string(),
  // Styled version of `question`, as HTML from the text editor. Missing on older quizzes.
  questionHtml: z.string().optional(),
  layout: z.enum(["grid", "list"]),
  options: z.tuple([optionSchema, optionSchema, optionSchema, optionSchema]),
  correctOptionId: z.string().nullable(),
  elements: z.array(svgElementSchema),
  questionHeight: z.number(),
});

export const quizSchema = z.object({
  id: z.string(),
  title: z.string(),
  slides: z.array(slideSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Option = z.infer<typeof optionSchema>;
export type SvgElement = z.infer<typeof svgElementSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type Quiz = z.infer<typeof quizSchema>;
