import { Bone, LoadingLabel } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-4 w-28" />
      <div className="flex items-center gap-3">
        <Bone className="h-12 w-12 rounded-2xl" />
        <div className="space-y-2">
          <Bone className="h-3 w-32" />
          <Bone className="h-7 w-56" />
        </div>
      </div>
      <LoadingLabel />
      {Array.from({ length: 3 }).map((_, i) => (
        <Bone key={i} className="h-40 w-full rounded-2xl" />
      ))}
    </div>
  );
}
