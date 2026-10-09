// kits.js — every kit's numbers live here. The server uses them for the
// rules (health, damage, fire rate) and the browser uses them for movement,
// zoom and the kit menu. Change a number here and both sides follow.
//
// For reference, a "normal" player has:
//   maxHealth 100, speed 7, damage 25 (headshot 50), fireMs 200 (5 shots/second), 1 jump

export const KITS = {
  tank: {
    name: 'Tank',
    strength: '150 health',
    weakness: 'Moves about 20% slower',
    maxHealth: 150, speed: 5.6, jumps: 1,
    damage: 25, headDamage: 50, fireMs: 200,
  },
  heavy: {
    name: 'Heavy',
    strength: '40 damage per hit, 80 for a headshot',
    weakness: 'Fires half as fast',
    maxHealth: 100, speed: 7, jumps: 1,
    damage: 40, headDamage: 80, fireMs: 400,
  },
  ninja: {
    name: 'Ninja',
    strength: 'Moves about 30% faster, double jump',
    weakness: '75 health',
    maxHealth: 75, speed: 9.1, jumps: 2,
    damage: 25, headDamage: 50, fireMs: 200,
  },
  gunner: {
    name: 'Gunner',
    strength: 'Fires twice as fast',
    weakness: '14 damage per hit, 28 for a headshot',
    maxHealth: 100, speed: 7, jumps: 1,
    damage: 14, headDamage: 28, fireMs: 100,
  },
  sniper: {
    name: 'Sniper',
    strength: 'Press Q to zoom. 50 damage, headshots kill instantly',
    weakness: 'Fires once per second',
    maxHealth: 100, speed: 7, jumps: 1,
    damage: 50, headDamage: 1000, fireMs: 1000,
    zoom: true,
  },
  shotgun: {
    name: 'Shotgun',
    strength: '6 pellets of 10 damage each, up to 60 up close',
    weakness: 'Pellets spread out at range, fires slower',
    maxHealth: 100, speed: 7, jumps: 1,
    damage: 10, headDamage: 20, fireMs: 700,
    pellets: 6, spread: 0.07, // spread is the cone angle in radians
  },
  medic: {
    name: 'Medic',
    strength: 'Heals slowly after 4 seconds without taking damage',
    weakness: '18 damage per hit, 36 for a headshot',
    maxHealth: 100, speed: 7, jumps: 1,
    damage: 18, headDamage: 36, fireMs: 200,
    regen: { delayMs: 4000, perSecond: 6 }, // about 17 seconds from empty to full
  },
  vampire: {
    name: 'Vampire',
    strength: 'Every hit you land heals you 10 health',
    weakness: '80 max health',
    maxHealth: 80, speed: 7, jumps: 1,
    damage: 25, headDamage: 50, fireMs: 200,
    lifesteal: 10,
  },
};

export const DEFAULT_KIT = 'tank';
