/** One skill of an agent's index: its name, its description and where it lives (decision 0207). */
export interface SkillIndexEntry {
  readonly name: string;
  readonly description: string;
  /** `<place>/<name>/SKILL.md`. */
  readonly location: string;
  /**
   * A workspace skill that waits for the owner to accept its files (decision 0408): it is not
   * loaded, and the agent never opens it.
   */
  readonly held?: boolean;
}
