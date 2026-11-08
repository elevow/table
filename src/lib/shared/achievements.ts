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
  { type: 'royal_flush', label: 'Royal Treatment', description: 'Win at showdown with a royal flush', icon: '👑' },
  { type: 'beat_quads', label: 'Quad Killer', description: 'Beat four of a kind or better at showdown', icon: '🔨' },
  { type: 'beat_straight_flush', label: 'Giant Slayer', description: 'Beat a straight flush at showdown', icon: '🗡️' },
  { type: 'omaha_trips', label: 'Against the Odds', description: 'Win an Omaha hand holding three of a kind in your hole cards', icon: '🎲' },
  // 7-2 offsuit
  { type: 'hammer', label: 'The Hammer', description: "Win a Hold'em pot with 7-2 offsuit", icon: '⚒️' },
  { type: 'hammer_showdown', label: "Show 'Em the Hammer", description: 'Win at showdown with 7-2 offsuit', icon: '🫣' },
  { type: 'hammer_7', label: 'Hammer Time', description: 'Win 7 pots with 7-2 offsuit', icon: '🪓' },
  { type: 'hammer_72', label: 'Seventy-Two', description: 'Win 72 pots with 7-2 offsuit', icon: '🏆' },
  // Famous hands
  { type: 'dead_mans_hand', label: "Dead Man's Hand", description: 'Win at showdown with aces and eights, holding at least one of each', icon: '💀' },
  { type: 'wheel', label: 'The Wheel', description: 'Win at showdown with a 5-high straight', icon: '🛞' },
  { type: 'steel_wheel', label: 'Steel Wheel', description: 'Win at showdown with a 5-high straight flush', icon: '🔩' },
  { type: 'bicycle', label: 'Bicycle', description: 'Win with A-2-3-4-5 as your low in Razz or a hi-lo game', icon: '🚲' },
  // Luck, good and bad
  { type: 'bad_beat', label: 'Bad Beat', description: 'Lose at showdown with a full house or better', icon: '😩' },
  { type: 'cooler', label: 'Cooler', description: 'Lose at showdown with four of a kind or better', icon: '🧊' },
  { type: 'one_outer', label: 'One-Outer', description: 'Win at showdown when only one river card could save you', icon: '☝️' },
  { type: 'runner_runner', label: 'Runner-Runner', description: 'Win with a straight or flush that needed both the turn and the river', icon: '🏃' },
  { type: 'aces_cracked', label: 'Aces Cracked', description: 'Lose with pocket aces three times in one session', icon: '🥚' },
  { type: 'deja_vu', label: 'Déjà Vu', description: 'Get the same two hole cards as in the hand before', icon: '🔁' },
  // Odd table moments
  { type: 'board_plays', label: 'Board Plays', description: "Split a Hold'em pot with four of a kind or a royal flush on the board", icon: '🪧' },
  { type: 'three_way_chop', label: 'Three-Way Chop', description: 'Win an equal share of a pot split three or more ways', icon: '🍰' },
  { type: 'scoop', label: 'Scoop', description: 'Win both the high and the low half of a hi-lo pot', icon: '🥄' },
  { type: 'double_trouble', label: 'Double Trouble', description: 'Win every board outright when the hand is run more than once', icon: '✌️' },
  // Style and streaks
  { type: 'heater', label: 'Heater', description: 'Win 5 hands in a row at one table', icon: '🔥' },
  { type: 'stone_cold_bluff', label: 'Stone Cold Bluff', description: 'Win without a showdown after betting the last round with no pair', icon: '🥶' },
  { type: 'chip_and_a_chair', label: 'Chip and a Chair', description: 'Fall below 10 big blinds, then double your starting stack in the same session without adding chips', icon: '💺' },
  { type: 'two_birds', label: 'Two Birds', description: 'Knock out two players in one hand', icon: '🐦' },
  { type: 'patient_one', label: 'The Patient One', description: 'Fold 50 hands in a row at one table, then win the next', icon: '🧘' },
  { type: 'make_it_rain', label: 'Make It Rain', description: 'Splash the pot and win the hand', icon: '🌧️' },
];

export const ACHIEVEMENTS_BY_TYPE: Record<string, AchievementInfo> = Object.fromEntries(
  ACHIEVEMENTS.map(a => [a.type, a])
);
