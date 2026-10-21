import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { CityScene } from './CityScene';
import type { GameController } from './controller';
import { MAP } from './palette';

/** Mounts the Phaser canvas into a React-managed container. */
export function PhaserCity({ controller }: { controller: GameController }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      backgroundColor: MAP.background,
      antialias: true,
      scale: { mode: Phaser.Scale.RESIZE, width: host.current.clientWidth, height: host.current.clientHeight },
      scene: new CityScene(controller),
      banner: false,
      audio: { noAudio: true },
    });
    return () => game.destroy(true);
  }, [controller]);

  return <div ref={host} className="map-host" />;
}
