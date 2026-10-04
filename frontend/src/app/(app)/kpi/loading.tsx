import { Bone, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-11 w-56" />
      <Bone className="h-56 w-full rounded-2xl" />
      <TableSkeleton cols={3} rows={6} />
    </div>
  );
}
