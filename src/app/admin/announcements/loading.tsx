import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";

// Shown while the announcements (and the form's pages inside this folder) load.
export default function Loading() {
  return (
    <div className="flex justify-center py-16">
      <TopLoadingBar />
      <Spinner size={32} />
    </div>
  );
}
