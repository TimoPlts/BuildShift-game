/**
 * The explicit per-substep input handed to the local simulation. `jumpPressed`
 * is the *edge* for this substep only: `true` on the first substep of a batch
 * whose captured sample has `jump: true`, always `false` on the second
 * substep — so a Space press that arrives between the two substeps is never
 * consumed on substep B (the browser latch stays intact for the next batch).
 */
export interface SubstepInput {
  moveX: number;
  moveZ: number;
  lookYaw: number;
  jumpPressed: boolean;
}
