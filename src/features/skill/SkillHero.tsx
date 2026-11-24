import { useRef, useState } from "react";
import type { CSSProperties, JSX, ReactNode } from "react";
import type { SkillBlock } from "../../data/types";
import { DinlemeIcon, KelimeIcon, KonusmaIcon, OkumaIcon } from "../../components/icons";
import { Button, cx, Sheet, useReducedMotion } from "../../components/ui";
import { heroAriaLabel, heroKicker, ringFraction } from "./heroLogic";
import "./skillHero.css";

const ICONS = { okuma: OkumaIcon, kelime: KelimeIcon, dinleme: DinlemeIcon, konusma: KonusmaIcon };

export interface SkillHeroProps {
  block: SkillBlock;
  doneMinutes: number;
  planMinutes: number;
  runningSeconds: number | null;
  title: string;
  subtitle: string;
  chips?: string[];
  actionLabel: string;
  actionAriaLabel: string;
  onAction(): void;
  detail?: ReactNode;
}

export function SkillHero(props: SkillHeroProps): JSX.Element {
  const { block, doneMinutes, planMinutes, runningSeconds, title, subtitle, chips,
    actionLabel, actionAriaLabel, onAction, detail } = props;
  const [open, setOpen] = useState(false);
  const ringRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const Icon = ICONS[block];
  const fraction = ringFraction(doneMinutes, planMinutes);
  const complete = planMinutes > 0 && doneMinutes >= planMinutes;
  const kicker = heroKicker(doneMinutes, planMinutes, runningSeconds);
  const style = {
    "--skill-tile": `var(--${block}-tile)`,
    "--skill-ink": `var(--${block}-ink)`,
    "--skill-mark": `var(--${block}-mark)`,
    "--skill-button": `var(--${block}-btn-bg)`,
    "--skill-button-text": `var(--${block}-btn-text)`,
    "--skill-button-edge": `var(--${block}-btn-active)`,
  } as CSSProperties;
  const openSheet = () => {
    // Safari does not always focus a tapped button; preserve the sheet's opener.
    ringRef.current?.focus();
    setOpen(true);
  };

  return (
    <section className="skill-hero" aria-label={`${title} bugünkü ilerleme`} style={style}>
      <div className="skill-hero-ring-wrap">
        <button type="button" className={cx("skill-hero-bubble", !reducedMotion && "can-pulse")}
          aria-label={actionAriaLabel} onClick={onAction}>{actionLabel}</button>
        <button type="button" ref={ringRef} className="skill-hero-ring"
          aria-label={heroAriaLabel(block, doneMinutes, planMinutes, runningSeconds !== null)}
          aria-haspopup="dialog" onClick={openSheet}>
          <span className="skill-hero-ring-face" aria-hidden="true">
            <svg className="skill-hero-ring-svg" viewBox="0 0 116 116">
              <circle className="skill-hero-track" cx="58" cy="58" r="51" />
              <circle className="skill-hero-progress" cx="58" cy="58" r="51" pathLength="1"
                strokeDasharray={`${fraction} 1`} visibility={fraction > 0 ? "visible" : "hidden"} />
            </svg>
          </span>
          <span className="skill-hero-disc" aria-hidden="true"><Icon filled={false} /></span>
          {complete ? <span className="skill-hero-check" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </span> : null}
        </button>
      </div>
      <div className="skill-hero-text">
        <p className="skill-hero-kicker num">{kicker}</p>
        <h2 className="skill-hero-title">{title}</h2>
        <p className="skill-hero-subtitle">{subtitle}</p>
        {chips?.length ? <ul className="skill-hero-chips">
          {chips.map((chip, index) => <li className="skill-hero-chip num" key={`${index}-${chip}`}>{chip}</li>)}
        </ul> : null}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} variant="sheet" aria-label={`${title} ayrıntısı`}
        returnFocusTo={() => ringRef.current}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="num text-small font-semibold text-muted">{kicker}</p>
            <h2 className="text-section font-semibold text-text">{title}</h2>
          </div>
          <Button variant="icon" aria-label="Ayrıntıyı kapat" onClick={() => setOpen(false)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Button>
        </div>
        {detail}
        <Button variant="primary-block" block={block} aria-label={actionAriaLabel}
          onClick={() => { setOpen(false); onAction(); }}>{actionLabel}</Button>
      </Sheet>
    </section>
  );
}
