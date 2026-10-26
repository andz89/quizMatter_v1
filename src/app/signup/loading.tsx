import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";

// Shown while the sign up page reads the blocked email domains.
export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <TopLoadingBar />
      <Spinner size={32} />
    </div>
  );
}
