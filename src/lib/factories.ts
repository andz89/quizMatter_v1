import { createId } from "./id";
import { DEFAULT_QUESTION_HEIGHT } from "./constants";
import type { Quiz, Slide, SlideType } from "./schema";

export function createBlankSlide(type: SlideType = "choice"): Slide {
  return {
    id: createId(),
    type,
    question: "",
    layout: "grid",
    options: [
      { id: createId(), text: "" },
      { id: createId(), text: "" },
      { id: createId(), text: "" },
      { id: createId(), text: "" },
    ],
    correctOptionId: null,
    correctAnswer: "",
    elements: [],
    questionHeight: DEFAULT_QUESTION_HEIGHT,
  };
}

function createSampleSlide(): Slide {
  const options = [
    { id: createId(), text: "Jupiter" },
    { id: createId(), text: "Venus" },
    { id: createId(), text: "Mars" },
    { id: createId(), text: "Saturn" },
  ] as Slide["options"];

  return {
    id: createId(),
    question: "Which planet is the largest in our solar system?",
    layout: "grid",
    options,
    correctOptionId: options[0].id,
    elements: [],
    questionHeight: DEFAULT_QUESTION_HEIGHT,
  };
}

export function createBlankQuiz(title = "Untitled lesson"): Quiz {
  const now = Date.now();
  return {
    id: createId(),
    title,
    slides: [createSampleSlide()],
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicateSlide(slide: Slide): Slide {
  const correctIndex = slide.options.findIndex((option) => option.id === slide.correctOptionId);
  const options = slide.options.map((option) => ({ ...option, id: createId() })) as Slide["options"];

  // Option ids are regenerated above, so elements bound to an option must be repointed to its new id.
  const optionIdMap = new Map(slide.options.map((option, index) => [option.id, options[index].id]));

  return {
    ...slide,
    id: createId(),
    options,
    correctOptionId: correctIndex === -1 ? null : options[correctIndex].id,
    elements: slide.elements.map((element) => ({
      ...element,
      id: createId(),
      containerId: element.containerId && optionIdMap.has(element.containerId)
        ? optionIdMap.get(element.containerId)!
        : element.containerId,
    })),
  };
}
