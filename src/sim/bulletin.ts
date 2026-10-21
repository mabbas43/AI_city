// The Morning Circuit: a daily city newspaper assembled at 06:00 from the
// previous 24 hours of events, statistics and citizens' experiences.

import { TICKS_PER_DAY } from './constants';
import { pct } from './stats';
import { dayOf, weekdayName } from './time';
import { WEATHER, hoursUntilChange } from './weather';
import type { Bulletin, CityEvent, World } from './types';

export const BULLETIN_HOUR = 6;
const MAX_BULLETINS = 7;

const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 } as const;
/** Event types that make for news, in order of preference among equal severities. */
const NEWSWORTHY = new Set([
  'businessClosure', 'businessReopened', 'powerShortage', 'protest', 'protestEnded', 'election', 'milestone',
  'goodsShortage', 'budgetCrisis', 'housingShortage', 'healthCrisis', 'unemployment', 'festival', 'construction',
  'immigration', 'emigration', 'weather', 'policy', 'demolition', 'petition',
]);

function newsScore(e: CityEvent): number {
  const bonus = e.type === 'milestone' || e.type === 'election' ? 2.5 : e.type === 'construction' || e.type === 'weather' ? -0.5 : 0;
  return SEVERITY_RANK[e.severity] + bonus;
}

function headlineFor(e: CityEvent): string {
  switch (e.type) {
    case 'businessClosure':
      return `${e.title.replace(' has closed', '')} shuts its doors`;
    case 'powerShortage':
      return 'Blackouts hit the city as the grid falls short';
    case 'protest':
      return 'Angry crowds gather outside City Hall';
    case 'milestone':
      return e.title.replace('Milestone: ', 'City celebrates: ');
    case 'election':
      return e.severity === 'critical' ? 'Mayor ousted at the ballot box' : 'Voters hand the mayor another term';
    case 'immigration':
      return `Welcome, ${e.title.replace(' moved to the city', '')}!`;
    case 'emigration':
      return `${e.title.replace(' left the city', '')} packs up and leaves`;
    default:
      return e.title;
  }
}

export function makeBulletin(world: World): Bulletin {
  const since = world.tick - TICKS_PER_DAY;
  const recent = world.events.filter((e) => e.tick > since && NEWSWORTHY.has(e.type));
  const ranked = [...recent].sort((a, b) => newsScore(b) - newsScore(a) || b.tick - a.tick);
  const lead = ranked[0];
  const headline = lead ? headlineFor(lead) : 'A quiet day in AI City';

  const stories: string[] = [];
  const seen = new Set<string>(lead ? [lead.title] : []);
  for (const e of ranked.slice(1)) {
    if (stories.length >= 4) break;
    if (seen.has(e.title) || e.type === 'petition') continue;
    seen.add(e.title);
    stories.push(e.title);
  }
  const complaints = world.events.filter((e) => e.tick > since && e.type === 'complaint');
  if (complaints.length > 0) stories.push(`${complaints.length} complaint${complaints.length > 1 ? 's' : ''} filed with City Hall`);

  const then = world.history.find((s) => s.tick >= since) ?? world.history[0];
  const now = world.history[world.history.length - 1];
  const figures: Bulletin['figures'] = [];
  if (now) {
    const unemp = now.population ? now.unemployed / now.population : 0;
    figures.push({ label: 'Population', value: `${now.population}`, delta: then ? now.population - then.population : undefined });
    figures.push({ label: 'Unemployment', value: pct(unemp) });
    figures.push({ label: 'Happiness', value: `${Math.round(now.avgHappiness)}`, delta: then ? Math.round(now.avgHappiness - then.avgHappiness) : undefined });
    figures.push({ label: 'Treasury', value: `${now.treasury} cr`, delta: then ? now.treasury - then.treasury : undefined });
  }
  figures.push({ label: 'Approval', value: `${Math.round(world.approval.value)}%` });

  let spotlight: Bulletin['spotlight'] = null;
  let strongest = 4;
  for (const c of world.citizens) {
    for (const m of c.memories) {
      if (m.tick <= since || Math.abs(m.impact) <= strongest) continue;
      strongest = Math.abs(m.impact);
      spotlight = { citizenId: c.id, name: c.name, text: `${c.occupation}, ${c.age}: ${m.text}.` };
    }
  }

  const w = WEATHER[world.weather.kind];
  const next = WEATHER[world.weather.forecast];
  const weather = world.weather.forecast === world.weather.kind ? `${w.label} today` : `${w.label}, turning to ${next.label.toLowerCase()} in about ${hoursUntilChange(world)}h`;

  return { tick: world.tick, day: dayOf(world.tick), headline, stories, figures, spotlight, weather: `${weekdayName(world.tick)} · ${weather}` };
}

/** Hourly hook: publishes the paper at BULLETIN_HOUR every day after the first. */
export function publishBulletin(world: World): Bulletin {
  const b = makeBulletin(world);
  world.bulletins.push(b);
  if (world.bulletins.length > MAX_BULLETINS) world.bulletins.splice(0, world.bulletins.length - MAX_BULLETINS);
  return b;
}
