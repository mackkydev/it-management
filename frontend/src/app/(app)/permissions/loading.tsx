import { Bone, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Bone className="h-11 w-56" />
      <TableSkeleton cols={6} rows={12} />
    </div>
  );
}
