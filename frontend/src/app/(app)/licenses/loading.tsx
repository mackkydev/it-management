import { Bone, LoadingLabel } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-11 w-64" />
      <LoadingLabel />
      <Bone className="h-16 w-full rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Bone className="h-36 rounded-2xl" />
        <Bone className="h-36 rounded-2xl" />
        <Bone className="h-36 rounded-2xl" />
      </div>
    </div>
  );
}
