import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";

// Shown while the Browse page counts the presentations.
export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <TopLoadingBar />
      <Spinner size={32} />
    </div>
  );
}
