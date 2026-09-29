import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";

// Shown while the cleanup page lists the photo files (it reads the whole bucket, so it can take a moment).
export default function Loading() {
  return (
    <div className="flex justify-center py-16">
      <TopLoadingBar />
      <Spinner size={32} />
    </div>
  );
}
