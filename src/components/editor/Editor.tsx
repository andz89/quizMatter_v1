"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { lastSaveOf, useEditorStore, waitForLeavingSave, type EditorReview } from "@/lib/store";
import { buildSlides } from "@/lib/importPresentation";
import { useEditorShortcuts } from "@/lib/useEditorShortcuts";
import { EditorTopBar } from "./EditorTopBar";
import { IconRail } from "./IconRail";
import { Workspace } from "./Workspace";
import { EditorBottomBar } from "./EditorBottomBar";
import { ElementsPanel } from "./ElementsPanel";
import { PhotosPanel } from "./PhotosPanel";
import { ColorPanel } from "./ColorPanel";
import { BackgroundPanel } from "./BackgroundPanel";
import { EffectsPanel } from "./EffectsPanel";
import { PresentationsPanel } from "./PresentationsPanel";
import { SmallScreenNote } from "./SmallScreenNote";
import { ReviewBanner } from "./ReviewControls";
import { SentBackBanner } from "./SentBackBanner";
import { ConfirmModal } from "./ConfirmModal";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import type { Presentation } from "@/lib/schema";
import type { SharedCopy } from "@/lib/sharing";
import type { SubmissionStatus } from "@/lib/submissions";

// Only downloaded the first time they're opened, so the editor itself loads faster. While one
// downloads, a dimmed screen with the spinner shows over the editor. Without `loading`, the whole
// page blanks to white for that moment.
const LoadingOverlay = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <Spinner />
  </div>
);
const SlideGridModal = dynamic(() => import("./SlideGridModal").then((mod) => mod.SlideGridModal), {
  loading: LoadingOverlay,
});
const PresentationView = dynamic(
  () => import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView),
  { loading: LoadingOverlay }
);

/**
 * `draft` is the slides recipe of a presentation Claude sent through the MCP server (see /presentation/new): its
 * slides replace the new presentation's sample slide, unsaved, like the Paste button does.
 * `review` opens an editor's review of someone else's QuizMatter presentation: saves go to their draft (see the
 * presentation_reviews migration).
 * `sentBackNote` is the admin's note on my presentation that QuizMatter sent back (see the quizmatter_submissions
 * migration), shown under the top bar.
 * `sharedCopy` is my presentation's shared copy, if it's published (see the shared_copy migration). `canPublish` is
 * false for editors: they send presentations to QuizMatter instead (see the shared_copy_moderation migration).
 * `submission` is my presentation's Submit to QuizMatter status, if it was ever sent (the Share card uses it).
 */
export function Editor({
  presentation,
  draft,
  review,
  sentBackNote,
  sharedCopy,
  canPublish = true,
  submission,
}: {
  presentation: Presentation;
  draft?: unknown;
  review?: EditorReview;
  sentBackNote?: string;
  sharedCopy?: SharedCopy | null;
  canPublish?: boolean;
  submission?: SubmissionStatus;
}) {
  // The page's presentation once the editor has opened it (below). Until then the Spinner shows, and the store still
  // holds the placeholder (or the last presentation opened).
  const [openedFrom, setOpenedFrom] = useState<Presentation | null>(null);
  // What was wrong in Claude's slides, shown in a box when its draft couldn't load.
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const isInStore = useEditorStore((s) => s.presentation.id === presentation.id);
  const hasUnsavedChanges = useEditorStore((s) => s.presentation !== s.savedPresentation);
  const isOutdated = useEditorStore((s) => s.isOutdated);
  const setOutdated = useEditorStore((s) => s.setOutdated);
  const keptInBrowser = useEditorStore((s) => s.keptInBrowser);
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const isGridViewOpen = useEditorStore((s) => s.isGridViewOpen);
  const isElementsPanelOpen = useEditorStore((s) => s.isElementsPanelOpen);
  const isPhotosPanelOpen = useEditorStore((s) => s.isPhotosPanelOpen);
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const isBackgroundPanelOpen = useEditorStore((s) => s.isBackgroundPanelOpen);
  const isEffectsPanelOpen = useEditorStore((s) => s.isEffectsPanelOpen);
  const isPresentationsPanelOpen = useEditorStore((s) => s.isPresentationsPanelOpen);
  const closeColorPanel = useEditorStore((s) => s.closeColorPanel);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const clearElementSelection = useEditorStore((s) => s.clearElementSelection);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const selectContainer = useEditorStore((s) => s.selectContainer);

  useEditorShortcuts();

  useEffect(() => {
    let isCurrent = true;
    // A presentation the editor just left may still be saving (saveBeforeLeaving): this opens after it, so the store
    // isn't replaced while it saves, and coming back to it opens what was saved.
    waitForLeavingSave().then(() => {
      if (!isCurrent) return;
      const store = useEditorStore.getState();
      // What a save in this tab saved, when it's newer than the page: a leave-save that ended after the page was
      // fetched, or browser Back/Forward showing the page as it first loaded. A Claude draft's page is always older
      // once it's saved with Save or Ctrl+S (opened fresh, it goes to the saved presentation instead).
      const saved = lastSaveOf(presentation.id, review !== undefined);
      const isSavedSince = saved !== null && (draft !== undefined || saved.savedAt > presentation.updatedAt);
      store.loadPresentation(isSavedSince ? saved.presentation : presentation);
      useEditorStore.setState({ review: review ?? null, sharedCopy: sharedCopy ?? null, canPublish, submission: submission ?? null });
      // Its save time, not its own updatedAt (the time of its last edit), so the next save doesn't conflict.
      if (isSavedSince) useEditorStore.setState({ savedAt: saved.savedAt });
      setOpenedFrom(presentation);
      // Unsaved work kept before an app update's reload, or when leaving couldn't save (see keptWork.ts), comes back
      // now. A Claude draft saved since (with Save or Ctrl+S; leaving doesn't save it) opens as the saved presentation.
      if (draft === undefined || isSavedSince) {
        store.restoreKeptWork();
        return;
      }

      // Show the presentation's own address instead of /presentation/new?draft=…, so a reload after saving opens the
      // saved presentation instead of another new copy.
      window.history.replaceState(null, "", `/presentation/${presentation.id}/edit`);
      const result = buildSlides(draft);
      if ("errors" in result) setDraftErrors(result.errors);
      else store.importSlides(result.slides);
      // Not in the database yet: its first save sends every slide, and fails if another tab saved it first. Claude's
      // draft as it opened (before kept work comes back), so leaving can tell whether it was changed.
      useEditorStore.setState((s) => ({ claudeDraft: s.presentation, savedAt: null }));
      // Changes kept when it was left (leaving keeps a changed draft instead of saving it) come back over Claude's
      // slides.
      store.restoreKeptWork();
    });
    return () => {
      isCurrent = false;
    };
    // A new presentation/draft/review object from the server (e.g. after router.refresh()) loads it again and
    // drops unsaved edits, so don't refresh the editor page while someone is editing.
  }, [presentation, draft, review, sharedCopy, canPublish, submission]);

  // Leaving the editor in the app (browser Back/Forward, a link, the ← arrow) saves first (saveBeforeLeaving; a Claude
  // draft not saved yet only keeps its changes in this browser). React's dev mode closes and opens the editor again
  // right after it opens: that isn't leaving, so the save checks a moment later that the editor isn't open again.
  const isOpenRef = useRef(false);
  useEffect(() => {
    isOpenRef.current = true;
    return () => {
      isOpenRef.current = false;
      useEditorStore.getState().saveBeforeLeaving(() => !isOpenRef.current);
    };
  }, []);

  // Closing or reloading the tab with unsaved changes makes the browser ask "Leave page?" first (a save can't finish
  // while the tab closes). Not after an app update refused a save: the work is kept once more right here (with edits
  // made since the box opened), and the reload gives it back. It asks only if that fails.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const { isOutdated, keepWorkNow } = useEditorStore.getState();
      if (!isOutdated || !keepWorkNow()) e.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // A file dropped outside the slide's drop spots would make the browser open it, leaving the editor.
  useEffect(() => {
    const ignoreFileDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", ignoreFileDrop);
    window.addEventListener("drop", ignoreFileDrop);
    return () => {
      window.removeEventListener("dragover", ignoreFileDrop);
      window.removeEventListener("drop", ignoreFileDrop);
    };
  }, []);

  // Clicking anywhere except a selected SVG element/toolbar or a selected container deselects them.
  useEffect(() => {
    if (selectedElementIds.length === 0 && selectedContainerId === null) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-svg-element], [data-element-toolbar], [data-container-id], [data-keep-container-selection]'))
        return;
      clearElementSelection();
      selectContainer(null);
      closeColorPanel();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [selectedElementIds, selectedContainerId, clearElementSelection, selectContainer, closeColorPanel]);

  if (!isInStore || openedFrom !== presentation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-page">
        <TopLoadingBar />
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <EditorTopBar />
      <ReviewBanner />
      {sentBackNote && <SentBackBanner note={sentBackNote} hint="Save your changes, then submit it again from Share." />}
      <div className="relative flex flex-1 overflow-hidden">
        <IconRail />
        {/* On laptops and bigger, an open panel sits beside the slides. On smaller screens it opens over them
            (next to the icon rail) and is kept narrower than the screen, so the slide isn't squeezed. */}
        <div className="absolute inset-y-0 left-24 z-30 flex max-w-[calc(100%-6rem)] max-lg:[&>*]:max-w-full lg:static lg:max-w-none">
          {isElementsPanelOpen && <ElementsPanel />}
          {isPhotosPanelOpen && <PhotosPanel />}
          {isColorPanelOpen && <ColorPanel />}
          {isBackgroundPanelOpen && <BackgroundPanel />}
          {isEffectsPanelOpen && <EffectsPanel />}
          {isPresentationsPanelOpen && <PresentationsPanel />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Workspace />
          <EditorBottomBar />
        </div>
      </div>
      <SmallScreenNote />
      {isGridViewOpen && <SlideGridModal />}
      {isPresenting && <PresentationView />}
      {draftErrors.length > 0 && (
        <Modal title="Couldn't load the slides from Claude" onClose={() => setDraftErrors([])}>
          <ul className="list-disc space-y-1 pl-4 text-sm text-text-primary">
            {draftErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </Modal>
      )}
      {isOutdated && (
        <ConfirmModal
          title="QuizMatter was updated"
          message={
            keptInBrowser
              ? "Reload to keep editing. Your changes are safe."
              : "Couldn't keep your changes in this browser. Copy anything you need before reloading."
          }
          confirmLabel="Reload"
          // It opens by itself after a save, maybe while the teacher is still typing.
          autoFocus={false}
          // The reload keeps the work once more, with edits made since the box opened (see "Leave page?" above).
          onConfirm={() => window.location.reload()}
          // The work stays kept; the next save asks again.
          onCancel={() => setOutdated(false)}
        />
      )}
    </div>
  );
}
