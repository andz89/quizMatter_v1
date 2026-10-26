import { z } from "zod";
import { SaveRefusedError, refusalFromCode } from "./presentations";
import { createClient } from "./supabase/client";

// A teacher's shared copy: what other teachers see once it's published (see the shared_copy migration).
// `sharedAt`: when it was last copied from the original (Unix ms). `isHidden`: an admin hid it from other teachers.
export type SharedCopy = { id: string; sharedAt: number; isHidden: boolean };

const idSchema = z.string().min(1).max(100);
const sharedCopySchema = z.object({ id: z.string(), sharedAt: z.number() });

// A known refusal becomes its message. "Not allowed" (42501) from these functions already says why in plain words
// (e.g. "QuizMatter hid the shared copy…"). Any other error keeps its code and details (e.g. a QMBLK pause).
function refused(error: { code: string; message: string; details: string }): Error {
  const refusal = refusalFromCode(error.code);
  if (refusal) return refusal;
  if (error.code === "42501") return new SaveRefusedError(error.message);
  return Object.assign(new Error(error.message), error);
}

/**
 * Publish, or "Update shared presentation": copies my saved presentation to its shared copy. An admin's hide
 * stays on an updated copy, so `isHidden` is kept by the caller.
 */
export async function shareCopy(id: string): Promise<Omit<SharedCopy, "isHidden">> {
  const { data, error } = await createClient().rpc("share_presentation", { target_id: idSchema.parse(id) });
  if (error) throw refused(error);
  return sharedCopySchema.parse(data);
}

/** Private: removes the shared copy. */
export async function unshareCopy(id: string): Promise<void> {
  const { error } = await createClient().rpc("unshare_presentation", { target_id: idSchema.parse(id) });
  if (error) throw refused(error);
}
