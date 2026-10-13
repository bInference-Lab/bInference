/** One skill of an agent's index: its name, its description and where it lives (decision 0207). */
export interface SkillIndexEntry {
  readonly name: string;
  readonly description: string;
  /** `<place>/<name>/SKILL.md`. */
  readonly location: string;
}
