"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { deleteDrafts, getDraft, type Draft } from "@/lib/drafts";
import { fetchPresentation } from "@/lib/fetchPresentation";
import type { Presentation } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";

const idsSchema = z.array(z.string().min(1).max(100)).max(200);

/**
 * Deletes my saved presentations (their slides go with them — `on delete cascade`) and discards Claude's
 * drafts (only my own), then reloads the list. The "Own presentations" policy only lets the owner delete, so other
 * teachers' presentations can't be removed. Returns false if anything failed, so the page can tell the user.
 */
export async function removePresentations(presentationIds: string[], draftIds: string[]): Promise<boolean> {
  const presentations = idsSchema.safeParse(presentationIds);
  const drafts = idsSchema.safeParse(draftIds);
  if (!presentations.success || !drafts.success) return false;

  try {
    if (presentations.data.length > 0) {
      const supabase = await createClient();
      const { error } = await supabase.from("presentations").delete().in("id", presentations.data);
      if (error) throw error;
    }
    await deleteDrafts(drafts.data, (await getAccount()).id);
  } catch {
    return false;
  } finally {
    refresh();
  }
  return true;
}

/**
 * Removes Claude's draft once the user has saved it as a presentation (it took the draft's id). Then Claude's
 * next send can't update a draft nobody can open anymore: it gets a new draft with a new link instead.
 */
export async function finishDraft(id: string) {
  await deleteDrafts([z.uuid().parse(id)], (await getAccount()).id);
}

/** A whole saved presentation with its slides, so the home page can present it. null if it can't be read. */
export async function getPresentation(id: string): Promise<Presentation | null> {
  if (!z.string().min(1).max(100).safeParse(id).success) return null;
  try {
    return (await fetchPresentation(id))?.presentation ?? null;
  } catch {
    return null;
  }
}

/**
 * Claude's draft (details + slides recipe), so the home page can present it. The slides are built in
 * the browser, like the editor does (building them needs react-dom/server, which server code can't use).
 */
export async function getDraftPresentation(id: string): Promise<Draft | null> {
  if (!z.string().min(1).max(100).safeParse(id).success) return null;
  try {
    return await getDraft(id, (await getAccount()).id);
  } catch {
    return null;
  }
}
