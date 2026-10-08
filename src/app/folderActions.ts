"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { folderIdSchema, folderNameSchema, MAX_FOLDERS } from "@/lib/folders";
import { createClient } from "@/lib/supabase/server";

// A teacher's folders (see the folders migration). Each action checks its input with zod, saves, reloads the
// page's data, and returns what went wrong (null = saved). The database only lets a teacher touch their own.

// The presentations one move takes (the ones the teacher checked, or one from a card's ⋮ menu).
const presentationIdsSchema = z.array(z.string().min(1).max(100)).min(1).max(200);

/** What to tell the teacher when the database refused. */
function failure(error: { code?: string }): string {
  if (error.code === "23505") return "You already have a folder with that name.";
  if (error.code === "QMFLD") return `You have ${MAX_FOLDERS} folders, the most allowed. Delete one to make another.`;
  if (error.code === "QMBAN") return "Your account is blocked, so you can't change folders.";
  return "Couldn't save the folder. Please try again.";
}

/** Makes a folder, and moves presentations into it if `presentationIds` are given. Returns the new folder's id. */
export async function createFolder(name: string, presentationIds?: string[]): Promise<{ id: string } | { error: string }> {
  const parsed = folderNameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("folders").insert({ name: parsed.data }).select("id").single();
  if (error) return { error: failure(error) };
  const moveError = presentationIds ? await saveMove(presentationIds, data.id) : null;
  // The folder is made even if the move failed, so the page shows it either way.
  refresh();
  return moveError ? { error: moveError } : { id: data.id };
}

export async function renameFolder(id: string, name: string): Promise<string | null> {
  const folderId = folderIdSchema.safeParse(id);
  const parsed = folderNameSchema.safeParse(name);
  if (!folderId.success) return "Couldn't find that folder.";
  if (!parsed.success) return parsed.error.issues[0].message;
  const supabase = await createClient();
  const { error } = await supabase.from("folders").update({ name: parsed.data }).eq("id", folderId.data);
  if (error) return failure(error);
  refresh();
  return null;
}

/** Deletes a folder. Its presentations stay, in no folder (`on delete cascade` removes only their folder rows). */
export async function deleteFolder(id: string): Promise<string | null> {
  const folderId = folderIdSchema.safeParse(id);
  if (!folderId.success) return "Couldn't find that folder.";
  const supabase = await createClient();
  const { error } = await supabase.from("folders").delete().eq("id", folderId.data);
  if (error) return failure(error);
  refresh();
  return null;
}

/** Puts my presentations in one of my folders, or in none (`folderId` null). */
export async function moveToFolder(presentationIds: string[], folderId: string | null): Promise<string | null> {
  const error = await saveMove(presentationIds, folderId);
  if (!error) refresh();
  return error;
}

/** One database call for all of them, so they all move or none do. */
async function saveMove(presentationIds: string[], folderId: string | null): Promise<string | null> {
  const parsed = z.object({ ids: presentationIdsSchema, folderId: folderIdSchema.nullable() }).safeParse({ ids: presentationIds, folderId });
  if (!parsed.success) return "Couldn't move the presentations. Please try again.";
  const { ids } = parsed.data;
  const supabase = await createClient();
  const { error } = parsed.data.folderId
    ? await supabase.from("folder_items").upsert(
        ids.map((id) => ({ presentation_id: id, folder_id: parsed.data.folderId })),
        { onConflict: "presentation_id" }
      )
    : await supabase.from("folder_items").delete().in("presentation_id", ids);
  return error ? failure(error) : null;
}
