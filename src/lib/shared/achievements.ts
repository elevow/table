/**
 * Achievements players can earn, shared by the server (which awards them) and the pages that
 * show them.
 */
export interface AchievementInfo {
  type: string;
  label: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementInfo[] = [
  { type: 'first_hand', label: 'Pull Up a Chair', description: 'Play your first hand', icon: '🪑' },
  { type: 'first_win', label: 'First Blood', description: 'Win your first pot', icon: '🥇' },
  { type: 'hands_100', label: 'Regular', description: 'Play 100 hands', icon: '🃏' },
  { type: 'hands_1000', label: 'Grinder', description: 'Play 1,000 hands', icon: '⚙️' },
  { type: 'wins_100', label: 'Centurion', description: 'Win 100 pots', icon: '💯' },
  { type: 'big_pot', label: 'Monster Pot', description: 'Win a pot of 100 big blinds or more', icon: '💰' },
  { type: 'double_up', label: 'Double Up', description: 'Double your stack in a single hand', icon: '⏫' },
  { type: 'quads_plus', label: 'Quad Squad', description: 'Win at showdown with four of a kind or better', icon: '🎰' },
  { type: 'bomb_pot_win', label: 'Demolition', description: 'Win a bomb pot', icon: '💣' },
];

export const ACHIEVEMENTS_BY_TYPE: Record<string, AchievementInfo> = Object.fromEntries(
  ACHIEVEMENTS.map(a => [a.type, a])
);
