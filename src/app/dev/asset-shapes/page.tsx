import { notFound } from "next/navigation";
import { AssetShapes } from "./AssetShapes";

/** Development only: measures every library drawing's real shape for Claude's import (see src/lib/assetShapes.json). */
export default function AssetShapesPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <AssetShapes />;
}
