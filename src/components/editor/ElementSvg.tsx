import { getElementAsset } from "@/lib/svgLibrary";

interface ElementSvgProps {
  assetId: string;
  color: string;
}

export function ElementSvg({ assetId, color }: ElementSvgProps) {
  const asset = getElementAsset(assetId);
  if (!asset) return null;

  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {asset.render(color)}
    </svg>
  );
}
