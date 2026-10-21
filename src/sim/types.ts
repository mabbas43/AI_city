// Core world-state types. Everything here must be plain JSON-serializable data
// so that the world can be saved, loaded and compared for determinism.

export interface Point {
  x: number;
  y: number;
}

export type TileKind = 'grass' | 'road';

export type BuildingType =
  | 'house'
  | 'apartment'
  | 'office'
  | 'factory'
  | 'shop'
  | 'market'
  | 'powerStation'
  | 'solarArray'
  | 'park'
  | 'clinic'
  | 'school'
  | 'cityHall';

export type BuildingStatus = 'operational' | 'closed';

export interface BuildingDayStats {
  revenue: number;
  wagesPaid: number;
  wagesUnpaid: number;
  unpoweredTicks: number;
  sales: number;
}

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tile citizens walk to in order to enter. Usually a road tile next to the footprint. */
  entrance: Point;
  /** True when the entrance is on a road tile (required for deliveries). */
  connected: boolean;
  /** Business cash. Public buildings are funded by the treasury and keep 0 here. */
  funds: number;
  /** Goods: shop/market shelf stock, or factory warehouse inventory. */
  stock: number;
  powered: boolean;
  status: BuildingStatus;
  /** Consecutive hours a business could not cover its payroll. */
  distressHours: number;
  /** Consecutive hours a public building's upkeep went unpaid. */
  unpaidUpkeepHours: number;
  builtAt: number;
  today: BuildingDayStats;
  yesterday: BuildingDayStats;
}

export type ActionKind =
  | 'work'
  | 'rest'
  | 'eat'
  | 'shop'
  | 'socialize'
  | 'seekJob'
  | 'seekCare'
  | 'protest'
  | 'wait';

export interface IdleActivity {
  kind: 'idle';
  /** Ticks remaining before the citizen reconsiders (0 = decide now). */
  wait: number;
}

export interface TravelActivity {
  kind: 'traveling';
  action: ActionKind;
  targetId: number | null;
  destination: Point;
  path: Point[];
  ticksTraveled: number;
}

export interface PerformActivity {
  kind: 'performing';
  action: ActionKind;
  targetId: number | null;
  elapsed: number;
  maxTicks: number;
}

export type Activity = IdleActivity | TravelActivity | PerformActivity;

export interface Traits {
  /** Desire for company. */
  sociability: number;
  /** Work ethic. */
  diligence: number;
  /** Reluctance to spend. */
  frugality: number;
  /** Dampens negative happiness effects. */
  resilience: number;
}

export interface Skills {
  technical: number;
  manual: number;
  social: number;
}

export interface Needs {
  /** 0 = exhausted, 100 = fully rested. */
  energy: number;
  /** 0 = full, 100 = starving. */
  hunger: number;
  /** 0 = critically ill, 100 = perfect health. */
  health: number;
  /** 0 = miserable, 100 = elated. */
  happiness: number;
}

export type GoalKind = 'saveMoney' | 'findJob' | 'makeFriends' | 'stayHealthy';

export interface Goal {
  kind: GoalKind;
  target: number;
  progress: number;
  completed: boolean;
}

export interface Memory {
  tick: number;
  text: string;
  /** Positive or negative emotional weight. */
  impact: number;
}

export interface DecisionRecord {
  tick: number;
  action: ActionKind;
  targetId: number | null;
  score: number;
  reasons: string[];
  alternatives: { action: ActionKind; targetId: number | null; score: number }[];
}

export interface HappinessFactor {
  label: string;
  value: number;
}

export interface Citizen {
  id: number;
  name: string;
  age: number;
  traits: Traits;
  skills: Skills;
  occupation: string;
  money: number;
  /** Gross wage per worked tick at the current job. */
  wage: number;
  needs: Needs;
  /** Grocery portions stored at home. */
  food: number;
  homeId: number | null;
  jobId: number | null;
  pos: Point;
  prevPos: Point;
  stepTicks: number;
  stepElapsed: number;
  /** Building the citizen is currently inside, if any. */
  insideId: number | null;
  activity: Activity;
  goals: Goal[];
  /** Affinity towards other citizens keyed by id, -100..100. */
  relationships: Record<string, number>;
  memories: Memory[];
  lastDecision: DecisionRecord | null;
  happinessFactors: HappinessFactor[];
  /** Short-lived social satisfaction, decays over time. */
  socialBuff: number;
  workedToday: number;
  incomeToday: number;
  unpaidToday: number;
  ticksUnemployed: number;
  miseryTicks: number;
  /** Tick before which job hunting is pointless (no openings found last time). */
  jobSearchCooldownUntil: number;
  /** Per-grievance tick of last complaint to avoid spam. */
  complaintCooldowns: Record<string, number>;
  arrivedAt: number;
}

export interface Policies {
  /** Fraction of gross wages collected by the city. */
  incomeTaxRate: number;
  /** Fraction of retail prices collected by the city. */
  salesTaxRate: number;
  /** Credits per day paid to each unemployed citizen. */
  unemploymentBenefit: number;
  /** Cuts power demand by 20% at a small happiness cost. */
  energyConservation: boolean;
}

export interface PowerState {
  supply: number;
  demand: number;
  shortage: boolean;
  unpoweredIds: number[];
}

export type EventSeverity = 'info' | 'warning' | 'critical';

export type EventType =
  | 'powerShortage'
  | 'powerRestored'
  | 'unemployment'
  | 'complaint'
  | 'businessClosure'
  | 'businessReopened'
  | 'protest'
  | 'protestEnded'
  | 'goodsShortage'
  | 'budgetCrisis'
  | 'housingShortage'
  | 'healthCrisis'
  | 'immigration'
  | 'emigration'
  | 'construction'
  | 'demolition'
  | 'policy'
  | 'weather'
  | 'milestone'
  | 'election'
  | 'petition'
  | 'festival';

export interface CityEvent {
  id: number;
  tick: number;
  type: EventType;
  severity: EventSeverity;
  title: string;
  description: string;
  /** Concrete simulation conditions that caused this event. */
  causes: string[];
  citizenIds: number[];
  buildingIds: number[];
}

export interface EventState {
  flags: Record<string, boolean>;
  /** Consecutive hours a condition has held, for sustained triggers. */
  streaks: Record<string, number>;
  lastFired: Record<string, number>;
}

export interface Ledger {
  /** Treasury income/expense by category for the current day. */
  today: Record<string, number>;
  yesterday: Record<string, number>;
  /** Balance of the world outside the city. Total money including this is conserved. */
  external: number;
}

export interface StatsSample {
  tick: number;
  population: number;
  employed: number;
  unemployed: number;
  avgHappiness: number;
  avgHealth: number;
  treasury: number;
  powerSupply: number;
  powerDemand: number;
  homeless: number;
}

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'heatwave';

export interface WeatherState {
  kind: WeatherKind;
  /** Tick at which the current weather gives way to the forecast. */
  untilTick: number;
  forecast: WeatherKind;
}

export type Difficulty = 'relaxed' | 'standard' | 'hard';

/** A temporary change to approval, e.g. from answering a petition. */
export interface ApprovalModifier {
  label: string;
  value: number;
  untilTick: number;
}

export interface ApprovalState {
  /** Mayor approval rating, 0..100. Drifts hourly towards the sum of its factors. */
  value: number;
  factors: HappinessFactor[];
  modifiers: ApprovalModifier[];
}

export interface ElectionRecord {
  tick: number;
  approval: number;
  won: boolean;
}

export interface ElectionState {
  nextTick: number;
  term: number;
  history: ElectionRecord[];
}

export type EffectKind = 'festival' | 'powerImport' | 'coolingCenters' | 'parkPromise';

/** A timed city-wide effect created by a petition decision. */
export interface ActiveEffect {
  kind: EffectKind;
  label: string;
  startTick: number;
  untilTick: number;
  value: number;
}

export type PetitionKind = 'bailout' | 'powerImport' | 'festival' | 'taxRelief' | 'cooling' | 'parkRequest';

export interface PetitionOption {
  id: string;
  label: string;
  detail: string;
  cost: number;
}

/** A decision the mayor must make. Unanswered petitions resolve to `defaultOption` on expiry. */
export interface Petition {
  id: number;
  kind: PetitionKind;
  tick: number;
  expiresAt: number;
  title: string;
  description: string;
  causes: string[];
  options: PetitionOption[];
  defaultOption: string;
  buildingId: number | null;
}

export interface Bulletin {
  tick: number;
  day: number;
  headline: string;
  stories: string[];
  figures: { label: string; value: string; delta?: number }[];
  spotlight: { citizenId: number; name: string; text: string } | null;
  weather: string;
}

export interface GameOverState {
  tick: number;
  reason: string;
}

export interface World {
  seed: number;
  rngState: number;
  tick: number;
  width: number;
  height: number;
  tiles: TileKind[];
  buildings: Building[];
  citizens: Citizen[];
  nextBuildingId: number;
  nextCitizenId: number;
  nextEventId: number;
  treasury: number;
  policies: Policies;
  power: PowerState;
  events: CityEvent[];
  eventState: EventState;
  ledger: Ledger;
  history: StatsSample[];
  /** Unemployment rate recorded at the start of each day (for trend detection). */
  dailyUnemployment: number[];
  difficulty: Difficulty;
  weather: WeatherState;
  approval: ApprovalState;
  election: ElectionState;
  /** Milestone id -> tick it was achieved. */
  milestones: Record<string, number>;
  petitions: Petition[];
  nextPetitionId: number;
  effects: ActiveEffect[];
  bulletins: Bulletin[];
  gameOver: GameOverState | null;
  /** After losing an election the player may keep playing without elections. */
  sandbox: boolean;
}
