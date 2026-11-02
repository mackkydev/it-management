import { Bone, LoadingLabel } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-11 w-56" />
      <LoadingLabel />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Bone key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Bone key={i} className="h-56 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
