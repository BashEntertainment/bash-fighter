// Roster registry: one place a new character joins to become selectable
// everywhere else (character-select UI, local match bot-fill, online
// join protocol). Adding a character means adding an entry here -- no
// other package should hardcode the roster list.
import type { CharacterData } from '@bash-fighter/sim';
import { PLACEHOLDER_CHARACTER } from './characters/placeholder/data.ts';
import { BALLAST_CHARACTER } from './characters/ballast/data.ts';

export interface CharacterEntry {
  /** Stable wire/storage identifier -- never the display name, so
   *  renaming a character in the UI later doesn't break saved
   *  selections or the network protocol. */
  id: string;
  character: CharacterData;
}

export const DEFAULT_CHARACTER_ID = 'placeholder';

/** The full roster, in select-screen display order. */
export const ALL_CHARACTERS: readonly CharacterEntry[] = [
  { id: 'placeholder', character: PLACEHOLDER_CHARACTER },
  { id: 'ballast', character: BALLAST_CHARACTER },
];

/** Resolves a wire-supplied character id to its CharacterData, falling
 *  back to the default (placeholder) for anything absent, unknown, or
 *  sent by a client that predates character selection -- this is the
 *  backward-compatibility path the protocol doc promises. */
export function resolveCharacterId(id: string | null | undefined): CharacterData {
  const found = ALL_CHARACTERS.find((c) => c.id === id);
  return found ? found.character : PLACEHOLDER_CHARACTER;
}

/** True if `id` is a known roster entry -- used to sanitise client-supplied
 *  ids before they reach resolveCharacterId's silent fallback, so callers
 *  that care can distinguish "known" from "defaulted". */
export function isKnownCharacterId(id: string | null | undefined): boolean {
  return typeof id === 'string' && ALL_CHARACTERS.some((c) => c.id === id);
}
