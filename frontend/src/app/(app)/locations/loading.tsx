import { Bone, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-5">
      <Bone className="h-11 w-56" />
      <TableSkeleton cols={4} rows={10} />
    </div>
  );
}
