import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";

// Shown while the Submissions pages load (the list, and one presentation with all its slides).
export default function Loading() {
  return (
    <div className="flex justify-center py-16">
      <TopLoadingBar />
      <Spinner size={32} />
    </div>
  );
}
