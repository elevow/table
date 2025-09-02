# Pot Distribution and Remainder Rules

This document summarizes how pots are formed and distributed at showdown, including how remainders are handled when splits are not perfectly even. It reflects the behavior enforced by the engine and covered by tests under US-033.

## Pot formation
- Base Pot: Computed as (potBefore − betsTotal). Eligible to all active (non-folded) players.
- Side Pots: Built by ascending unique bet thresholds. For each level, contributions are the difference between the current and previous level for players who have at least that bet. Eligibility excludes folded players. If the highest level is unmatched (only one contributor), that pot amount is still formed but will effectively return to that sole contributor during distribution due to eligibility.

## Winner selection per pot
- Eligibility: Only players who contributed to a pot and haven’t folded are eligible for that pot.
- Strength: Hands are compared using a composite numeric score combining the category rank with ordered kickers/best-5 ranks to break ties within the same category.
- Winners: The highest scoring eligible hand(s) for that pot share that pot.

## Splitting and deterministic remainders
- Split logic: Each eligible winner gets floor(potAmount / winnerCount).
- Remainder assignment: Any remainder (potAmount % winnerCount) is distributed deterministically in winner order. Earlier winners receive +1 until the remainder is exhausted. Order is stable and based on the winner list evaluated for that pot.
- Independence per pot: Remainder handling is performed independently for each pot (base and each side pot). When multiple pots exist, each may have its own remainder distribution.

## Edge cases covered by tests
- Three-way ties across base and side pots with varying remainders.
- Mixed eligibility where folded players shaped side-pot sizes but aren’t eligible to win them.
- Unmatched top-level side pot effectively returning to the sole contributor.
- Deterministic, per-pot remainder allocation order when multiple pots have remainders.

See tests under `src/lib/poker/__tests__/multiway-allin-*.test.ts` for concrete examples.
