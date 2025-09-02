import React from 'react';
import { getVariantUI } from '../lib/ui/variant-registry';
import { isVisible, GameVariant } from '../types/variant-ui';
import type { GameStage } from '../types/poker';

export interface VariantControlsProps {
  variant: GameVariant;
  stage: GameStage;
  declarationsEnabled?: boolean;
  onAction?: (action: string) => void;
}

export const VariantControls: React.FC<VariantControlsProps> = ({ variant, stage, declarationsEnabled, onAction }) => {
  const config = getVariantUI(variant);
  const ctx = { variant, stage, declarationsEnabled: !!declarationsEnabled };

  return (
    <div className="variant-controls flex gap-2 items-center">
      {config.controls.filter(c => isVisible(c.visibility, ctx)).map((c, idx) => {
        if (c.type === 'slider') {
          return (
            <input
              key={`ctrl-${idx}`}
              type="range"
              aria-label={c.label}
              min={0}
              max={100}
            />
          );
        }
        const label = c.label;
        return (
          <button key={`ctrl-${idx}`} aria-label={label} onClick={() => onAction?.(c.action || label)}>{label}</button>
        );
      })}
    </div>
  );
};

export default VariantControls;
