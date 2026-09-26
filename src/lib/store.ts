import { create } from "zustand";
import type { Editor } from "@tiptap/react";
import { createBlankQuiz, createBlankSlide, duplicateSlide as cloneSlide } from "./factories";
import { createId } from "./id";
import { DEFAULT_ELEMENT_COLOR, DEFAULT_ELEMENT_SIZE, getElementAsset, type RenderSettings } from "./svgLibrary";
import {
  getContainerBounds,
  getMaxQuestionHeight,
  getMaxShapeStripHeight,
  getShapeStripHeight,
  hasShapeBox,
  type BoxLayout,
  MIN_QUESTION_HEIGHT,
  MIN_SHAPE_STRIP_HEIGHT,
  QUESTION_CONTAINER_ID,
  SIDE_CONTAINER_ID,
  ANSWER_CONTAINER_ID,
  canHaveAnswer,
} from "./constants";
import { fitInBox, getOuterEdges } from "./geometry";
import { withBackground, type BackgroundPatch } from "./slideBackground";
import { saveQuizToDb } from "./quizzes";
import type { LessonDetails, Quiz, Slide, SlideType, SvgElement } from "./schema";

type ElementPatch = Partial<Omit<SvgElement, "id" | "assetId">>;

export const MIN_ZOOM = 0.25;

// One shared empty list: a selector that keeps returning it counts as "unchanged", so no redraw.
const NO_IDS: string[] = [];

/**
 * Selector for the selected element ids, but only on the given slide (other slides get an empty
 * list). Every slide is on screen at once, so this keeps a click on one slide from redrawing all of them.
 */
export const selectedIdsOn = (slideId: string) => (s: EditorState) =>
  s.selectedSlideId === slideId ? s.selectedElementIds : NO_IDS;
export const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

const MAX_HISTORY = 100;
// Quiz changes closer together than this count as one undo step (a whole drag, a typed word).
const HISTORY_GROUP_MS = 500;

/** Applies `updater` to the one slide matching `slideId` and bumps the quiz's updatedAt — the shape every mutation below needs. */
/** A text on the canvas that can be typed in: the question, one option, or a text box element. */
export type TextTarget =
  | { kind: "question"; slideId: string }
  | { kind: "option"; slideId: string; optionId: string }
  | { kind: "textBox"; slideId: string; elementId: string };

/** A text's editor together with which text it is. */
export type TextEditorEntry = { editor: Editor; target: TextTarget };

/** Where copied slides go: right after the slide, or right before it when `before` is set. */
export type SlideInsertTarget = { slideId: string; before?: boolean };

/**
 * True for an Escape press a side panel should act on. Not while the slide grid, the presentation or
 * an answer modal is open, or while typing in a canvas text — those use Escape to close or stop themselves first.
 */
export function isPanelEscape(e: KeyboardEvent) {
  if (e.key !== "Escape") return false;
  const { isGridViewOpen, isPresenting, answerSlideId } = useEditorStore.getState();
  return !isGridViewOpen && !isPresenting && !answerSlideId && !(e.target as HTMLElement | null)?.isContentEditable;
}

function updateSlide(quiz: Quiz, slideId: string, updater: (slide: Slide) => Slide): Quiz {
  return {
    ...quiz,
    slides: quiz.slides.map((s) => (s.id === slideId ? updater(s) : s)),
    updatedAt: Date.now(),
  };
}

/** The given ids plus every other member of any group they belong to. */
export function withGroupMembers(elements: SvgElement[], ids: string[]): string[] {
  const groupIds = new Set(elements.filter((el) => ids.includes(el.id) && el.groupId).map((el) => el.groupId));
  const members = elements.filter((el) => el.groupId && groupIds.has(el.groupId)).map((el) => el.id);
  return [...new Set([...ids, ...members])];
}

/** A group needs 2+ members — an element left alone in its group becomes a plain element again. */
function dropLoneGroups(elements: SvgElement[]): SvgElement[] {
  const counts = new Map<string, number>();
  elements.forEach((el) => el.groupId && counts.set(el.groupId, (counts.get(el.groupId) ?? 0) + 1));
  return elements.map((el) => (el.groupId && counts.get(el.groupId)! < 2 ? { ...el, groupId: undefined } : el));
}

/** Copies get fresh group ids, so a copied group becomes its own group instead of joining the original. */
function giveCopiesNewGroups(copies: SvgElement[]): SvgElement[] {
  const newIds = new Map<string, string>();
  const regrouped = copies.map((el) => {
    if (!el.groupId) return el;
    if (!newIds.has(el.groupId)) newIds.set(el.groupId, createId());
    return { ...el, groupId: newIds.get(el.groupId) };
  });
  return dropLoneGroups(regrouped);
}

/**
 * Text boxes don't scale with their box: their width is set by hand, and scaling it with the box's
 * height could push it past the box's sides. They keep their size and are only moved (or shrunk,
 * if they no longer fit) to stay inside.
 */
function keepTextBoxInside(el: SvgElement, box: { width: number; height: number }): SvgElement {
  const width = Math.min(el.width, box.width);
  const height = Math.min(el.height, box.height);
  return {
    ...el,
    width,
    height,
    x: Math.max(0, Math.min(box.width - width, el.x)),
    y: Math.max(0, Math.min(box.height - height, el.y)),
  };
}

/**
 * Moves every box-bound element into its box's new size after a layout change. The question box
 * only changes height, so its elements scale with it (same rule as resizing it by hand). Everything
 * else keeps its size unless it no longer fits — shrinking only, so switching back and forth doesn't
 * keep making it smaller — and keeps its center at the same relative spot.
 */
function fitElementsToBoxes(elements: SvgElement[], from: BoxLayout, to: BoxLayout): SvgElement[] {
  const questionScale = to.questionHeight / from.questionHeight;
  return elements.map((el) => {
    if (el.containerId === null) return el;
    if (getElementAsset(el.assetId)?.isTextBox) return keepTextBoxInside(el, getContainerBounds(el.containerId, to));
    if (el.containerId === QUESTION_CONTAINER_ID) {
      return { ...el, y: el.y * questionScale, width: el.width * questionScale, height: el.height * questionScale };
    }
    const oldBox = getContainerBounds(el.containerId, from);
    const newBox = getContainerBounds(el.containerId, to);
    const centerX = ((el.x + el.width / 2) / oldBox.width) * newBox.width;
    const centerY = ((el.y + el.height / 2) / oldBox.height) * newBox.height;
    const moved = { width: el.width, height: el.height, x: centerX - el.width / 2, y: centerY - el.height / 2 };
    return { ...el, ...fitInBox(moved, newBox, true) };
  });
}

/**
 * Stretches every box-bound element along with its box after the teacher drags a box taller or
 * shorter (the question box or the shape strip — which also changes the options' height).
 * Bound elements store absolute pixel coordinates. The boxes' width never changes, only their
 * height, so x (the left edge) stays untouched — but width has to scale together with height,
 * by the same factor, or a shrinking/growing box would squish square icons into rectangles
 * (they'd then shrink-to-fit and re-center inside their own box when drawn, leaving a gap
 * between the visible icon and its actual corner/resize handle).
 */
function scaleElementsToBoxes(elements: SvgElement[], from: BoxLayout, to: BoxLayout): SvgElement[] {
  return elements.map((el) => {
    if (el.containerId === null) return el;
    const newBox = getContainerBounds(el.containerId, to);
    if (getElementAsset(el.assetId)?.isTextBox) return keepTextBoxInside(el, newBox);
    const scale = newBox.height / getContainerBounds(el.containerId, from).height;
    const width = el.width * scale;
    // A wider element may now reach past the box's right edge, so pull it back inside.
    const maxX = Math.max(0, newBox.width - width);
    return { ...el, x: Math.min(el.x, maxX), y: el.y * scale, height: el.height * scale, width };
  });
}

/**
 * A strip height that still fits after a layout change or after the strip comes back. The question
 * box is shrunk after this if needed; the strip only gives way when even the smallest question box
 * wouldn't fit next to it.
 */
function fitShapeStripHeight(box: BoxLayout): number | undefined {
  if (box.shapeStripHeight === undefined) return undefined;
  return Math.min(box.shapeStripHeight, getMaxShapeStripHeight({ ...box, questionHeight: MIN_QUESTION_HEIGHT }));
}

interface EditorState {
  quiz: Quiz;
  // Opens a quiz loaded from the database: sets it as the saved version and starts a fresh undo history.
  loadQuiz: (quiz: Quiz) => void;
  // The quiz as it was last saved. Any edit makes a new quiz object, so `quiz !== savedQuiz` means unsaved changes.
  savedQuiz: Quiz | null;
  saveStatus: "idle" | "saving" | "error";
  saveQuiz: () => Promise<void>;
  // Undo/redo history of the quiz content only (not selection, zoom or open panels). Filled
  // automatically by the store subscription at the bottom of this file.
  past: Quiz[];
  future: Quiz[];
  undo: () => void;
  redo: () => void;
  selectedSlideId: string;
  zoom: number;

  selectSlide: (slideId: string) => void;
  addSlide: (afterSlideId?: string, type?: SlideType) => void;
  // Replaces all slides with ready-made ones (e.g. from an imported JSON file), as one undo step.
  importSlides: (slides: Slide[]) => void;
  deleteSlide: (slideId: string) => void;
  duplicateSlide: (slideId: string) => void;
  // Copies of slides from another lesson (new ids), put right after (or before) `at.slideId`, or at
  // the end when `at` is missing or unknown. The first one gets selected.
  insertSlides: (slides: Slide[], at?: SlideInsertTarget) => void;
  reorderSlides: (fromId: string, toId: string) => void;
  // Switches the options between a 2x2 grid, 4 stacked rows, and 4 rows beside an element box,
  // moving option-bound elements along.
  setLayout: (slideId: string, layout: Slide["layout"]) => void;
  // Adds an empty shape strip under the question of a grid/list slide, and selects it.
  addShapeBox: (slideId: string) => void;
  // Takes the shape strip away from a grid/list slide, along with the elements in it.
  removeShapeBox: (slideId: string) => void;

  updateQuestion: (slideId: string, text: string, html: string) => void;
  setQuestionHeight: (slideId: string, height: number) => void;
  // Grid/list shape strip only: drag its bottom edge to make it taller or shorter.
  setShapeStripHeight: (slideId: string, height: number) => void;
  // Sets the shape box's fill or border color; undefined = none.
  setShapeBoxColors: (slideId: string, patch: Partial<Pick<Slide, "shapeBoxFill" | "shapeBoxBorder">>) => void;
  // Sets the slide's background color, pattern and/or pattern strength, redrawing the pattern.
  setSlideBackground: (slideId: string, patch: BackgroundPatch) => void;
  // Gives every slide this slide's background color, pattern and pattern strength.
  applyBackgroundToAll: (slideId: string) => void;
  updateOption: (slideId: string, optionId: string, text: string, html: string) => void;
  setCorrectOption: (slideId: string, optionId: string) => void;
  updateCorrectAnswer: (slideId: string, answer: string) => void;
  // Picks which answer a short-answer or blank slide shows: the typed text or the answer canvas.
  setAnswerType: (slideId: string, answerType: NonNullable<Slide["answerType"]>) => void;
  renameSlide: (slideId: string, name: string) => void;
  reorderOptions: (slideId: string, fromOptionId: string, toOptionId: string) => void;
  shuffleOptions: (slideId: string) => void;
  // Empties the question, every option's text and all slide elements; keeps the answer (text and canvas) and layout.
  clearSlide: (slideId: string) => void;

  // Title and the other lesson details (grade, subject…), edited in the top bar and the Details panel.
  setLessonDetails: (patch: Partial<LessonDetails>) => void;
  // Private/published, saved right away (the whole lesson, so others see what the teacher sees).
  // On failure it switches back. Resolves true if the save worked.
  setPublished: (isPublished: boolean) => Promise<boolean>;

  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setZoom: (zoom: number) => void;

  isPresenting: boolean;
  presentationIndex: number;
  startPresentation: () => void;
  exitPresentation: () => void;
  nextPresentationSlide: () => void;
  prevPresentationSlide: () => void;

  isGridViewOpen: boolean;
  openGridView: () => void;
  closeGridView: () => void;

  // The slide whose answer modal is open (short-answer and blank slides), or null.
  answerSlideId: string | null;
  openAnswer: (slideId: string) => void;
  closeAnswer: () => void;

  selectedElementIds: string[];
  // Clicking a grouped element selects its whole group.
  selectElement: (slideId: string, elementId: string, additive?: boolean) => void;
  selectElements: (elementIds: string[]) => void;
  clearElementSelection: () => void;
  // Group needs 2+ selected elements in the same box. Both act on the current slide's selection.
  groupSelectedElements: () => void;
  ungroupSelectedElements: () => void;

  // The last box clicked. With Shift+click, more boxes can be selected with it (question and
  // options only, on one slide) — selectedContainerIds holds all of them, this one included.
  selectedContainerId: string | null;
  selectedContainerIds: string[];
  selectContainer: (containerId: string | null, slideId?: string, additive?: boolean) => void;
  // The editors of the selected boxes that aren't being typed in, in the order they were selected.
  // The format toolbar changes all of their text at once.
  selectedTextEditors: TextEditorEntry[];
  addSelectedTextEditor: (entry: TextEditorEntry) => void;
  removeSelectedTextEditor: (editor: Editor) => void;

  // The text editor the user is typing in right now, so the header can show its format toolbar.
  activeTextEditor: Editor | null;
  // Which text that editor is typing in, so the format toolbar can change its font size.
  activeTextTarget: TextTarget | null;
  setActiveTextEditor: (editor: Editor | null, target?: TextTarget | null) => void;
  // Sets the chosen font size of questions, options or text boxes (all to the same size).
  setTextFontSizes: (targets: TextTarget[], fontSize: number) => void;

  // `position`, when given, is the exact drop point (in the container's own coordinate space) to
  // center the new element on, instead of the container's center.
  addElement: (slideId: string, assetId: string, containerId?: string | null, position?: { x: number; y: number }) => void;
  // Most-recently-inserted asset ids first, for the Elements panel's "Recently used" row.
  recentElementAssetIds: string[];
  updateElement: (slideId: string, elementId: string, patch: ElementPatch) => void;
  // Changes several elements in one store update (one redraw, one quiz copy), keyed by element id.
  updateElements: (slideId: string, patches: Record<string, ElementPatch>) => void;
  deleteElements: (slideId: string, elementIds: string[]) => void;
  // Returns the copies' ids. Copies of a whole group form a new group of their own.
  duplicateElements: (slideId: string, elementIds: string[]) => string[];
  // Removes every element bound to one box (the question or an option).
  clearContainerElements: (slideId: string, containerId: string) => void;
  // Makes the elements as big as their box allows (keeping their shape), centered. Elements in the
  // same box fit together as one unit. Free elements and text boxes are skipped.
  fitElementsToContainer: (slideId: string, elementIds: string[]) => void;

  // `containerId` on the clipboard entry is where each element was copied from — pasting via
  // keyboard (no target given) puts it back there; pasting via the context menu targets wherever
  // was right-clicked instead.
  clipboard: SvgElement[] | null;
  copySelectedElements: () => void;
  pasteClipboard: (slideId: string, containerId?: string | null) => void;
  clearClipboard: () => void;

  isElementsPanelOpen: boolean;
  toggleElementsPanel: () => void;
  closeElementsPanel: () => void;

  // Only one of the Elements/Color/Background sidebar panels is shown at a time.
  isColorPanelOpen: boolean;
  toggleColorPanel: () => void;
  closeColorPanel: () => void;
  // Which part of the shape box the Color panel paints, when the box (not a shape) is selected.
  shapeBoxColorTarget: "fill" | "border";
  // Opens the Color panel on the box's fill or border; clicking the same one again closes it.
  openShapeBoxColorPanel: (target: "fill" | "border") => void;

  // The Background panel changes the selected slide's background.
  isBackgroundPanelOpen: boolean;
  toggleBackgroundPanel: () => void;
  closeBackgroundPanel: () => void;

  isDetailsPanelOpen: boolean;
  toggleDetailsPanel: () => void;
  closeDetailsPanel: () => void;

  // The Lessons panel lists published lessons, to add their slides to this one.
  isLessonsPanelOpen: boolean;
  toggleLessonsPanel: () => void;
  closeLessonsPanel: () => void;

  // Which box a placed element is currently being dragged over, while it's being moved from a
  // different box — drives that box's "drop here" highlight. Not part of quiz data.
  dragOverContainerId: string | null;
  setDragOverContainerId: (containerId: string | null) => void;

  // Faint preview icons (one per dragged element) that follow the cursor once a drag crosses into a
  // different box, so the move is visible in real time instead of only snapping into place on drop.
  // Canvas-wide coordinates. Empty when nothing is being dragged across boxes.
  elementDragGhosts: {
    id: string;
    assetId: string;
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    // The dragged element's own settings (3D angle, clock time, number line…), drawn the same way.
    settings: RenderSettings;
  }[];
  setElementDragGhosts: (ghosts: EditorState["elementDragGhosts"]) => void;

  // Snap lines shown while an element is dragged: xs are vertical lines, ys horizontal ones, in the
  // box's own coordinates. slideId is needed because every slide has a "question" box. Not part of quiz data.
  snapGuides: { slideId: string; containerId: string | null; xs: number[]; ys: number[] } | null;
  setSnapGuides: (guides: EditorState["snapGuides"]) => void;
}

// A placeholder until loadQuiz puts the real quiz in.
const initialQuiz = createBlankQuiz();

export const useEditorStore = create<EditorState>((set, get) => ({
  quiz: initialQuiz,
  past: [],
  future: [],

  loadQuiz: (quiz) =>
    withoutHistory(() =>
      set({
        quiz,
        savedQuiz: quiz,
        saveStatus: "idle",
        past: [],
        future: [],
        selectedSlideId: quiz.slides[0].id,
        selectedElementIds: [],
        selectedContainerId: null,
        selectedContainerIds: [],
        isPresenting: false,
        answerSlideId: null,
      })
    ),

  savedQuiz: null,
  saveStatus: "idle",

  saveQuiz: async () => {
    const { quiz, saveStatus } = get();
    if (saveStatus === "saving") return;
    set({ saveStatus: "saving" });
    try {
      await saveQuizToDb(quiz);
      // Edits made while saving aren't in the database yet, so they still count as unsaved.
      set({ savedQuiz: quiz, saveStatus: "idle" });
    } catch {
      set({ saveStatus: "error" });
    }
  },

  undo: () => {
    const state = get();
    const previous = state.past[state.past.length - 1];
    if (!previous) return;
    restoreQuiz(previous, { past: state.past.slice(0, -1), future: [state.quiz, ...state.future] });
  },

  redo: () => {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    restoreQuiz(next, { past: [...state.past, state.quiz], future: state.future.slice(1) });
  },

  selectedSlideId: initialQuiz.slides[0].id,
  zoom: 1,
  recentElementAssetIds: [],

  selectSlide: (slideId) =>
    set({ selectedSlideId: slideId, selectedElementIds: [], selectedContainerId: null, selectedContainerIds: [] }),

  addSlide: (afterSlideId, type) => {
    const slide = createBlankSlide(type);
    set((state) => {
      const slides = [...state.quiz.slides];
      const insertAt = afterSlideId ? slides.findIndex((s) => s.id === afterSlideId) + 1 : slides.length;
      slides.splice(insertAt, 0, slide);
      return {
        quiz: { ...state.quiz, slides, updatedAt: Date.now() },
        selectedSlideId: slide.id,
      };
    });
  },

  importSlides: (slides) =>
    set((state) => ({
      quiz: { ...state.quiz, slides, updatedAt: Date.now() },
      selectedSlideId: slides[0].id,
      selectedElementIds: [],
      selectedContainerId: null,
      selectedContainerIds: [],
    })),

  deleteSlide: (slideId) => {
    const { quiz, selectedSlideId } = get();
    if (quiz.slides.length <= 1) return;

    const index = quiz.slides.findIndex((s) => s.id === slideId);
    const slides = quiz.slides.filter((s) => s.id !== slideId);
    const nextSelected =
      selectedSlideId === slideId
        ? slides[Math.max(0, index - 1)].id
        : selectedSlideId;

    set({
      quiz: { ...quiz, slides, updatedAt: Date.now() },
      selectedSlideId: nextSelected,
    });
  },

  duplicateSlide: (slideId) => {
    const { quiz } = get();
    const index = quiz.slides.findIndex((s) => s.id === slideId);
    if (index === -1) return;

    const copy = cloneSlide(quiz.slides[index]);
    const slides = [...quiz.slides];
    slides.splice(index + 1, 0, copy);

    set({
      quiz: { ...quiz, slides, updatedAt: Date.now() },
      selectedSlideId: copy.id,
    });
  },

  insertSlides: (slides, at) => {
    if (slides.length === 0) return;
    const copies = slides.map(cloneSlide);
    set((state) => {
      const all = [...state.quiz.slides];
      const targetIndex = at ? all.findIndex((s) => s.id === at.slideId) : -1;
      const insertAt = targetIndex === -1 ? all.length : at?.before ? targetIndex : targetIndex + 1;
      all.splice(insertAt, 0, ...copies);
      return {
        quiz: { ...state.quiz, slides: all, updatedAt: Date.now() },
        selectedSlideId: copies[0].id,
        selectedElementIds: [],
        selectedContainerId: null,
        selectedContainerIds: [],
      };
    });
  },

  reorderSlides: (fromId, toId) => {
    const { quiz } = get();
    const fromIndex = quiz.slides.findIndex((s) => s.id === fromId);
    const toIndex = quiz.slides.findIndex((s) => s.id === toId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const slides = [...quiz.slides];
    const [moved] = slides.splice(fromIndex, 1);
    slides.splice(toIndex, 0, moved);

    set({ quiz: { ...quiz, slides, updatedAt: Date.now() } });
  },

  setLayout: (slideId, layout) => {
    const { quiz, selectedContainerId, selectedContainerIds } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide || slide.layout === layout) return;

    // Leaving list-side with shapes in its box keeps that box as a strip under the question.
    const keepsShapeBox =
      slide.layout === "list-side" ? slide.elements.some((el) => el.containerId === SIDE_CONTAINER_ID) : slide.hasShapeBox;
    const next = { ...slide, layout, hasShapeBox: keepsShapeBox };
    // The new layout may allow a shorter strip and question box, so they may have to shrink first.
    next.shapeStripHeight = fitShapeStripHeight(next);
    next.questionHeight = Math.min(slide.questionHeight, getMaxQuestionHeight(next));

    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        layout,
        hasShapeBox: keepsShapeBox,
        shapeStripHeight: next.shapeStripHeight,
        questionHeight: next.questionHeight,
        elements: fitElementsToBoxes(s.elements, s, next),
      })),
      // A clicked shape box that no longer exists would send new elements nowhere.
      ...(selectedContainerId === SIDE_CONTAINER_ID && !hasShapeBox(next)
        ? { selectedContainerId: null, selectedContainerIds: [] }
        : { selectedContainerId, selectedContainerIds }),
    });
  },

  addShapeBox: (slideId) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide || hasShapeBox(slide)) return;

    const next = { ...slide, hasShapeBox: true };
    // The strip takes room from the options, so it and the question box may have to shrink first.
    next.shapeStripHeight = fitShapeStripHeight(next);
    next.questionHeight = Math.min(slide.questionHeight, getMaxQuestionHeight(next));

    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        hasShapeBox: true,
        shapeStripHeight: next.shapeStripHeight,
        questionHeight: next.questionHeight,
        // The options get shorter, so their elements move along.
        elements: fitElementsToBoxes(s.elements, s, next),
      })),
      // Select the new strip, so the next inserted element goes straight into it.
      selectedSlideId: slideId,
      selectedContainerId: SIDE_CONTAINER_ID,
      selectedContainerIds: [SIDE_CONTAINER_ID],
      selectedElementIds: [],
    });
  },

  removeShapeBox: (slideId) => {
    const { quiz, selectedContainerId, selectedContainerIds, selectedElementIds } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const removedIds = slide.elements.filter((el) => el.containerId === SIDE_CONTAINER_ID).map((el) => el.id);
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        hasShapeBox: false,
        // The options grow into the strip's space, so their elements move along.
        elements: fitElementsToBoxes(
          s.elements.filter((el) => el.containerId !== SIDE_CONTAINER_ID),
          s,
          { ...s, hasShapeBox: false }
        ),
      })),
      ...(selectedContainerId === SIDE_CONTAINER_ID
        ? { selectedContainerId: null, selectedContainerIds: [] }
        : { selectedContainerId, selectedContainerIds }),
      selectedElementIds: selectedElementIds.filter((id) => !removedIds.includes(id)),
    });
  },

  updateQuestion: (slideId, text, html) => {
    const { quiz } = get();
    set({ quiz: updateSlide(quiz, slideId, (s) => ({ ...s, question: text, questionHtml: html })) });
  },

  setQuestionHeight: (slideId, height) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const clamped = Math.min(getMaxQuestionHeight(slide), Math.max(MIN_QUESTION_HEIGHT, height));
    if (clamped === slide.questionHeight) return;

    const resized = { ...slide, questionHeight: clamped };
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        questionHeight: clamped,
        elements: scaleElementsToBoxes(s.elements, s, resized),
      })),
    });
  },

  setShapeBoxColors: (slideId, patch) => {
    set((state) => ({ quiz: updateSlide(state.quiz, slideId, (s) => ({ ...s, ...patch })) }));
  },

  setSlideBackground: (slideId, patch) => {
    set((state) => ({ quiz: updateSlide(state.quiz, slideId, (s) => withBackground(s, patch)) }));
  },

  applyBackgroundToAll: (slideId) => {
    const { quiz } = get();
    const source = quiz.slides.find((s) => s.id === slideId);
    if (!source) return;
    // The source's artwork is already drawn for its color, pattern and strength (or is Claude's own
    // drawing), so every slide takes it as-is instead of redrawing it — and nothing gets erased.
    const background = {
      background: source.background,
      backgroundPattern: source.backgroundPattern,
      backgroundOpacity: source.backgroundOpacity,
      backgroundSvg: source.backgroundSvg,
    };
    set({ quiz: { ...quiz, slides: quiz.slides.map((s) => ({ ...s, ...background })), updatedAt: Date.now() } });
  },

  setShapeStripHeight: (slideId, height) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const clamped = Math.min(getMaxShapeStripHeight(slide), Math.max(MIN_SHAPE_STRIP_HEIGHT, height));
    if (clamped === getShapeStripHeight(slide)) return;

    const resized = { ...slide, shapeStripHeight: clamped };
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        shapeStripHeight: clamped,
        // The strip's shapes stretch with it; the options' shapes stretch with the options.
        elements: scaleElementsToBoxes(s.elements, s, resized),
      })),
    });
  },

  updateOption: (slideId, optionId, text, html) => {
    const { quiz } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        options: s.options.map((o) => (o.id === optionId ? { ...o, text, html } : o)) as typeof s.options,
      })),
    });
  },

  setCorrectOption: (slideId, optionId) => {
    const { quiz } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        correctOptionId: s.correctOptionId === optionId ? null : optionId,
      })),
    });
  },

  updateCorrectAnswer: (slideId, answer) => {
    const { quiz } = get();
    set({ quiz: updateSlide(quiz, slideId, (s) => ({ ...s, correctAnswer: answer })) });
  },

  setAnswerType: (slideId, answerType) => {
    set((state) => ({ quiz: updateSlide(state.quiz, slideId, (s) => ({ ...s, answerType })) }));
  },

  renameSlide: (slideId, name) => {
    const { quiz } = get();
    // An empty name means "no name", so the slide falls back to its default label.
    set({ quiz: updateSlide(quiz, slideId, (s) => ({ ...s, name: name.trim() || undefined })) });
  },

  reorderOptions: (slideId, fromOptionId, toOptionId) => {
    const { quiz } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => {
        const fromIndex = s.options.findIndex((o) => o.id === fromOptionId);
        const toIndex = s.options.findIndex((o) => o.id === toOptionId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return s;

        const options = [...s.options];
        const [moved] = options.splice(fromIndex, 1);
        options.splice(toIndex, 0, moved);
        return { ...s, options: options as typeof s.options };
      }),
    });
  },

  shuffleOptions: (slideId) => {
    const { quiz } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => {
        const options = [...s.options];
        // Fisher-Yates shuffle; repeat if it lands on the same order so every click visibly changes something.
        do {
          for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
          }
        } while (options.every((o, i) => o.id === s.options[i].id));
        return { ...s, options: options as typeof s.options };
      }),
    });
  },

  clearSlide: (slideId) => {
    const { quiz, selectedElementIds } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        question: "",
        questionHtml: "",
        options: s.options.map((o) => ({ ...o, text: "", html: "" })) as typeof s.options,
        elements: s.elements.filter((el) => el.containerId === ANSWER_CONTAINER_ID),
      })),
      selectedElementIds: selectedElementIds.filter(
        (id) => !slide.elements.some((el) => el.id === id && el.containerId !== ANSWER_CONTAINER_ID)
      ),
    });
  },

  setLessonDetails: (patch) => {
    const { quiz } = get();
    set({ quiz: { ...quiz, ...patch, updatedAt: Date.now() } });
  },

  setPublished: async (isPublished) => {
    const { quiz, saveStatus, setLessonDetails, saveQuiz } = get();
    if (saveStatus === "saving") return false;
    const wasPublished = quiz.isPublished;
    setLessonDetails({ isPublished });
    await saveQuiz();
    if (get().saveStatus !== "error") return true;
    setLessonDetails({ isPublished: wasPublished });
    return false;
  },

  zoomIn: () => set((state) => ({ zoom: Math.min(MAX_ZOOM, +(state.zoom + ZOOM_STEP).toFixed(2)) })),
  zoomOut: () => set((state) => ({ zoom: Math.max(MIN_ZOOM, +(state.zoom - ZOOM_STEP).toFixed(2)) })),
  resetZoom: () => set({ zoom: 1 }),
  setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),

  isPresenting: false,
  presentationIndex: 0,

  // Starts at the slide being edited, so the teacher doesn't have to click through from slide 1.
  startPresentation: () => {
    const { quiz, selectedSlideId } = get();
    const startIndex = Math.max(0, quiz.slides.findIndex((s) => s.id === selectedSlideId));
    set({ isPresenting: true, presentationIndex: startIndex });
  },
  exitPresentation: () => set({ isPresenting: false }),
  nextPresentationSlide: () => {
    const { quiz, presentationIndex } = get();
    set({ presentationIndex: Math.min(quiz.slides.length - 1, presentationIndex + 1) });
  },
  prevPresentationSlide: () => {
    const { presentationIndex } = get();
    set({ presentationIndex: Math.max(0, presentationIndex - 1) });
  },

  isGridViewOpen: false,
  openGridView: () => set({ isGridViewOpen: true }),
  closeGridView: () => set({ isGridViewOpen: false }),

  answerSlideId: null,
  openAnswer: (slideId) => set({ answerSlideId: slideId }),
  closeAnswer: () => set({ answerSlideId: null }),

  selectedElementIds: [],

  selectElement: (slideId, elementId, additive = false) => {
    const { quiz, selectedElementIds } = get();
    const elements = quiz.slides.find((s) => s.id === slideId)?.elements ?? [];
    const ids = withGroupMembers(elements, [elementId]);
    if (!additive) {
      set({ selectedSlideId: slideId, selectedElementIds: ids });
      return;
    }
    set({
      selectedSlideId: slideId,
      selectedElementIds: selectedElementIds.includes(elementId)
        ? selectedElementIds.filter((id) => !ids.includes(id))
        : [...new Set([...selectedElementIds, ...ids])],
    });
  },
  selectElements: (elementIds) => set({ selectedElementIds: elementIds }),
  clearElementSelection: () => set({ selectedElementIds: [] }),

  groupSelectedElements: () => {
    const { quiz, selectedSlideId, selectedElementIds } = get();
    const slide = quiz.slides.find((s) => s.id === selectedSlideId);
    const selected = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
    if (selected.length < 2 || selected.some((el) => el.containerId !== selected[0].containerId)) return;

    const groupId = createId();
    set({
      quiz: updateSlide(quiz, selectedSlideId, (s) => ({
        ...s,
        // Grouping members of an older group can leave that group with one element — clean it up.
        elements: dropLoneGroups(s.elements.map((el) => (selectedElementIds.includes(el.id) ? { ...el, groupId } : el))),
      })),
    });
  },

  ungroupSelectedElements: () => {
    const { quiz, selectedSlideId, selectedElementIds } = get();
    set({
      quiz: updateSlide(quiz, selectedSlideId, (s) => ({
        ...s,
        elements: dropLoneGroups(
          s.elements.map((el) => (selectedElementIds.includes(el.id) ? { ...el, groupId: undefined } : el))
        ),
      })),
    });
  },

  selectedContainerId: null,
  selectedContainerIds: [],
  // With every slide visible at once (scrollable workspace), selecting a container on any slide
  // must also make that slide the "current" one — otherwise toolbars/inserts would act on a
  // different, merely-scrolled-past slide.
  // Shift+click (`additive`) adds the box to the selection, or takes it out if it's already in.
  // The side box and the answer canvas have no text, so they're never selected together with others.
  selectContainer: (containerId, slideId, additive = false) =>
    set((state) => {
      const selectedSlideId = slideId ?? state.selectedSlideId;
      const canJoin =
        additive &&
        containerId !== null &&
        containerId !== SIDE_CONTAINER_ID &&
        containerId !== ANSWER_CONTAINER_ID &&
        state.selectedContainerId !== SIDE_CONTAINER_ID &&
        state.selectedContainerId !== ANSWER_CONTAINER_ID &&
        selectedSlideId === state.selectedSlideId;
      const ids = !canJoin
        ? containerId ? [containerId] : []
        : state.selectedContainerIds.includes(containerId)
          ? state.selectedContainerIds.filter((id) => id !== containerId)
          : [...state.selectedContainerIds, containerId];
      return {
        selectedContainerId: ids.at(-1) ?? null,
        selectedContainerIds: ids,
        selectedElementIds: [],
        selectedSlideId,
      };
    }),

  selectedTextEditors: [],
  addSelectedTextEditor: (entry) => set((state) => ({ selectedTextEditors: [...state.selectedTextEditors, entry] })),
  removeSelectedTextEditor: (editor) =>
    set((state) => ({ selectedTextEditors: state.selectedTextEditors.filter((entry) => entry.editor !== editor) })),

  activeTextEditor: null,
  activeTextTarget: null,
  // Leaving a text box with no shape selected closes the color panel — nothing is left for it to color.
  setActiveTextEditor: (editor, target = null) =>
    set((state) => ({
      activeTextEditor: editor,
      activeTextTarget: editor ? target : null,
      isColorPanelOpen: editor || state.selectedElementIds.length > 0 ? state.isColorPanelOpen : false,
    })),

  setTextFontSizes: (targets, fontSize) => {
    const quiz = targets.reduce(
      (quiz, target) =>
        updateSlide(quiz, target.slideId, (s) => {
          if (target.kind === "question") return { ...s, questionFontSize: fontSize };
          if (target.kind === "option") {
            return { ...s, options: s.options.map((o) => (o.id === target.optionId ? { ...o, fontSize } : o)) as typeof s.options };
          }
          return {
            ...s,
            elements: s.elements.map((el) => (el.id === target.elementId ? { ...el, text: { html: el.text?.html ?? "", fontSize } } : el)),
          };
        }),
      get().quiz
    );
    set({ quiz });
  },

  addElement: (slideId, assetId, containerId = null, position) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;
    const bounds = getContainerBounds(containerId, slide);
    const asset = getElementAsset(assetId);
    // 3D solids are drawn smaller inside their square (so they still fit when rotated), so they
    // start 30% bigger to look the same size as flat elements.
    const boxSize = asset?.is3d ? 124 : 95;
    // The open slide and the (slide-sized) answer canvas get the bigger default size.
    const square = containerId === null || containerId === ANSWER_CONTAINER_ID ? DEFAULT_ELEMENT_SIZE : boxSize;
    // Wide assets (number lines) start at their own size; everything else starts square.
    const wanted = asset?.defaultSize ?? { width: square, height: square };
    // Centered on the drop point (or the box's center), shrunk evenly if it doesn't fit.
    const center = position ?? { x: bounds.width / 2, y: bounds.height / 2 };
    const rect = { ...wanted, x: center.x - wanted.width / 2, y: center.y - wanted.height / 2 };
    const element: SvgElement = {
      id: createId(),
      assetId,
      ...fitInBox(rect, bounds, true),
      color: asset?.defaultColor ?? DEFAULT_ELEMENT_COLOR,
      containerId,
      ...(asset?.isTextBox && { text: { html: "<p>Type here</p>" } }),
    };
    const { recentElementAssetIds, selectedSlideId, selectedContainerId, selectedContainerIds } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({ ...s, elements: [...s.elements, element] })),
      // The drop may land on a slide other than the current one — make it current so the toolbar
      // and shortcuts act on the new element. A box picked on the old slide doesn't carry over.
      selectedSlideId: slideId,
      ...(slideId === selectedSlideId
        ? { selectedContainerId, selectedContainerIds }
        : { selectedContainerId: null, selectedContainerIds: [] }),
      selectedElementIds: [element.id],
      recentElementAssetIds: [assetId, ...recentElementAssetIds.filter((id) => id !== assetId)].slice(0, 8),
    });
  },

  updateElement: (slideId, elementId, patch) => get().updateElements(slideId, { [elementId]: patch }),

  updateElements: (slideId, patches) => {
    const { quiz } = get();
    // Taking an element out of its group may leave one member behind on its own.
    const changesGroups = Object.values(patches).some((patch) => "groupId" in patch);
    set({
      quiz: updateSlide(quiz, slideId, (s) => {
        const elements = s.elements.map((el) => (patches[el.id] ? { ...el, ...patches[el.id] } : el));
        return { ...s, elements: changesGroups ? dropLoneGroups(elements) : elements };
      }),
    });
  },

  deleteElements: (slideId, elementIds) => {
    if (elementIds.length === 0) return;
    const { quiz, selectedElementIds } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        elements: dropLoneGroups(s.elements.filter((el) => !elementIds.includes(el.id))),
      })),
      selectedElementIds: selectedElementIds.filter((id) => !elementIds.includes(id)),
    });
  },

  duplicateElements: (slideId, elementIds) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return [];

    const OFFSET = 20;
    const copies = giveCopiesNewGroups(
      slide.elements
        .filter((el) => elementIds.includes(el.id))
        .map((original) => {
          const bounds = getContainerBounds(original.containerId, slide);
          return {
            ...original,
            id: createId(),
            x: Math.min(bounds.width - original.width, original.x + OFFSET),
            y: Math.min(bounds.height - original.height, original.y + OFFSET),
          };
        })
    );

    set({ quiz: updateSlide(quiz, slideId, (s) => ({ ...s, elements: [...s.elements, ...copies] })) });

    return copies.map((el) => el.id);
  },

  clearContainerElements: (slideId, containerId) => {
    const { quiz, selectedElementIds } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const removedIds = slide.elements.filter((el) => el.containerId === containerId).map((el) => el.id);
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({ ...s, elements: s.elements.filter((el) => el.containerId !== containerId) })),
      selectedElementIds: selectedElementIds.filter((id) => !removedIds.includes(id)),
    });
  },

  fitElementsToContainer: (slideId, elementIds) => {
    const slide = get().quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const byContainer = new Map<string, SvgElement[]>();
    for (const el of slide.elements) {
      if (!elementIds.includes(el.id) || el.containerId === null || getElementAsset(el.assetId)?.isTextBox) continue;
      byContainer.set(el.containerId, [...(byContainer.get(el.containerId) ?? []), el]);
    }

    const PADDING = 8;
    const patches: Record<string, ElementPatch> = {};
    for (const [containerId, elements] of byContainer) {
      const box = getContainerBounds(containerId, slide);
      const { minX, minY, maxX, maxY } = getOuterEdges(elements);
      const scale = Math.min((box.width - PADDING * 2) / (maxX - minX), (box.height - PADDING * 2) / (maxY - minY));
      // Where the scaled-up group's top-left corner lands so it sits centered in the box.
      const left = (box.width - (maxX - minX) * scale) / 2;
      const top = (box.height - (maxY - minY) * scale) / 2;
      for (const el of elements) {
        patches[el.id] = {
          x: left + (el.x - minX) * scale,
          y: top + (el.y - minY) * scale,
          width: el.width * scale,
          height: el.height * scale,
        };
      }
    }
    if (Object.keys(patches).length > 0) get().updateElements(slideId, patches);
  },

  clipboard: null,

  copySelectedElements: () => {
    const { quiz, selectedSlideId, selectedElementIds } = get();
    if (selectedElementIds.length === 0) return;

    const slide = quiz.slides.find((s) => s.id === selectedSlideId);
    const elements = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
    if (elements.length === 0) return;

    // Forget any previously clicked box, so a plain Ctrl+V puts each element back in the box it
    // was copied from — clicking a box after copying still aims the paste there.
    set({ clipboard: elements, selectedContainerId: null, selectedContainerIds: [] });
  },

  clearClipboard: () => set({ clipboard: null }),

  pasteClipboard: (slideId, containerId) => {
    const { quiz, clipboard } = get();
    if (!clipboard) return;
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    // An element copied from an option on another slide goes into the option in the same spot
    // here — that other slide's option id doesn't exist on this slide, so the element would vanish.
    const resolveContainer = (id: string | null) => {
      // A slide without an answer canvas (multiple choice) takes answer elements on the open slide.
      if (id === ANSWER_CONTAINER_ID) return canHaveAnswer(slide) ? id : null;
      // Lesson slides have no boxes at all, so everything lands on the open slide.
      if (slide.type === "lesson") return null;
      if (id === null || id === QUESTION_CONTAINER_ID) return id;
      // Short-answer slides hide their options, so an element from an option goes into the shape box.
      if (slide.type === "short-answer") return SIDE_CONTAINER_ID;
      if (slide.options.some((o) => o.id === id)) return id;
      // No shape box on this slide — the element lands on the open canvas instead.
      if (id === SIDE_CONTAINER_ID) return hasShapeBox(slide) ? id : null;
      const sourceIndex = quiz.slides.map((s) => s.options.findIndex((o) => o.id === id)).find((i) => i !== -1);
      return sourceIndex === undefined ? null : slide.options[sourceIndex].id;
    };

    const OFFSET = 20;
    const pasted = giveCopiesNewGroups(clipboard).map((el) => {
      const targetContainerId = resolveContainer(containerId !== undefined ? containerId : el.containerId);
      const bounds = getContainerBounds(targetContainerId, slide);
      const shifted = { width: el.width, height: el.height, x: el.x + OFFSET, y: el.y + OFFSET };
      // Pasting into a smaller box shrinks it evenly (keeping the shape) so it fits.
      return { ...el, ...fitInBox(shifted, bounds), id: createId(), containerId: targetContainerId };
    });

    set({
      quiz: updateSlide(quiz, slideId, (s) => ({ ...s, elements: [...s.elements, ...pasted] })),
      selectedSlideId: slideId,
      selectedElementIds: pasted.map((el) => el.id),
    });
  },

  isElementsPanelOpen: false,
  toggleElementsPanel: () =>
    set((state) => {
      const next = !state.isElementsPanelOpen;
      return {
        isElementsPanelOpen: next,
        isColorPanelOpen: next ? false : state.isColorPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isDetailsPanelOpen: next ? false : state.isDetailsPanelOpen,
        isLessonsPanelOpen: next ? false : state.isLessonsPanelOpen,
      };
    }),
  closeElementsPanel: () => set({ isElementsPanelOpen: false }),

  isColorPanelOpen: false,
  toggleColorPanel: () =>
    set((state) => {
      const next = !state.isColorPanelOpen;
      return {
        isColorPanelOpen: next,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isDetailsPanelOpen: next ? false : state.isDetailsPanelOpen,
        isLessonsPanelOpen: next ? false : state.isLessonsPanelOpen,
      };
    }),
  closeColorPanel: () => set({ isColorPanelOpen: false }),
  shapeBoxColorTarget: "fill",
  openShapeBoxColorPanel: (target) =>
    set((state) => {
      const next = !(state.isColorPanelOpen && state.shapeBoxColorTarget === target);
      return {
        shapeBoxColorTarget: target,
        isColorPanelOpen: next,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isDetailsPanelOpen: next ? false : state.isDetailsPanelOpen,
        isLessonsPanelOpen: next ? false : state.isLessonsPanelOpen,
      };
    }),

  isBackgroundPanelOpen: false,
  toggleBackgroundPanel: () =>
    set((state) => {
      const next = !state.isBackgroundPanelOpen;
      return {
        isBackgroundPanelOpen: next,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isColorPanelOpen: next ? false : state.isColorPanelOpen,
        isDetailsPanelOpen: next ? false : state.isDetailsPanelOpen,
        isLessonsPanelOpen: next ? false : state.isLessonsPanelOpen,
      };
    }),
  closeBackgroundPanel: () => set({ isBackgroundPanelOpen: false }),

  isDetailsPanelOpen: false,
  toggleDetailsPanel: () =>
    set((state) => {
      const next = !state.isDetailsPanelOpen;
      return {
        isDetailsPanelOpen: next,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isColorPanelOpen: next ? false : state.isColorPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isLessonsPanelOpen: next ? false : state.isLessonsPanelOpen,
      };
    }),
  closeDetailsPanel: () => set({ isDetailsPanelOpen: false }),

  isLessonsPanelOpen: false,
  toggleLessonsPanel: () =>
    set((state) => {
      const next = !state.isLessonsPanelOpen;
      return {
        isLessonsPanelOpen: next,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isColorPanelOpen: next ? false : state.isColorPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isDetailsPanelOpen: next ? false : state.isDetailsPanelOpen,
      };
    }),
  closeLessonsPanel: () => set({ isLessonsPanelOpen: false }),

  dragOverContainerId: null,
  setDragOverContainerId: (containerId) => set({ dragOverContainerId: containerId }),

  elementDragGhosts: [],
  setElementDragGhosts: (ghosts) => set({ elementDragGhosts: ghosts }),

  snapGuides: null,
  setSnapGuides: (guides) => set({ snapGuides: guides }),
}));

// Set while undo/redo swaps the quiz (or withoutHistory runs), so the subscription below doesn't
// record that as a new edit.
let skipHistory = false;
let lastQuizChangeAt = 0;

/**
 * Runs a quiz change that isn't the user's own edit — like fitting a box to its drawing when it
 * first shows — so it never becomes an undo step of its own. Otherwise undo would take the fit
 * away, the box would fit itself again, and that new step would wipe the redo list.
 */
export function withoutHistory(change: () => void) {
  skipHistory = true;
  try {
    change();
  } finally {
    skipHistory = false;
  }
}

/** Puts an older/newer quiz back, dropping any selection that points at things that no longer exist. */
function restoreQuiz(quiz: Quiz, history: Pick<EditorState, "past" | "future">) {
  const { selectedSlideId, selectedElementIds } = useEditorStore.getState();
  const slide = quiz.slides.find((s) => s.id === selectedSlideId) ?? quiz.slides[0];

  skipHistory = true;
  useEditorStore.setState({
    quiz,
    ...history,
    selectedSlideId: slide.id,
    selectedElementIds: selectedElementIds.filter((id) => slide.elements.some((el) => el.id === id)),
  });
  skipHistory = false;
  // The next edit after an undo/redo always starts its own step.
  lastQuizChangeAt = 0;
}

// Every quiz change goes through here, so each action gets undo for free. Only the first change of
// a quick burst saves the old quiz; the rest of the burst joins that same step.
useEditorStore.subscribe((state, prev) => {
  if (state.quiz === prev.quiz || skipHistory) return;

  const now = Date.now();
  const startsNewStep = now - lastQuizChangeAt > HISTORY_GROUP_MS;
  lastQuizChangeAt = now;
  if (!startsNewStep) return;

  useEditorStore.setState({ past: [...state.past, prev.quiz].slice(-MAX_HISTORY), future: [] });
});
