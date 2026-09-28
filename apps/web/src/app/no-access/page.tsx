export default function NoAccess() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">No access</h1>
      <p className="text-sm text-neutral-500">
        You&apos;re signed in, but your account isn&apos;t set up (or has been deactivated). Ask your school administrator to invite you again.
      </p>
      <form action="/auth/signout" method="post">
        <button className="text-sm font-medium text-blue-800 underline dark:text-blue-400">Sign out</button>
      </form>
    </main>
  );
}
