export const PLACEMENT_LIMITS = Object.freeze({
  roomInsetM: 0.1,
  gridM: 0.1,
  beamWidth: 32,
  candidatesPerObject: 48,
  improvementThreshold: 100,
});

/** Spec 8.3: the nine weighted terms, summing to 10,000. */
export const PLACEMENT_SCORE_WEIGHTS = Object.freeze({
  circulation: 2300,
  sofaWallAndSide: 1500,
  tableRelation: 1600,
  rugRelation: 1400,
  chairRelation: 1000,
  accessories: 600,
  movement: 400,
  viewFidelity: 600,
  composition: 600,
});
