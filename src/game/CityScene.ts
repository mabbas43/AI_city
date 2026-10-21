// Phaser scene that renders the city. It never mutates the simulation
// directly: interactions are forwarded to the GameController.

import Phaser from 'phaser';
import { BUILDING_DEFS, getBuilding, type Building, type Citizen, type World } from '../sim';
import { activeEffect } from '../sim/effects';
import { pollutionAt, serviceCoverageAt } from '../sim/environment';
import { isDaylight } from '../sim/power';
import { hourOf } from '../sim/time';
import type { GameController } from './controller';
import { ACTION_COLORS, BUILDING_ACCENT, CATEGORY_COLORS, MAP } from './palette';

export const TILE = 32;
const OUTDOOR_VENUES = new Set(['park', 'cityHall']);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

function hash(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0x5bd1e995) >>> 0;
  return (x ^ (x >>> 15)) / 4294967296;
}

/** Window slots for occupancy lighting, in pixel coordinates. */
function windowSlots(b: Building): Rect[] {
  const px = b.x * TILE;
  const py = b.y * TILE;
  const W = b.w * TILE;
  const H = b.h * TILE;
  const grid = (cols: number, rows: number, inset: number, size: number): Rect[] => {
    const out: Rect[] = [];
    const gw = (W - inset * 2) / cols;
    const gh = (H - inset * 2) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: px + inset + c * gw + (gw - size) / 2, y: py + inset + r * gh + (gh - size) / 2, w: size, h: size * 0.75 });
    return out;
  };
  switch (b.type) {
    case 'house':
      return grid(2, 2, 14, 8);
    case 'apartment':
      return grid(3, 4, 12, 7);
    case 'office':
      return grid(4, 3, 10, 7);
    case 'factory':
      return grid(4, 1, 14, 9).map((r) => ({ ...r, y: py + H - 22 }));
    case 'shop':
    case 'market':
      return grid(b.w * 2, 1, 10, 8).map((r) => ({ ...r, y: py + H * 0.42 }));
    case 'clinic':
    case 'school':
      return grid(2, 2, 8, 6);
    case 'cityHall':
      return grid(5, 1, 14, 7).map((r) => ({ ...r, y: py + H - 26 }));
    default:
      return [];
  }
}

export class CityScene extends Phaser.Scene {
  private ground!: Phaser.GameObjects.Graphics;
  private statics!: Phaser.GameObjects.Graphics;
  private night!: Phaser.GameObjects.Graphics;
  private dynamic!: Phaser.GameObjects.Graphics;
  private people!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private heat!: Phaser.GameObjects.Graphics;
  private weatherFx!: Phaser.GameObjects.Graphics;
  private bubbles: Phaser.GameObjects.Text[] = [];
  private heatKey = '';
  private heatAt = 0;
  private hoverLabel!: Phaser.GameObjects.Text;
  private selectLabel!: Phaser.GameObjects.Text;
  private hintLabel!: Phaser.GameObjects.Text;
  private renderedMap = -1;
  private renderedWorld: World | null = null;
  private hoverTile: { x: number; y: number } | null = null;
  private screenPositions = new Map<number, { x: number; y: number }>();
  private drag: { startX: number; startY: number; scrollX: number; scrollY: number; panning: boolean; button: number } | null = null;
  private lastPaintTile = '';
  private fitted = false;

  constructor(private ctrl: GameController) {
    super('city');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(MAP.background);
    this.ground = this.add.graphics();
    this.statics = this.add.graphics();
    this.night = this.add.graphics();
    this.dynamic = this.add.graphics();
    this.heat = this.add.graphics();
    this.people = this.add.graphics();
    this.weatherFx = this.add.graphics();
    this.overlay = this.add.graphics();
    const labelStyle = { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#e6f1ff', backgroundColor: '#0b1222cc', padding: { x: 6, y: 3 } };
    this.hoverLabel = this.add.text(0, 0, '', labelStyle).setDepth(10).setVisible(false).setResolution(2);
    this.selectLabel = this.add.text(0, 0, '', { ...labelStyle, color: '#2ee6d6' }).setDepth(10).setVisible(false).setResolution(2);
    this.hintLabel = this.add.text(0, 0, '', { ...labelStyle, color: '#fca5a5' }).setDepth(11).setVisible(false).setResolution(2);
    for (let i = 0; i < 12; i++) {
      this.bubbles.push(
        this.add
          .text(0, 0, '', { fontFamily: 'Inter, sans-serif', fontSize: '10px', fontStyle: 'bold', color: '#0b1222', backgroundColor: '#e6f1ff', padding: { x: 4, y: 2 } })
          .setDepth(9)
          .setOrigin(0.5, 1)
          .setResolution(2)
          .setVisible(false),
      );
    }

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('gameout', () => (this.hoverTile = null));
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.zoomAt(p, dy));
    this.scale.on('resize', () => this.fitCamera(false));
    this.fitCamera(true);
  }

  private mapPixelSize(): { w: number; h: number } {
    return { w: this.ctrl.world.width * TILE, h: this.ctrl.world.height * TILE };
  }

  private fitCamera(force: boolean): void {
    const cam = this.cameras.main;
    const { w, h } = this.mapPixelSize();
    const vw = this.scale.width;
    const vh = this.scale.height;
    if (force || !this.fitted) {
      cam.setZoom(Phaser.Math.Clamp(Math.min(vw / w, vh / h) * 0.98, 0.4, 2.5));
      cam.centerOn(w / 2, h / 2);
      this.fitted = true;
    }
    cam.setBounds(-w * 0.5, -h * 0.5, w * 2, h * 2);
  }

  private zoomAt(p: Phaser.Input.Pointer, dy: number): void {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(p.x, p.y);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.4, 3));
    const after = cam.getWorldPoint(p.x, p.y);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  private tileOf(p: Phaser.Input.Pointer): { x: number; y: number; wx: number; wy: number } {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: Math.floor(wp.x / TILE), y: Math.floor(wp.y / TILE), wx: wp.x, wy: wp.y };
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    const cam = this.cameras.main;
    this.drag = { startX: p.x, startY: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY, panning: p.button !== 0, button: p.button };
    const tool = this.ctrl.tool;
    if (p.button === 0 && tool.kind !== 'select') {
      const t = this.tileOf(p);
      // Building placement is offset so the cursor sits in the footprint centre.
      const [ox, oy] = tool.kind === 'build' ? this.buildOffset() : [0, 0];
      this.lastPaintTile = `${t.x},${t.y}`;
      this.ctrl.applyTool(t.x - ox, t.y - oy);
    }
  }

  private buildOffset(): [number, number] {
    const tool = this.ctrl.tool;
    if (tool.kind !== 'build') return [0, 0];
    const d = BUILDING_DEFS[tool.type];
    return [Math.floor((d.w - 1) / 2), Math.floor((d.h - 1) / 2)];
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const t = this.tileOf(p);
    this.hoverTile = { x: t.x, y: t.y };
    const d = this.drag;
    if (!d || !p.isDown) return;
    const tool = this.ctrl.tool;
    const moved = Math.hypot(p.x - d.startX, p.y - d.startY) > 5;
    if (d.button === 0 && (tool.kind === 'road' || tool.kind === 'bulldoze')) {
      const key = `${t.x},${t.y}`;
      if (key !== this.lastPaintTile) {
        this.lastPaintTile = key;
        this.ctrl.applyTool(t.x, t.y, true);
      }
      return;
    }
    if (moved && (d.button !== 0 || tool.kind === 'select')) d.panning = true;
    if (d.panning) {
      const cam = this.cameras.main;
      cam.scrollX = d.scrollX - (p.x - d.startX) / cam.zoom;
      cam.scrollY = d.scrollY - (p.y - d.startY) / cam.zoom;
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.panning || d.button !== 0 || this.ctrl.tool.kind !== 'select') return;
    const t = this.tileOf(p);
    const citizen = this.citizenAt(t.wx, t.wy);
    if (citizen !== null) return this.ctrl.select({ kind: 'citizen', id: citizen });
    const b = this.ctrl.world.buildings.find((x) => t.x >= x.x && t.x < x.x + x.w && t.y >= x.y && t.y < x.y + x.h);
    this.ctrl.select(b ? { kind: 'building', id: b.id } : null);
  }

  private citizenAt(wx: number, wy: number): number | null {
    let best: number | null = null;
    let bestD = TILE * 0.45;
    for (const [id, pos] of this.screenPositions) {
      const dd = Math.hypot(pos.x - wx, pos.y - wy);
      if (dd < bestD) {
        bestD = dd;
        best = id;
      }
    }
    return best;
  }

  update(time: number): void {
    const world = this.ctrl.world;
    if (this.renderedMap !== this.ctrl.mapVersion || this.renderedWorld !== world) {
      if (this.renderedWorld !== world) this.fitCamera(true);
      this.drawGround(world);
      this.drawStatics(world);
      this.renderedMap = this.ctrl.mapVersion;
      this.renderedWorld = world;
    }
    this.drawNight(world);
    this.drawDynamic(world, time);
    this.drawHeat(world, time);
    this.drawCitizens(world, time);
    this.drawBubbles(world, time);
    this.drawWeather(world, time);
    this.drawOverlay(world, time);
  }

  // ---------- static layers ----------
  private drawGround(world: World): void {
    const g = this.ground;
    g.clear();
    g.fillStyle(MAP.ground, 1);
    g.fillRect(0, 0, world.width * TILE, world.height * TILE);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if ((x + y) % 2 === 0) {
          g.fillStyle(MAP.groundAlt, 1);
          g.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }
    g.lineStyle(1, MAP.grid, 0.6);
    for (let x = 0; x <= world.width; x++) g.lineBetween(x * TILE, 0, x * TILE, world.height * TILE);
    for (let y = 0; y <= world.height; y++) g.lineBetween(0, y * TILE, world.width * TILE, y * TILE);

    const road = (x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height && world.tiles[y * world.width + x] === 'road';
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (!road(x, y)) continue;
        const px = x * TILE;
        const py = y * TILE;
        g.fillStyle(MAP.road, 1);
        g.fillRect(px, py, TILE, TILE);
        g.lineStyle(1, MAP.roadEdge, 1);
        if (!road(x, y - 1)) g.lineBetween(px, py + 0.5, px + TILE, py + 0.5);
        if (!road(x, y + 1)) g.lineBetween(px, py + TILE - 0.5, px + TILE, py + TILE - 0.5);
        if (!road(x - 1, y)) g.lineBetween(px + 0.5, py, px + 0.5, py + TILE);
        if (!road(x + 1, y)) g.lineBetween(px + TILE - 0.5, py, px + TILE - 0.5, py + TILE);
        g.fillStyle(MAP.roadLine, 0.35);
        const h = road(x - 1, y) || road(x + 1, y);
        const v = road(x, y - 1) || road(x, y + 1);
        if (h) g.fillRect(px + 9, py + TILE / 2 - 1, 14, 2);
        if (v) g.fillRect(px + TILE / 2 - 1, py + 9, 2, 14);
        if (!h && !v) g.fillRect(px + 13, py + 13, 6, 6);
      }
    }
  }

  private drawStatics(world: World): void {
    const g = this.statics;
    g.clear();
    for (const b of world.buildings) this.drawBuilding(g, b);
  }

  private drawBuilding(g: Phaser.GameObjects.Graphics, b: Building): void {
    const d = BUILDING_DEFS[b.type];
    const color = BUILDING_ACCENT[b.type] ?? CATEGORY_COLORS[d.category];
    const px = b.x * TILE + 3;
    const py = b.y * TILE + 3;
    const W = b.w * TILE - 6;
    const H = b.h * TILE - 6;
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(px + 3, py + 4, W, H, 6);

    if (b.type === 'park') {
      g.fillStyle(0x12382a, 1);
      g.fillRoundedRect(px, py, W, H, 8);
      g.lineStyle(1.5, color, 0.9);
      g.strokeRoundedRect(px, py, W, H, 8);
      g.lineStyle(3, 0x1f5a43, 1);
      g.lineBetween(px + 8, py + H / 2, px + W - 8, py + H / 2);
      g.lineBetween(px + W / 2, py + 8, px + W / 2, py + H - 8);
      g.fillStyle(0x2f9e6e, 1);
      for (const [tx, ty, r] of [[0.22, 0.22, 9], [0.78, 0.25, 8], [0.25, 0.78, 8], [0.75, 0.76, 10], [0.5, 0.5, 6]]) g.fillCircle(px + W * tx, py + H * ty, r);
      g.fillStyle(0x56d39c, 0.6);
      for (const [tx, ty, r] of [[0.2, 0.19, 4], [0.76, 0.22, 3], [0.23, 0.75, 3], [0.73, 0.72, 4]]) g.fillCircle(px + W * tx, py + H * ty, r);
      return;
    }

    g.fillStyle(mix(MAP.ground, color, 0.22), 1);
    g.fillRoundedRect(px, py, W, H, 6);
    g.lineStyle(1.5, color, 0.95);
    g.strokeRoundedRect(px, py, W, H, 6);
    g.fillStyle(color, 0.9);
    g.fillRect(px + 6, py + 1, W - 12, 2);

    switch (b.type) {
      case 'house':
        g.lineStyle(1, color, 0.5);
        g.lineBetween(px + 6, py + H / 2, px + W - 6, py + H / 2);
        break;
      case 'apartment':
        g.fillStyle(mix(MAP.ground, color, 0.35), 1);
        g.fillRoundedRect(px + 6, py + 6, W - 12, H - 12, 4);
        break;
      case 'factory':
        g.lineStyle(1.5, color, 0.7);
        for (let i = 0; i < 4; i++) {
          const sx = px + 10 + i * 16;
          g.lineBetween(sx, py + 22, sx + 8, py + 10);
          g.lineBetween(sx + 8, py + 10, sx + 8, py + 22);
        }
        g.fillStyle(color, 0.9);
        g.fillRect(px + W - 18, py + 6, 8, 16);
        break;
      case 'shop':
      case 'market': {
        const stripes = b.w * 3;
        const sw = (W - 8) / stripes;
        for (let i = 0; i < stripes; i++) {
          g.fillStyle(i % 2 === 0 ? color : 0xe6f1ff, i % 2 === 0 ? 0.85 : 0.25);
          g.fillRect(px + 4 + i * sw, py + 8, sw, 9);
        }
        break;
      }
      case 'powerStation':
        g.lineStyle(2, color, 0.6);
        g.strokeCircle(px + W / 2, py + H / 2, W * 0.3);
        g.fillStyle(mix(MAP.ground, color, 0.4), 1);
        g.fillCircle(px + W / 2, py + H / 2, W * 0.18);
        break;
      case 'solarArray':
        g.fillStyle(0x1d3b7a, 1);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.fillRect(px + 6 + c * ((W - 12) / 3), py + 6 + r * ((H - 12) / 3), (W - 12) / 3 - 3, (H - 12) / 3 - 3);
        break;
      case 'clinic':
        g.fillStyle(0xef4444, 1);
        g.fillRect(px + W / 2 - 4, py + 10, 8, 22);
        g.fillRect(px + W / 2 - 11, py + 17, 22, 8);
        break;
      case 'school':
        g.fillStyle(color, 0.9);
        g.fillTriangle(px + W / 2, py + 6, px + W / 2 - 14, py + 18, px + W / 2 + 14, py + 18);
        g.lineStyle(1.5, color, 0.8);
        g.lineBetween(px + W / 2, py + 6, px + W / 2, py - 2);
        g.fillRect(px + W / 2, py - 2, 7, 4);
        break;
      case 'cityHall':
        g.fillStyle(mix(MAP.ground, color, 0.45), 1);
        g.fillCircle(px + W / 2, py + H * 0.38, 18);
        g.lineStyle(1.5, color, 0.9);
        g.strokeCircle(px + W / 2, py + H * 0.38, 18);
        g.fillStyle(color, 0.8);
        for (let i = 0; i < 6; i++) g.fillRect(px + 14 + i * ((W - 28) / 5) - 1.5, py + H - 40, 3, 12);
        break;
    }
    for (const r of windowSlots(b)) {
      g.fillStyle(MAP.windowDark, 1);
      g.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  // ---------- dynamic layers ----------
  private darkness(world: World): number {
    const h = hourOf(world.tick);
    if (h >= 20 || h < 5) return 0.42;
    if (h >= 18) return ((h - 18) / 2) * 0.42;
    if (h < 7) return ((7 - h) / 2) * 0.42;
    return 0;
  }

  private drawNight(world: World): void {
    const g = this.night;
    g.clear();
    const a = this.darkness(world);
    if (a <= 0) return;
    g.fillStyle(0x020617, a);
    g.fillRect(-world.width * TILE, -world.height * TILE, world.width * TILE * 3, world.height * TILE * 3);
  }

  private drawDynamic(world: World, time: number): void {
    const g = this.dynamic;
    g.clear();
    const inside = new Map<number, number>();
    for (const c of world.citizens) if (c.insideId !== null && c.activity.kind !== 'traveling') inside.set(c.insideId, (inside.get(c.insideId) ?? 0) + 1);
    const blink = Math.floor(time / 450) % 2 === 0;
    const night = this.darkness(world) > 0.1;
    const festival = !!activeEffect(world, 'festival');

    for (const b of world.buildings) {
      const d = BUILDING_DEFS[b.type];
      const px = b.x * TILE + 3;
      const py = b.y * TILE + 3;
      const W = b.w * TILE - 6;
      const H = b.h * TILE - 6;
      const working = b.status === 'operational' && (b.powered || d.powerDemand === 0);
      const slots = windowSlots(b);
      if (slots.length && working) {
        const occupants = inside.get(b.id) ?? 0;
        const capacity = Math.max(1, d.housing || d.jobs || 4);
        const lit = Math.min(slots.length, Math.ceil((occupants / capacity) * slots.length));
        // Stable per-building order so the same windows light up each frame.
        const order = slots.map((_, i) => i).sort((i, j) => hash(b.id * 97 + i) - hash(b.id * 97 + j));
        for (let i = 0; i < lit; i++) {
          const r = slots[order[i]];
          g.fillStyle(MAP.windowLit, night ? 1 : 0.85);
          g.fillRect(r.x, r.y, r.w, r.h);
          if (night) {
            g.fillStyle(MAP.windowLit, 0.12);
            g.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
          }
        }
      }
      if (b.type === 'powerStation' && working) {
        const out = b.unpaidUpkeepHours >= 6 ? 0 : 1;
        const pulse = (Math.sin(time / 380) + 1) / 2;
        g.lineStyle(2, 0xffe08a, 0.25 + pulse * 0.5 * out);
        g.strokeCircle(px + W / 2, py + H / 2, W * 0.18 + pulse * 10 * out);
        g.fillStyle(0xffe08a, 0.5 + pulse * 0.4 * out);
        g.fillCircle(px + W / 2, py + H / 2, 6);
      }
      if (b.type === 'solarArray' && isDaylight(world.tick)) {
        const sweep = ((time / 2400) % 1) * (W + 20) - 10;
        g.fillStyle(0xbfe3ff, 0.18);
        g.fillRect(px + Math.max(0, sweep), py + 4, 6, H - 8);
      }
      if (b.type === 'factory' && working && (inside.get(b.id) ?? 0) > 0) {
        for (let i = 0; i < 3; i++) {
          const t = ((time / 1800 + i / 3) % 1);
          g.fillStyle(0x9aa7bd, 0.35 * (1 - t));
          g.fillCircle(px + W - 14 + Math.sin(t * 6 + i) * 3, py + 4 - t * 26, 4 + t * 6);
        }
      }
      if (b.status === 'closed') {
        g.fillStyle(0x0b1020, 0.65);
        g.fillRoundedRect(px, py, W, H, 6);
        g.lineStyle(2, 0x64748b, 0.9);
        g.lineBetween(px + 6, py + 6, px + W - 6, py + H - 6);
        g.lineBetween(px + W - 6, py + 6, px + 6, py + H - 6);
      } else if (!b.powered && d.powerDemand > 0) {
        g.fillStyle(0x0b1020, 0.45);
        g.fillRoundedRect(px, py, W, H, 6);
        if (blink) {
          g.fillStyle(MAP.warning, 1);
          g.fillTriangle(px + W - 14, py + 18, px + W - 4, py + 18, px + W - 9, py + 8);
        }
      }
      if (!b.connected && b.status === 'operational') {
        g.lineStyle(1.5, 0xfacc15, blink ? 0.9 : 0.3);
        g.strokeRoundedRect(px - 2, py - 2, W + 4, H + 4, 7);
      }
      if (festival && (b.type === 'park' || b.type === 'cityHall')) this.drawBunting(g, px, py, W, time + b.id * 300);
    }
  }

  private drawBunting(g: Phaser.GameObjects.Graphics, px: number, py: number, W: number, time: number): void {
    const colors = [0xf472b6, 0xfacc15, 0x2ee6d6, 0xa78bfa, 0x34d399];
    const flags = Math.floor(W / 9);
    g.lineStyle(1, 0xe6f1ff, 0.6);
    g.lineBetween(px, py - 2, px + W, py - 2);
    for (let i = 0; i < flags; i++) {
      const x = px + 4 + i * 9;
      const sway = Math.sin(time / 260 + i) * 1.5;
      g.fillStyle(colors[i % colors.length], 0.95);
      g.fillTriangle(x - 3, py - 2, x + 3, py - 2, x + sway, py + 5);
    }
  }

  // ---------- data overlays ----------
  private drawHeat(world: World, time: number): void {
    const mode = this.ctrl.overlay;
    const key = `${mode}:${this.ctrl.mapVersion}`;
    // Pollution and coverage change slowly; recompute a few times a second at most.
    if (key === this.heatKey && time - this.heatAt < 400) return;
    this.heatKey = key;
    this.heatAt = time;
    const g = this.heat;
    g.clear();
    if (mode === 'none') return;
    if (mode === 'happiness') {
      for (const b of world.buildings) {
        if (BUILDING_DEFS[b.type].housing === 0) continue;
        const res = world.citizens.filter((c) => c.homeId === b.id);
        const mood = res.length ? res.reduce((s, c) => s + c.needs.happiness, 0) / res.length : null;
        const color = mood === null ? 0x475569 : mood >= 45 ? mix(0xf59e0b, 0x34d399, Math.min(1, (mood - 45) / 25)) : mix(0xef4444, 0xf59e0b, Math.max(0, (mood - 20) / 25));
        g.fillStyle(color, 0.55);
        g.fillRoundedRect(b.x * TILE + 2, b.y * TILE + 2, b.w * TILE - 4, b.h * TILE - 4, 6);
      }
      return;
    }
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (mode === 'pollution') {
          const p = pollutionAt(world, x + 0.5, y + 0.5);
          if (p < 0.05) continue;
          g.fillStyle(mix(0xa16207, 0x7c2d12, p), 0.12 + p * 0.5);
        } else {
          const n = serviceCoverageAt(world, x + 0.5, y + 0.5);
          g.fillStyle([0x3f1d2e, 0x5b3fd1, 0x7c5cff, 0x2ee6d6][n], n === 0 ? 0.35 : 0.22 + n * 0.06);
        }
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  // ---------- weather ----------
  private drawWeather(world: World, time: number): void {
    const g = this.weatherFx;
    g.clear();
    const kind = world.weather.kind;
    if (kind === 'clear') return;
    const W = world.width * TILE;
    const H = world.height * TILE;
    const cover = (color: number, alpha: number) => {
      g.fillStyle(color, alpha);
      g.fillRect(-W, -H, W * 3, H * 3);
    };
    if (kind === 'heatwave') {
      cover(0xff7a1a, 0.06 + Math.sin(time / 900) * 0.015);
      return;
    }
    cover(0x1e293b, kind === 'cloudy' ? 0.12 : kind === 'rain' ? 0.18 : 0.26);
    // Slow cloud shadows drifting east.
    for (let i = 0; i < 5; i++) {
      const cx = ((time / 60 + i * 397) % (W + 400)) - 200;
      const cy = (hash(i + 3) * H) | 0;
      g.fillStyle(0x020617, 0.08);
      g.fillEllipse(cx, cy, 260, 120);
    }
    if (kind === 'cloudy') return;
    const drops = kind === 'storm' ? 260 : 150;
    const speed = kind === 'storm' ? 0.9 : 0.6;
    g.lineStyle(1, 0x93c5fd, kind === 'storm' ? 0.45 : 0.35);
    for (let i = 0; i < drops; i++) {
      const x = hash(i * 31 + 7) * (W + 100) - 50;
      const y = ((hash(i * 17 + 3) * H + time * speed) % (H + 40)) - 20;
      g.lineBetween(x, y, x - 4, y + 11);
    }
    if (kind === 'storm') {
      const phase = (time % 5200) / 5200;
      if (phase < 0.025 || (phase > 0.05 && phase < 0.065)) cover(0xe0f2fe, 0.22);
    }
  }

  private drawBubbles(world: World, time: number): void {
    let n = 0;
    for (const c of world.citizens) {
      if (n >= this.bubbles.length) break;
      const m = c.memories[c.memories.length - 1];
      if (!m || Math.abs(m.impact) < 8 || world.tick - m.tick > 24) continue;
      const p = this.screenPositions.get(c.id) ?? this.doorOf(world, c);
      if (!p) continue;
      const label = bubbleText(m.text, m.impact);
      const bubble = this.bubbles[n++];
      const bob = Math.sin(time / 400 + c.id) * 1.5;
      bubble
        .setText(label)
        .setBackgroundColor(m.impact > 0 ? '#bbf7d0' : '#fecaca')
        .setPosition(p.x, p.y - 9 + bob)
        .setAlpha(Math.min(1, (24 - (world.tick - m.tick)) / 6))
        .setVisible(true);
    }
    for (let i = n; i < this.bubbles.length; i++) this.bubbles[i].setVisible(false);
  }

  private doorOf(world: World, c: Citizen): { x: number; y: number } | null {
    const b = getBuilding(world, c.insideId);
    return b ? { x: (b.entrance.x + 0.5) * TILE, y: (b.entrance.y + 0.5) * TILE } : null;
  }

  private citizenPosition(world: World, c: Citizen, time: number, alpha: number): { x: number; y: number } | null {
    const a = c.activity;
    if (a.kind === 'traveling') {
      const t = Math.min(1, (c.stepElapsed + alpha) / Math.max(1, c.stepTicks));
      return { x: (c.prevPos.x + (c.pos.x - c.prevPos.x) * t + 0.5) * TILE, y: (c.prevPos.y + (c.pos.y - c.prevPos.y) * t + 0.5) * TILE };
    }
    if (c.insideId !== null) {
      const b = getBuilding(world, c.insideId);
      if (b && OUTDOOR_VENUES.has(b.type)) {
        const hx = hash(c.id * 7 + 1);
        const hy = hash(c.id * 13 + 5);
        const wob = Math.sin(time / 900 + c.id) * 2;
        return { x: (b.x + 0.4 + hx * (b.w - 0.8)) * TILE + wob, y: (b.y + 0.4 + hy * (b.h - 0.8)) * TILE + Math.cos(time / 1100 + c.id) * 2 };
      }
      if (b) return null; // inside a building: shown through window lights
    }
    return { x: (c.pos.x + 0.5) * TILE, y: (c.pos.y + 0.5) * TILE };
  }

  private drawCitizens(world: World, time: number): void {
    const g = this.people;
    g.clear();
    this.screenPositions.clear();
    const alpha = this.ctrl.clock.alpha;
    const sel = this.ctrl.selection;
    for (const c of world.citizens) {
      const p = this.citizenPosition(world, c, time, alpha);
      if (!p) continue;
      this.screenPositions.set(c.id, p);
      const action = c.activity.kind === 'idle' ? 'idle' : c.activity.action;
      const color = ACTION_COLORS[action];
      const travelling = c.activity.kind === 'traveling';
      g.fillStyle(0x000000, 0.4);
      g.fillCircle(p.x + 1, p.y + 2, 5);
      g.fillStyle(color, 1);
      g.fillCircle(p.x, p.y, travelling ? 4.5 : 5);
      g.lineStyle(1.2, 0x0b1222, 1);
      g.strokeCircle(p.x, p.y, travelling ? 4.5 : 5);
      if (c.needs.happiness < 30 || action === 'protest') {
        g.fillStyle(MAP.warning, 0.85);
        g.fillCircle(p.x + 4, p.y - 4, 2);
      }
      if (!travelling && action !== 'idle' && action !== 'wait') {
        const pulse = (Math.sin(time / 300 + c.id) + 1) / 2;
        g.lineStyle(1, color, 0.25 + pulse * 0.35);
        g.strokeCircle(p.x, p.y, 7 + pulse * 2);
      }
    }
    if (sel?.kind === 'citizen' && !this.screenPositions.has(sel.id)) {
      const c = world.citizens.find((x) => x.id === sel.id);
      const b = c ? getBuilding(world, c.insideId) : undefined;
      if (c && b) this.screenPositions.set(c.id, { x: (b.entrance.x + 0.5) * TILE, y: (b.entrance.y + 0.5) * TILE });
    }
  }

  private drawOverlay(world: World, time: number): void {
    const g = this.overlay;
    g.clear();
    const sel = this.ctrl.selection;
    const pulse = (Math.sin(time / 250) + 1) / 2;
    this.selectLabel.setVisible(false);
    this.hoverLabel.setVisible(false);
    this.hintLabel.setVisible(false);

    if (sel?.kind === 'building') {
      const b = getBuilding(world, sel.id);
      if (b) {
        g.lineStyle(2, MAP.select, 0.6 + pulse * 0.4);
        g.strokeRoundedRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE, 8);
        g.fillStyle(MAP.select, 0.9);
        g.fillCircle((b.entrance.x + 0.5) * TILE, (b.entrance.y + 0.5) * TILE, 3);
      }
    } else if (sel?.kind === 'citizen') {
      const c = world.citizens.find((x) => x.id === sel.id);
      const p = this.screenPositions.get(sel.id);
      if (c && p) {
        if (c.activity.kind === 'traveling' && c.activity.path.length) {
          g.lineStyle(2, MAP.select, 0.55);
          g.beginPath();
          g.moveTo(p.x, p.y);
          for (const s of c.activity.path) g.lineTo((s.x + 0.5) * TILE, (s.y + 0.5) * TILE);
          g.strokePath();
          const dest = c.activity.destination;
          g.strokeCircle((dest.x + 0.5) * TILE, (dest.y + 0.5) * TILE, 6);
        }
        const target = c.activity.kind !== 'idle' ? getBuilding(world, c.activity.targetId) : undefined;
        if (target) {
          g.lineStyle(1.5, MAP.select, 0.4);
          g.strokeRoundedRect(target.x * TILE, target.y * TILE, target.w * TILE, target.h * TILE, 8);
        }
        g.lineStyle(2, MAP.select, 1);
        g.strokeCircle(p.x, p.y, 9 + pulse * 3);
        this.selectLabel.setText(c.name).setPosition(p.x + 12, p.y - 26).setVisible(true);
      }
    }

    const hover = this.hoverTile;
    if (!hover) return;
    const tool = this.ctrl.tool;
    if (tool.kind === 'build' || tool.kind === 'road') {
      const [ox, oy] = this.buildOffset();
      const x = hover.x - ox;
      const y = hover.y - oy;
      const w = tool.kind === 'build' ? BUILDING_DEFS[tool.type].w : 1;
      const h = tool.kind === 'build' ? BUILDING_DEFS[tool.type].h : 1;
      const check = this.ctrl.previewTool(x, y);
      const color = check.ok ? MAP.valid : MAP.invalid;
      g.fillStyle(color, 0.22);
      g.fillRect(x * TILE, y * TILE, w * TILE, h * TILE);
      g.lineStyle(2, color, 0.9);
      g.strokeRect(x * TILE, y * TILE, w * TILE, h * TILE);
      if (!check.ok && check.reason) this.hintLabel.setText(check.reason).setPosition((x + w) * TILE + 6, y * TILE - 4).setVisible(true);
    } else if (tool.kind === 'bulldoze') {
      const b = world.buildings.find((x) => hover.x >= x.x && hover.x < x.x + x.w && hover.y >= x.y && hover.y < x.y + x.h);
      g.lineStyle(2, MAP.invalid, 0.9);
      if (b) {
        g.fillStyle(MAP.invalid, 0.18);
        g.fillRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
        g.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
      } else g.strokeRect(hover.x * TILE, hover.y * TILE, TILE, TILE);
    } else {
      const wp = { x: (hover.x + 0.5) * TILE, y: (hover.y + 0.5) * TILE };
      const b = world.buildings.find((x) => hover.x >= x.x && hover.x < x.x + x.w && hover.y >= x.y && hover.y < x.y + x.h);
      const pointer = this.input.activePointer;
      const cw = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const cid = this.citizenAt(cw.x, cw.y);
      if (cid !== null && cid !== (sel?.kind === 'citizen' ? sel.id : -1)) {
        const c = world.citizens.find((x) => x.id === cid);
        const p = this.screenPositions.get(cid)!;
        if (c) this.hoverLabel.setText(c.name).setPosition(p.x + 10, p.y - 22).setVisible(true);
      } else if (b && !(sel?.kind === 'building' && sel.id === b.id)) {
        g.lineStyle(1.5, 0xe6f1ff, 0.4);
        g.strokeRoundedRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE, 8);
        const label = `${BUILDING_DEFS[b.type].label}${b.status === 'closed' ? ' · closed' : !b.powered ? ' · no power' : ''}`;
        this.hoverLabel.setText(label).setPosition(b.x * TILE, b.y * TILE - 24).setVisible(true);
      } else if (!b) {
        g.lineStyle(1, 0xe6f1ff, 0.15);
        g.strokeRect(wp.x - TILE / 2, wp.y - TILE / 2, TILE, TILE);
      }
    }
  }
}

/** Short speech-bubble label for a memorable experience. */
function bubbleText(text: string, impact: number): string {
  const rules: [RegExp, string][] = [
    [/^Hired/, 'Hired!'],
    [/^Became friends/, 'New friend'],
    [/^Achieved a goal/, 'Goal!'],
    [/^Moved (to|into)/, 'New home'],
    [/^Got a raise/, 'Raise!'],
    [/^(Laid off|Lost their job)/, 'Laid off'],
    [/^Lost their home/, 'Evicted'],
    [/^Quit/, 'Leaving'],
  ];
  for (const [re, label] of rules) if (re.test(text)) return label;
  return impact > 0 ? 'Great!' : 'Ugh…';
}
