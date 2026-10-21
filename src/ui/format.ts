import { BUILDING_DEFS, type Building } from '../sim';

export const money = (n: number): string => `${Math.floor(n).toLocaleString('en-US')} cr`;
export const signed = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const percent = (n: number): string => `${Math.round(n * 100)}%`;
export const round = (n: number): string => Math.round(n).toString();
export const buildingName = (b: Building | undefined): string => (b ? `${BUILDING_DEFS[b.type].label} #${b.id}` : '—');
