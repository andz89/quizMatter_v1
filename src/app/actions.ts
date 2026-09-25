"use server";

import { refresh } from "next/cache";
import { deleteDraft } from "@/lib/drafts";

/** Deletes a quiz Claude sent that the user doesn't want, then reloads the quiz list. */
export async function discardDraft(id: string) {
  await deleteDraft(id);
  refresh();
}
