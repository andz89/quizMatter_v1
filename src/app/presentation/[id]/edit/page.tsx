import { notFound, redirect } from "next/navigation";
import { fetchPresentation } from "@/lib/fetchPresentation";
import { PresentationEditor } from "./PresentationEditor";

export default async function PresentationPage({ params }: PageProps<"/presentation/[id]/edit">) {
  const { id } = await params;
  const result = await fetchPresentation(id);
  // Also covers someone else's private presentation: the database hides it, so it looks like it doesn't exist.
  if (!result) notFound();
  // Someone else's published presentation can be viewed, not edited (saving it would be refused anyway).
  if (!result.isMine) redirect(`/presentation/${id}`);

  return <PresentationEditor presentation={result.presentation} />;
}
