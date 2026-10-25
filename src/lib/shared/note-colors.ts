/** Color tags a player can put on another player, with their swatch classes. */
export const NOTE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type NoteColor = typeof NOTE_COLORS[number];

export const NOTE_COLOR_CLASSES: Record<NoteColor, { swatch: string; ring: string }> = {
  red: { swatch: 'bg-red-500', ring: 'ring-red-500' },
  orange: { swatch: 'bg-orange-500', ring: 'ring-orange-500' },
  yellow: { swatch: 'bg-yellow-400', ring: 'ring-yellow-400' },
  green: { swatch: 'bg-green-500', ring: 'ring-green-500' },
  blue: { swatch: 'bg-blue-500', ring: 'ring-blue-500' },
  purple: { swatch: 'bg-purple-500', ring: 'ring-purple-500' },
};
