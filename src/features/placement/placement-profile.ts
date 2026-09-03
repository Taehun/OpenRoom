export const PLACEMENT_LIMITS = Object.freeze({
  roomInsetM: 0.1,
  gridM: 0.1,
  beamWidth: 32,
  candidatesPerObject: 48,
  improvementThreshold: 100,
});

export const PLACEMENT_SCORE_WEIGHTS = Object.freeze({
  circulation: 2500,
  sofaWallAndSide: 1700,
  tableRelation: 1800,
  rugRelation: 1600,
  chairRelation: 1000,
  accessories: 800,
  movement: 600,
});
