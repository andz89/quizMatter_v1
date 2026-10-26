import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import { DataCheckList } from "./DataCheckList";

/**
 * Admin → Data check: finds saved presentations and review drafts that today's code can't open (see actions.ts).
 * The check only runs when asked, so opening the page stays quick.
 */
export default async function AdminDataCheckPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isSuperAdmin) notFound();

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
        <h2 className="text-[15px] font-extrabold text-text-primary">Can every saved presentation still open?</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Run this before deploying a change to how presentations or slides are saved: start the app on your computer
          (<code>npm run dev</code>), open this page, and fix <code>upgradeSlide</code> / <code>upgradePresentation</code>{" "}
          in <code>src/lib/schema.ts</code> until nothing is listed. It only reads.
        </p>
      </section>
      <DataCheckList />
    </div>
  );
}
