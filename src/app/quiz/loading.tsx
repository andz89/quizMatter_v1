import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";

// Shown while a quiz (saved or Claude's draft) loads.
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-page">
      <TopLoadingBar />
      <Spinner size={32} />
    </div>
  );
}
