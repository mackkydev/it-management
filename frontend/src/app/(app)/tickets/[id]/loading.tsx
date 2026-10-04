import { Bone, LoadingLabel } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-4 w-24" />
      <Bone className="h-12 w-72" />
      <LoadingLabel />
      <Bone className="h-48 w-full rounded-2xl" />
      <Bone className="h-40 w-full rounded-2xl" />
      <Bone className="h-36 w-full rounded-2xl" />
    </div>
  );
}
