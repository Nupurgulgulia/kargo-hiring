import Link from "next/link";

export default function DashLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="sticky top-0 z-20 bg-header text-header-ink shadow-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
              <rect width="32" height="32" rx="8" fill="#ffffff" />
              <path d="M9 8v16M9 16l9-8M12.5 13l7 11" stroke="#0b2545" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            Kargo Hiring
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/" className="rounded-md px-2.5 py-1.5 text-header-muted hover:bg-white/10 hover:text-header-ink">Shortlist</Link>
            <Link href="/rubric" className="rounded-md px-2.5 py-1.5 text-header-muted hover:bg-white/10 hover:text-header-ink">Rubrics</Link>
          </nav>
          <form action="/api/logout" method="post" className="ml-auto">
            <button className="rounded-md px-2.5 py-1.5 text-sm text-header-muted hover:bg-white/10 hover:text-header-ink">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </>
  );
}
