/*
 * Faz 1 placeholder for the Okuma (Reading) screen.
 * Keeps the exact header hierarchy from design/drafts/today-d.html without fake data.
 */
export function OkumaScreen() {
  return (
    <section aria-labelledby="okuma-screen-title" className="flex flex-col gap-3.5">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1
            id="okuma-screen-title"
            className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text"
          >
            Okuma
          </h1>
        </div>
        <p className="text-small leading-[1.35] text-muted">
          Bu ekran Faz 2&apos;de gelecek.
        </p>
      </header>
    </section>
  )
}
