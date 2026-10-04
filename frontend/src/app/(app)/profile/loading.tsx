import { Bone, LoadingLabel } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-11 w-56" />
      <LoadingLabel />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Bone className="h-56 w-full rounded-2xl" />
          <Bone className="h-48 w-full rounded-2xl" />
        </div>
        <Bone className="h-80 w-full rounded-2xl" />
      </div>
    </div>
  );
}
