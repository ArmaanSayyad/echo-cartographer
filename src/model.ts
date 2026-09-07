export const BANDS = [125, 250, 500, 1000, 2000, 4000] as const;
export type MaterialId =
  | "plaster"
  | "glass"
  | "curtains"
  | "carpet"
  | "timber"
  | "bookshelves"
  | "panel";
export const MATERIALS: Record<
  MaterialId,
  { name: string; color: string; alpha: number[]; description: string }
> = {
  plaster: {
    name: "Plaster",
    color: "#c6c4b6",
    alpha: [0.02, 0.025, 0.03, 0.04, 0.05, 0.06],
    description: "A hard, reflective painted wall.",
  },
  glass: {
    name: "Glass",
    color: "#87b9ba",
    alpha: [0.18, 0.06, 0.04, 0.03, 0.02, 0.02],
    description: "Reflective glazing; low-frequency behavior varies.",
  },
  curtains: {
    name: "Heavy curtains",
    color: "#aa9383",
    alpha: [0.07, 0.25, 0.45, 0.65, 0.7, 0.6],
    description: "Heavy, pleated fabric with an air gap.",
  },
  carpet: {
    name: "Carpet",
    color: "#939f7e",
    alpha: [0.08, 0.24, 0.57, 0.69, 0.71, 0.73],
    description: "Thick carpet and underlay.",
  },
  timber: {
    name: "Timber",
    color: "#b78d63",
    alpha: [0.15, 0.11, 0.1, 0.07, 0.06, 0.07],
    description: "Timber boards on a solid backing.",
  },
  bookshelves: {
    name: "Bookshelves",
    color: "#a29d83",
    alpha: [0.1, 0.15, 0.25, 0.3, 0.35, 0.4],
    description:
      "Illustrative absorption for irregular shelving; scattering is not modeled.",
  },
  panel: {
    name: "Acoustic panels",
    color: "#a7d5b1",
    alpha: [0.2, 0.55, 0.85, 0.95, 0.95, 0.9],
    description:
      "Generic 100 mm porous absorber. Verify a product’s tested data.",
  },
};
export type Vec2 = { x: number; z: number };
export type Vec3 = Vec2 & { y: number };
export type Provenance = "illustrative" | "inferred" | "user-defined";
export type Wall = {
  id: string;
  a: Vec2;
  b: Vec2;
  material: MaterialId;
  confidence: Provenance;
};
export type Opening = {
  id: string;
  wallId: string;
  kind: "door" | "window";
  offset: number;
  width: number;
  height: number;
  sill: number;
  material: MaterialId;
  confidence: Provenance;
};
export type Furniture = {
  id: string;
  kind: "sofa" | "table" | "shelf" | "rug" | "plant";
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  material: MaterialId;
  confidence: Provenance;
};
export type Treatment = {
  id: string;
  wallId: string;
  offset: number;
  width: number;
  height: number;
  material: MaterialId;
};
export type Calibration = {
  rt60: number;
  r2: number;
  snr: number;
  measuredAt: string;
  scale: number;
  device: string;
  applied: boolean;
  decay: number[];
  impulse: number[];
};
export type Room = {
  version: 1;
  name: string;
  walls: Wall[];
  ceiling: number;
  floorMaterial: MaterialId;
  ceilingMaterial: MaterialId;
  source: Vec3;
  listener: Vec3;
  yaw: number;
  furniture: Furniture[];
  openings: Opening[];
  treatments: Treatment[];
  provenance: Provenance;
  plan?: {
    image: string;
    width: number;
    height: number;
    metersPerPixel: number;
    originX: number;
    originY: number;
  };
  photos: string[];
  calibration?: Calibration;
};
export const uid = () => crypto.randomUUID().slice(0, 8);
export const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const wallLength = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
export const roomArea = (r: Room) =>
  Math.abs(r.walls.reduce((s, w) => s + w.a.x * w.b.z - w.b.x * w.a.z, 0)) / 2;
export function bounds(r: Room) {
  const points = r.walls.flatMap((w) => [w.a, w.b]);
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  };
}
export function inside(p: Vec2, r: Room) {
  let yes = false;
  for (const { a, b } of r.walls)
    if (
      a.z > p.z !== b.z > p.z &&
      p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x
    )
      yes = !yes;
  return yes;
}
export function constrain(p: Vec3, r: Room): Vec3 {
  const b = bounds(r);
  const next = {
    x: Math.max(b.minX + 0.15, Math.min(b.maxX - 0.15, p.x)),
    z: Math.max(b.minZ + 0.15, Math.min(b.maxZ - 0.15, p.z)),
    y: Math.max(0.2, Math.min(r.ceiling - 0.1, p.y)),
  };
  return inside(next, r) ? next : p;
}
export function demoRoom(scene = "demo"): Room {
  const width = scene === "shoebox" ? 6 : 7.2,
    depth = scene === "shoebox" ? 4 : 5.6;
  const points = [
    { x: 0, z: 0 },
    { x: width, z: 0 },
    { x: width, z: depth },
    { x: 0, z: depth },
  ];
  const r: Room = {
    version: 1,
    name: scene === "shoebox" ? "Reference shoebox" : "The listening room",
    ceiling: 2.8,
    walls: points.map((a, i) => ({
      id: `wall-${i}`,
      a,
      b: points[(i + 1) % 4],
      material: "plaster",
      confidence: "illustrative",
    })),
    floorMaterial: "timber",
    ceilingMaterial: "plaster",
    source: { x: 2.05, y: 1.25, z: 1.8 },
    listener: { x: 4.55, y: 1.2, z: 3.5 },
    yaw: Math.atan2(-2.5, 1.7),
    furniture:
      scene === "shoebox"
        ? []
        : [
            {
              id: "rug",
              kind: "rug",
              name: "Woven wool rug",
              x: 3.6,
              z: 3.0,
              width: 3.7,
              depth: 2.9,
              height: 0.03,
              rotation: 0,
              material: "carpet",
              confidence: "illustrative",
            },
            {
              id: "sofa",
              kind: "sofa",
              name: "Linen sofa",
              x: 5.4,
              z: 2.95,
              width: 2.55,
              depth: 0.95,
              height: 0.8,
              rotation: Math.PI / 2,
              material: "curtains",
              confidence: "illustrative",
            },
            {
              id: "table",
              kind: "table",
              name: "Oak coffee table",
              x: 3.75,
              z: 3.05,
              width: 1.45,
              depth: 0.8,
              height: 0.42,
              rotation: 0,
              material: "timber",
              confidence: "illustrative",
            },
            {
              id: "shelf",
              kind: "shelf",
              name: "Library wall",
              x: 5.4,
              z: 0.28,
              width: 2.7,
              depth: 0.4,
              height: 1.95,
              rotation: 0,
              material: "bookshelves",
              confidence: "illustrative",
            },
            {
              id: "plant",
              kind: "plant",
              name: "Ficus",
              x: 0.55,
              z: 0.6,
              width: 0.55,
              depth: 0.55,
              height: 1.5,
              rotation: 0,
              material: "curtains",
              confidence: "illustrative",
            },
          ],
    openings:
      scene === "shoebox"
        ? []
        : [
            {
              id: "window",
              wallId: "wall-3",
              kind: "window",
              offset: 2.5,
              width: 2.3,
              height: 1.7,
              sill: 0.65,
              material: "glass",
              confidence: "illustrative",
            },
            {
              id: "door",
              wallId: "wall-0",
              kind: "door",
              offset: 1.8,
              width: 0.95,
              height: 2.15,
              sill: 0,
              material: "timber",
              confidence: "illustrative",
            },
          ],
    treatments: [],
    photos: [],
    provenance: "illustrative",
  };
  if (scene === "treated")
    r.treatments = [
      {
        id: "reference-panel",
        wallId: "wall-1",
        offset: 2.8,
        width: 3.6,
        height: 2.2,
        material: "panel",
      },
    ];
  return r;
}
function finite(n: unknown, min: number, max: number): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}
const material = (v: unknown): v is MaterialId =>
  typeof v === "string" && Object.hasOwn(MATERIALS, v);
function point(p: unknown): p is Vec2 {
  const v = p as Vec2;
  return !!v && finite(v.x, -100, 100) && finite(v.z, -100, 100);
}
export function validPolygon(points: Vec2[]) {
  if (points.length < 3 || points.length > 32 || points.some((p) => !point(p)))
    return false;
  const orient = (a: Vec2, b: Vec2, c: Vec2) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.25) return false;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        orient(a, b, c) * orient(a, b, d) <= 0 &&
        orient(c, d, a) * orient(c, d, b) <= 0
      )
        return false;
    }
  }
  return (
    Math.abs(
      points.reduce((s, a, i) => {
        const b = points[(i + 1) % points.length];
        return s + a.x * b.z - a.z * b.x;
      }, 0),
    ) /
      2 >
    2
  );
}
export function validateRoom(value: unknown): Room {
  const r = value as Room;
  if (
    !r ||
    r.version !== 1 ||
    typeof r.name !== "string" ||
    r.name.length > 120 ||
    !Array.isArray(r.walls) ||
    !validPolygon(r.walls.map((w) => w.a)) ||
    !finite(r.ceiling, 1.8, 12)
  )
    throw new Error(
      "This is not a valid Echo room. Check the geometry and file version.",
    );
  if (
    r.walls.some(
      (w, i) =>
        !point(w.b) ||
        w.b.x !== r.walls[(i + 1) % r.walls.length].a.x ||
        w.b.z !== r.walls[(i + 1) % r.walls.length].a.z ||
        typeof w.id !== "string" ||
        !material(w.material),
    )
  )
    throw new Error("Walls must form one closed, non-intersecting polygon.");
  if (
    new Set(r.walls.map((w) => w.id)).size !== r.walls.length ||
    !material(r.floorMaterial) ||
    !material(r.ceilingMaterial)
  )
    throw new Error("Invalid room surfaces.");
  for (const p of [r.source, r.listener])
    if (!point(p) || !finite(p.y, 0.1, r.ceiling) || !inside(p, r))
      throw new Error("Speaker and listener must be inside the room.");
  if (
    !finite(r.yaw, -1000, 1000) ||
    !Array.isArray(r.furniture) ||
    r.furniture.length > 80 ||
    !Array.isArray(r.openings) ||
    r.openings.length > 64 ||
    !Array.isArray(r.treatments) ||
    r.treatments.length > 32 ||
    !Array.isArray(r.photos) ||
    r.photos.length > 6
  )
    throw new Error("Unsupported room data.");
  for (const f of r.furniture)
    if (
      !point(f) ||
      !finite(f.width, 0.1, 30) ||
      !finite(f.depth, 0.1, 30) ||
      !finite(f.height, 0.01, 12) ||
      !finite(f.rotation, -100, 100) ||
      !material(f.material) ||
      !["sofa", "table", "shelf", "rug", "plant"].includes(f.kind) ||
      typeof f.id !== "string" ||
      typeof f.name !== "string"
    )
      throw new Error("Invalid furniture dimensions.");
  for (const o of [...r.openings, ...r.treatments]) {
    const w = r.walls.find((w) => w.id === o.wallId);
    if (
      !w ||
      !finite(o.width, 0.1, wallLength(w)) ||
      !finite(o.height, 0.1, r.ceiling) ||
      !finite(o.offset, o.width / 2, wallLength(w) - o.width / 2) ||
      !material(o.material) ||
      typeof o.id !== "string"
    )
      throw new Error("An opening or treatment is outside its wall.");
  }
  for (const o of r.openings)
    if (
      !["door", "window"].includes(o.kind) ||
      !finite(o.sill, 0, r.ceiling - o.height)
    )
      throw new Error("Invalid opening height.");
  const dataImage = (s: unknown) =>
    typeof s === "string" &&
    /^data:image\/(png|jpeg|webp);base64,/.test(s) &&
    s.length < 8_000_000;
  if (r.photos.some((s) => !dataImage(s)))
    throw new Error("Photos must be embedded local images.");
  if (
    r.plan &&
    (!dataImage(r.plan.image) ||
      !finite(r.plan.width, 1, 8000) ||
      !finite(r.plan.height, 1, 8000) ||
      !finite(r.plan.metersPerPixel, 0.0001, 1) ||
      !finite(r.plan.originX, -8000, 8000) ||
      !finite(r.plan.originY, -8000, 8000))
  )
    throw new Error("Invalid floor plan.");
  if (
    r.calibration &&
    (!finite(r.calibration.rt60, 0.1, 5) ||
      !finite(r.calibration.scale, 0.2, 4) ||
      !finite(r.calibration.r2, 0, 1) ||
      !finite(r.calibration.snr, 0, 150) ||
      !Array.isArray(r.calibration.decay) ||
      r.calibration.decay.length > 1000 ||
      r.calibration.decay.some((n) => !finite(n, -200, 10)) ||
      !Array.isArray(r.calibration.impulse) ||
      r.calibration.impulse.length > 1000 ||
      r.calibration.impulse.some((n) => !finite(n, -2, 2)))
  )
    throw new Error("Invalid calibration data.");
  return r;
}
