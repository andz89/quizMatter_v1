"use client";

import { useState } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, MouseSensor, rectIntersection, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { toast } from "sonner";
import type { Folder } from "@/lib/folders";
import { LinkPending } from "@/components/LinkPending";
import type { PresentationCardData } from "../PresentationCard";
import { DraggedCards, FolderHeader, FolderTiles, MoveToFolderModal, SelectRow, folderDropId, movedMessage } from "../MyFolders";
import { moveToFolder } from "../folderActions";
import { Cards, PartLabel, PresentingView, SubjectChips, subjectChip } from "./CardGrid";

// How many of my newest cards show ("See all" opens the rest on /presentations).
const MY_ROW_SIZE = 5;

// My own cards have no bookmark.
const NO_SAVED_IDS = new Set<string>();

/**
 * My presentations (the "/" page): my newest cards and Claude's drafts, my folders, dragging cards into folders, and
 * picking several to move at once.
 */
export function MyPresentations({
  myCards,
  folders,
}: {
  // My presentations and Claude's drafts; `folderId` says which of my folders each one is in.
  myCards: PresentationCardData[];
  folders: Folder[];
}) {
  // The picked subject chip ("" = All).
  const [subject, setSubject] = useState("");
  const ofSubject = (cards: PresentationCardData[]) =>
    subject === "" ? cards : cards.filter((card) => subjectChip(card.subject ?? "") === subject);

  // An open folder's cards, or (with the folder tiles below) those in no folder.
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  // A deleted folder is gone from `folders`, so the page goes back to the tiles by itself.
  const openFolder = folders.find((folder) => folder.id === openFolderId);
  // The cards the Move to folder box is open for (one from a card's ⋮ menu, or the checked ones).
  const [movingCards, setMovingCards] = useState<PresentationCardData[] | null>(null);
  // Picking several of my cards: "Select multiple" turns select mode on (a click then picks a card), or a Shift+click
  // picks one. Picks and select mode end after a move, and when the shown cards change (folder).
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const clearChecked = () => setCheckedIds(new Set());
  const endSelecting = () => {
    clearChecked();
    setIsSelectMode(false);
  };
  const toggleChecked = (id: string) =>
    setCheckedIds((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Dragging a card onto a folder tile (or onto "← My presentations", to take it out of its folder). Mouse: after
  // moving 4px, like the editor; touch: after pressing and holding, so a quick swipe still scrolls the page.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );
  // The cards being dragged: a checked card takes every checked one along; an unchecked one goes alone.
  const [draggedCards, setDraggedCards] = useState<PresentationCardData[]>([]);
  // The folder dropped cards are being moved to ("" = out of their folder), which shows the Spinner.
  const [movingTo, setMovingTo] = useState<string | null>(null);

  const myShown = myCards.filter((card) => card.folderId === openFolder?.id);
  const mine = openFolder ? ofSubject(myShown) : ofSubject(myShown).slice(0, MY_ROW_SIZE);
  // Only cards on screen count, so a chip or folder never moves something hidden.
  const checkedCards = mine.filter((card) => checkedIds.has(card.id));
  // The circles show in select mode, or while Shift+click picks are there.
  const isSelecting = isSelectMode || checkedCards.length > 0;

  const startDrag = ({ active }: DragStartEvent) => {
    const card = active.data.current?.card as PresentationCardData | undefined;
    if (card) setDraggedCards(checkedIds.has(card.id) ? checkedCards : [card]);
  };
  const dropCards = async ({ over }: DragEndEvent) => {
    const folderId = [{ id: "" }, ...folders].find(({ id }) => folderDropId(id) === over?.id)?.id;
    // Ones already in that folder stay as they are.
    const cards = draggedCards.filter((card) => (card.folderId ?? "") !== folderId);
    setDraggedCards([]);
    if (folderId === undefined || cards.length === 0) return;
    setMovingTo(folderId);
    const error = await moveToFolder(
      cards.map((card) => card.id),
      folderId || null
    );
    setMovingTo(null);
    if (error) toast.error(error);
    else {
      toast.success(movedMessage(cards.length, folders.find(({ id }) => id === folderId)?.name));
      endSelecting();
    }
  };

  return (
    <DndContext
      sensors={sensors}
      // The card's copy sits centered on the pointer, and the folder it overlaps most is where it drops (people aim
      // the copy, not the mouse). Set here, not on the DragOverlay, so the drop check uses the same spot.
      modifiers={[snapCenterToCursor]}
      collisionDetection={rectIntersection}
      onDragStart={startDrag}
      onDragCancel={() => setDraggedCards([])}
      onDragEnd={dropCards}
    >
      {myCards.length > 0 && (
        <div className="mb-4 flex justify-end">
          <Link href="/presentations" className="text-sm font-semibold text-text-primary hover:underline">
            See all ({myCards.length})
            <LinkPending />
          </Link>
        </div>
      )}

      {openFolder && (
        <FolderHeader
          folder={openFolder}
          isMovingOut={movingTo === ""}
          onBack={() => {
            setOpenFolderId(null);
            endSelecting();
          }}
        />
      )}

      <SubjectChips cards={myShown} picked={subject} onPick={setSubject} />

      <section className="mb-10">
        {mine.length > 0 && (
          <SelectRow
            count={checkedCards.length}
            isSelecting={isSelecting}
            onStart={() => setIsSelectMode(true)}
            onDone={endSelecting}
            onClear={clearChecked}
            onMove={() => setMovingCards(checkedCards)}
          />
        )}
        <Cards
          cards={mine}
          showMenu
          onMoveToFolder={(card) => setMovingCards([card])}
          selection={{ checkedIds, isSelecting, onToggle: toggleChecked }}
          canDrag={movingTo === null}
          fadedIds={new Set(draggedCards.map((card) => card.id))}
          empty={
            openFolder
              ? "This folder is empty. To add a presentation, open its ⋮ menu and pick “Move to folder…”."
              : myCards.length > 0
                ? "All your presentations are in folders."
                : "No presentations yet. Click “+ New presentation” to make one, or ask Claude to send you one."
          }
          savedIds={NO_SAVED_IDS}
          onSavedChange={() => {}}
        />
        {!openFolder && (
          <>
            <PartLabel className="mt-8">Folders</PartLabel>
            <FolderTiles
              folders={folders}
              movingTo={movingTo}
              onOpen={(id) => {
                setOpenFolderId(id);
                setSubject("");
                endSelecting();
              }}
            />
          </>
        )}
      </section>

      {movingCards && (
        <MoveToFolderModal cards={movingCards} folders={folders} onMoved={endSelecting} onClose={() => setMovingCards(null)} />
      )}
      <PresentingView />
      <DragOverlay dropAnimation={null}>{draggedCards.length > 0 && <DraggedCards cards={draggedCards} />}</DragOverlay>
    </DndContext>
  );
}
