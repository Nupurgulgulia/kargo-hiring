import Link from "next/link";
import { testRecipient } from "@/lib/email";

export default function DashLayout({ children }: LayoutProps<"/">) {
  const testTo = testRecipient();
  return (
    <>
      {testTo && (
        <div className="bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn">
          Email test mode: every send goes to {testTo}, not to candidates.
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
              <rect width="32" height="32" rx="7" fill="var(--accent)" />
              <path d="M9 8v16M9 16l9-8M12.5 13l7 11" stroke="var(--accent-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            Kargo Hiring
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/" className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-ink">Shortlist</Link>
            <Link href="/rubric" className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-ink">Rubrics</Link>
          </nav>
          <form action="/api/logout" method="post" className="ml-auto">
            <button className="rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </>
  );
}
