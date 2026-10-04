import { Bone, LoadingLabel } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-11 w-56" />
      <LoadingLabel />
      <Bone className="h-48 w-full rounded-2xl" />
    </div>
  );
}
