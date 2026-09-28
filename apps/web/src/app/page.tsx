import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Lesson Observation</h1>
      <p className="text-neutral-500">Proof of concept. The teacher and admin apps arrive after the recording test.</p>
      <Link href="/lab/recorder" className="inline-block rounded-md bg-blue-800 px-4 py-2 font-medium text-white">
        Open recording lab
      </Link>
    </main>
  );
}
