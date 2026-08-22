// v3 — EVOLVE. Same redesigned table as v2, plus a Target column on every row.
//
// Nothing breaks. Rows stay at 20, every mapped field still resolves, conformance
// stays at 1.0. What appears is a field the record schema has never heard of:
// unmapped_fields_seen = ["target"]. That is a requirement change, not a fault,
// and it has to route somewhere other than REPAIR.
//
// The rendering is v2's, called with the target column switched on — the whole
// point is that the page did not otherwise change.

import { pipeline as pipelineV2 } from '../v2/pipeline.mjs';

export function pipeline(data, version) {
  return pipelineV2(data, version, { withTarget: true });
}
