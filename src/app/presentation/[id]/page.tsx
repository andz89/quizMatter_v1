import { notFound } from "next/navigation";
import { fetchPresentation } from "@/lib/fetchPresentation";
import { usesPeopleArt } from "@/lib/peopleArt";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { PresentationPreview } from "./PresentationPreview";

/** A presentation to look at, not edit: mostly other teachers' published presentations (opened from the home page). */
export default async function PresentationPage({ params }: PageProps<"/presentation/[id]">) {
  const { id } = await params;
  const result = await fetchPresentation(id);
  // Someone else's private presentation is hidden by the database, so it looks like it doesn't exist.
  if (!result) notFound();

  return (
    <PeopleArtGate needed={usesPeopleArt(result.presentation.slides)}>
      <PresentationPreview
        presentation={result.presentation}
        isMine={result.isMine}
        publisherName={result.publisherName}
        isSaved={result.isSaved}
      />
    </PeopleArtGate>
  );
}
