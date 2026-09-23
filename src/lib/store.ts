import { create } from "zustand";
import type { Editor } from "@tiptap/react";
import { createBlankQuiz, createBlankSlide, duplicateSlide as cloneSlide } from "./factories";
import { createId } from "./id";
import { DEFAULT_ELEMENT_COLOR, DEFAULT_ELEMENT_SIZE, getElementAsset, type RenderSettings } from "./svgLibrary";
import {
  getContainerBounds,
  getOptionContainerHeight,
  MIN_QUESTION_HEIGHT,
  MAX_QUESTION_HEIGHT,
  QUESTION_CONTAINER_ID,
} from "./constants";
import type { Quiz, Slide, SvgElement } from "./schema";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

const MAX_HISTORY = 100;
// Quiz changes closer together than this count as one undo step (a whole drag, a typed word).
const HISTORY_GROUP_MS = 500;

/** Applies `updater` to the one slide matching `slideId` and bumps the quiz's updatedAt — the shape every mutation below needs. */
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

interface EditorState {
  quiz: Quiz;
  // Undo/redo history of the quiz content only (not selection, zoom or open panels). Filled
  // automatically by the store subscription at the bottom of this file.
  past: Quiz[];
  future: Quiz[];
  undo: () => void;
  redo: () => void;
  selectedSlideId: string;
  zoom: number;

  selectSlide: (slideId: string) => void;
  addSlide: (afterSlideId?: string) => void;
  deleteSlide: (slideId: string) => void;
  duplicateSlide: (slideId: string) => void;
  reorderSlides: (fromId: string, toId: string) => void;

  updateQuestion: (slideId: string, text: string, html: string) => void;
  setQuestionHeight: (slideId: string, height: number) => void;
  updateOption: (slideId: string, optionId: string, text: string, html: string) => void;
  setCorrectOption: (slideId: string, optionId: string) => void;
  reorderOptions: (slideId: string, fromOptionId: string, toOptionId: string) => void;
  shuffleOptions: (slideId: string) => void;
  // Empties the question, every option's text and all elements; keeps the correct answer and layout.
  clearSlide: (slideId: string) => void;

  setQuizTitle: (title: string) => void;

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

  selectedElementIds: string[];
  // Clicking a grouped element selects its whole group.
  selectElement: (slideId: string, elementId: string, additive?: boolean) => void;
  selectElements: (elementIds: string[]) => void;
  clearElementSelection: () => void;
  // Group needs 2+ selected elements in the same box. Both act on the current slide's selection.
  groupSelectedElements: () => void;
  ungroupSelectedElements: () => void;

  selectedContainerId: string | null;
  selectContainer: (containerId: string | null, slideId?: string) => void;

  // The text editor the user is typing in right now, so the header can show its format toolbar.
  activeTextEditor: Editor | null;
  setActiveTextEditor: (editor: Editor | null) => void;

  // `position`, when given, is the exact drop point (in the container's own coordinate space) to
  // center the new element on, instead of the container's center.
  addElement: (slideId: string, assetId: string, containerId?: string | null, position?: { x: number; y: number }) => void;
  // Most-recently-inserted asset ids first, for the Elements panel's "Recently used" row.
  recentElementAssetIds: string[];
  updateElement: (slideId: string, elementId: string, patch: Partial<Omit<SvgElement, "id" | "assetId">>) => void;
  deleteElement: (slideId: string, elementId: string) => void;
  // Returns the copies' ids. Copies of a whole group form a new group of their own.
  duplicateElements: (slideId: string, elementIds: string[]) => string[];
  // Removes every element bound to one box (the question or an option).
  clearContainerElements: (slideId: string, containerId: string) => void;

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

  // Only one of the Elements/Color sidebar panels is shown at a time.
  isColorPanelOpen: boolean;
  toggleColorPanel: () => void;
  closeColorPanel: () => void;

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
}

const initialQuiz = createBlankQuiz();

export const useEditorStore = create<EditorState>((set, get) => ({
  quiz: initialQuiz,
  past: [],
  future: [],

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
    set({ selectedSlideId: slideId, selectedElementIds: [], selectedContainerId: null }),

  addSlide: (afterSlideId) => {
    const slide = createBlankSlide();
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

  updateQuestion: (slideId, text, html) => {
    const { quiz } = get();
    set({ quiz: updateSlide(quiz, slideId, (s) => ({ ...s, question: text, questionHtml: html })) });
  },

  setQuestionHeight: (slideId, height) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const clamped = Math.min(MAX_QUESTION_HEIGHT, Math.max(MIN_QUESTION_HEIGHT, height));
    if (clamped === slide.questionHeight) return;

    // Bound elements store absolute pixel coordinates. The containers' width never changes, only
    // their height, so x (the left edge) stays untouched — but width has to scale together with
    // height, by the same factor, or a shrinking/growing box would squish square icons into
    // rectangles (they'd then shrink-to-fit and re-center inside their own box when drawn,
    // leaving a gap between the visible icon and its actual corner/resize handle).
    const questionScale = clamped / slide.questionHeight;
    const optionScale = getOptionContainerHeight(clamped) / getOptionContainerHeight(slide.questionHeight);

    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        questionHeight: clamped,
        elements: s.elements.map((el) => {
          if (el.containerId === null) return el;
          const scale = el.containerId === QUESTION_CONTAINER_ID ? questionScale : optionScale;
          const width = el.width * scale;
          // A wider element may now reach past the box's right edge, so pull it back inside.
          const maxX = Math.max(0, getContainerBounds(el.containerId, clamped).width - width);
          return { ...el, x: Math.min(el.x, maxX), y: el.y * scale, height: el.height * scale, width };
        }),
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
        elements: [],
      })),
      selectedElementIds: selectedElementIds.filter((id) => !slide.elements.some((el) => el.id === id)),
    });
  },

  setQuizTitle: (title) => {
    const { quiz } = get();
    set({ quiz: { ...quiz, title, updatedAt: Date.now() } });
  },

  zoomIn: () => set((state) => ({ zoom: Math.min(MAX_ZOOM, +(state.zoom + ZOOM_STEP).toFixed(2)) })),
  zoomOut: () => set((state) => ({ zoom: Math.max(MIN_ZOOM, +(state.zoom - ZOOM_STEP).toFixed(2)) })),
  resetZoom: () => set({ zoom: 1 }),
  setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),

  isPresenting: false,
  presentationIndex: 0,

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
  // With every slide visible at once (scrollable workspace), selecting a container on any slide
  // must also make that slide the "current" one — otherwise toolbars/inserts would act on a
  // different, merely-scrolled-past slide.
  selectContainer: (containerId, slideId) =>
    set((state) => ({
      selectedContainerId: containerId,
      selectedElementIds: [],
      selectedSlideId: slideId ?? state.selectedSlideId,
    })),

  activeTextEditor: null,
  // Leaving a text box with no shape selected closes the color panel — nothing is left for it to color.
  setActiveTextEditor: (editor) =>
    set((state) => ({
      activeTextEditor: editor,
      isColorPanelOpen: editor || state.selectedElementIds.length > 0 ? state.isColorPanelOpen : false,
    })),

  addElement: (slideId, assetId, containerId = null, position) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    const bounds = getContainerBounds(containerId, slide?.questionHeight ?? 0);
    const asset = getElementAsset(assetId);
    // 3D solids are drawn smaller inside their square (so they still fit when rotated), so they
    // start 30% bigger to look the same size as flat elements.
    const boxSize = asset?.is3d ? 124 : 95;
    const square = containerId === null ? DEFAULT_ELEMENT_SIZE : boxSize;
    // Wide assets (number lines) start at their own size; everything else starts square.
    const wanted = asset?.defaultSize ?? { width: square, height: square };
    // Inside a box, shrink evenly (keeping the shape) if it doesn't fit.
    const scale = containerId === null ? 1 : Math.min(1, bounds.width / wanted.width, bounds.height / wanted.height);
    const width = wanted.width * scale;
    const height = wanted.height * scale;
    const x = position ? Math.min(bounds.width - width, Math.max(0, position.x - width / 2)) : (bounds.width - width) / 2;
    const y = position ? Math.min(bounds.height - height, Math.max(0, position.y - height / 2)) : (bounds.height - height) / 2;
    const element: SvgElement = {
      id: createId(),
      assetId,
      x,
      y,
      width,
      height,
      color: asset?.defaultColor ?? DEFAULT_ELEMENT_COLOR,
      containerId,
    };
    const { recentElementAssetIds } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({ ...s, elements: [...s.elements, element] })),
      selectedElementIds: [element.id],
      recentElementAssetIds: [assetId, ...recentElementAssetIds.filter((id) => id !== assetId)].slice(0, 8),
    });
  },

  updateElement: (slideId, elementId, patch) => {
    const { quiz } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        elements: s.elements.map((el) => (el.id === elementId ? { ...el, ...patch } : el)),
      })),
    });
    // Taking an element out of its group may leave one member behind on its own.
    if ("groupId" in patch) {
      set({ quiz: updateSlide(get().quiz, slideId, (s) => ({ ...s, elements: dropLoneGroups(s.elements) })) });
    }
  },

  deleteElement: (slideId, elementId) => {
    const { quiz, selectedElementIds } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        elements: dropLoneGroups(s.elements.filter((el) => el.id !== elementId)),
      })),
      selectedElementIds: selectedElementIds.filter((id) => id !== elementId),
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
          const bounds = getContainerBounds(original.containerId, slide.questionHeight);
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

  clipboard: null,

  copySelectedElements: () => {
    const { quiz, selectedSlideId, selectedElementIds } = get();
    if (selectedElementIds.length === 0) return;

    const slide = quiz.slides.find((s) => s.id === selectedSlideId);
    const elements = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
    if (elements.length === 0) return;

    // Forget any previously clicked box, so a plain Ctrl+V puts each element back in the box it
    // was copied from — clicking a box after copying still aims the paste there.
    set({ clipboard: elements, selectedContainerId: null });
  },

  clearClipboard: () => set({ clipboard: null }),

  pasteClipboard: (slideId, containerId) => {
    const { quiz, clipboard } = get();
    if (!clipboard) return;
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const OFFSET = 20;
    const pasted = giveCopiesNewGroups(clipboard).map((el) => {
      const targetContainerId = containerId !== undefined ? containerId : el.containerId;
      const bounds = getContainerBounds(targetContainerId, slide.questionHeight);
      // Pasting into a smaller box — shrink evenly (keeping the shape) so it fits.
      const scale = Math.min(1, bounds.width / el.width, bounds.height / el.height);
      const width = el.width * scale;
      const height = el.height * scale;
      return {
        ...el,
        id: createId(),
        containerId: targetContainerId,
        width,
        height,
        x: Math.max(0, Math.min(bounds.width - width, el.x + OFFSET)),
        y: Math.max(0, Math.min(bounds.height - height, el.y + OFFSET)),
      };
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
      return { isElementsPanelOpen: next, isColorPanelOpen: next ? false : state.isColorPanelOpen };
    }),
  closeElementsPanel: () => set({ isElementsPanelOpen: false }),

  isColorPanelOpen: false,
  toggleColorPanel: () =>
    set((state) => {
      const next = !state.isColorPanelOpen;
      return { isColorPanelOpen: next, isElementsPanelOpen: next ? false : state.isElementsPanelOpen };
    }),
  closeColorPanel: () => set({ isColorPanelOpen: false }),

  dragOverContainerId: null,
  setDragOverContainerId: (containerId) => set({ dragOverContainerId: containerId }),

  elementDragGhosts: [],
  setElementDragGhosts: (ghosts) => set({ elementDragGhosts: ghosts }),
}));

// Set while undo/redo swaps the quiz, so the subscription below doesn't record that as a new edit.
let isRestoring = false;
let lastQuizChangeAt = 0;

/** Puts an older/newer quiz back, dropping any selection that points at things that no longer exist. */
function restoreQuiz(quiz: Quiz, history: Pick<EditorState, "past" | "future">) {
  const { selectedSlideId, selectedElementIds } = useEditorStore.getState();
  const slide = quiz.slides.find((s) => s.id === selectedSlideId) ?? quiz.slides[0];

  isRestoring = true;
  useEditorStore.setState({
    quiz,
    ...history,
    selectedSlideId: slide.id,
    selectedElementIds: selectedElementIds.filter((id) => slide.elements.some((el) => el.id === id)),
  });
  isRestoring = false;
  // The next edit after an undo/redo always starts its own step.
  lastQuizChangeAt = 0;
}

// Every quiz change goes through here, so each action gets undo for free. Only the first change of
// a quick burst saves the old quiz; the rest of the burst joins that same step.
useEditorStore.subscribe((state, prev) => {
  if (state.quiz === prev.quiz || isRestoring) return;

  const now = Date.now();
  const startsNewStep = now - lastQuizChangeAt > HISTORY_GROUP_MS;
  lastQuizChangeAt = now;
  if (!startsNewStep) return;

  useEditorStore.setState({ past: [...state.past, prev.quiz].slice(-MAX_HISTORY), future: [] });
});
