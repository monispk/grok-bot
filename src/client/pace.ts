/**
 * The rhythm the bot speaks in.
 *
 * Messages arrive as a batch — the welcome is eight at once — which lands as a
 * wall nobody reads. They are revealed instead in the groups a person would say
 * them in: a line, its voice note just behind it, then a pause before the next
 * thing is said. A rider who is listening rather than reading needs that pause
 * to keep up. In one place, so the browser tests measure against these numbers
 * rather than their own copies.
 */

/** How fast a line's words appear. */
export const WORD_MS = 18
/** Long messages reveal several words a tick so none outstays this budget. */
export const MAX_TICKS = 14
/** A voice note follows the words it speaks almost at once: one utterance. */
export const BEAT_MS = 160
/** The pause between one pair — words, then voice — and the next. */
export const GROUP_MS = 2000
/**
 * How long the next pair waits for the previous pair's voice note to be made.
 * Uplift takes two to four seconds; a note that never comes is not waited on
 * forever.
 */
export const VOICE_PATIENCE_MS = 8000
