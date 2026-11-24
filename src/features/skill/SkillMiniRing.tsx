import type { CSSProperties } from "react";
import type { SkillBlock } from "../../data/types";
import { DinlemeIcon, KelimeIcon, KonusmaIcon, OkumaIcon } from "../../components/icons";
import { NBSP } from "../bugun/todayLogic";
import { miniRingAriaLabel, ringFraction } from "./heroLogic";
import "./skillHero.css";

const ICONS = { okuma: OkumaIcon, kelime: KelimeIcon, dinleme: DinlemeIcon, konusma: KonusmaIcon };

export interface SkillMiniRingProps {
  block: SkillBlock;
  doneMinutes: number;
  planMinutes: number;
  label: string;
}

export function SkillMiniRing({ block, doneMinutes, planMinutes, label }: SkillMiniRingProps) {
  const Icon = ICONS[block];
  const fraction = ringFraction(doneMinutes, planMinutes);
  const style = {
    "--skill-tile": `var(--${block}-tile)`,
    "--skill-ink": `var(--${block}-ink)`,
    "--skill-mark": `var(--${block}-mark)`,
    "--skill-button": `var(--${block}-btn-bg)`,
    "--skill-button-text": `var(--${block}-btn-text)`,
    "--skill-button-edge": `var(--${block}-btn-active)`,
  } as CSSProperties;
  return (
    <div className="skill-mini-ring" role="img" aria-label={miniRingAriaLabel(block, doneMinutes, planMinutes)} style={style}>
      <span className="skill-mini-ring-face" aria-hidden="true">
        <svg className="skill-hero-ring-svg" viewBox="0 0 72 72">
          <circle className="skill-hero-track" cx="36" cy="36" r="33" />
          <circle className="skill-hero-progress" cx="36" cy="36" r="33" pathLength="1"
            strokeDasharray={`${fraction} 1`} visibility={fraction > 0 ? "visible" : "hidden"} />
        </svg>
        <span className="skill-mini-ring-disc"><Icon filled={false} /></span>
      </span>
      <span className="skill-mini-ring-name" aria-hidden="true">{label}</span>
      <span className="skill-mini-ring-min num" aria-hidden="true">{`${doneMinutes}${NBSP}/${NBSP}${planMinutes}${NBSP}dk`}</span>
    </div>
  );
}
