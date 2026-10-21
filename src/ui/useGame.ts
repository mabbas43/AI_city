import { createContext, useContext, useSyncExternalStore } from 'react';
import type { GameController } from '../game/controller';

export const GameContext = createContext<GameController | null>(null);

/** Returns the controller and re-renders whenever it publishes an update. */
export function useGame(): GameController {
  const ctrl = useContext(GameContext);
  if (!ctrl) throw new Error('useGame must be used inside GameContext');
  useSyncExternalStore(ctrl.subscribe, ctrl.getVersion);
  return ctrl;
}
