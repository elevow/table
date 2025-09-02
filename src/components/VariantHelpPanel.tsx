import React from 'react';
import { getVariantUI } from '../lib/ui/variant-registry';
import { GameVariant } from '../types/variant-ui';

export interface VariantHelpPanelProps {
  variant: GameVariant;
}

export const VariantHelpPanel: React.FC<VariantHelpPanelProps> = ({ variant }) => {
  const cfg = getVariantUI(variant);
  const help = cfg.helpContent;
  return (
    <section aria-label="Variant Help" className="variant-help">
      <h3>{help.title}</h3>
      <p>{help.summary}</p>
      {help.bullets && help.bullets.length > 0 && (
        <ul>
          {help.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default VariantHelpPanel;
