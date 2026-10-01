"use client";

import { useEffect } from "react";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { SLIDE_TRANSITIONS, SLIDE_TRANSITION_LABELS, SLIDE_EFFECT_SPEED_MIN, SLIDE_EFFECT_SPEED_MAX } from "@/lib/schema";
import { PanelLabel } from "./PanelControls";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";

/**
 * Sidebar panel for the slide effect: how each slide comes in when the presentation is shown full screen. One
 * effect for the whole presentation (every slide); it counts as an unsaved change until Save.
 */
export function EffectsPanel() {
  const closeEffectsPanel = useEditorStore((s) => s.closeEffectsPanel);
  const setPresentationDetails = useEditorStore((s) => s.setPresentationDetails);
  const transition = useEditorStore((s) => s.presentation.transition);
  const transitionSpeed = useEditorStore((s) => s.presentation.transitionSpeed);
  const setSpeed = (speed: number) => {
    const clamped = Math.min(SLIDE_EFFECT_SPEED_MAX, Math.max(SLIDE_EFFECT_SPEED_MIN, speed));
    if (clamped !== transitionSpeed) setPresentationDetails({ transitionSpeed: clamped });
  };

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
      className="flex w-72 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border-default bg-bg-surface p-5"
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

      <section className="flex flex-col gap-3">
        <PanelLabel>Slide effect</PanelLabel>
        <p className="text-xs text-text-secondary">How every slide comes in when you present full screen.</p>
        {SLIDE_TRANSITIONS.map((effect) => {
          const selected = effect === transition;
          return (
            <div
              key={effect}
              className={`rounded-button border transition-colors ${
                selected ? "border-accent bg-accent-soft" : "border-border-default hover:bg-bg-page"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (!selected) setPresentationDetails({ transition: effect });
                }}
                className={`w-full px-4 py-3 text-left text-sm font-semibold ${selected ? "text-accent" : "text-text-primary"}`}
              >
                {SLIDE_TRANSITION_LABELS[effect]}
              </button>

              {/* The speed of the picked effect, right under it. "None" has nothing to speed up. */}
              {selected && effect !== "none" && (
                <div className="flex flex-col gap-1.5 px-4 pb-3">
                  <span className="flex justify-between text-xs font-semibold uppercase tracking-[0.05em] text-text-header">
                    Speed
                    <span className="font-normal normal-case tracking-normal text-text-secondary">
                      {transitionSpeed} of {SLIDE_EFFECT_SPEED_MAX}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSpeed(transitionSpeed - 1)}
                      disabled={transitionSpeed <= SLIDE_EFFECT_SPEED_MIN}
                      title="Slower"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-dropdown border border-border-default bg-bg-surface text-text-primary enabled:hover:bg-bg-page disabled:opacity-40"
                    >
                      <MinusIcon size={14} />
                    </button>
                    <input
                      type="range"
                      min={SLIDE_EFFECT_SPEED_MIN}
                      max={SLIDE_EFFECT_SPEED_MAX}
                      step={1}
                      value={transitionSpeed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                      aria-label="Speed"
                      className="min-w-0 flex-1 accent-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => setSpeed(transitionSpeed + 1)}
                      disabled={transitionSpeed >= SLIDE_EFFECT_SPEED_MAX}
                      title="Faster"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-dropdown border border-border-default bg-bg-surface text-text-primary enabled:hover:bg-bg-page disabled:opacity-40"
                    >
                      <PlusIcon size={14} />
                    </button>
                  </div>
                  <div className="flex justify-between px-9 text-xs text-text-secondary">
                    <span>Slow</span>
                    <span>Fast</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
