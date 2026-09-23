import { z } from "zod";

export const optionSchema = z.object({
  id: z.string(),
  text: z.string(),
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
});

export const slideSchema = z.object({
  id: z.string(),
  question: z.string(),
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
