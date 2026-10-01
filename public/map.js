// Shared map layout. Both the server (for bullet hit checks) and the
// browser (for drawing walls and stopping the player) read this file.
// Each wall is a box centered at (x, z) with width w (along x),
// depth d (along z) and height h.

export const ARENA_SIZE = 60; // the floor runs from -30 to +30 on x and z

export const WALLS = [
  // Outer boundary
  { x: 0, z: -30, w: 60, d: 1, h: 6 },
  { x: 0, z: 30, w: 60, d: 1, h: 6 },
  { x: -30, z: 0, w: 1, d: 60, h: 6 },
  { x: 30, z: 0, w: 1, d: 60, h: 6 },

  // Center structure
  { x: 0, z: 0, w: 8, d: 8, h: 4 },

  // Cover pieces
  { x: -14, z: -14, w: 6, d: 1, h: 2.5 },
  { x: 14, z: 14, w: 6, d: 1, h: 2.5 },
  { x: -14, z: 14, w: 1, d: 6, h: 2.5 },
  { x: 14, z: -14, w: 1, d: 6, h: 2.5 },
  { x: 0, z: -20, w: 10, d: 1, h: 3 },
  { x: 0, z: 20, w: 10, d: 1, h: 3 },
  { x: -20, z: 0, w: 1, d: 10, h: 3 },
  { x: 20, z: 0, w: 1, d: 10, h: 3 },

  // Low crates you can hide behind
  { x: -7, z: -24, w: 2, d: 2, h: 1.2 },
  { x: 7, z: 24, w: 2, d: 2, h: 1.2 },
  { x: -24, z: 7, w: 2, d: 2, h: 1.2 },
  { x: 24, z: -7, w: 2, d: 2, h: 1.2 },
];

export const SPAWN_POINTS = [
  { x: -25, z: -25 }, { x: 25, z: 25 }, { x: -25, z: 25 }, { x: 25, z: -25 },
  { x: 0, z: -25 }, { x: 0, z: 25 }, { x: -25, z: 0 }, { x: 25, z: 0 },
  { x: -10, z: -8 }, { x: 10, z: 8 },
];

export const EYE_HEIGHT = 1.6;    // camera height above the ground
export const PLAYER_RADIUS = 0.4; // used for bumping into walls
