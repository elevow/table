import type { GameAction, GameStage, TableState } from './poker';

// Derive GameVariant union from existing TableState['variant'] for type safety
export type GameVariant = NonNullable<TableState['variant']>;

export interface VariantUI {
  variant: GameVariant;
  controls: UIControl[];
  displays: UIDisplay[];
  helpContent: VariantHelp;
  mobileLayout: MobileAdaptation;
}

export type UIControlType = 'button' | 'slider' | 'toggle' | 'declaration';

export interface VisibilityRule {
  whenVariant?: GameVariant | GameVariant[];
  whenStage?: GameStage | GameStage[];
  requiresDeclaration?: boolean; // Only show when declarations are enabled for the variant
}

export interface UIControl {
  type: UIControlType;
  label: string;
  variantSpecific: boolean;
  visibility?: VisibilityRule[];
  action?: GameAction['type'] | 'declare-high' | 'declare-low' | 'declare-both';
}

export type UIDisplayType = 'hand-info' | 'pot-split' | 'stud-exposed-cards';

export interface UIDisplay {
  type: UIDisplayType;
  visibility?: VisibilityRule[];
}

export interface VariantHelp {
  title: string;
  summary: string;
  bullets?: string[];
}

export interface MobileAdaptation {
  compactControls: boolean;
  stackHelpBelow: boolean;
}

// Simple helper to evaluate visibility rules
export function isVisible(
  rules: VisibilityRule[] | undefined,
  ctx: { variant: GameVariant; stage: GameStage; declarationsEnabled: boolean }
): boolean {
  if (!rules || rules.length === 0) return true;
  return rules.every(r => {
    const variantOk = !r.whenVariant
      || (Array.isArray(r.whenVariant)
        ? r.whenVariant.includes(ctx.variant)
        : r.whenVariant === ctx.variant);
    const stageOk = !r.whenStage
      || (Array.isArray(r.whenStage)
        ? r.whenStage.includes(ctx.stage)
        : r.whenStage === ctx.stage);
    const declOk = r.requiresDeclaration ? ctx.declarationsEnabled : true;
    return variantOk && stageOk && declOk;
  });
}
