import React from 'react';
import { betSliderAmount, betSliderNotch, betSliderNotches } from '../lib/shared/bet-sizing';

interface Props {
  min: number;
  max: number;
  /** Size of one notch, from betSliderStep. */
  step: number;
  value: number;
  onChange: (amount: number) => void;
}

/** Slider for bet and raise amounts, moving in table-sized steps from min up to max. */
export default function BetSlider({ min, max, step, value, onChange }: Props) {
  return (
    <input
      type="range"
      min={0}
      max={betSliderNotches(min, max, step)}
      step={1}
      value={betSliderNotch(value, min, max, step)}
      onChange={e => onChange(betSliderAmount(Number(e.target.value), min, max, step))}
    />
  );
}
