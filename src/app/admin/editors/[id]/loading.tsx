import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";

// Shown while an editor's profile opens.
export default function Loading() {
  return (
    <div className="flex justify-center py-16">
      <TopLoadingBar />
      <Spinner size={32} />
    </div>
  );
}
