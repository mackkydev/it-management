import { Bone, LoadingLabel } from "@/components/skeletons";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-5 px-4 py-10" aria-busy="true">
      <Bone className="h-11 w-72" />
      <LoadingLabel />
      <Bone className="h-96 w-full rounded-2xl" />
    </main>
  );
}
