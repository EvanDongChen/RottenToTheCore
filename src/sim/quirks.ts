/** A ready-made personality quirk that can be dropped onto a fruit on the setup screen. */
export interface QuirkPreset {
  id: string
  /** Short name shown on the chip. */
  label: string
  /** How the quirk is described to the AI. */
  text: string
  /** Chip colour. */
  tint: string
  /** Little phrases the stock-line brains tacks onto this fruit's lines. */
  tics: string[]
}

export const QUIRK_PRESETS: QuirkPreset[] = [
  { id: 'dramatic', label: 'Dramatic', tint: '#ffb3c7', text: 'Dramatic. Everything is the end of the world.', tics: ['This is the END.', 'I may faint.', 'Oh, the horror.'] },
  { id: 'sassy', label: 'Sassy', tint: '#ffd27a', text: 'Sassy. Rolls its eyes at everyone and has a comeback for everything.', tics: ['Obviously.', 'Not that anyone asked.', 'Try to keep up.'] },
  { id: 'pirate', label: 'Pirate', tint: '#9fd3ff', text: 'Talks like a pirate.', tics: ['Arr.', 'Mark me words.', 'Or I be a landlubber.'] },
  { id: 'nervous', label: 'Nervous', tint: '#d9f29a', text: 'Nervous. Ends its sentences with a nervous laugh.', tics: ['Ha. Ha ha.', 'Sorry. Sorry.', 'Um.'] },
  { id: 'know-it-all', label: 'Know-it-all', tint: '#c9b8f5', text: 'Convinced it is the smartest fruit in the lab.', tics: ['As I predicted.', 'It is basic logic.', 'You are welcome.'] },
  { id: 'polite', label: 'Polite', tint: '#bfeee0', text: 'Extremely polite, even when accusing someone.', tics: ['If you would be so kind.', 'With the greatest respect.', 'Do forgive me.'] },
  { id: 'sleepy', label: 'Sleepy', tint: '#cfd8e6', text: 'Sleepy. Easily distracted by snacks and naps.', tics: ['Is it nap time yet?', 'Yawn.', 'Anyway. Snacks?'] },
  { id: 'gossip', label: 'Gossip', tint: '#ffc4a3', text: 'Loves gossip more than the truth.', tics: ['You did not hear it from me.', 'Everyone is saying it.', 'Pass it on.'] },
  { id: 'paranoid', label: 'Paranoid', tint: '#f5e08a', text: 'Paranoid. Suspicious of anyone who is too nice.', tics: ['They are listening.', 'Trust nobody.', 'I have said too much.'] },
  { id: 'grumpy', label: 'Grumpy', tint: '#d6c3a8', text: 'A grumpy old fruit. Everything was better in its day.', tics: ['Bah.', 'In my day the lab had real fridges.', 'Fruit these days.'] },
  { id: 'poet', label: 'Poet', tint: '#e3c4f0', text: 'Speaks in little rhymes.', tics: ['So it goes, as the wind blows.', 'Mark my verse, it will get worse.', 'A rhyme in time.'] },
  { id: 'cheerful', label: 'Cheerful', tint: '#fff08a', text: 'Relentlessly cheerful, even about murder.', tics: ["Isn't this fun?", 'Lovely day for it!', 'Best lab ever!'] },
  { id: 'detective', label: 'Detective', tint: '#b9c7d9', text: 'Thinks it is a hard-boiled detective.', tics: ['The clues never lie.', 'Case closed.', 'I have seen this before.'] },
  { id: 'royal', label: 'Royal', tint: '#f3c7ff', text: 'Believes it is royalty and everyone else is a peasant.', tics: ['Peasants.', 'We are not amused.', 'Fetch my crown.'] },
]

/** Most quirks one fruit can hold. */
export const MAX_QUIRKS = 3

/** A fruit's quirk is stored either as a preset's id or, for one the user wrote, as the text itself. */
export function presetOf(quirk: string): QuirkPreset | undefined {
  return QUIRK_PRESETS.find((p) => p.id === quirk)
}

export function quirkLabel(quirk: string): string {
  return presetOf(quirk)?.label ?? quirk
}

/** The full description, as given to the AI. */
export function quirkText(quirk: string): string {
  return presetOf(quirk)?.text ?? quirk
}
