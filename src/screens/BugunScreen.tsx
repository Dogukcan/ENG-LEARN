/*
 * Faz 1 placeholder for the Bugün (Today) screen.
 * Shows only the 28px/600 screen title and the status line until the next step wires real data.
 */
export function BugunScreen() {
  return (
    <section aria-labelledby="bugun-screen-title" className="flex flex-col gap-3.5">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1
            id="bugun-screen-title"
            className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text"
          >
            Bugün
          </h1>
        </div>
        <p className="text-small leading-[1.35] text-muted">
          Bu ekran sıradaki adımda gelecek.
        </p>
      </header>
    </section>
  )
}
