import { create } from "zustand";
import { createBlankQuiz, createBlankSlide, duplicateSlide as cloneSlide } from "./factories";
import { createId } from "./id";
import { DEFAULT_ELEMENT_COLOR, DEFAULT_ELEMENT_SIZE } from "./svgLibrary";
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

/** Applies `updater` to the one slide matching `slideId` and bumps the quiz's updatedAt — the shape every mutation below needs. */
function updateSlide(quiz: Quiz, slideId: string, updater: (slide: Slide) => Slide): Quiz {
  return {
    ...quiz,
    slides: quiz.slides.map((s) => (s.id === slideId ? updater(s) : s)),
    updatedAt: Date.now(),
  };
}

interface EditorState {
  quiz: Quiz;
  selectedSlideId: string;
  zoom: number;

  selectSlide: (slideId: string) => void;
  addSlide: (afterSlideId?: string) => void;
  deleteSlide: (slideId: string) => void;
  duplicateSlide: (slideId: string) => void;
  reorderSlides: (fromId: string, toId: string) => void;

  updateQuestion: (slideId: string, text: string) => void;
  setQuestionHeight: (slideId: string, height: number) => void;
  updateOption: (slideId: string, optionId: string, text: string) => void;
  setCorrectOption: (slideId: string, optionId: string) => void;
  reorderOptions: (slideId: string, fromOptionId: string, toOptionId: string) => void;

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
  selectElement: (slideId: string, elementId: string, additive?: boolean) => void;
  selectElements: (elementIds: string[]) => void;
  clearElementSelection: () => void;

  selectedContainerId: string | null;
  selectContainer: (containerId: string | null, slideId?: string) => void;

  addElement: (slideId: string, assetId: string, containerId?: string | null) => void;
  updateElement: (slideId: string, elementId: string, patch: Partial<Omit<SvgElement, "id" | "assetId">>) => void;
  deleteElement: (slideId: string, elementId: string) => void;
  duplicateElement: (slideId: string, elementId: string) => string | undefined;

  // `containerId` on the clipboard entry is where each element was copied from — pasting via
  // keyboard (no target given) puts it back there; pasting via the context menu targets wherever
  // was right-clicked instead.
  clipboard: SvgElement[] | null;
  copySelectedElements: () => void;
  pasteClipboard: (slideId: string, containerId?: string | null) => void;

  isElementsPanelOpen: boolean;
  toggleElementsPanel: () => void;
  closeElementsPanel: () => void;
}

const initialQuiz = createBlankQuiz();

export const useEditorStore = create<EditorState>((set, get) => ({
  quiz: initialQuiz,
  selectedSlideId: initialQuiz.slides[0].id,
  zoom: 1,

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

  updateQuestion: (slideId, text) => {
    const { quiz } = get();
    set({ quiz: updateSlide(quiz, slideId, (s) => ({ ...s, question: text })) });
  },

  setQuestionHeight: (slideId, height) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const clamped = Math.min(MAX_QUESTION_HEIGHT, Math.max(MIN_QUESTION_HEIGHT, height));
    if (clamped === slide.questionHeight) return;

    // Bound elements store absolute pixel coordinates. Only the containers' height changes here
    // (their width is always fixed), so only rescale y/height — x/width must stay untouched or
    // the element drifts horizontally for no reason.
    const questionScale = clamped / slide.questionHeight;
    const optionScale = getOptionContainerHeight(clamped) / getOptionContainerHeight(slide.questionHeight);

    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        questionHeight: clamped,
        elements: s.elements.map((el) => {
          if (el.containerId === null) return el;
          const scale = el.containerId === QUESTION_CONTAINER_ID ? questionScale : optionScale;
          return { ...el, y: el.y * scale, height: el.height * scale };
        }),
      })),
    });
  },

  updateOption: (slideId, optionId, text) => {
    const { quiz } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({
        ...s,
        options: s.options.map((o) => (o.id === optionId ? { ...o, text } : o)) as typeof s.options,
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
    const { selectedElementIds } = get();
    if (!additive) {
      set({ selectedSlideId: slideId, selectedElementIds: [elementId] });
      return;
    }
    set({
      selectedSlideId: slideId,
      selectedElementIds: selectedElementIds.includes(elementId)
        ? selectedElementIds.filter((id) => id !== elementId)
        : [...selectedElementIds, elementId],
    });
  },
  selectElements: (elementIds) => set({ selectedElementIds: elementIds }),
  clearElementSelection: () => set({ selectedElementIds: [] }),

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

  addElement: (slideId, assetId, containerId = null) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    const bounds = getContainerBounds(containerId, slide?.questionHeight ?? 0);
    const size = containerId === null ? DEFAULT_ELEMENT_SIZE : Math.min(56, bounds.width, bounds.height);
    const element: SvgElement = {
      id: createId(),
      assetId,
      x: (bounds.width - size) / 2,
      y: (bounds.height - size) / 2,
      width: size,
      height: size,
      color: DEFAULT_ELEMENT_COLOR,
      containerId,
    };
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({ ...s, elements: [...s.elements, element] })),
      selectedElementIds: [element.id],
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
  },

  deleteElement: (slideId, elementId) => {
    const { quiz, selectedElementIds } = get();
    set({
      quiz: updateSlide(quiz, slideId, (s) => ({ ...s, elements: s.elements.filter((el) => el.id !== elementId) })),
      selectedElementIds: selectedElementIds.filter((id) => id !== elementId),
    });
  },

  duplicateElement: (slideId, elementId) => {
    const { quiz } = get();
    const slide = quiz.slides.find((s) => s.id === slideId);
    const original = slide?.elements.find((el) => el.id === elementId);
    if (!slide || !original) return undefined;

    const OFFSET = 20;
    const bounds = getContainerBounds(original.containerId, slide.questionHeight);
    const copy: SvgElement = {
      ...original,
      id: createId(),
      x: Math.min(bounds.width - original.width, original.x + OFFSET),
      y: Math.min(bounds.height - original.height, original.y + OFFSET),
    };

    set({ quiz: updateSlide(quiz, slideId, (s) => ({ ...s, elements: [...s.elements, copy] })) });

    return copy.id;
  },

  clipboard: null,

  copySelectedElements: () => {
    const { quiz, selectedSlideId, selectedElementIds } = get();
    if (selectedElementIds.length === 0) return;

    const slide = quiz.slides.find((s) => s.id === selectedSlideId);
    const elements = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
    if (elements.length === 0) return;

    set({ clipboard: elements });
  },

  pasteClipboard: (slideId, containerId) => {
    const { quiz, clipboard } = get();
    if (!clipboard) return;
    const slide = quiz.slides.find((s) => s.id === slideId);
    if (!slide) return;

    const OFFSET = 20;
    const pasted = clipboard.map((el) => {
      const targetContainerId = containerId !== undefined ? containerId : el.containerId;
      const bounds = getContainerBounds(targetContainerId, slide.questionHeight);
      return {
        ...el,
        id: createId(),
        containerId: targetContainerId,
        x: Math.min(bounds.width - el.width, el.x + OFFSET),
        y: Math.min(bounds.height - el.height, el.y + OFFSET),
      };
    });

    set({
      quiz: updateSlide(quiz, slideId, (s) => ({ ...s, elements: [...s.elements, ...pasted] })),
      selectedSlideId: slideId,
      selectedElementIds: pasted.map((el) => el.id),
    });
  },

  isElementsPanelOpen: false,
  toggleElementsPanel: () => set((state) => ({ isElementsPanelOpen: !state.isElementsPanelOpen })),
  closeElementsPanel: () => set({ isElementsPanelOpen: false }),
}));
