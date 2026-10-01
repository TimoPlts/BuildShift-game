/**
 * @deprecated This module has been consolidated into
 * `apps/web/src/network/twoPlayer/`. Use {@link InputSender} from
 * `@/network/twoPlayer` instead.
 *
 * The old `InputSender` sent sequenced `MovementInput` frames with a
 * fixed-size ring buffer. The canonical version in `network/twoPlayer`
 * additionally stores predicted state alongside each input for
 * reconciliation and supports `pruneUpTo` for efficient acknowledgement.
 */
export {};
