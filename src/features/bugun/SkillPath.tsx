import { useId, useRef, useState } from "react";
import { SKILL_BLOCKS } from "../../data/repository";
import type { SkillBlock } from "../../data/types";
import type { MinutesByBlock } from "./todayLogic";
import { coveredFraction, NODE_ANCHORS, PATH_HEIGHT, PATH_VIEWBOX, RIBBON_PATH } from "./pathLogic";
import { SkillNode } from "./SkillNode";
import { NodeSheet } from "./NodeSheet";
import "./skillPath.css";

interface SkillPathProps {
  next: SkillBlock;
  running: SkillBlock | null;
  elapsedSeconds: number;
  done: MinutesByBlock;
  plan: MinutesByBlock;
  dueCards: number;
  detail: Record<SkillBlock, string>;
  onPress: (block: SkillBlock) => void;
}

export function SkillPath({ next, running, elapsedSeconds, done, plan, dueCards, detail, onPress }: SkillPathProps) {
  const gradientId = useId();
  const [selected, setSelected] = useState<SkillBlock | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const covered = coveredFraction(SKILL_BLOCKS.reduce((sum, block) => sum + done[block], 0), SKILL_BLOCKS.reduce((sum, block) => sum + plan[block], 0));
  return (
    <section aria-label="Bugünkü çalışma yolu" className="skill-path">
      <div className="skill-path-stage">
        <svg className="skill-path-ribbon" viewBox={PATH_VIEWBOX} aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2={PATH_HEIGHT} gradientUnits="userSpaceOnUse">
              {SKILL_BLOCKS.map((block, index) => <stop key={block} offset={NODE_ANCHORS[index].y / PATH_HEIGHT} stopColor={`var(--${block}-mark)`} />)}
            </linearGradient>
          </defs>
          <path className="skill-path-ribbon-edge" d={RIBBON_PATH} />
          <path className="skill-path-ribbon-pale" d={RIBBON_PATH} />
          <path className="skill-path-ribbon-covered" d={RIBBON_PATH} pathLength="1" stroke={`url(#${gradientId})`}
            strokeDasharray={`${covered} 1`} visibility={covered > 0 ? "visible" : "hidden"} />
        </svg>
        <ol role="list" className="m-0 list-none p-0">
          {SKILL_BLOCKS.map((block, index) => <SkillNode key={block} block={block} anchor={NODE_ANCHORS[index]}
            next={next} running={running} done={done[block]} plan={plan[block]} dueCards={dueCards}
            runningSeconds={running === block ? elapsedSeconds : null} onPress={onPress}
            onOpen={(block, button) => { opener.current = button; setSelected(block); }} />)}
        </ol>
      </div>
      <NodeSheet block={selected ?? next} open={selected !== null} next={next} running={running}
        done={done[selected ?? next]} plan={plan[selected ?? next]} dueCards={dueCards}
        runningSeconds={running === (selected ?? next) ? elapsedSeconds : null} detail={detail[selected ?? next]}
        onClose={() => setSelected(null)} onPress={onPress} returnFocusTo={() => opener.current} />
    </section>
  );
}
