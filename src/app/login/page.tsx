import { buttonClass, inputClass } from "@/components/ui";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <form action="/api/login" method="post" className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">
        <h1 className="text-lg font-semibold tracking-tight">Kargo Hiring</h1>
        <p className="mt-1 text-sm text-muted">Candidate data is private. Sign in to continue.</p>
        <input type="hidden" name="next" value={next} />
        <label className="mt-5 block text-sm font-medium" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoFocus className={`${inputClass} mt-1.5`} />
        {error && (
          <p className="mt-2 text-sm text-bad">
            {error === "config" ? "DASHBOARD_PASSWORD isn't configured on the server." : "Incorrect password."}
          </p>
        )}
        <button className={`${buttonClass.primary} mt-4 w-full`}>Sign in</button>
      </form>
    </main>
  );
}
