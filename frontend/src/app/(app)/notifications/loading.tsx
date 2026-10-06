import { Bone, LoadingLabel } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-12 w-72" />
      <Bone className="h-10 w-64 rounded-2xl" />
      <LoadingLabel />
      <Bone className="h-96 w-full rounded-2xl" />
    </div>
  );
}
