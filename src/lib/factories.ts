import { createId } from "./id";
import { CANVAS_WIDTH, DEFAULT_QUESTION_HEIGHT } from "./constants";
import { DEFAULT_TEXT_COLOR } from "./richText";
import { SLIDE_EFFECT_SPEED_DEFAULT, type PresentationDetails, type Presentation, type Slide, type SlideType, type SvgElement } from "./schema";

// Where a new title slide's two text boxes go: centered, the title a bit above the middle.
// Claude's title slides (importPresentation) use the same spots.
const TITLE_SLIDE_MARGIN = 120;
const titleSlideRect = (y: number) => ({ x: TITLE_SLIDE_MARGIN, y, width: CANVAS_WIDTH - TITLE_SLIDE_MARGIN * 2, height: 120 });
export const TITLE_SLIDE_TITLE = { rect: titleSlideRect(220), fontSize: 72 };
export const TITLE_SLIDE_DESCRIPTION = { rect: titleSlideRect(370), fontSize: 36 };

/** A plain text box on the open slide (the same one the Elements panel adds). */
function titleSlideTextBox({ rect, fontSize }: typeof TITLE_SLIDE_TITLE, html: string): SvgElement {
  return { id: createId(), assetId: "text-box", ...rect, color: DEFAULT_TEXT_COLOR, containerId: null, text: { html, fontSize } };
}

export function createBlankSlide(type: SlideType = "choice"): Slide {
  // A title slide is a blank slide that starts with a title and a description; both can be edited,
  // moved or deleted like any other text box.
  const elements =
    type === "title"
      ? [
          titleSlideTextBox(TITLE_SLIDE_TITLE, '<p style="text-align: center"><strong>Title</strong></p>'),
          titleSlideTextBox(TITLE_SLIDE_DESCRIPTION, '<p style="text-align: center">Add a description here</p>'),
        ]
      : [];

  return {
    id: createId(),
    type,
    question: "",
    layout: "grid",
    options: [
      { id: createId(), text: type === "true-false" ? "True" : "" },
      { id: createId(), text: type === "true-false" ? "False" : "" },
      { id: createId(), text: "" },
      { id: createId(), text: "" },
    ],
    correctOptionId: null,
    correctAnswer: "",
    elements,
    questionHeight: DEFAULT_QUESTION_HEIGHT,
    // A custom question starts as 1 item; the teacher changes it in the slide toolbar.
    ...(type === "custom" && { itemCount: 1 }),
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

export function createBlankPresentation(details: Partial<PresentationDetails> = {}): Presentation {
  const now = Date.now();
  return {
    id: createId(),
    title: "Untitled presentation",
    description: "",
    grade: "",
    subject: "",
    curriculum: "",
    learningCompetency: "",
    author: "",
    referenceLinks: [],
    tags: [],
    transition: "slide",
    transitionSpeed: SLIDE_EFFECT_SPEED_DEFAULT,
    isPublished: false,
    fromAdmin: false,
    ...details,
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
