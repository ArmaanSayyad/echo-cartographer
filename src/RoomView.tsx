import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bounds, inside, MATERIALS, wallLength } from "./model";
import type { Room, Vec3 } from "./model";
import type { AcousticResult } from "./acoustics";
export type ViewMode = "orbit" | "walk" | "plan";
export type RenderStats = {
  fps: number;
  calls: number;
  triangles: number;
  geometries: number;
};
type Props = {
  room: Room;
  result: AcousticResult;
  treated: boolean;
  mode: ViewMode;
  pathsVisible: boolean;
  band: number;
  frozen: boolean;
  selected: string;
  onMove: (who: "source" | "listener", p: Vec3, yaw?: number) => void;
  onSelect: (id: string) => void;
  onStats: (s: RenderStats) => void;
  resetKey: number;
};
type Runtime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
};
const vec = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
// Batch static architecture by material and selectable object. This keeps the
// procedural detail without hundreds of separate draw calls per frame.
function batchRoom(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const batches = new Map<
    string,
    { meshes: THREE.Mesh[]; material: THREE.MeshStandardMaterial }
  >();
  group.traverse((o) => {
    if (
      !(o instanceof THREE.Mesh) ||
      !(o.material instanceof THREE.MeshStandardMaterial)
    )
      return;
    const m = o.material;
    const key = [
      m.color.getHexString(),
      m.roughness,
      m.metalness,
      m.side,
      o.castShadow,
      o.receiveShadow,
      o.userData.selectId ?? "",
    ].join("/");
    const batch = batches.get(key) ?? { meshes: [], material: m.clone() };
    batch.meshes.push(o);
    batches.set(key, batch);
  });
  for (const { meshes, material } of batches.values()) {
    const parts = meshes.map((mesh) => {
      const g = mesh.geometry.index
        ? mesh.geometry.toNonIndexed()
        : mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      return g;
    });
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (!merged) {
      material.dispose();
      continue;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.userData = { ...meshes[0].userData };
    mesh.castShadow = meshes[0].castShadow;
    mesh.receiveShadow = meshes[0].receiveShadow;
    meshes.forEach((old) => {
      old.removeFromParent();
      old.geometry.dispose();
      const ms = Array.isArray(old.material) ? old.material : [old.material];
      ms.forEach((m) => m.dispose());
    });
    group.add(mesh);
  }
}
function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => {
        if ("map" in m) (m.map as THREE.Texture | null)?.dispose();
        m.dispose();
      });
    }
  });
  group.clear();
}
function box(
  group: THREE.Group,
  size: [number, number, number],
  pos: [number, number, number],
  color: string,
  rounded = false,
) {
  const mesh = new THREE.Mesh(
    rounded
      ? new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.14)
      : new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color, roughness: 0.86 }),
  );
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function cylinder(
  group: THREE.Group,
  radius: number,
  height: number,
  pos: [number, number, number],
  color: string,
  topRadius = radius,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius, radius, height, 28),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function ring(group: THREE.Group, radius: number, color: string, y = 0.045) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.012, radius, 64),
    new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  group.add(mesh);
}
function makeRoom(
  group: THREE.Group,
  room: Room,
  treated: boolean,
  walk: boolean,
  selected: string,
) {
  const b = bounds(room),
    w = b.maxX - b.minX,
    d = b.maxZ - b.minZ,
    centerX = (b.minX + b.maxX) / 2,
    centerZ = (b.minZ + b.maxZ) / 2;
  const shape = new THREE.Shape();
  room.walls.forEach((wall, i) => {
    if (i === 0) shape.moveTo(wall.a.x, -wall.a.z);
    else shape.lineTo(wall.a.x, -wall.a.z);
  });
  shape.closePath();
  const slab = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: "#6e6658", roughness: 0.9 }),
  );
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = -0.18;
  slab.receiveShadow = true;
  group.add(slab);
  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({
      color: MATERIALS[room.floorMaterial].color,
      roughness: 0.86,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.006;
  floor.receiveShadow = true;
  floor.userData.selectId = "floor";
  group.add(floor);
  // Board joints are geometry, with no downloaded texture dependencies.
  if (room.floorMaterial === "timber") {
    const joints: THREE.Vector3[] = [];
    for (let z = b.minZ + 0.02, i = 0; z < b.maxZ; z += 0.22, i++) {
      for (let x = b.minX; x < b.maxX; x += 0.09)
        if (inside({ x: x + 0.045, z }, room))
          joints.push(
            new THREE.Vector3(x, 0.012, z),
            new THREE.Vector3(Math.min(b.maxX, x + 0.09), 0.012, z),
          );
      for (let x = b.minX + (i % 3) * 0.55; x < b.maxX; x += 1.9)
        if (inside({ x, z: z + 0.11 }, room))
          joints.push(
            new THREE.Vector3(x, 0.012, z),
            new THREE.Vector3(x, 0.012, z + 0.2),
          );
    }
    group.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(joints),
        new THREE.LineBasicMaterial({
          color: "#8d765c",
          transparent: true,
          opacity: 0.45,
        }),
      ),
    );
  }
  if (walk) {
    const ceiling = floor.clone();
    ceiling.geometry = floor.geometry.clone();
    ceiling.material = new THREE.MeshStandardMaterial({
      color: MATERIALS[room.ceilingMaterial].color,
      side: THREE.DoubleSide,
      roughness: 1,
    });
    ceiling.position.y = room.ceiling;
    ceiling.userData.selectId = "ceiling";
    group.add(ceiling);
  }
  room.walls.forEach((wall) => {
    const len = wallLength(wall),
      angle = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x),
      mx = (wall.a.x + wall.b.x) / 2,
      mz = (wall.a.z + wall.b.z) / 2;
    const front = (mx - centerX) * 0.8 + (mz - centerZ) > 0.1;
    const h = front && !walk ? 0.13 : room.ceiling;
    const wg = new THREE.Group();
    wg.position.set(wall.a.x, 0, wall.a.z);
    wg.rotation.y = angle;
    group.add(wg);
    const openings = room.openings.filter((o) => o.wallId === wall.id);
    const xs = [
      ...new Set([
        0,
        len,
        ...openings.flatMap((o) => [
          Math.max(0, o.offset - o.width / 2),
          Math.min(len, o.offset + o.width / 2),
        ]),
      ]),
    ].sort((a, b) => a - b);
    const ys = [
      ...new Set([
        0,
        h,
        ...openings
          .flatMap((o) => [o.sill, o.sill + o.height])
          .filter((y) => y > 0 && y < h),
      ]),
    ].sort((a, b) => a - b);
    for (let ix = 0; ix < xs.length - 1; ix++)
      for (let iy = 0; iy < ys.length - 1; iy++) {
        const x = (xs[ix] + xs[ix + 1]) / 2,
          y = (ys[iy] + ys[iy + 1]) / 2;
        if (
          openings.some(
            (o) =>
              Math.abs(x - o.offset) < o.width / 2 &&
              y > o.sill &&
              y < o.sill + o.height,
          )
        )
          continue;
        const mesh = box(
          wg,
          [xs[ix + 1] - xs[ix], ys[iy + 1] - ys[iy], 0.12],
          [x, y, 0],
          selected === wall.id ? "#c6d6c1" : MATERIALS[wall.material].color,
        );
        mesh.userData.selectId = wall.id;
      }
    if (h > 0.2) {
      box(wg, [len, 0.07, 0.14], [len / 2, 0.05, 0], "#d9d5c8");
      openings.forEach((o) => {
        const glass = o.kind === "window";
        const panel = box(
          wg,
          [o.width - 0.06, o.height - 0.06, 0.035],
          [o.offset, o.sill + o.height / 2, 0],
          glass ? "#89a6a1" : "#93806a",
        );
        if (glass) {
          (panel.material as THREE.MeshStandardMaterial).metalness = 0.2;
          (panel.material as THREE.MeshStandardMaterial).roughness = 0.23;
        }
        panel.userData.selectId = o.id;
        [-1, 1].forEach((sign) =>
          box(
            wg,
            [0.055, o.height + 0.06, 0.15],
            [o.offset + (sign * o.width) / 2, o.sill + o.height / 2, 0],
            "#444b43",
          ),
        );
        [o.sill, o.sill + o.height].forEach((y) =>
          box(wg, [o.width + 0.06, 0.055, 0.15], [o.offset, y, 0], "#444b43"),
        );
        if (glass) {
          box(
            wg,
            [0.035, o.height, 0.13],
            [o.offset, o.sill + o.height / 2, 0],
            "#46554e",
          );
          box(
            wg,
            [o.width + 0.17, 0.05, 0.32],
            [o.offset, o.sill, 0],
            "#c6c4b7",
          );
        } else {
          cylinder(
            wg,
            0.025,
            0.1,
            [o.offset + o.width * 0.34, 0.98, -0.095],
            "#c5b898",
          ).rotation.x = Math.PI / 2;
        }
      });
    }
    if (treated)
      room.treatments
        .filter((t) => t.wallId === wall.id)
        .forEach((t) => {
          const inwardZ = inside(
            { x: mx + Math.sin(angle) * 0.1, z: mz + Math.cos(angle) * 0.1 },
            room,
          )
            ? 0.11
            : -0.11;
          const count = Math.max(1, Math.ceil(t.width / 0.62));
          for (let i = 0; i < count; i++) {
            const mesh = box(
              wg,
              [t.width / count - 0.035, t.height, 0.1],
              [
                t.offset - t.width / 2 + (t.width / count) * (i + 0.5),
                room.ceiling / 2,
                inwardZ,
              ],
              MATERIALS[t.material].color,
              true,
            );
            mesh.userData.selectId = t.id;
            // In cutaway mode panels remain as freestanding outlines of their wall position.
          }
        });
  });
  room.furniture.forEach((f) => {
    const g = new THREE.Group();
    g.position.set(f.x, 0, f.z);
    g.rotation.y = -f.rotation;
    group.add(g);
    const color = MATERIALS[f.material].color;
    if (f.kind === "rug") {
      box(g, [f.width, 0.018, f.depth], [0, 0.025, 0], "#8b9581", true);
      for (let i = -f.width / 2 + 0.04; i < f.width / 2; i += 0.075)
        box(g, [0.006, 0.002, f.depth - 0.04], [i, 0.036, 0], "#98a18c");
      for (const sign of [-1, 1])
        for (let i = -f.width / 2; i < f.width / 2; i += 0.05)
          box(
            g,
            [0.013, 0.008, 0.065],
            [i, 0.02, sign * (f.depth / 2 + 0.02)],
            "#b5b7a0",
          );
    } else if (f.kind === "sofa") {
      box(g, [f.width, 0.25, f.depth], [0, 0.29, 0], "#777d69", true);
      box(
        g,
        [f.width, f.height * 0.6, 0.23],
        [0, f.height * 0.72, -f.depth / 2 + 0.08],
        "#bcbcac",
        true,
      );
      for (const sign of [-1, 1]) {
        box(
          g,
          [0.22, f.height * 0.7, f.depth],
          [sign * (f.width / 2 - 0.1), f.height * 0.5, 0],
          "#b0b3a2",
          true,
        );
        for (const z of [-0.32, 0.32])
          cylinder(
            g,
            0.04,
            0.18,
            [sign * (f.width / 2 - 0.2), 0.09, z],
            "#444b3e",
          );
      }
      for (let i = 0; i < 3; i++) {
        box(
          g,
          [(f.width - 0.45) / 3 - 0.025, 0.17, f.depth - 0.23],
          [((i - 1) * (f.width - 0.45)) / 3, 0.47, 0.08],
          "#c4c5b4",
          true,
        );
        const pillow = box(
          g,
          [0.4, 0.4, 0.17],
          [((i - 1) * (f.width - 0.6)) / 3, 0.67, -0.17],
          i === 1 ? "#88957e" : "#ccc8b8",
          true,
        );
        pillow.rotation.x = -0.15;
        pillow.rotation.z = i === 0 ? -0.12 : 0.12;
      }
    } else if (f.kind === "table") {
      box(g, [f.width, 0.065, f.depth], [0, f.height, 0], color, true);
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          box(
            g,
            [0.055, f.height - 0.04, 0.055],
            [x * (f.width / 2 - 0.11), f.height / 2, z * (f.depth / 2 - 0.11)],
            "#605847",
          );
      box(g, [0.24, 0.032, 0.3], [-0.22, f.height + 0.05, 0.08], "#d3c8af");
      box(g, [0.23, 0.022, 0.29], [-0.21, f.height + 0.08, 0.06], "#54665c");
      cylinder(g, 0.09, 0.14, [0.32, f.height + 0.1, -0.06], "#b2a488");
    } else if (f.kind === "shelf") {
      box(
        g,
        [f.width, f.height, 0.055],
        [0, f.height / 2, -f.depth / 2],
        "#6d6554",
      );
      [-1, 1].forEach((sign) =>
        box(
          g,
          [0.05, f.height, f.depth],
          [(sign * f.width) / 2, f.height / 2, 0],
          "#97816a",
        ),
      );
      for (let row = 0; row < 5; row++) {
        const y = 0.1 + (row * (f.height - 0.12)) / 4;
        box(g, [f.width, 0.045, f.depth], [0, y, 0], "#a89070");
        if (row < 4)
          for (let i = 0; i < Math.floor(f.width / 0.105); i++) {
            if ((i + row * 3) % 11 > 7) continue;
            const bh = 0.19 + Math.sin(i * 3.13 + row) * 0.065;
            box(
              g,
              [0.064, bh, f.depth * 0.63],
              [-f.width / 2 + 0.085 + i * 0.1, y + bh / 2 + 0.024, 0.025],
              ["#a69a7a", "#577064", "#a8aaa0", "#5c625e", "#99745a"][
                (i + row) % 5
              ],
            );
          }
      }
    } else {
      cylinder(
        g,
        f.width * 0.32,
        f.height * 0.24,
        [0, f.height * 0.12, 0],
        "#99927d",
        f.width * 0.4,
      );
      cylinder(g, 0.018, f.height * 0.7, [0, f.height * 0.52, 0], "#6d7150");
      for (let i = 0; i < 15; i++) {
        const a = i * 2.399,
          radius = 0.18 + (i % 3) * 0.065;
        const leaf = new THREE.Mesh(
          new THREE.SphereGeometry(1, 10, 8),
          new THREE.MeshStandardMaterial({
            color: i % 3 ? "#5b7558" : "#7c9168",
            roughness: 1,
          }),
        );
        leaf.scale.set(f.width * 0.2, f.height * 0.15, 0.035);
        leaf.position.set(
          Math.cos(a) * radius,
          f.height * (0.45 + i / 30),
          Math.sin(a) * radius,
        );
        leaf.rotation.set(0.2, -a, 0.7);
        leaf.castShadow = true;
        g.add(leaf);
      }
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.userData.selectId = f.id;
    });
  });
  // Architectural datum lines outside the room footprint.
  batchRoom(group);
  const lineMat = new THREE.LineBasicMaterial({
    color: "#56615a",
    transparent: true,
    opacity: 0.55,
  });
  const pts = [
    [b.minX, -0.17, b.maxZ + 0.4],
    [b.maxX, -0.17, b.maxZ + 0.4],
    [b.maxX + 0.4, -0.17, b.maxZ],
    [b.maxX + 0.4, -0.17, b.minZ],
  ];
  for (let i = 0; i < 4; i += 2)
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...(pts[i] as [number, number, number])),
          new THREE.Vector3(...(pts[i + 1] as [number, number, number])),
        ]),
        lineMat.clone(),
      ),
    );
  void w;
  void d;
}
function makeSource(group: THREE.Group) {
  ring(group, 0.29, "#b8edc3");
  ring(group, 0.38, "#75a88b");
  cylinder(group, 0.18, 0.035, [0, 0.025, 0], "#2d3731");
  cylinder(group, 0.022, 0.83, [0, 0.44, 0], "#414c44");
  box(group, [0.26, 0.4, 0.24], [0, 1.05, 0], "#39433a", true);
  const cone = cylinder(group, 0.078, 0.014, [0, 1.01, 0.128], "#b3bc9c");
  cone.rotation.x = Math.PI / 2;
  const tweeter = cylinder(group, 0.027, 0.014, [0, 1.16, 0.13], "#bccab0");
  tweeter.rotation.x = Math.PI / 2;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.021, 12, 12),
    new THREE.MeshBasicMaterial({ color: "#c9f5ba" }),
  );
  light.position.set(0.075, 0.9, 0.132);
  group.add(light);
}
function makeListener(group: THREE.Group) {
  ring(group, 0.23, "#93d8e5");
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 20, 16),
    new THREE.MeshStandardMaterial({
      color: "#afdeeb",
      emissive: "#5eafbb",
      emissiveIntensity: 0.5,
      roughness: 0.3,
    }),
  );
  orb.position.y = 1.2;
  group.add(orb);
  const hoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.009, 8, 32, Math.PI * 1.6),
    new THREE.MeshBasicMaterial({ color: "#c6eff8" }),
  );
  hoop.position.y = 1.21;
  hoop.rotation.z = -0.94;
  group.add(hoop);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(0, 1.08, 0),
    ]),
    new THREE.LineDashedMaterial({
      color: "#81b9c7",
      dashSize: 0.035,
      gapSize: 0.03,
      transparent: true,
      opacity: 0.6,
    }),
  );
  line.computeLineDistances();
  group.add(line);
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.065, 0.16, 3),
    new THREE.MeshBasicMaterial({ color: "#a4d7e3" }),
  );
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.set(0, 0.045, -0.32);
  group.add(arrow);
}
export default function RoomView(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(props),
    runtime = useRef<Runtime | null>(null);
  const [error, setError] = useState("");
  current.current = props;
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
    } catch {
      setError(
        "3D acceleration is unavailable. The synchronized plan and audio still work.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setClearColor("#1b2220", 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive three dimensional room. Drag to orbit. Use the plan to move the speaker and listener.",
    );
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(36, 1, 0.04, 180),
      controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 4;
    controls.maxDistance = 32;
    controls.enablePan = true;
    const hemi = new THREE.HemisphereLight("#e4efda", "#5b6655", 2.4);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff0cf", 4.2);
    sun.position.set(-3, 10, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.normalBias = 0.025;
    sun.shadow.bias = -0.0002;
    scene.add(sun);
    const fill = new THREE.DirectionalLight("#adcac8", 1.2);
    fill.position.set(8, 5, -2);
    scene.add(fill);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.2 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.23;
    ground.receiveShadow = true;
    scene.add(ground);
    const geometry = new THREE.Group(),
      rays = new THREE.Group(),
      speaker = new THREE.Group(),
      listener = new THREE.Group();
    scene.add(geometry, rays, speaker, listener);
    makeSource(speaker);
    makeListener(listener);
    runtime.current = { renderer, scene, camera, controls };
    let lastGeometry = "",
      lastPaths = "",
      lastMode = "",
      lastReset = -1,
      frames = 0,
      statTime = performance.now(),
      lastTime = performance.now(),
      raf = 0;
    const keys = new Set<string>(),
      raycaster = new THREE.Raycaster(),
      pointer = new THREE.Vector2(),
      floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let drag: "source" | "listener" | null = null,
      turning = false,
      lastX = 0,
      moved = false,
      yaw = current.current.room.yaw;
    const setPointer = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };
    const down = (e: PointerEvent) => {
      moved = false;
      lastX = e.clientX;
      if (current.current.mode === "walk") {
        turning = true;
        el.setPointerCapture(e.pointerId);
        return;
      }
      setPointer(e);
      const hit = raycaster.intersectObjects(
        [...speaker.children, ...listener.children],
        true,
      )[0];
      if (hit) {
        let o = hit.object;
        while (o.parent && o.parent !== scene) o = o.parent;
        drag = o === speaker ? "source" : "listener";
        controls.enabled = false;
        el.setPointerCapture(e.pointerId);
        current.current.onSelect(drag);
      }
    };
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - lastX) > 2 || Math.abs(e.movementY) > 2)
        moved = true;
      if (turning) {
        yaw -= (e.clientX - lastX) * 0.006;
        current.current.onMove("listener", current.current.room.listener, yaw);
        lastX = e.clientX;
        return;
      }
      if (!drag) return;
      setPointer(e);
      const hit = new THREE.Vector3();
      raycaster.ray.intersectPlane(floorPlane, hit);
      if (inside({ x: hit.x, z: hit.z }, current.current.room))
        current.current.onMove(drag, {
          x: hit.x,
          z: hit.z,
          y: current.current.room[drag].y,
        });
    };
    const up = (e: PointerEvent) => {
      if (!moved && !drag && current.current.mode !== "walk") {
        setPointer(e);
        const hit = raycaster
          .intersectObjects(geometry.children, true)
          .find((h) => h.object.userData.selectId);
        if (hit) current.current.onSelect(hit.object.userData.selectId);
      }
      turning = false;
      drag = null;
      controls.enabled = current.current.mode !== "walk";
      if (el.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
    };
    const keydown = (e: KeyboardEvent) => {
      if (
        /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (
        current.current.mode === "walk" &&
        [
          "w",
          "a",
          "s",
          "d",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.key)
      ) {
        e.preventDefault();
        keys.add(e.key);
      }
    };
    const keyup = (e: KeyboardEvent) => keys.delete(e.key),
      blur = () => keys.clear();
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      lastReset = -1;
    });
    resize.observe(el);
    const resetCamera = (room: Room) => {
      const b = bounds(room),
        cx = (b.minX + b.maxX) / 2,
        cz = (b.minZ + b.maxZ) / 2,
        size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ),
        fit = Math.max(1, 1.4 / camera.aspect);
      camera.position.set(
        cx + size * 1.1 * fit,
        0.65 + (size * 1.04 - 0.65) * fit,
        cz + size * 1.28 * fit,
      );
      controls.target.set(cx, 0.65, cz);
      camera.lookAt(controls.target);
      controls.update();
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const p = current.current,
        dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const geoKey = JSON.stringify([
        p.room.walls,
        p.room.openings,
        p.room.furniture,
        p.room.ceiling,
        p.room.floorMaterial,
        p.room.ceilingMaterial,
        p.room.treatments,
        p.treated,
        p.mode === "walk",
        p.selected,
      ]);
      if (lastGeometry !== geoKey) {
        disposeGroup(geometry);
        makeRoom(geometry, p.room, p.treated, p.mode === "walk", p.selected);
        lastGeometry = geoKey;
      }
      if (lastMode !== p.mode || lastReset !== p.resetKey) {
        camera.fov = p.mode === "walk" ? 68 : 36;
        camera.updateProjectionMatrix();
        if (p.mode !== "walk") resetCamera(p.room);
        else yaw = p.room.yaw;
        controls.enabled = p.mode !== "walk";
        lastMode = p.mode;
        lastReset = p.resetKey;
        keys.clear();
      }
      if (p.mode === "walk") {
        const forward =
            (keys.has("w") || keys.has("ArrowUp") ? 1 : 0) -
            (keys.has("s") || keys.has("ArrowDown") ? 1 : 0),
          side = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
        yaw =
          p.room.yaw +
          ((keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0)) *
            dt *
            1.5;
        if (forward || side || yaw !== p.room.yaw) {
          const speed = (dt * 1.55) / Math.max(1, Math.hypot(forward, side));
          const next = {
            ...p.room.listener,
            x:
              p.room.listener.x +
              (Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed,
            z:
              p.room.listener.z +
              (-Math.cos(yaw) * forward + Math.sin(yaw) * side) * speed,
          };
          if (inside(next, p.room)) p.onMove("listener", next, yaw);
        }
        camera.position.set(
          p.room.listener.x,
          p.room.listener.y,
          p.room.listener.z,
        );
        camera.lookAt(
          p.room.listener.x + Math.sin(yaw),
          p.room.listener.y,
          p.room.listener.z - Math.cos(yaw),
        );
      } else controls.update();
      speaker.position.set(
        p.room.source.x,
        p.room.source.y - 1.25,
        p.room.source.z,
      );
      speaker.rotation.y = Math.atan2(
        p.room.listener.x - p.room.source.x,
        p.room.listener.z - p.room.source.z,
      );
      listener.position.set(
        p.room.listener.x,
        p.room.listener.y - 1.2,
        p.room.listener.z,
      );
      listener.rotation.y = -p.room.yaw;
      listener.visible = p.mode !== "walk";
      const pathKey = JSON.stringify([p.result.paths, p.pathsVisible, p.band]);
      if (pathKey !== lastPaths) {
        disposeGroup(rays);
        lastPaths = pathKey;
        if (p.pathsVisible)
          p.result.paths.slice(0, 36).forEach((path) => {
            const color =
              path.order === 0
                ? "#dcffc3"
                : path.order === 1
                  ? "#78efc6"
                  : "#d9b57c";
            const opacity =
              path.order === 0 ? 1 : path.order === 1 ? 0.78 : 0.24;
            const points = path.points.map(vec),
              curve = new THREE.CurvePath<THREE.Vector3>();
            points
              .slice(1)
              .forEach((v, i) => curve.add(new THREE.LineCurve3(points[i], v)));
            const brightness = Math.min(
              1,
              path.gains[p.band] / Math.max(0.0001, path.gains[0]),
            );
            points.slice(1).forEach((end, i) => {
              const start = points[i],
                delta = end.clone().sub(start),
                radius =
                  path.order === 0 ? 0.014 : path.order === 1 ? 0.01 : 0.006;
              const line = new THREE.Mesh(
                new THREE.CylinderGeometry(radius, radius, delta.length(), 6),
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: opacity * brightness,
                  depthWrite: false,
                  toneMapped: false,
                }),
              );
              line.position.copy(start).add(end).multiplyScalar(0.5);
              line.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                delta.normalize(),
              );
              rays.add(line);
            });
            path.points.slice(1, -1).forEach((hit) => {
              const dot = new THREE.Mesh(
                new THREE.SphereGeometry(0.025, 8, 8),
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: opacity + 0.1,
                }),
              );
              dot.position.copy(vec(hit));
              rays.add(dot);
            });
            if (path.order < 2) {
              const pulse = new THREE.Mesh(
                new THREE.SphereGeometry(0.025, 8, 8),
                new THREE.MeshBasicMaterial({ color: "#efffdc" }),
              );
              pulse.userData.curve = curve;
              pulse.userData.offset = path.delay * 13;
              rays.add(pulse);
            }
          });
      }
      rays.children.forEach((o) => {
        if (o.userData.curve)
          o.position.copy(
            (o.userData.curve as THREE.CurvePath<THREE.Vector3>).getPoint(
              ((p.frozen ? 1.6 : now / 3200) + o.userData.offset) % 1,
            ),
          );
      });
      if (p.mode !== "plan" && !document.hidden) renderer.render(scene, camera);
      frames++;
      if (now - statTime > 1000) {
        p.onStats({
          fps: Math.round((frames * 1000) / (now - statTime)),
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
        });
        frames = 0;
        statTime = now;
      }
    };
    raf = requestAnimationFrame(frame);
    const lost = (e: Event) => {
      e.preventDefault();
      setError(
        "The 3D context was interrupted. Reload to restore it, or continue in plan view.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      controls.dispose();
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      [geometry, rays, speaker, listener].forEach(disposeGroup);
      ground.geometry.dispose();
      ground.material.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  return (
    <div
      className={`room-view ${props.mode === "walk" ? "is-walking" : ""}`}
      ref={host}
      data-testid="room-view"
    >
      {error && <div className="webgl-error">{error}</div>}
    </div>
  );
}
