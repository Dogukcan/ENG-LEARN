import { Button, Sheet } from "../../components/ui";
import type { SkillBlock } from "../../data/types";
import { BLOCK_NAMES } from "./todayLogic";
import { actionAriaLabel, actionLabel, sheetKicker } from "./pathLogic";
import type { ActionContext, NodeContext } from "./pathLogic";

interface NodeSheetProps extends NodeContext, ActionContext {
  block: SkillBlock;
  open: boolean;
  detail: string;
  onClose: () => void;
  onPress: (block: SkillBlock) => void;
  returnFocusTo: () => HTMLElement | null;
}

export function NodeSheet(props: NodeSheetProps) {
  const { block, open, detail, onClose, onPress, returnFocusTo } = props;
  return (
    <Sheet open={open} onClose={onClose} variant="sheet" aria-label={`${BLOCK_NAMES[block]} ayrıntısı`} returnFocusTo={returnFocusTo}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="num text-small font-semibold text-muted">{sheetKicker(block, props)}</p>
          <h2 className="text-section font-semibold text-text">{BLOCK_NAMES[block]}</h2>
          <p className="text-body text-muted">{detail}</p>
        </div>
        <Button variant="icon" aria-label="Ayrıntıyı kapat" onClick={onClose}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </Button>
      </div>
      <Button variant="primary-block" block={block} aria-label={actionAriaLabel(block, props)} onClick={() => { onClose(); onPress(block); }}>
        {actionLabel(block, props)}
      </Button>
    </Sheet>
  );
}
