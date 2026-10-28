import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { PhotoThumbnail } from "@/components/editor/PhotoTile";
import { getAccount } from "@/lib/account";
import { formatBytes, formatDate, joinParts, slideCountLabel } from "@/lib/format";
import { SUBMISSION_LABELS, type SubmissionStatus } from "@/lib/submissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProfilePhotoPart } from "./ProfilePhotoPart";

/**
 * Admin → Editors → one editor, view only, to check their work: the presentations they made (with what happened
 * when they submitted them to QuizMatter), the QuizMatter presentations they reviewed, and the photos they uploaded.
 * Their profile photo is the one thing an admin can change here (Remove photo).
 * Uses the secret key, like the list.
 */
export default async function AdminEditorPage({ params }: PageProps<"/admin/editors/[id]">) {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const admin = createAdminClient();
  if (!admin) {
    return <Empty>This page needs the secret key SUPABASE_SECRET_KEY on the server.</Empty>;
  }

  const [user, editor, settings, profilePhoto, presentations, submissions, published, rounds, photos, shared] = await Promise.all([
    admin.auth.admin.getUserById(id),
    admin.from("editors").select("added_at").eq("user_id", id).maybeSingle(),
    admin.from("user_settings").select("display_name").eq("user_id", id).maybeSingle(),
    admin.from("profile_photos").select("src").eq("user_id", id).maybeSingle(),
    // Not shared copies, like their own lists.
    admin
      .from("presentations")
      .select("id, title, updated_at, slides(count)")
      .eq("owner_id", id)
      .is("shared_from", null)
      .order("updated_at", { ascending: false }),
    admin.from("presentation_submissions").select("id, presentation_id, title, status, copy_id").eq("submitter_id", id),
    // Published reviews stay in "Reviewed by" for good.
    admin.from("presentation_reviewers").select("presentation_id, reviewed_on, presentations(title)").eq("reviewer_id", id),
    // presentation_reviews keeps only each presentation's latest round, so an older canceled one is gone.
    admin
      .from("presentation_reviews")
      .select("presentation_id, status, admin_note, canceled_by_admin, started_at, submitted_at, ended_at, presentations(title)")
      .eq("reviewer_id", id)
      .in("status", ["reviewing", "submitted", "canceled"]),
    admin.from("photos").select("id, src, width, height, created_at").eq("user_id", id).order("created_at", { ascending: false }),
    // Their uploads also become shared photos (file name, category, tags, …) held by them (uploaded_by), found by
    // their id rather than by every photo's address. A file someone else shared first stays that person's.
    admin
      .from("shared_photos_search")
      .select("src, file_name, description, tags, source, category_name, bytes, is_public")
      .eq("uploaded_by", id),
  ]);
  for (const result of [editor, settings, profilePhoto, presentations, submissions, published, rounds, photos, shared]) {
    if (result.error) throw result.error;
  }
  // Not an editor (or the account is gone) = not found.
  if (!editor.data || user.error || !user.data.user) notFound();

  const photoRows = photos.data ?? [];

  const email = user.data.user.email ?? "";
  const name = (settings.data?.display_name as string | null) ?? "";
  const presentationRows = buildPresentationRows(
    (presentations.data ?? []) as unknown as OwnPresentation[],
    (submissions.data ?? []) as Submission[],
  );
  const reviewRows = buildReviewRows(
    (published.data ?? []) as unknown as PublishedReview[],
    (rounds.data ?? []) as unknown as ReviewRound[],
  );
  const sharedBySrc = new Map((shared.data as SharedInfo[]).map((info) => [info.src, info]));

  const publishedCount = reviewRows.filter((row) => row.status === "published").length;
  const canceledCount = reviewRows.filter((row) => row.status === "canceled").length;

  return (
    <>
      <Link
        href="/admin/editors"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary"
      >
        <ChevronLeftIcon size={16} />
        Editors
        <LinkPending />
      </Link>

      <header className="mb-5">
        <h2 className="text-base font-extrabold text-text-primary">{name || email}</h2>
        <p className="mt-0.5 text-sm text-text-secondary">
          {joinParts([name && email, `Editor since ${formatDate(Date.parse(editor.data.added_at as string))}`])}
        </p>
      </header>

      <PartLabel>Profile photo</PartLabel>
      <ProfilePhotoPart userId={id} src={(profilePhoto.data?.src as string | undefined) ?? ""} />

      <PartLabel className="mt-6">Presentations ({presentationRows.length})</PartLabel>
      {presentationRows.length === 0 ? (
        <Empty>No presentations yet.</Empty>
      ) : (
        <Table columns={["Presentation", "Slides", "Submitted to QuizMatter", "Last changed"]}>
          {presentationRows.map((row) => (
            <tr key={row.key} className="border-b border-border-default last:border-b-0">
              <td className="max-w-80 px-5 py-3">
                <TitleLink id={row.id} title={row.title} />
                {row.copyId && (
                  <Link href={`/presentation/${row.copyId}`} className="text-[13px] text-accent hover:underline">
                    See it in QuizMatter
                    <LinkPending />
                  </Link>
                )}
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-text-secondary">
                {row.slideCount === null ? "—" : slideCountLabel(row.slideCount)}
              </td>
              <td className="px-3 py-3">
                {row.submission ? (
                  <Pill className={SUBMISSION_LABELS[row.submission].className}>{SUBMISSION_LABELS[row.submission].label}</Pill>
                ) : (
                  <span className="text-text-secondary">Not submitted</span>
                )}
              </td>
              <td className="px-5 py-3 whitespace-nowrap text-text-secondary">{row.updated ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}

      <PartLabel className="mt-6">
        {`Reviews (${joinParts([`${publishedCount} published`, `${canceledCount} canceled`])})`}
      </PartLabel>
      {reviewRows.length === 0 ? (
        <Empty>No reviews yet.</Empty>
      ) : (
        <Table columns={["Presentation", "Result", "Date"]}>
          {reviewRows.map((row) => {
            const label = reviewLabel(row);
            return (
              <tr key={`${row.status}-${row.presentationId}`} className="border-b border-border-default last:border-b-0">
                <td className="max-w-80 px-5 py-3">
                  <TitleLink id={row.presentationId} title={row.title} />
                </td>
                <td className="px-3 py-3">
                  <Pill className={label.className}>{label.label}</Pill>
                </td>
                <td className="px-5 py-3 whitespace-nowrap text-text-secondary">
                  {row.date === null ? "—" : formatDate(row.date)}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <PartLabel className="mt-6">Photos ({photoRows.length})</PartLabel>
      {photoRows.length === 0 ? (
        <Empty>No photos uploaded yet.</Empty>
      ) : (
        <Table columns={["", "File name", "Category", "Description", "Tags", "Source", "Size", "Status", "Uploaded"]}>
          {photoRows.map((photo) => {
            const info = sharedBySrc.get(photo.src);
            return (
              <tr key={photo.id} className="border-b border-border-default align-middle last:border-b-0">
                <td className="py-2 pr-2 pl-5">
                  {/* The full photo, in a new tab. */}
                  <a
                    href={photo.src}
                    target="_blank"
                    rel="noreferrer"
                    className="block h-12 w-12 overflow-hidden rounded-dropdown border border-border-default bg-bg-page"
                  >
                    <PhotoThumbnail src={photo.src} alt={info?.description ?? ""} className="h-full w-full object-contain" />
                  </a>
                </td>
                {/* Their own uploads have no name: the stored file's name stands in. */}
                <td className="max-w-48 truncate px-3 py-2 text-text-primary">
                  {info?.file_name || photo.src.split("/").pop()}
                </td>
                <td className="px-3 py-2 text-text-secondary">{info?.category_name || "—"}</td>
                <td className="max-w-64 px-3 py-2 text-text-secondary">{info?.description || "—"}</td>
                <td className="max-w-48 px-3 py-2 text-text-secondary">{info?.tags.length ? info.tags.join(", ") : "—"}</td>
                <td className="max-w-48 truncate px-3 py-2 text-text-secondary">{info?.source || "—"}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {info?.bytes && <span className="block font-semibold text-text-primary">{formatBytes(info.bytes)}</span>}
                  <span className="text-text-secondary">
                    {photo.width}×{photo.height}
                  </span>
                </td>
                {/* Waiting = in Admin → Photos, but no teacher can see it until a live QuizMatter presentation uses it.
                    No shared copy of theirs (a JPEG, removed, or a file someone else shared first): the empty dash. */}
                <td className="px-3 py-2">
                  {!info ? (
                    <span className="text-text-secondary">—</span>
                  ) : info.is_public ? (
                    <Pill className="bg-success-soft text-success-strong">Public</Pill>
                  ) : (
                    <Pill className="bg-highlight-soft text-highlight-strong">Waiting</Pill>
                  )}
                </td>
                <td className="px-5 py-2 whitespace-nowrap text-text-secondary">{formatDate(Date.parse(photo.created_at))}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}

type OwnPresentation = { id: string; title: string; updated_at: string; slides: { count: number }[] };
type Submission = {
  id: string;
  presentation_id: string | null;
  title: string;
  status: SubmissionStatus;
  copy_id: string | null;
};
type PresentationRow = {
  key: string;
  // null = deleted (an approved submission outlives its original).
  id: string | null;
  title: string;
  slideCount: number | null;
  submission: SubmissionStatus | null;
  copyId: string | null;
  updated: string | null;
};

/** Their presentations with what happened to each one's submission, then approved ones whose original they deleted. */
function buildPresentationRows(presentations: OwnPresentation[], submissions: Submission[]): PresentationRow[] {
  const byPresentation = new Map(submissions.map((row) => [row.presentation_id, row]));
  return [
    ...presentations.map((p) => {
      const submission = byPresentation.get(p.id);
      return {
        key: p.id,
        id: p.id,
        title: p.title,
        slideCount: p.slides[0]?.count ?? 0,
        submission: submission?.status ?? null,
        copyId: submission?.status === "approved" ? submission.copy_id : null,
        updated: formatDate(Date.parse(p.updated_at)),
      };
    }),
    ...submissions
      .filter((row) => row.presentation_id === null)
      .map((row) => ({
        key: row.id,
        id: null,
        title: row.title,
        slideCount: null,
        submission: row.status,
        copyId: row.copy_id,
        updated: null,
      })),
  ];
}

type PublishedReview = { presentation_id: string; reviewed_on: string; presentations: { title: string } | null };
type ReviewRound = {
  presentation_id: string;
  status: "reviewing" | "submitted" | "canceled";
  admin_note: string | null;
  canceled_by_admin: boolean;
  started_at: string | null;
  submitted_at: string | null;
  ended_at: string | null;
  presentations: { title: string } | null;
};
type ReviewRow = {
  presentationId: string;
  title: string;
  status: "reviewing" | "submitted" | "canceled" | "published";
  isSentBack: boolean;
  canceledByAdmin: boolean;
  date: number | null;
};

/** Their published reviews and their latest open or canceled rounds, newest first. */
function buildReviewRows(published: PublishedReview[], rounds: ReviewRound[]): ReviewRow[] {
  const time = (value: string | null) => (value ? Date.parse(value) : null);
  return [
    ...published.map((row) => ({
      presentationId: row.presentation_id,
      title: row.presentations?.title ?? "",
      status: "published" as const,
      isSentBack: false,
      canceledByAdmin: false,
      date: time(row.reviewed_on),
    })),
    ...rounds.map((row) => ({
      presentationId: row.presentation_id,
      title: row.presentations?.title ?? "",
      status: row.status,
      isSentBack: row.status === "reviewing" && Boolean(row.admin_note),
      canceledByAdmin: row.canceled_by_admin,
      date: time(row.status === "canceled" ? row.ended_at : row.status === "submitted" ? row.submitted_at : row.started_at),
    })),
  ].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

// A review's label and color (like the editor's own Reviews table).
function reviewLabel(row: ReviewRow) {
  if (row.status === "published") return { label: "Published", className: "bg-success-soft text-success-strong" };
  if (row.status === "canceled") {
    return {
      label: row.canceledByAdmin ? "Canceled by QuizMatter" : "Canceled by editor",
      className: "bg-danger-soft text-danger-strong",
    };
  }
  if (row.status === "submitted") return { label: "Waiting for QuizMatter", className: "bg-bg-page text-text-secondary" };
  if (row.isSentBack) return { label: "Sent back", className: "bg-highlight-soft text-highlight-strong" };
  return { label: "Reviewing", className: "bg-accent-soft text-accent" };
}

type SharedInfo = {
  src: string;
  file_name: string;
  description: string;
  tags: string[];
  source: string;
  category_name: string;
  bytes: number | null;
  is_public: boolean;
};

function TitleLink({ id, title }: { id: string | null; title: string }) {
  if (!id) {
    return (
      <p className="truncate">
        <span className="font-semibold text-text-primary">{title || "Untitled presentation"}</span>
        <span className="text-text-secondary"> (original deleted)</span>
      </p>
    );
  }
  return (
    <Link href={`/presentation/${id}`} className="block truncate font-semibold text-text-primary hover:text-accent">
      {title || "Untitled presentation"}
      <LinkPending />
    </Link>
  );
}

function Table({ columns, children }: { columns: string[]; children: React.ReactNode }) {
  return (
    // Scrolls sideways on narrow phones instead of breaking the page.
    <div className="overflow-x-auto rounded-card border border-border-default bg-bg-surface">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
          <tr className="border-b border-border-default">
            {columns.map((column, i) => (
              <th key={i} className={`py-2.5 ${i === 0 ? "pl-5" : "pl-3"} ${i === columns.length - 1 ? "pr-5" : "pr-3"}`}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function PartLabel({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={`mb-2 text-xs font-bold tracking-[0.05em] text-text-header uppercase ${className}`}>{children}</h3>;
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center text-sm text-text-secondary">
      {children}
    </p>
  );
}
