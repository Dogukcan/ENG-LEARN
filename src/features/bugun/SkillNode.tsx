import { useRef } from "react";
import type { CSSProperties } from "react";
import type { SkillBlock } from "../../data/types";
import { DinlemeIcon, KelimeIcon, KonusmaIcon, OkumaIcon } from "../../components/icons";
import { cx, useReducedMotion } from "../../components/ui";
import { formatMMSS } from "../timer/timerMath";
import { BLOCK_NAMES, NBSP } from "./todayLogic";
import { actionAriaLabel, bubbleBlock, bubbleLabel, nodeAriaLabel, nodeState, PATH_WIDTH, placementPercent, ringFraction } from "./pathLogic";
import type { ActionContext, NodeContext, NODE_ANCHORS } from "./pathLogic";

const ICONS = { okuma: OkumaIcon, kelime: KelimeIcon, dinleme: DinlemeIcon, konusma: KonusmaIcon };
export interface SkillNodeProps extends NodeContext, ActionContext {
  block: SkillBlock;
  anchor: typeof NODE_ANCHORS[number];
  onOpen: (block: SkillBlock, opener: HTMLButtonElement) => void;
  onPress: (block: SkillBlock) => void;
}

export function SkillNode(props: SkillNodeProps) {
  const { block, anchor, done, plan, runningSeconds, onOpen, onPress } = props;
  const ringRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const { state } = nodeState(block, props);
  const isNext = state === "next";
  const complete = plan > 0 && done >= plan;
  const size = isNext ? 116 : 104;
  const radius = isNext ? 51 : 45;
  const fraction = ringFraction(done, plan);
  const Icon = ICONS[block];
  const open = () => {
    if (ringRef.current) {
      // Safari does not always focus a tapped button. Sheet remembers this ring as its opener.
      ringRef.current.focus();
      onOpen(block, ringRef.current);
    }
  };
  const style = {
    ...placementPercent(anchor),
    "--node-size": `calc(${size} / ${PATH_WIDTH} * 100cqw)`,
    "--anchor-x": `calc(${anchor.x} / ${PATH_WIDTH} * 100cqw)`,
    "--skill-tile": `var(--${block}-tile)`,
    "--skill-ink": `var(--${block}-ink)`,
    "--skill-mark": `var(--${block}-mark)`,
    "--skill-button": `var(--${block}-btn-bg)`,
    "--skill-button-text": `var(--${block}-btn-text)`,
    "--skill-button-edge": `var(--${block}-btn-active)`,
  } as CSSProperties;

  return (
    <li className={cx("skill-path-node", isNext && "is-next")} style={style} data-side={anchor.side}>
      {bubbleBlock(props) === block ? (
        <button type="button" className={cx("skill-path-bubble", !reducedMotion && "can-pulse")}
          aria-label={actionAriaLabel(block, props)}
          onClick={() => onPress(block)}>{bubbleLabel(block, props)}</button>
      ) : null}
      <button ref={ringRef} type="button" className="skill-path-ring" aria-label={nodeAriaLabel(block, props)}
        aria-haspopup="dialog" onClick={open}>
        <span className="skill-path-ring-face" aria-hidden="true">
          <svg className="skill-path-ring-svg">
            <circle className="skill-path-track" cx="50%" cy="50%" r={`calc(${radius} / ${PATH_WIDTH} * 100cqw)`} />
            <circle className="skill-path-progress" cx="50%" cy="50%" r={`calc(${radius} / ${PATH_WIDTH} * 100cqw)`} pathLength="1"
              strokeDasharray={`${fraction} 1`} visibility={fraction > 0 ? "visible" : "hidden"} />
          </svg>
        </span>
        <span className="skill-path-disc" aria-hidden="true"><Icon filled={false} /></span>
        {complete ? <span className="skill-path-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span> : null}
      </button>
      <span className="skill-path-label" aria-hidden="true" onClick={open}>
        <span className="font-semibold">{BLOCK_NAMES[block]}</span>
        <span className="num text-muted">{runningSeconds !== null ? formatMMSS(runningSeconds) : `${done}${NBSP}/${NBSP}${plan}${NBSP}dk`}</span>
      </span>
    </li>
  );
}
