import { create } from "zustand";
import { toast } from "sonner";
import type { Editor } from "@tiptap/react";
import { createBlankPresentation, createBlankSlide, duplicateSlide as cloneSlide } from "./factories";
import { createId } from "./id";
import { DEFAULT_ELEMENT_COLOR, DEFAULT_ELEMENT_SIZE, getElementAsset, type ElementCategory, type RenderSettings } from "./svgLibrary";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  getContainerBounds,
  getMaxQuestionHeight,
  getQuestionBox,
  MIN_QUESTION_WIDTH,
  getMaxShapeStripHeight,
  getShapeStripHeight,
  hasShapeBox,
  hasOptions,
  getShownOptions,
  type BoxLayout,
  MIN_QUESTION_HEIGHT,
  MIN_SHAPE_STRIP_HEIGHT,
  QUESTION_CONTAINER_ID,
  SIDE_CONTAINER_ID,
  ANSWER_CONTAINER_ID,
  canHaveAnswer,
  isFreeCanvas,
} from "./constants";
import { clamp, fitInBox, getOuterEdges } from "./geometry";
import { withBackground, type BackgroundPatch } from "./slideBackground";
import { SaveRefusedError, saveErrorMessage, savePresentationToDb } from "./presentations";
import { saveReviewDraft } from "./reviews";
import { finishDraft } from "@/app/actions";
import { isEmbedSlide } from "./embed";
import type { Photo, PresentationDetails, Presentation, ReviewerFields, Slide, SlideType, SvgElement } from "./schema";
import { MAX_ITEM_COUNT, MAX_SLIDES, TOO_MANY_SLIDES_MESSAGE } from "./schema";

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
// Presentation changes closer together than this count as one undo step (a whole drag, a typed word).
const HISTORY_GROUP_MS = 500;

// Longest side (px) of a new photo on the open slide or the answer canvas.
const DEFAULT_PHOTO_SIZE = 480;

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

/** Applies `updater` to the one slide matching `slideId` and bumps the presentation's updatedAt — the shape every mutation below needs. */
function updateSlide(presentation: Presentation, slideId: string, updater: (slide: Slide) => Slide): Presentation {
  return {
    ...presentation,
    slides: presentation.slides.map((s) => (s.id === slideId ? updater(s) : s)),
    updatedAt: Date.now(),
  };
}

/** The given ids plus every other member of any group they belong to. */
export function withGroupMembers(elements: SvgElement[], ids: string[]): string[] {
  const groupIds = new Set(elements.filter((el) => ids.includes(el.id) && el.groupId).map((el) => el.groupId));
  const members = elements.filter((el) => el.groupId && groupIds.has(el.groupId)).map((el) => el.id);
  return [...new Set([...ids, ...members])];
}

export type LayerMove = "forward" | "backward" | "front" | "back";

/**
 * Changes which elements draw on top. Later in the list = drawn on top, and only elements in the same
 * box can overlap, so each box is reordered on its own. The selection (plus its group members) moves as
 * one block. "forward"/"backward" step past the next element (or whole group) in that box.
 * Returns the same array when nothing would change, so callers can use it to disable a button.
 */
export function moveInLayers(elements: SvgElement[], ids: string[], move: LayerMove): SvgElement[] {
  const selected = new Set(withGroupMembers(elements, ids));
  const containerIds = new Set(elements.filter((el) => selected.has(el.id)).map((el) => el.containerId));
  const result = [...elements];

  containerIds.forEach((containerId) => {
    const slots = elements.flatMap((el, i) => (el.containerId === containerId ? [i] : []));
    const list = slots.map((i) => elements[i]);
    const block = list.filter((el) => selected.has(el.id));
    const others = list.filter((el) => !selected.has(el.id));

    let insertAt: number;
    if (move === "front") insertAt = others.length;
    else if (move === "back") insertAt = 0;
    else {
      const blockIndexes = list.flatMap((el, i) => (selected.has(el.id) ? [i] : []));
      const target =
        move === "forward"
          ? list.find((el, i) => i > Math.max(...blockIndexes) && !selected.has(el.id))
          : list.findLast((el, i) => i < Math.min(...blockIndexes) && !selected.has(el.id));
      if (!target) return;
      // Step past the target's whole group, so the selection doesn't land between its members.
      const targetGroup = others.filter((el) => el === target || (target.groupId && el.groupId === target.groupId));
      insertAt =
        move === "forward"
          ? others.indexOf(targetGroup[targetGroup.length - 1]) + 1
          : others.indexOf(targetGroup[0]);
    }

    const reordered = [...others.slice(0, insertAt), ...block, ...others.slice(insertAt)];
    slots.forEach((slot, i) => (result[slot] = reordered[i]));
  });

  return result.every((el, i) => el === elements[i]) ? elements : result;
}

/**
 * Whether `count` more slides still fit (MAX_SLIDES). If not, a toast says so and nothing should be added, so the
 * teacher learns it now instead of when the save fails.
 */
function hasRoomForSlides(presentation: Presentation, count: number): boolean {
  if (presentation.slides.length + count <= MAX_SLIDES) return true;
  toast.error(TOO_MANY_SLIDES_MESSAGE);
  return false;
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

// An editor reviewing someone else's QuizMatter presentation (see the presentation_reviews migration): the admin's
// note when it was sent back ("" if none), and the "Reviewed by" form's starting values.
export type EditorReview = { note: string; fields: ReviewerFields };

interface EditorState {
  presentation: Presentation;
  // Opens a presentation loaded from the database: sets it as the saved version and starts a fresh undo history.
  loadPresentation: (presentation: Presentation) => void;
  // The presentation as it was last saved. Any edit makes a new presentation object, so `presentation !== savedPresentation` means unsaved changes.
  savedPresentation: Presentation | null;
  // When the database copy was last saved (Unix ms), so a save can tell if someone saved in between. null = not
  // in the database yet (a draft from Claude).
  savedAt: number | null;
  saveStatus: "idle" | "saving" | "error";
  // True while the presentation is a draft from Claude that hasn't been saved yet (see /presentation/new).
  fromDraft: boolean;
  // Set while an editor reviews someone else's QuizMatter presentation: saves go to their draft. null = a normal
  // presentation.
  review: EditorReview | null;
  // Saves the whole presentation and shows a toast (not when `quiet`). Resolves true if it's saved (or had
  // nothing new to save), false if it failed or another save is still running.
  savePresentation: (options?: { quiet?: boolean }) => Promise<boolean>;
  // Undo/redo history of the presentation content only (not selection, zoom or open panels). Filled
  // automatically by the store subscription at the bottom of this file.
  past: Presentation[];
  future: Presentation[];
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
  // Copies of slides from another presentation (new ids), put right after (or before) `at.slideId`, or at
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
  // Short-answer slides only: moves and/or resizes the question box (slide px), kept inside the slide.
  setQuestionBox: (slideId: string, rect: { x: number; y: number; width: number; height: number }) => void;
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
  // Custom slides: how many question items they hold (1–MAX_ITEM_COUNT), so they take that many numbers.
  setItemCount: (slideId: string, itemCount: number) => void;
  // Embed slides: the link they show (already checked with embedLinkSchema).
  setEmbedUrl: (slideId: string, embedUrl: string) => void;
  // Puts a question slide in or takes it out of the question numbers (1, 2, 3…).
  reorderOptions: (slideId: string, fromOptionId: string, toOptionId: string) => void;
  shuffleOptions: (slideId: string) => void;
  // Empties the question, every option's text and all slide elements; keeps the answer (text and canvas) and layout.
  clearSlide: (slideId: string) => void;

  // Title and the other presentation details (grade, subject…), edited in the top bar and the Details panel.
  setPresentationDetails: (patch: Partial<PresentationDetails>) => void;
  // Private/published, saved right away (the whole presentation, so others see what the teacher sees).
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
  goToPresentationSlide: (index: number) => void;

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
  // The element being cropped (its crop handles show), or null. Only while it's the one selected element.
  croppingElementId: string | null;
  setCroppingElementId: (elementId: string | null) => void;
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
  // With `size`, `position` is the new element's top-left corner (a drawn box); without it, its center.
  addElement: (
    slideId: string,
    assetId: string,
    containerId?: string | null,
    position?: { x: number; y: number },
    size?: { width: number; height: number },
    // Only for photos (assetId PHOTO_ID): the uploaded photo it shows.
    photo?: Photo
  ) => void;
  // Adds an element by clicking it in the Elements panel: into the selected box on the current
  // slide, else a multiple-choice slide's shape box (added first if missing), else the slide itself.
  insertElement: (assetId: string, photo?: Photo) => void;
  // Most-recently-inserted asset ids first, for the Elements panel's "Recently used" row.
  recentElementAssetIds: string[];
  updateElement: (slideId: string, elementId: string, patch: ElementPatch) => void;
  // Changes several elements in one store update (one redraw, one presentation copy), keyed by element id.
  updateElements: (slideId: string, patches: Record<string, ElementPatch>) => void;
  deleteElements: (slideId: string, elementIds: string[]) => void;
  // Brings elements forward/to front or sends them backward/to back (see moveInLayers).
  moveElementsInLayers: (slideId: string, elementIds: string[], move: LayerMove) => void;
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
  // The Photos panel uploads photos, or adds them from a link.
  isPhotosPanelOpen: boolean;
  togglePhotosPanel: () => void;
  closePhotosPanel: () => void;
  // The Elements panel categories the user starred, saved to their account. null until loaded.
  favoriteElementCategories: ElementCategory[] | null;
  setFavoriteElementCategories: (categories: ElementCategory[]) => void;

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

  // The Effects panel picks how slides come in when the presentation is shown full screen.
  isEffectsPanelOpen: boolean;
  toggleEffectsPanel: () => void;
  closeEffectsPanel: () => void;

  // The Presentations panel lists published presentations, to add their slides to this one.
  isPresentationsPanelOpen: boolean;
  togglePresentationsPanel: () => void;
  closePresentationsPanel: () => void;

  // Which box a placed element is currently being dragged over, while it's being moved from a
  // different box — drives that box's "drop here" highlight. Not part of presentation data.
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
  // box's own coordinates. slideId is needed because every slide has a "question" box. Not part of presentation data.
  snapGuides: { slideId: string; containerId: string | null; xs: number[]; ys: number[] } | null;
  setSnapGuides: (guides: EditorState["snapGuides"]) => void;
}

// A placeholder until loadPresentation puts the real presentation in.
const initialPresentation = createBlankPresentation();

export const useEditorStore = create<EditorState>((set, get) => ({
  presentation: initialPresentation,
  past: [],
  future: [],

  loadPresentation: (presentation) =>
    withoutHistory(() =>
      set({
        presentation,
        savedPresentation: presentation,
        // Loaded from the database, so its updatedAt is the database's save time.
        savedAt: presentation.updatedAt,
        saveStatus: "idle",
        fromDraft: false,
        review: null,
        past: [],
        future: [],
        selectedSlideId: presentation.slides[0].id,
        selectedElementIds: [],
        selectedContainerId: null,
        selectedContainerIds: [],
        isPresenting: false,
        answerSlideId: null,
      })
    ),

  savedPresentation: null,
  savedAt: null,
  saveStatus: "idle",
  fromDraft: false,
  review: null,

  savePresentation: async ({ quiet = false } = {}) => {
    const { presentation, savedPresentation, savedAt, saveStatus, fromDraft, review } = get();
    if (saveStatus === "saving") return false;
    // Nothing new to save (Ctrl+S works even when the Save button is greyed out).
    if (presentation === savedPresentation) return true;
    set({ saveStatus: "saving" });
    // If another presentation is opened while this one saves, loadPresentation replaces savedPresentation.
    // Then this save's result belongs to the old presentation and must not touch the new one.
    const isStillOpen = () => get().savedPresentation === savedPresentation;
    try {
      // Only the slides changed since the last save are sent. Never saved yet = there's nothing to compare with.
      // A review saves its draft (every slide); teachers keep seeing the live presentation.
      const newSavedAt = review
        ? await saveReviewDraft(presentation, savedAt)
        : await savePresentationToDb(presentation, {
            baseUpdatedAt: savedAt,
            savedSlides: savedAt === null ? undefined : savedPresentation?.slides,
          });
      // Claude's draft is now a saved presentation, so the draft goes: Claude's next send makes a new draft
      // (with a new link) instead of updating one nobody can open anymore. If this fails, the save still counts.
      if (fromDraft) finishDraft(presentation.id).catch(() => {});
      if (!quiet) toast.success(review ? "Draft saved. Teachers still see the old version." : "Presentation saved.");
      // Edits made while saving aren't in the database yet, so they still count as unsaved.
      if (isStillOpen()) set({ savedPresentation: presentation, savedAt: newSavedAt, saveStatus: "idle", fromDraft: false });
      return true;
    } catch (error) {
      console.error("Couldn't save the presentation", error);
      // A refused save is shown even when quiet: it says why, and a conflict stays until the user reloads.
      if (error instanceof SaveRefusedError || !quiet) {
        toast.error(saveErrorMessage(error, "save"), {
          duration: error instanceof SaveRefusedError && error.isConflict ? Infinity : undefined,
        });
      }
      if (isStillOpen()) set({ saveStatus: "error" });
      return false;
    }
  },

  undo: () => {
    const state = get();
    const previous = state.past[state.past.length - 1];
    if (!previous) return;
    restorePresentation(previous, { past: state.past.slice(0, -1), future: [state.presentation, ...state.future] });
  },

  redo: () => {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    restorePresentation(next, { past: [...state.past, state.presentation], future: state.future.slice(1) });
  },

  selectedSlideId: initialPresentation.slides[0].id,
  zoom: 1,
  recentElementAssetIds: [],

  selectSlide: (slideId) =>
    set({ selectedSlideId: slideId, selectedElementIds: [], selectedContainerId: null, selectedContainerIds: [] }),

  addSlide: (afterSlideId, type) => {
    if (!hasRoomForSlides(get().presentation, 1)) return;
    const slide = createBlankSlide(type);
    set((state) => {
      const slides = [...state.presentation.slides];
      const insertAt = afterSlideId ? slides.findIndex((s) => s.id === afterSlideId) + 1 : slides.length;
      slides.splice(insertAt, 0, slide);
      return {
        presentation: { ...state.presentation, slides, updatedAt: Date.now() },
        selectedSlideId: slide.id,
      };
    });
  },

  importSlides: (slides) =>
    set((state) => ({
      presentation: { ...state.presentation, slides, updatedAt: Date.now() },
      selectedSlideId: slides[0].id,
      selectedElementIds: [],
      selectedContainerId: null,
      selectedContainerIds: [],
    })),

  deleteSlide: (slideId) => {
    const { presentation, selectedSlideId } = get();
    if (presentation.slides.length <= 1) return;

    const index = presentation.slides.findIndex((s) => s.id === slideId);
    const slides = presentation.slides.filter((s) => s.id !== slideId);
    const nextSelected =
      selectedSlideId === slideId
        ? slides[Math.max(0, index - 1)].id
        : selectedSlideId;

    set({
      presentation: { ...presentation, slides, updatedAt: Date.now() },
      selectedSlideId: nextSelected,
    });
  },

  duplicateSlide: (slideId) => {
    const { presentation } = get();
    const index = presentation.slides.findIndex((s) => s.id === slideId);
    if (index === -1 || !hasRoomForSlides(presentation, 1)) return;

    const copy = cloneSlide(presentation.slides[index]);
    const slides = [...presentation.slides];
    slides.splice(index + 1, 0, copy);

    set({
      presentation: { ...presentation, slides, updatedAt: Date.now() },
      selectedSlideId: copy.id,
    });
  },

  insertSlides: (slides, at) => {
    if (slides.length === 0 || !hasRoomForSlides(get().presentation, slides.length)) return;
    const copies = slides.map(cloneSlide);
    set((state) => {
      const all = [...state.presentation.slides];
      const targetIndex = at ? all.findIndex((s) => s.id === at.slideId) : -1;
      const insertAt = targetIndex === -1 ? all.length : at?.before ? targetIndex : targetIndex + 1;
      all.splice(insertAt, 0, ...copies);
      return {
        presentation: { ...state.presentation, slides: all, updatedAt: Date.now() },
        selectedSlideId: copies[0].id,
        selectedElementIds: [],
        selectedContainerId: null,
        selectedContainerIds: [],
      };
    });
  },

  reorderSlides: (fromId, toId) => {
    const { presentation } = get();
    const fromIndex = presentation.slides.findIndex((s) => s.id === fromId);
    const toIndex = presentation.slides.findIndex((s) => s.id === toId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const slides = [...presentation.slides];
    const [moved] = slides.splice(fromIndex, 1);
    slides.splice(toIndex, 0, moved);

    set({ presentation: { ...presentation, slides, updatedAt: Date.now() } });
  },

  setLayout: (slideId, layout) => {
    const { presentation, selectedContainerId, selectedContainerIds } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide || slide.layout === layout) return;

    // Leaving list-side with shapes in its box keeps that box as a strip under the question.
    const keepsShapeBox =
      slide.layout === "list-side" ? slide.elements.some((el) => el.containerId === SIDE_CONTAINER_ID) : slide.hasShapeBox;
    const next = { ...slide, layout, hasShapeBox: keepsShapeBox };
    // The new layout may allow a shorter strip and question box, so they may have to shrink first.
    next.shapeStripHeight = fitShapeStripHeight(next);
    next.questionHeight = Math.min(slide.questionHeight, getMaxQuestionHeight(next));

    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
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
    const { presentation } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide || hasShapeBox(slide)) return;

    const next = { ...slide, hasShapeBox: true };
    // The strip takes room from the options, so it and the question box may have to shrink first.
    next.shapeStripHeight = fitShapeStripHeight(next);
    next.questionHeight = Math.min(slide.questionHeight, getMaxQuestionHeight(next));

    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
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
    const { presentation, selectedContainerId, selectedContainerIds, selectedElementIds } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const removedIds = slide.elements.filter((el) => el.containerId === SIDE_CONTAINER_ID).map((el) => el.id);
    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
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
    const { presentation } = get();
    set({ presentation: updateSlide(presentation, slideId, (s) => ({ ...s, question: text, questionHtml: html })) });
  },

  setQuestionHeight: (slideId, height) => {
    const { presentation } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const clamped = Math.min(getMaxQuestionHeight(slide), Math.max(MIN_QUESTION_HEIGHT, height));
    if (clamped === slide.questionHeight) return;

    const resized = { ...slide, questionHeight: clamped };
    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
        ...s,
        questionHeight: clamped,
        elements: scaleElementsToBoxes(s.elements, s, resized),
      })),
    });
  },

  setQuestionBox: (slideId, rect) => {
    const { presentation } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const width = clamp(rect.width, MIN_QUESTION_WIDTH, CANVAS_WIDTH);
    const height = clamp(rect.height, MIN_QUESTION_HEIGHT, CANVAS_HEIGHT);
    const questionBox = { x: clamp(rect.x, 0, CANVAS_WIDTH - width), y: clamp(rect.y, 0, CANVAS_HEIGHT - height), width };
    const current = getQuestionBox(slide);
    if (
      questionBox.x === current.x &&
      questionBox.y === current.y &&
      questionBox.width === current.width &&
      height === slide.questionHeight
    ) {
      return;
    }

    const resized = { ...slide, questionBox, questionHeight: height };
    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
        ...s,
        questionBox,
        questionHeight: height,
        elements: scaleElementsToBoxes(s.elements, s, resized),
      })),
    });
  },

  setShapeBoxColors: (slideId, patch) => {
    set((state) => ({ presentation: updateSlide(state.presentation, slideId, (s) => ({ ...s, ...patch })) }));
  },

  setSlideBackground: (slideId, patch) => {
    set((state) => ({ presentation: updateSlide(state.presentation, slideId, (s) => withBackground(s, patch)) }));
  },

  applyBackgroundToAll: (slideId) => {
    const { presentation } = get();
    const source = presentation.slides.find((s) => s.id === slideId);
    if (!source) return;
    // The source's artwork is already drawn for its color, pattern and strength (or is Claude's own
    // drawing), so every slide takes it as-is instead of redrawing it — and nothing gets erased.
    const background = {
      background: source.background,
      backgroundPattern: source.backgroundPattern,
      backgroundOpacity: source.backgroundOpacity,
      backgroundSvg: source.backgroundSvg,
    };
    set({ presentation: { ...presentation, slides: presentation.slides.map((s) => ({ ...s, ...background })), updatedAt: Date.now() } });
  },

  setShapeStripHeight: (slideId, height) => {
    const { presentation } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const clamped = Math.min(getMaxShapeStripHeight(slide), Math.max(MIN_SHAPE_STRIP_HEIGHT, height));
    if (clamped === getShapeStripHeight(slide)) return;

    const resized = { ...slide, shapeStripHeight: clamped };
    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
        ...s,
        shapeStripHeight: clamped,
        // The strip's shapes stretch with it; the options' shapes stretch with the options.
        elements: scaleElementsToBoxes(s.elements, s, resized),
      })),
    });
  },

  updateOption: (slideId, optionId, text, html) => {
    const { presentation } = get();
    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
        ...s,
        options: s.options.map((o) => (o.id === optionId ? { ...o, text, html } : o)) as typeof s.options,
      })),
    });
  },

  setCorrectOption: (slideId, optionId) => {
    const { presentation } = get();
    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
        ...s,
        correctOptionId: s.correctOptionId === optionId ? null : optionId,
      })),
    });
  },

  updateCorrectAnswer: (slideId, answer) => {
    const { presentation } = get();
    set({ presentation: updateSlide(presentation, slideId, (s) => ({ ...s, correctAnswer: answer })) });
  },

  setAnswerType: (slideId, answerType) => {
    set((state) => ({ presentation: updateSlide(state.presentation, slideId, (s) => ({ ...s, answerType })) }));
  },

  renameSlide: (slideId, name) => {
    const { presentation } = get();
    // An empty name means "no name", so the slide falls back to its default label.
    set({ presentation: updateSlide(presentation, slideId, (s) => ({ ...s, name: name.trim() || undefined })) });
  },

  setItemCount: (slideId, itemCount) => {
    // Kept a whole number in range, so the slide always passes the schema when it's saved.
    const count = Math.min(MAX_ITEM_COUNT, Math.max(1, Math.round(itemCount)));
    set((state) => ({ presentation: updateSlide(state.presentation, slideId, (s) => ({ ...s, itemCount: count })) }));
  },

  setEmbedUrl: (slideId, embedUrl) => {
    set((state) => ({ presentation: updateSlide(state.presentation, slideId, (s) => ({ ...s, embedUrl })) }));
  },

  reorderOptions: (slideId, fromOptionId, toOptionId) => {
    const { presentation } = get();
    set({
      presentation: updateSlide(presentation, slideId, (s) => {
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
    const { presentation } = get();
    set({
      presentation: updateSlide(presentation, slideId, (s) => {
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
    const { presentation, selectedElementIds } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide) return;

    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
        ...s,
        question: "",
        questionHtml: "",
        // True-or-false cards go back to "True" and "False" instead of empty.
        options: s.options.map((o, i) => ({
          ...o,
          text: s.type === "true-false" && i < 2 ? ["True", "False"][i] : "",
          html: "",
        })) as typeof s.options,
        elements: s.elements.filter((el) => el.containerId === ANSWER_CONTAINER_ID),
      })),
      selectedElementIds: selectedElementIds.filter(
        (id) => !slide.elements.some((el) => el.id === id && el.containerId !== ANSWER_CONTAINER_ID)
      ),
    });
  },

  setPresentationDetails: (patch) => {
    const { presentation } = get();
    set({ presentation: { ...presentation, ...patch, updatedAt: Date.now() } });
  },

  setPublished: async (isPublished) => {
    const { presentation, saveStatus, setPresentationDetails, savePresentation } = get();
    if (saveStatus === "saving") return false;
    setPresentationDetails({ isPublished });
    const switched = get().presentation;
    // Quiet: the Details panel shows its own message (published / private / couldn't change it).
    if (await savePresentation({ quiet: true })) return true;
    // Switch back. With no other edits since, put the old presentation object back, so it doesn't count as unsaved.
    if (get().presentation === switched) withoutHistory(() => set({ presentation }));
    else setPresentationDetails({ isPublished: presentation.isPublished });
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
    const { presentation, selectedSlideId } = get();
    const startIndex = Math.max(0, presentation.slides.findIndex((s) => s.id === selectedSlideId));
    set({ isPresenting: true, presentationIndex: startIndex });
  },
  exitPresentation: () => set({ isPresenting: false }),
  nextPresentationSlide: () => {
    const { presentation, presentationIndex } = get();
    set({ presentationIndex: Math.min(presentation.slides.length - 1, presentationIndex + 1) });
  },
  prevPresentationSlide: () => {
    const { presentationIndex } = get();
    set({ presentationIndex: Math.max(0, presentationIndex - 1) });
  },
  goToPresentationSlide: (index) => {
    const { presentation } = get();
    set({ presentationIndex: Math.min(presentation.slides.length - 1, Math.max(0, index)) });
  },

  isGridViewOpen: false,
  openGridView: () => set({ isGridViewOpen: true }),
  closeGridView: () => set({ isGridViewOpen: false }),

  answerSlideId: null,
  openAnswer: (slideId) => set({ answerSlideId: slideId }),
  closeAnswer: () => set({ answerSlideId: null }),

  selectedElementIds: [],

  selectElement: (slideId, elementId, additive = false) => {
    const { presentation, selectedElementIds } = get();
    const elements = presentation.slides.find((s) => s.id === slideId)?.elements ?? [];
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
  croppingElementId: null,
  setCroppingElementId: (elementId) => set({ croppingElementId: elementId }),

  groupSelectedElements: () => {
    const { presentation, selectedSlideId, selectedElementIds } = get();
    const slide = presentation.slides.find((s) => s.id === selectedSlideId);
    const selected = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
    if (selected.length < 2 || selected.some((el) => el.containerId !== selected[0].containerId)) return;

    const groupId = createId();
    set({
      presentation: updateSlide(presentation, selectedSlideId, (s) => ({
        ...s,
        // Grouping members of an older group can leave that group with one element — clean it up.
        elements: dropLoneGroups(s.elements.map((el) => (selectedElementIds.includes(el.id) ? { ...el, groupId } : el))),
      })),
    });
  },

  ungroupSelectedElements: () => {
    const { presentation, selectedSlideId, selectedElementIds } = get();
    set({
      presentation: updateSlide(presentation, selectedSlideId, (s) => ({
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
    const presentation = targets.reduce(
      (presentation, target) =>
        updateSlide(presentation, target.slideId, (s) => {
          if (target.kind === "question") return { ...s, questionFontSize: fontSize };
          if (target.kind === "option") {
            return { ...s, options: s.options.map((o) => (o.id === target.optionId ? { ...o, fontSize } : o)) as typeof s.options };
          }
          return {
            ...s,
            elements: s.elements.map((el) => (el.id === target.elementId ? { ...el, text: { html: el.text?.html ?? "", fontSize } } : el)),
          };
        }),
      get().presentation
    );
    set({ presentation });
  },

  addElement: (slideId, assetId, containerId = null, position, size, photo) => {
    const { presentation } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    // Embed slides hold only their video, deck or picture: anything on top would cover the player's buttons.
    if (!slide || isEmbedSlide(slide)) return;
    const bounds = getContainerBounds(containerId, slide);
    const asset = getElementAsset(assetId);
    // 3D solids are drawn smaller inside their square (so they still fit when rotated), so they
    // start 30% bigger to look the same size as flat elements.
    const boxSize = asset?.is3d ? 124 : 95;
    // The open slide and the (slide-sized) answer canvas get the bigger default size.
    const isSlideSized = containerId === null || containerId === ANSWER_CONTAINER_ID;
    const square = isSlideSized ? DEFAULT_ELEMENT_SIZE : boxSize;
    // Photos keep their shape, their longest side a bit bigger on the open slide; wide assets (number
    // lines) start at their own size; everything else starts square.
    const photoScale = photo ? (isSlideSized ? DEFAULT_PHOTO_SIZE : boxSize) / Math.max(photo.width, photo.height) : 1;
    const wanted = photo
      ? { width: photo.width * photoScale, height: photo.height * photoScale }
      : (asset?.defaultSize ?? { width: square, height: square });
    // Centered on the drop point (or the box's center), shrunk evenly if it doesn't fit.
    const center = position ?? { x: bounds.width / 2, y: bounds.height / 2 };
    const rect =
      size && position
        ? { ...size, ...position }
        : { ...wanted, x: center.x - wanted.width / 2, y: center.y - wanted.height / 2 };
    const element: SvgElement = {
      id: createId(),
      assetId,
      ...fitInBox(rect, bounds, true),
      color: asset?.defaultColor ?? DEFAULT_ELEMENT_COLOR,
      containerId,
      ...(asset?.isTextBox && { text: { html: "<p>Type here</p>" } }),
      ...(photo && { image: photo }),
    };
    const { recentElementAssetIds, selectedSlideId, selectedContainerId, selectedContainerIds } = get();
    set({
      presentation: updateSlide(presentation, slideId, (s) => ({ ...s, elements: [...s.elements, element] })),
      // The drop may land on a slide other than the current one — make it current so the toolbar
      // and shortcuts act on the new element. A box picked on the old slide doesn't carry over.
      selectedSlideId: slideId,
      ...(slideId === selectedSlideId
        ? { selectedContainerId, selectedContainerIds }
        : { selectedContainerId: null, selectedContainerIds: [] }),
      selectedElementIds: [element.id],
      // Photos aren't in the Elements panel, so they're not "recently used".
      recentElementAssetIds: photo
        ? recentElementAssetIds
        : [assetId, ...recentElementAssetIds.filter((id) => id !== assetId)].slice(0, 8),
    });
  },

  insertElement: (assetId, photo) => {
    const { presentation, selectedSlideId, selectedContainerId, answerSlideId } = get();
    const slide = presentation.slides.find((s) => s.id === selectedSlideId);
    if (!slide) return;
    // The answer canvas stays selected after its window closes; only add to it while it's open.
    const isHiddenAnswer = selectedContainerId === ANSWER_CONTAINER_ID && answerSlideId !== slide.id;
    if (selectedContainerId && !isHiddenAnswer) return get().addElement(slide.id, assetId, selectedContainerId, undefined, undefined, photo);
    if (!hasOptions(slide)) return get().addElement(slide.id, assetId, null, undefined, undefined, photo);
    // addShapeBox does nothing if the slide already has one.
    get().addShapeBox(slide.id);
    get().addElement(slide.id, assetId, SIDE_CONTAINER_ID, undefined, undefined, photo);
  },

  updateElement: (slideId, elementId, patch) => get().updateElements(slideId, { [elementId]: patch }),

  updateElements: (slideId, patches) => {
    const { presentation } = get();
    // Taking an element out of its group may leave one member behind on its own.
    const changesGroups = Object.values(patches).some((patch) => "groupId" in patch);
    set({
      presentation: updateSlide(presentation, slideId, (s) => {
        const elements = s.elements.map((el) => (patches[el.id] ? { ...el, ...patches[el.id] } : el));
        return { ...s, elements: changesGroups ? dropLoneGroups(elements) : elements };
      }),
    });
  },

  deleteElements: (slideId, elementIds) => {
    if (elementIds.length === 0) return;
    const { presentation, selectedElementIds } = get();
    set({
      presentation: updateSlide(presentation, slideId, (s) => ({
        ...s,
        elements: dropLoneGroups(s.elements.filter((el) => !elementIds.includes(el.id))),
      })),
      selectedElementIds: selectedElementIds.filter((id) => !elementIds.includes(id)),
    });
  },

  moveElementsInLayers: (slideId, elementIds, move) => {
    const { presentation } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide) return;
    const elements = moveInLayers(slide.elements, elementIds, move);
    if (elements === slide.elements) return;
    set({ presentation: updateSlide(presentation, slideId, (s) => ({ ...s, elements })) });
  },

  duplicateElements: (slideId, elementIds) => {
    const { presentation } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
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

    set({ presentation: updateSlide(presentation, slideId, (s) => ({ ...s, elements: [...s.elements, ...copies] })) });

    return copies.map((el) => el.id);
  },

  clearContainerElements: (slideId, containerId) => {
    const { presentation, selectedElementIds } = get();
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const removedIds = slide.elements.filter((el) => el.containerId === containerId).map((el) => el.id);
    set({
      presentation: updateSlide(presentation, slideId, (s) => ({ ...s, elements: s.elements.filter((el) => el.containerId !== containerId) })),
      selectedElementIds: selectedElementIds.filter((id) => !removedIds.includes(id)),
    });
  },

  fitElementsToContainer: (slideId, elementIds) => {
    const slide = get().presentation.slides.find((s) => s.id === slideId);
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
    const { presentation, selectedSlideId, selectedElementIds } = get();
    if (selectedElementIds.length === 0) return;

    const slide = presentation.slides.find((s) => s.id === selectedSlideId);
    const elements = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
    if (elements.length === 0) return;

    // Forget any previously clicked box, so a plain Ctrl+V puts each element back in the box it
    // was copied from — clicking a box after copying still aims the paste there.
    set({ clipboard: elements, selectedContainerId: null, selectedContainerIds: [] });
  },

  clearClipboard: () => set({ clipboard: null }),

  pasteClipboard: (slideId, containerId) => {
    const { presentation, clipboard } = get();
    if (!clipboard) return;
    const slide = presentation.slides.find((s) => s.id === slideId);
    if (!slide || isEmbedSlide(slide)) return;

    // An element copied from an option on another slide goes into the option in the same spot
    // here — that other slide's option id doesn't exist on this slide, so the element would vanish.
    const resolveContainer = (id: string | null) => {
      // A slide without an answer canvas (multiple choice) takes answer elements on the open slide.
      if (id === ANSWER_CONTAINER_ID) return canHaveAnswer(slide) ? id : null;
      // Blank slides have no boxes at all, so everything lands on the open slide.
      if (isFreeCanvas(slide)) return null;
      if (id === null || id === QUESTION_CONTAINER_ID) return id;
      // Short-answer slides hide their options and have no shape box, so the element lands on the slide.
      if (slide.type === "short-answer") return null;
      // True-or-false slides hide their last 2 option slots, so only the 2 shown cards take elements.
      const shownOptions = getShownOptions(slide);
      if (shownOptions.some((o) => o.id === id)) return id;
      // No shape box on this slide — the element lands on the open canvas instead.
      if (id === SIDE_CONTAINER_ID) return hasShapeBox(slide) ? id : null;
      const sourceIndex = presentation.slides.map((s) => s.options.findIndex((o) => o.id === id)).find((i) => i !== -1);
      return shownOptions[sourceIndex ?? -1]?.id ?? null;
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
      presentation: updateSlide(presentation, slideId, (s) => ({ ...s, elements: [...s.elements, ...pasted] })),
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
        isEffectsPanelOpen: next ? false : state.isEffectsPanelOpen,
        isPresentationsPanelOpen: next ? false : state.isPresentationsPanelOpen,
        isPhotosPanelOpen: next ? false : state.isPhotosPanelOpen,
      };
    }),
  closeElementsPanel: () => set({ isElementsPanelOpen: false }),

  isPhotosPanelOpen: false,
  togglePhotosPanel: () =>
    set((state) => {
      const next = !state.isPhotosPanelOpen;
      return {
        isPhotosPanelOpen: next,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isColorPanelOpen: next ? false : state.isColorPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isDetailsPanelOpen: next ? false : state.isDetailsPanelOpen,
        isEffectsPanelOpen: next ? false : state.isEffectsPanelOpen,
        isPresentationsPanelOpen: next ? false : state.isPresentationsPanelOpen,
      };
    }),
  closePhotosPanel: () => set({ isPhotosPanelOpen: false }),
  favoriteElementCategories: null,
  setFavoriteElementCategories: (categories) => set({ favoriteElementCategories: categories }),

  isColorPanelOpen: false,
  toggleColorPanel: () =>
    set((state) => {
      const next = !state.isColorPanelOpen;
      return {
        isColorPanelOpen: next,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isDetailsPanelOpen: next ? false : state.isDetailsPanelOpen,
        isEffectsPanelOpen: next ? false : state.isEffectsPanelOpen,
        isPresentationsPanelOpen: next ? false : state.isPresentationsPanelOpen,
        isPhotosPanelOpen: next ? false : state.isPhotosPanelOpen,
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
        isEffectsPanelOpen: next ? false : state.isEffectsPanelOpen,
        isPresentationsPanelOpen: next ? false : state.isPresentationsPanelOpen,
        isPhotosPanelOpen: next ? false : state.isPhotosPanelOpen,
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
        isEffectsPanelOpen: next ? false : state.isEffectsPanelOpen,
        isPresentationsPanelOpen: next ? false : state.isPresentationsPanelOpen,
        isPhotosPanelOpen: next ? false : state.isPhotosPanelOpen,
      };
    }),
  closeBackgroundPanel: () => set({ isBackgroundPanelOpen: false }),

  isDetailsPanelOpen: false,
  toggleDetailsPanel: () =>
    set((state) => {
      const next = !state.isDetailsPanelOpen;
      return {
        isDetailsPanelOpen: next,
        isEffectsPanelOpen: next ? false : state.isEffectsPanelOpen,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isColorPanelOpen: next ? false : state.isColorPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isPresentationsPanelOpen: next ? false : state.isPresentationsPanelOpen,
        isPhotosPanelOpen: next ? false : state.isPhotosPanelOpen,
      };
    }),
  closeDetailsPanel: () => set({ isDetailsPanelOpen: false }),

  isEffectsPanelOpen: false,
  toggleEffectsPanel: () =>
    set((state) => {
      const next = !state.isEffectsPanelOpen;
      return {
        isEffectsPanelOpen: next,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isColorPanelOpen: next ? false : state.isColorPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isDetailsPanelOpen: next ? false : state.isDetailsPanelOpen,
        isPresentationsPanelOpen: next ? false : state.isPresentationsPanelOpen,
        isPhotosPanelOpen: next ? false : state.isPhotosPanelOpen,
      };
    }),
  closeEffectsPanel: () => set({ isEffectsPanelOpen: false }),

  isPresentationsPanelOpen: false,
  togglePresentationsPanel: () =>
    set((state) => {
      const next = !state.isPresentationsPanelOpen;
      return {
        isPresentationsPanelOpen: next,
        isElementsPanelOpen: next ? false : state.isElementsPanelOpen,
        isColorPanelOpen: next ? false : state.isColorPanelOpen,
        isBackgroundPanelOpen: next ? false : state.isBackgroundPanelOpen,
        isDetailsPanelOpen: next ? false : state.isDetailsPanelOpen,
        isEffectsPanelOpen: next ? false : state.isEffectsPanelOpen,
        isPhotosPanelOpen: next ? false : state.isPhotosPanelOpen,
      };
    }),
  closePresentationsPanel: () => set({ isPresentationsPanelOpen: false }),

  dragOverContainerId: null,
  setDragOverContainerId: (containerId) => set({ dragOverContainerId: containerId }),

  elementDragGhosts: [],
  setElementDragGhosts: (ghosts) => set({ elementDragGhosts: ghosts }),

  snapGuides: null,
  setSnapGuides: (guides) => set({ snapGuides: guides }),
}));

// Set while undo/redo swaps the presentation (or withoutHistory runs), so the subscription below doesn't
// record that as a new edit.
let skipHistory = false;
let lastPresentationChangeAt = 0;

/**
 * Runs a presentation change that isn't the user's own edit — like fitting a box to its drawing when it
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

/** Puts an older/newer presentation back, dropping any selection that points at things that no longer exist. */
function restorePresentation(presentation: Presentation, history: Pick<EditorState, "past" | "future">) {
  const { selectedSlideId, selectedElementIds } = useEditorStore.getState();
  const slide = presentation.slides.find((s) => s.id === selectedSlideId) ?? presentation.slides[0];

  skipHistory = true;
  useEditorStore.setState({
    presentation,
    ...history,
    selectedSlideId: slide.id,
    selectedElementIds: selectedElementIds.filter((id) => slide.elements.some((el) => el.id === id)),
  });
  skipHistory = false;
  // The next edit after an undo/redo always starts its own step.
  lastPresentationChangeAt = 0;
}

// Every presentation change goes through here, so each action gets undo for free. Only the first change of
// a quick burst saves the old presentation; the rest of the burst joins that same step.
useEditorStore.subscribe((state, prev) => {
  if (state.presentation === prev.presentation || skipHistory) return;

  const now = Date.now();
  const startsNewStep = now - lastPresentationChangeAt > HISTORY_GROUP_MS;
  lastPresentationChangeAt = now;
  if (!startsNewStep) return;

  useEditorStore.setState({ past: [...state.past, prev.presentation].slice(-MAX_HISTORY), future: [] });
});
