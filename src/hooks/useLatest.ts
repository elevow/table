import { useLayoutEffect, useRef } from 'react';

/**
 * A ref that always holds the latest `value`, for callbacks and subscriptions that must see the
 * current props without re-subscribing. It's updated after render, not during it, as React's
 * rules require; anything reading it from an effect or event handler sees the current value.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
