import { z } from "zod";

// Same limits as the folders migration (20261028000000_folders.sql), which checks them again.
export const FOLDER_NAME_MAX = 60;
export const MAX_FOLDERS = 50;

export const folderNameSchema = z
  .string()
  .trim()
  .min(1, "Type a name for the folder.")
  .max(FOLDER_NAME_MAX, `A folder name can have at most ${FOLDER_NAME_MAX} characters.`);

export const folderIdSchema = z.uuid();

/** One of a teacher's folders, with how many of their presentations are in it. */
export type Folder = { id: string; name: string; count: number };
