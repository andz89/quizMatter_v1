"use client";

import { useEffect, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import {
  ELEMENT_EFFECTS,
  ELEMENT_EFFECT_LABELS,
  SLIDE_EFFECT_SPEED_DEFAULT,
  SLIDE_EFFECT_SPEED_MAX,
  SLIDE_EFFECT_SPEED_MIN,
  SLIDE_TRANSITIONS,
  SLIDE_TRANSITION_LABELS,
  type ElementEffectType,
  type Slide,
} from "@/lib/schema";
import { canHaveElementEffects, effectSteps } from "@/lib/elementEffects";
import { PanelLabel } from "./PanelControls";
import { elementName } from "./LayersPanel";
import { GripVerticalIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";

const VERTICAL_ONLY = [restrictToVerticalAxis];
const POINTER_OPTIONS = { activationConstraint: { distance: 4 } };
const NO_IDS: string[] = [];

type Tab = "slide" | "element";

/**
 * Sidebar panel for effects while presenting full screen, in two tabs. Slide effects: how every slide comes in (one
 * for the whole presentation). Element effects: on a blank or title slide, picked elements come in one click at a
 * time, in the order listed. Both count as unsaved changes until Save.
 */
export function EffectsPanel() {
  const closeEffectsPanel = useEditorStore((s) => s.closeEffectsPanel);
  const [tab, setTab] = useState<Tab>("slide");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPanelEscape(e)) closeEffectsPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeEffectsPanel]);

  return (
    <div
      data-keep-container-selection="true"
      className="flex shrink-0 flex-col gap-6 overflow-y-auto border-r border-border-default bg-bg-surface side-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold text-text-primary">Effects</h2>
        <button
          type="button"
          onClick={closeEffectsPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <XIcon size={16} />
        </button>
      </div>

      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-button border border-border-default bg-bg-page p-1">
        {(
          [
            ["slide", "Slide effects"],
            ["element", "Element effects"],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded-dropdown border px-2 py-2 text-center text-sm font-semibold transition-colors ${
              tab === value ? "border-accent bg-accent-soft text-accent" : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === "slide" ? <SlideEffectsTab /> : <ElementEffectsTab />}
    </div>
  );
}

/** One effect choice as a card; the picked one shows `children` (its speed) under it. */
function EffectChoice({ label, selected, onPick, children }: { label: string; selected: boolean; onPick: () => void; children?: React.ReactNode }) {
  return (
    <div className={`rounded-button border transition-colors ${selected ? "border-accent bg-accent-soft" : "border-border-default hover:bg-bg-page"}`}>
      <button
        type="button"
        onClick={() => {
          if (!selected) onPick();
        }}
        className={`w-full px-4 py-3 text-left text-sm font-semibold ${selected ? "text-accent" : "text-text-primary"}`}
      >
        {label}
      </button>
      {selected && children}
    </div>
  );
}

/** Speed 1–5 (slow to fast): − / slider / +. Shared by both tabs. */
function SpeedControl({ value, onChange }: { value: number; onChange: (speed: number) => void }) {
  const set = (speed: number) => {
    const clamped = Math.min(SLIDE_EFFECT_SPEED_MAX, Math.max(SLIDE_EFFECT_SPEED_MIN, speed));
    if (clamped !== value) onChange(clamped);
  };
  const stepClass =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-dropdown border border-border-default bg-bg-surface text-text-primary enabled:hover:bg-bg-page disabled:opacity-40";
  return (
    <div className="flex flex-col gap-1.5 px-4 pb-3">
      <span className="flex justify-between text-xs font-semibold uppercase tracking-[0.05em] text-text-header">
        Speed
        <span className="font-normal normal-case tracking-normal text-text-secondary">
          {value} of {SLIDE_EFFECT_SPEED_MAX}
        </span>
      </span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => set(value - 1)} disabled={value <= SLIDE_EFFECT_SPEED_MIN} title="Slower" className={stepClass}>
          <MinusIcon size={14} />
        </button>
        <input
          type="range"
          min={SLIDE_EFFECT_SPEED_MIN}
          max={SLIDE_EFFECT_SPEED_MAX}
          step={1}
          value={value}
          onChange={(e) => set(Number(e.target.value))}
          aria-label="Speed"
          className="min-w-0 flex-1 accent-[var(--accent)]"
        />
        <button type="button" onClick={() => set(value + 1)} disabled={value >= SLIDE_EFFECT_SPEED_MAX} title="Faster" className={stepClass}>
          <PlusIcon size={14} />
        </button>
      </div>
      <div className="flex justify-between px-9 text-xs text-text-secondary">
        <span>Slow</span>
        <span>Fast</span>
      </div>
    </div>
  );
}

function SlideEffectsTab() {
  const setPresentationDetails = useEditorStore((s) => s.setPresentationDetails);
  const transition = useEditorStore((s) => s.presentation.transition);
  const transitionSpeed = useEditorStore((s) => s.presentation.transitionSpeed);

  return (
    <section className="flex flex-col gap-3">
      <PanelLabel>Slide effect</PanelLabel>
      <p className="text-xs text-text-secondary">How every slide comes in when you present full screen.</p>
      {SLIDE_TRANSITIONS.map((effect) => (
        <EffectChoice
          key={effect}
          label={SLIDE_TRANSITION_LABELS[effect]}
          selected={effect === transition}
          onPick={() => setPresentationDetails({ transition: effect })}
        >
          {/* "None" has nothing to speed up. */}
          {effect !== "none" && <SpeedControl value={transitionSpeed} onChange={(speed) => setPresentationDetails({ transitionSpeed: speed })} />}
        </EffectChoice>
      ))}
    </section>
  );
}

function ElementEffectsTab() {
  const slide = useEditorStore((s) => s.presentation.slides.find((sl) => sl.id === s.selectedSlideId));
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const setElementEffect = useEditorStore((s) => s.setElementEffect);

  if (!slide) return null;
  if (!canHaveElementEffects(slide)) {
    return <p className="text-sm text-text-secondary">Element effects work on Blank and Title slides.</p>;
  }

  const picked = slide.elements.filter((e) => selectedIds.includes(e.id));
  // The picked elements' shared effect; mixed or none shows None.
  const first = picked[0]?.effect;
  const shared = first && picked.every((e) => e.effect?.type === first.type) ? first : undefined;
  const speed = shared && picked.every((e) => e.effect?.speed === shared.speed) ? shared.speed : SLIDE_EFFECT_SPEED_DEFAULT;
  const ids = picked.map((e) => e.id);
  const pick = (type: ElementEffectType | null) => setElementEffect(slide.id, ids, type);

  return (
    <>
      <section className="flex flex-col gap-3">
        <PanelLabel>Element effect</PanelLabel>
        <p className="text-xs text-text-secondary">While presenting, each click shows the next element with an effect.</p>
        {picked.length === 0 ? (
          <p className="text-sm text-text-secondary">Pick a picture or text on the slide to give it an effect.</p>
        ) : (
          <>
            <EffectChoice label="None" selected={!shared && !picked.some((e) => e.effect)} onPick={() => pick(null)} />
            {ELEMENT_EFFECTS.map((type) => (
              <EffectChoice key={type} label={ELEMENT_EFFECT_LABELS[type]} selected={shared?.type === type} onPick={() => pick(type)}>
                <SpeedControl value={speed} onChange={(next) => setElementEffect(slide.id, ids, type, next)} />
              </EffectChoice>
            ))}
          </>
        )}
      </section>
      <EffectSteps slide={slide} />
    </>
  );
}

/** "On this slide": the steps in the order they come in. Click = select, drag = reorder, ✕ = no effect. */
function EffectSteps({ slide }: { slide: Slide }) {
  const moveElementEffect = useEditorStore((s) => s.moveElementEffect);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_OPTIONS));
  const steps = effectSteps(slide);
  if (steps.length === 0) return null;
  const keys = steps.map((ids) => ids[0]);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    moveElementEffect(slide.id, keys.indexOf(String(active.id)), keys.indexOf(String(over.id)));
  };

  return (
    <section className="flex flex-col gap-2">
      <PanelLabel>On this slide</PanelLabel>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={VERTICAL_ONLY} onDragEnd={handleDragEnd}>
        <SortableContext items={keys} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-2">
            {steps.map((ids, i) => (
              <StepRow key={keys[i]} id={keys[i]} number={i + 1} slide={slide} ids={ids} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function StepRow({ id, number, slide, ids }: { id: string; number: number; slide: Slide; ids: string[] }) {
  const selectElements = useEditorStore((s) => s.selectElements);
  const setElementEffect = useEditorStore((s) => s.setElementEffect);
  const selectedIds = useEditorStore((s) => (s.selectedSlideId === slide.id ? s.selectedElementIds : NO_IDS));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const elements = slide.elements.filter((e) => ids.includes(e.id));
  const isGroup = !!elements[0]?.groupId && elements.every((e) => e.groupId === elements[0].groupId);
  const name = isGroup ? `Group · ${elements.length} items` : elements.map((e) => elementName(e)).join(", ");
  const effect = elements[0]?.effect;
  const isSelected = ids.every((i) => selectedIds.includes(i));

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-button border px-2 py-2 ${isDragging ? "z-10" : ""} ${
        isSelected ? "border-accent bg-accent-soft" : "border-border-default bg-bg-surface hover:bg-bg-page"
      }`}
    >
      <span {...attributes} {...listeners} title="Drag to change the order" className="flex cursor-grab text-text-secondary">
        <GripVerticalIcon size={16} />
      </span>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-dropdown bg-accent text-[11px] font-bold text-white">{number}</span>
      <button type="button" onClick={() => selectElements(ids)} className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm font-semibold text-text-primary">{name}</span>
        {effect && <span className="text-xs text-text-secondary">{ELEMENT_EFFECT_LABELS[effect.type]}</span>}
      </button>
      <button
        type="button"
        onClick={() => setElementEffect(slide.id, ids, null)}
        title="Remove effect"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-dropdown text-text-secondary hover:bg-danger-soft hover:text-danger-strong"
      >
        <XIcon size={14} />
      </button>
    </li>
  );
}
