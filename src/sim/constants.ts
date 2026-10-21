// Simulation balance constants. One tick = 5 in-game minutes.

export const MINUTES_PER_TICK = 5;
export const TICKS_PER_HOUR = 12;
export const TICKS_PER_DAY = TICKS_PER_HOUR * 24;
/** Worlds start on day 1 at 06:00. */
export const START_TICK = 6 * TICKS_PER_HOUR;

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 26;

/** Ticks needed to cross one tile. Roads are fast, open ground is slow. */
export const ROAD_STEP_TICKS = 1;
export const GRASS_STEP_TICKS = 3;

export const NEEDS = {
  energyDecay: 0.17,
  workEnergyCost: 0.08,
  hungerGrowth: 0.3,
  restHome: 0.6,
  restHomeUnpowered: 0.38,
  restOutdoors: 0.25,
  mealAtShop: 45,
  mealAtHome: 35,
  starvationHealthLoss: 0.15,
  exhaustionHealthLoss: 0.1,
  naturalHealing: 0.025,
  clinicHealing: 1.4,
  happinessDrift: 0.012,
  socialBuffDecay: 0.04,
  socialBuffGain: 0.45,
  /** Health lost per hour at full pollution. */
  pollutionHealthLoss: 0.9,
  /** Health lost per hour in a heatwave without cooling. */
  heatHealthLoss: 0.35,
};

export const WORK = {
  startHour: 7,
  endHour: 19,
  shiftTicks: 8 * TICKS_PER_HOUR,
  blockTicks: 4 * TICKS_PER_HOUR,
};

export const PRICES = {
  meal: 10,
  grocery: 7,
  luxury: 18,
  wholesale: 2.5,
  import: 5.5,
  export: 2.2,
  clinicVisit: 4,
  /** Daily power and water bill per resident. */
  utilities: 3,
};

export const ECONOMY = {
  officeRevenuePerWorkTick: 1.5,
  factoryOutputPerWorkTick: 0.5,
  shopRestockThreshold: 30,
  shopMaxStock: 60,
  factoryExportThreshold: 40,
  factoryMaxStock: 400,
  /** Credits per power unit per hour charged to businesses. */
  powerFee: 0.08,
  closureDistressHours: 12,
  subsidyAmount: 600,
  demolitionRefund: 0.5,
};

export const POPULATION = {
  immigrationHappiness: 55,
  emigrationHappiness: 15,
  emigrationTicks: 12 * TICKS_PER_HOUR,
  maxMemories: 30,
  maxEvents: 250,
  maxHistory: 24 * 7,
};

export const GUARDS = {
  /** A trip that takes longer than this is abandoned and re-planned. */
  maxTravelTicks: 240,
  /** Wait when no action is possible, before deciding again. */
  noOptionWait: 6,
};
