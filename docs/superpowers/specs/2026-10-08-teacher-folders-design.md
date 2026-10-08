# Teacher folders (Part 4 of presentation categories)

## Goal

A teacher sorts their **own** presentations into folders ("Week 3", "Grade 4 – Fractions"). Folders are personal:
nobody else sees them. Bookmarked (Saved) and QuizMatter presentations don't go in folders.
An admin's personal presentations get folders like anyone's.

## Decisions

- **One folder per presentation** (or none), like files on a computer. No folders inside folders.
- **Own tables, not a column on `presentations`:** moving a presentation isn't an edit of it, so it works while the
  presentation is locked for a review (`QMREV`) and never makes an open editor tab hit "saved somewhere else"
  (`QM409`).

## Database (`supabase/migrations/20261028000000_folders.sql`)

- `folders`: `id` (uuid), `owner_id` (default `auth.uid()`), `name` (1–60 characters, trimmed), `created_at`.
  A teacher's folder names are unique (ignoring case). At most 50 folders per teacher, and none for banned
  teachers (trigger; error `QMFLD` = too many).
- `folder_items`: `presentation_id` (primary key: one folder each), `folder_id`, `owner_id`. Deleting a folder
  or a presentation deletes its rows (`on delete cascade`); the presentations of a deleted folder stay, with no
  folder.
- RLS: a teacher reads and changes only their own rows, and may only put their own presentation in their own
  folder.

## App

- `src/lib/folders.ts`: `FOLDER_NAME_MAX`, `MAX_FOLDERS`, `folderNameSchema`, the `Folder` type.
- `src/app/folderActions.ts` (server actions, zod first): `createFolder(name)`, `renameFolder(id, name)`,
  `deleteFolder(id)`, `moveToFolder(presentationId, folderId | null)`. Each returns an error message or null and
  refreshes the page.
- Home page (`page.tsx` loads the folders and items; my cards get `folderId`):
  - "My presentations", not searching: the presentations in no folder (first 5, then "See all", as before), then
    under a "FOLDERS" label the **folder tiles** (icon, name, count) and a **"+ New folder"** tile.
  - A tile opens the folder in the tab: "← My presentations / name", all its cards, and a ⋮ menu with Rename and
    Delete folder (asks first; its presentations are kept). The subject chips filter what's showing.
  - While searching: no tiles, just the matches.
  - Card ⋮ → **"Move to folder…"** (not for Claude's unsaved drafts): a box listing "No folder", the folders,
    and a field to make a new folder and move there.
  - New UI is in `src/app/MyFolders.tsx`.
- **Drag and drop** (`@dnd-kit/core`, already used by the editor; no new package): in "My presentations" (not
  searching), a saved card can be dragged onto a folder tile, or onto "← My presentations" inside a folder to take
  it out. The spot glows violet while a card is over it, shows the Spinner while it saves (`moveToFolder`, zod
  first), then a toast. Mouse: starts after 4px; touch: after a ¼-second press and hold, so swipes still scroll.
  A copy of the card follows the pointer (`DragOverlay`), centered on it (`snapCenterToCursor`), while the card
  fades. The folder the copy overlaps most is the drop spot (`rectIntersection`), since people aim the copy. A drop never also opens the card's
  link. Claude's drafts can't be dragged. The ⋮ menu's "Move to folder…" stays.
- **Several at once:** no circles on the cards normally. Two ways to pick saved cards in "My presentations":
  **Shift+click** picks one card instead of opening it (each Shift+click adds or removes one), or the **"Select
  multiple"** button turns on select mode, where a normal click picks a card; the button then says "Done" (ends it
  and un-picks all). The button is on the right of a row between the folders and the cards; while cards are
  picked, the row's left shows "N selected · Clear · Move to folder…". While selecting (select mode, or Shift+click
  picks), a round circle shows in each card's top-left corner (violet with ✓ when picked); un-picking every
  Shift+click pick hides them. Dragging a picked card drags all the picked ones (the copy says "N
  presentations"); an unpicked card goes alone. Only cards on screen count. Picks and select mode end after a move
  and when the shown cards change (opening or leaving a folder, another tab, a new search). Touch screens have no
  Shift, so they use the button. `moveToFolder(ids, folderId)` takes
  1–200 ids (zod) and saves them in one database call, so they all move or none do.
- "All my presentations" (`/presentations`): a **Folder** column and a folder filter (All folders / No folder /
  each folder).
- Every save shows a sonner toast on success and failure, and the Spinner while it works. Lucide icons only.

## Checking

`npx tsc --noEmit`, lint on the changed files, and reading the diff against this spec. The migration is left for
the user to push; live testing too.
