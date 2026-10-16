import { z } from "zod";
import { REFUSALS, SaveRefusedError } from "./presentations";
import { createClient } from "./supabase/client";

// A teacher's shared copy: what other teachers see once it's published (see the shared_copy migration).
// `sharedAt`: when it was last copied from the original (Unix ms).
export type SharedCopy = { id: string; sharedAt: number };

const idSchema = z.string().min(1).max(100);
const sharedCopySchema = z.object({ id: z.string(), sharedAt: z.number() });

// A known refusal becomes its message; any other error keeps its code and details (e.g. a QMBLK click-limit pause).
function refused(error: { code: string; message: string; details: string }): Error {
  return REFUSALS[error.code] ? new SaveRefusedError(REFUSALS[error.code]) : Object.assign(new Error(error.message), error);
}

/** Publish, or "Update shared presentation": copies my saved presentation to its shared copy. */
export async function shareCopy(id: string): Promise<SharedCopy> {
  const { data, error } = await createClient().rpc("share_presentation", { target_id: idSchema.parse(id) });
  if (error) throw refused(error);
  return sharedCopySchema.parse(data);
}

/** Private: removes the shared copy. */
export async function unshareCopy(id: string): Promise<void> {
  const { error } = await createClient().rpc("unshare_presentation", { target_id: idSchema.parse(id) });
  if (error) throw refused(error);
}
