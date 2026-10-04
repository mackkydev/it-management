import { Bone, LoadingLabel } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-11 w-64" />
      <LoadingLabel />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Bone className="h-24 rounded-2xl" />
        <Bone className="h-24 rounded-2xl" />
        <Bone className="h-24 rounded-2xl" />
      </div>
      <Bone className="h-64 w-full rounded-2xl" />
    </div>
  );
}
