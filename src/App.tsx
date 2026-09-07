import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cpu,
  DoorOpen,
  Expand,
  Headphones,
  Layers3,
  Leaf,
  Maximize2,
  Mic,
  MoreHorizontal,
  MousePointer2,
  Move3D,
  PanelTop,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  Settings2,
  ShieldCheck,
  Sofa,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  Volume1,
  Waves,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  BANDS,
  bounds,
  constrain,
  demoRoom,
  inside,
  MATERIALS,
  roomArea,
  uid,
  validateRoom,
  validPolygon,
  wallLength,
} from "./model";
import type { Room, MaterialId, Vec2, Vec3, Furniture } from "./model";
import { simulate } from "./acoustics";
import type { AcousticResult } from "./acoustics";
import { SpatialAudio } from "./audio";
import { download, loadRoom, saveRoom } from "./storage";
import RoomView from "./RoomView";
import type { RenderStats, ViewMode } from "./RoomView";
import PlanView from "./PlanView";
import { DecayChart, ImpulseChart } from "./Charts";
import ImportRoom from "./ImportRoom";
import CalibrationDialog from "./CalibrationDialog";
import Modal from "./Modal";

type EchoDebug = {
  getState: () => {
    room: Room;
    result: AcousticResult;
    treated: boolean;
    band: number;
    mode: ViewMode;
    performance: RenderStats;
    audio: ReturnType<SpatialAudio["debug"]>;
  };
  moveSource: (p: Vec3) => void;
  moveListener: (p: Vec3, yaw?: number) => void;
  setComparison: (treated: boolean) => void;
  loadScene: (scene: string) => void;
  renderProbe: () => Promise<{
    leftEnergy: number;
    rightEnergy: number;
    samples: number;
  }>;
};
declare global {
  interface Window {
    __ECHO__: EchoDebug;
  }
}
const routeScene = window.location.pathname.split("/").filter(Boolean).pop();
const deterministic =
  window.location.pathname !== "/" ||
  new URLSearchParams(window.location.search).has("scene");
const initialScene =
  new URLSearchParams(window.location.search).get("scene") ||
  (["shoebox", "treated"].includes(routeScene ?? "") ? routeScene! : "demo");
const frozen =
  new URLSearchParams(window.location.search).has("capture") ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 0.1,
  unit = "m",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          value={Number(value.toFixed(2))}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
function MaterialSelect({
  value,
  onChange,
}: {
  value: MaterialId;
  onChange: (m: MaterialId) => void;
}) {
  return (
    <label className="material-select">
      <span>Surface material</span>
      <div>
        <i style={{ background: MATERIALS[value].color }} />
        <select
          aria-label="Surface material"
          value={value}
          onChange={(e) => onChange(e.target.value as MaterialId)}
        >
          {Object.entries(MATERIALS).map(([id, m]) => (
            <option key={id} value={id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <small>{MATERIALS[value].description}</small>
    </label>
  );
}
function LayerRow({
  icon: Icon,
  title,
  sub,
  active,
  onClick,
  color,
  suffix,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  active?: boolean;
  onClick: () => void;
  color?: string;
  suffix?: React.ReactNode;
}) {
  return (
    <button className={`layer-row ${active ? "active" : ""}`} onClick={onClick}>
      <span className="layer-icon" style={{ color }}>
        <Icon size={16} strokeWidth={1.5} />
      </span>
      <span>
        {title}
        {sub && <small>{sub}</small>}
      </span>
      {suffix ?? <ChevronRight size={12} className="layer-chevron" />}
    </button>
  );
}

export default function App() {
  const [room, setRoom] = useState<Room>(() => demoRoom(initialScene)),
    [result, setResult] = useState<AcousticResult>(() =>
      simulate(demoRoom(initialScene), initialScene === "treated"),
    );
  const [treated, setTreated] = useState(initialScene === "treated"),
    [mode, setMode] = useState<ViewMode>("orbit"),
    [pathsVisible, setPathsVisible] = useState(true),
    [band, setBand] = useState(3),
    [order, setOrder] = useState(2),
    [selected, setSelected] = useState("source"),
    [inspector, setInspector] = useState<"acoustics" | "selection">(
      "acoustics",
    ),
    [edit, setEdit] = useState(false);
  const [modal, setModal] = useState<
      "import" | "calibrate" | "materials" | "about" | null
    >(null),
    [menu, setMenu] = useState(false),
    [addMenu, setAddMenu] = useState(false),
    [viewportAddMenu, setViewportAddMenu] = useState(false),
    [expandedFurniture, setExpandedFurniture] = useState(false),
    [playing, setPlaying] = useState(false),
    [volume, setVolume] = useState(0.45),
    [signal, setSignal] = useState<"percussion" | "noise">("percussion"),
    [resetKey, setResetKey] = useState(0),
    [toast, setToast] = useState(""),
    [saved, setSaved] = useState("Opening local workspace"),
    [ready, setReady] = useState(false),
    [storageFailed, setStorageFailed] = useState(false),
    [debug, setDebug] = useState(window.location.pathname === "/inspect"),
    [perf, setPerf] = useState<RenderStats>({
      fps: 0,
      calls: 0,
      triangles: 0,
      geometries: 0,
    });
  const [historyState, setHistoryState] = useState([0, 0]);
  const [audio] = useState(() => new SpatialAudio());
  const roomRef = useRef(room),
    history = useRef<Room[]>([]),
    future = useRef<Room[]>([]),
    lastHistory = useRef(0),
    worker = useRef<Worker | null>(null),
    request = useRef(0),
    file = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    viewport = useRef<HTMLDivElement>(null);
  roomRef.current = room;
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);
  const update = useCallback((fn: (r: Room) => Room) => {
    const previous = roomRef.current,
      next = fn(previous);
    if (next === previous) return;
    const now = performance.now();
    if (now - lastHistory.current > 400 || !history.current.length) {
      history.current = [...history.current.slice(-39), previous];
      lastHistory.current = now;
    }
    future.current = [];
    setHistoryState([history.current.length, 0]);
    roomRef.current = next;
    setRoom(next);
  }, []);
  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (prev) {
      future.current.push(roomRef.current);
      roomRef.current = prev;
      setRoom(prev);
      setHistoryState([history.current.length, future.current.length]);
    }
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next) {
      history.current.push(roomRef.current);
      roomRef.current = next;
      setRoom(next);
      setHistoryState([history.current.length, future.current.length]);
    }
  }, []);
  const select = useCallback((id: string) => {
    setSelected(id);
    setInspector("selection");
  }, []);
  const move = useCallback(
    (who: string, p: Vec3, yaw?: number) => {
      update((r) => {
        if (!inside(p, r)) return r;
        if (who === "source" || who === "listener")
          return {
            ...r,
            [who]: constrain(p, r),
            ...(yaw !== undefined ? { yaw } : {}),
          };
        return {
          ...r,
          furniture: r.furniture.map((f) =>
            f.id === who ? { ...f, x: p.x, z: p.z } : f,
          ),
        };
      });
    },
    [update],
  );
  const vertex = useCallback(
    (index: number, p: Vec2) =>
      update((r) => {
        const points = r.walls.map((w, i) =>
          i === index
            ? { x: Math.round(p.x * 20) / 20, z: Math.round(p.z * 20) / 20 }
            : w.a,
        );
        if (!validPolygon(points)) return r;
        const next = {
          ...r,
          walls: r.walls.map((w, i) => ({
            ...w,
            a: points[i],
            b: points[(i + 1) % points.length],
          })),
        };
        if (!inside(r.source, next) || !inside(r.listener, next)) return r;
        if (
          [...r.openings, ...r.treatments].some((o) => {
            const w = next.walls.find((w) => w.id === o.wallId)!;
            return o.offset + o.width / 2 > wallLength(w);
          })
        )
          return r;
        return next;
      }),
    [update],
  );
  const loadScene = useCallback(
    (scene: string) => {
      update(() => demoRoom(scene));
      setTreated(scene === "treated");
      setSelected("source");
      setInspector("acoustics");
      setMode("orbit");
      setResetKey((k) => k + 1);
      setMenu(false);
      notify("Demo loaded. Your previous room is available with Undo.");
    },
    [update, notify],
  );
  useEffect(() => {
    let active = true;
    if (deterministic) {
      setReady(true);
      setSaved("Demo session · not saved");
      return;
    }
    void loadRoom()
      .then((r) => {
        if (active && r) {
          roomRef.current = r;
          setRoom(r);
          setTreated(r.treatments.length > 0);
        }
        if (active) {
          setReady(true);
          setSaved("Saved on this device");
        }
      })
      .catch(() => {
        if (active) {
          setStorageFailed(true);
          setReady(true);
          setSaved("Local storage unavailable");
          notify(
            "The saved room could not be opened. The demo is ready; export a backup to keep changes.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [notify]);
  useEffect(() => {
    if (!ready || deterministic || storageFailed) return;
    setSaved("Saving locally…");
    const timer = setTimeout(() => {
      void saveRoom(room)
        .then(() => setSaved("Saved on this device"))
        .catch(() => {
          setSaved("Save failed · export a backup");
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [room, ready, storageFailed]);
  useEffect(() => {
    const w = new Worker(new URL("./acoustics.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.id !== request.current) return;
      if (data.error) notify(data.error);
      else setResult(data.result);
    };
    w.onerror = () =>
      notify("The acoustic worker stopped. Reload to restart calculations.");
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [notify]);
  useEffect(() => {
    worker.current?.postMessage({
      type: "simulate",
      id: ++request.current,
      room,
      treated,
      order,
    });
  }, [room, treated, order]);
  useEffect(() => {
    audio.update(room, result);
  }, [audio, room, result]);
  useEffect(
    () => () => {
      audio.dispose();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [audio],
  );
  const toggleAudio = useCallback(async () => {
    if (audio.playing) {
      audio.stop();
      setPlaying(false);
    } else {
      try {
        await audio.start();
        setPlaying(true);
      } catch (e) {
        notify(`Audio could not start: ${(e as Error).message}`);
      }
    }
  }, [audio, notify]);
  const addTreatment = () => {
    const r = roomRef.current,
      wall = r.walls.find((w) => w.id === selected) ?? r.walls[1] ?? r.walls[0],
      id = uid(),
      len = wallLength(wall);
    update((r) => ({
      ...r,
      treatments: [
        ...r.treatments,
        {
          id,
          wallId: wall.id,
          offset: len / 2,
          width: Math.min(3.6, len - 0.15),
          height: Math.min(2.1, r.ceiling - 0.2),
          material: "panel",
        },
      ],
    }));
    setTreated(true);
    select(id);
    setAddMenu(false);
    notify(
      "Acoustic panels added. Switch A / B to hear and see the difference.",
    );
  };
  const addObject = (kind: Furniture["kind"] | "door" | "window") => {
    const r = roomRef.current,
      id = uid(),
      wall = r.walls.find((w) => w.id === selected) ?? r.walls[0];
    if (kind === "door" || kind === "window") {
      const height = Math.min(kind === "door" ? 2.1 : 1.4, r.ceiling - 0.1),
        sill = kind === "door" ? 0 : Math.min(0.8, r.ceiling - height);
      update((r) => ({
        ...r,
        openings: [
          ...r.openings,
          {
            id,
            wallId: wall.id,
            kind,
            offset: wallLength(wall) / 2,
            width: Math.min(
              kind === "door" ? 0.9 : 1.5,
              wallLength(wall) - 0.1,
            ),
            height,
            sill,
            material: kind === "door" ? "timber" : "glass",
            confidence: "user-defined",
          },
        ],
      }));
    } else {
      const f: Furniture = {
        id,
        kind,
        name: {
          sofa: "Sofa",
          table: "Table",
          shelf: "Bookshelf",
          rug: "Area rug",
          plant: "Plant",
        }[kind],
        ...r.listener,
        width: kind === "rug" ? 2.5 : kind === "sofa" ? 2.2 : 1.2,
        depth: kind === "rug" ? 2 : kind === "shelf" ? 0.4 : 0.7,
        height: kind === "rug" ? 0.03 : kind === "shelf" ? 1.8 : 0.7,
        material:
          kind === "rug"
            ? "carpet"
            : kind === "sofa"
              ? "curtains"
              : kind === "shelf"
                ? "bookshelves"
                : "timber",
        rotation: 0,
        confidence: "user-defined",
      };
      update((r) => ({ ...r, furniture: [...r.furniture, f] }));
      setExpandedFurniture(true);
    }
    select(id);
    setAddMenu(false);
    setMode("plan");
    notify(
      `${kind === "shelf" ? "Bookshelf" : kind.charAt(0).toUpperCase() + kind.slice(1)} added. Adjust its position and dimensions in the inspector.`,
    );
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        modal ||
        /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName)
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        e.code === "Space" &&
        !["BUTTON"].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        void toggleAudio();
      }
      if (mode !== "walk") {
        if (e.key.toLowerCase() === "a") setTreated(false);
        if (e.key.toLowerCase() === "b") setTreated(true);
      }
      if (e.key === "Escape") {
        setMode("orbit");
        setEdit(false);
        setMenu(false);
        setAddMenu(false);
      }
      if (e.key === "?") setModal("about");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [modal, undo, redo, toggleAudio, mode]);
  useEffect(() => {
    window.__ECHO__ = {
      getState: () => ({
        room,
        result,
        treated,
        band,
        mode,
        performance: perf,
        audio: audio.debug(),
      }),
      moveSource: (p) => move("source", p),
      moveListener: (p, yaw) => move("listener", p, yaw),
      setComparison: setTreated,
      loadScene,
      renderProbe: async () => {
        const sr = 24000,
          ctx = new OfflineAudioContext(2, sr * 2, sr),
          buffer = ctx.createBuffer(1, 1, sr);
        buffer.getChannelData(0)[0] = 1;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const l = ctx.listener;
        l.positionX.value = room.listener.x;
        l.positionY.value = room.listener.y;
        l.positionZ.value = room.listener.z;
        l.forwardX.value = Math.sin(room.yaw);
        l.forwardZ.value = -Math.cos(room.yaw);
        result.paths.slice(0, 40).forEach((p) => {
          const delay = ctx.createDelay(2),
            gain = ctx.createGain(),
            pan = ctx.createPanner();
          delay.delayTime.value = p.delay;
          gain.gain.value = p.gains[2];
          pan.panningModel = "HRTF";
          pan.rolloffFactor = 0;
          const v = p.points[p.points.length - 2];
          pan.positionX.value = v.x;
          pan.positionY.value = v.y;
          pan.positionZ.value = v.z;
          source.connect(delay);
          delay.connect(gain);
          gain.connect(pan);
          pan.connect(ctx.destination);
        });
        source.start(0.01);
        const rendered = await ctx.startRendering();
        const energy = (n: number) =>
          rendered.getChannelData(n).reduce((v, x) => v + x * x, 0);
        return {
          leftEnergy: energy(0),
          rightEnergy: energy(1),
          samples: rendered.length,
        };
      },
    };
  }, [room, result, treated, band, mode, perf, audio, move, loadScene]);
  const midRT = (result.rt60[2] + result.rt60[3]) / 2,
    baselineRT = (result.baselineRT[2] + result.baselineRT[3]) / 2,
    reduction = Math.round((1 - midRT / baselineRT) * 100);
  const selectedWall = room.walls.find((w) => w.id === selected),
    selectedFurniture = room.furniture.find((f) => f.id === selected),
    selectedOpening = room.openings.find((o) => o.id === selected),
    selectedTreatment = room.treatments.find((t) => t.id === selected),
    selectedPosition =
      selected === "source" || selected === "listener"
        ? room[selected]
        : undefined;
  const selectedTitle = selectedPosition
    ? selected === "source"
      ? "Sound source"
      : "Listener"
    : selectedWall
      ? `Wall ${room.walls.indexOf(selectedWall) + 1}`
      : (selectedFurniture?.name ??
        (selectedOpening
          ? `${selectedOpening.kind === "door" ? "Door" : "Window"}`
          : selectedTreatment
            ? "Wall treatment"
            : selected === "floor"
              ? "Floor surface"
              : selected === "ceiling"
                ? "Ceiling surface"
                : "Room settings"));
  const selectedMaterial =
    selectedWall?.material ??
    selectedFurniture?.material ??
    selectedOpening?.material ??
    selectedTreatment?.material ??
    (selected === "floor"
      ? room.floorMaterial
      : selected === "ceiling"
        ? room.ceilingMaterial
        : undefined);
  const changeMaterial = (material: MaterialId) =>
    update((r) => ({
      ...r,
      walls: r.walls.map((w) =>
        w.id === selected ? { ...w, material, confidence: "user-defined" } : w,
      ),
      furniture: r.furniture.map((f) =>
        f.id === selected ? { ...f, material, confidence: "user-defined" } : f,
      ),
      openings: r.openings.map((o) =>
        o.id === selected ? { ...o, material, confidence: "user-defined" } : o,
      ),
      treatments: r.treatments.map((t) =>
        t.id === selected ? { ...t, material } : t,
      ),
      ...(selected === "floor"
        ? { floorMaterial: material }
        : selected === "ceiling"
          ? { ceilingMaterial: material }
          : {}),
    }));
  const planProps = {
    room,
    result,
    treated,
    selected,
    pathsVisible,
    onSelect: select,
    onMove: move,
    onVertex: vertex,
  };
  const statsChange = useCallback((s: RenderStats) => setPerf(s), []);
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Echo Cartographer home">
          <span className="brand-mark">
            <svg viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="16" />
              <path d="M9 28V12l22 16V12L9 28Z" />
            </svg>
          </span>
          <span>
            ECHO<span>CARTOGRAPHER</span>
          </span>
        </a>
        <div className="top-divider" />
        <nav className="top-nav">
          <button className="active" onClick={() => setModal(null)}>
            Workspace
          </button>
          <button onClick={() => setModal("materials")}>
            Material library
          </button>
        </nav>
        <div className="top-spacer" />
        <span className="privacy-badge">
          <ShieldCheck size={14} /> Local by nature
        </span>
        <button
          className="icon-button help-button"
          aria-label="About and keyboard shortcuts"
          onClick={() => setModal("about")}
        >
          <CircleHelp size={18} />
        </button>
        <button className="new-room-button" onClick={() => setModal("import")}>
          <Plus size={15} /> New room
        </button>
      </header>
      <section className="project-header">
        <div>
          <div className="breadcrumb">
            YOUR SPACES <ChevronRight size={10} />{" "}
            {room.provenance === "illustrative"
              ? "THE DEMO COLLECTION"
              : "PERSONAL WORKSPACE"}
          </div>
          <div className="room-title">
            <h1>
              {room.name}
              <span>.</span>
            </h1>
            <button
              className="icon-button"
              aria-label="Room settings"
              onClick={() => select("room")}
            >
              <Settings2 size={16} />
            </button>
            <span className="demo-badge">
              {room.provenance === "illustrative" ? "DEMO ROOM" : "YOUR ROOM"}
            </span>
          </div>
          <p>Every surface has a sound. Explore yours.</p>
        </div>
        <div className="project-actions">
          <span className="save-state">
            <span className="status-dot" />
            {saved}
          </span>
          <div className="project-buttons">
            <button
              className="outline-button"
              onClick={() => {
                setMode("plan");
                setEdit((e) => !e);
                notify(
                  "Plan editor: drag wall corners, select surfaces, or add openings and furniture.",
                );
              }}
            >
              <Ruler size={14} /> Edit geometry
            </button>
            <div className="menu-wrap">
              <button
                className="icon-button outlined"
                aria-label="Room actions"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <MoreHorizontal size={19} />
              </button>
              {menu && (
                <div className="dropdown project-menu">
                  <button
                    onClick={() => {
                      download(
                        `${room.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.echo.json`,
                        JSON.stringify(room, null, 2),
                      );
                      setMenu(false);
                    }}
                  >
                    <ArrowDownToLine size={14} /> Export room backup
                  </button>
                  <button
                    onClick={() => {
                      file.current?.click();
                      setMenu(false);
                    }}
                  >
                    <Upload size={14} /> Open room backup
                  </button>
                  <hr />
                  <button onClick={() => loadScene("demo")}>
                    <Box size={14} /> Load listening room
                  </button>
                  <button onClick={() => loadScene("shoebox")}>
                    <Square size={14} /> Reference shoebox
                  </button>
                  <button
                    onClick={() => {
                      setDebug((d) => !d);
                      setMenu(false);
                    }}
                  >
                    <Cpu size={14} /> Acoustic debug state
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      <main className="workbench">
        <aside className="scene-sidebar">
          <div className="panel-heading">
            <span>
              <Layers3 size={15} /> Scene
            </span>
            <span className="small-mono">01</span>
          </div>
          <div className="scene-scroll">
            <div className="scene-summary">
              <span className="scene-thumb">
                <Box size={24} strokeWidth={1} />
              </span>
              <div>
                <strong>
                  {room.provenance === "illustrative"
                    ? "Listening studio"
                    : "Your room model"}
                </strong>
                <span>
                  {roomArea(room).toFixed(1)} m² <i /> {room.ceiling.toFixed(1)}{" "}
                  m high
                </span>
              </div>
              <span className="status-dot" />
            </div>
            <div className="layer-section">
              <h3>
                ROOM ENVELOPE<span>{room.walls.length + 2}</span>
              </h3>
              <LayerRow
                icon={Box}
                title="Walls"
                sub={`${room.walls.length} surfaces · ${room.walls.every((w) => w.material === room.walls[0].material) ? MATERIALS[room.walls[0].material].name : "Mixed materials"}`}
                active={!!selectedWall}
                onClick={() => select(room.walls[0].id)}
              />
              <LayerRow
                icon={Layers3}
                title="Floor"
                sub={MATERIALS[room.floorMaterial].name}
                active={selected === "floor"}
                onClick={() => select("floor")}
              />
              <LayerRow
                icon={PanelTop}
                title="Ceiling"
                sub={MATERIALS[room.ceilingMaterial].name}
                active={selected === "ceiling"}
                onClick={() => select("ceiling")}
              />
              {room.openings.map((o) => (
                <LayerRow
                  key={o.id}
                  icon={o.kind === "door" ? DoorOpen : Square}
                  title={o.kind === "door" ? "Door" : "Window"}
                  sub={MATERIALS[o.material].name}
                  active={selected === o.id}
                  onClick={() => select(o.id)}
                />
              ))}
            </div>
            <div className="layer-section">
              <h3>
                IN THE ROOM
                <div className="menu-wrap">
                  <button
                    aria-label="Add object"
                    className="tiny-button"
                    onClick={() => setAddMenu(!addMenu)}
                  >
                    <Plus size={13} />
                  </button>
                  {addMenu && (
                    <div className="dropdown add-menu">
                      {(
                        [
                          "door",
                          "window",
                          "sofa",
                          "table",
                          "shelf",
                          "rug",
                          "plant",
                        ] as const
                      ).map((kind) => (
                        <button key={kind} onClick={() => addObject(kind)}>
                          <Plus size={12} />
                          {
                            {
                              door: "Door",
                              window: "Window",
                              sofa: "Sofa",
                              table: "Table",
                              shelf: "Bookshelf",
                              rug: "Area rug",
                              plant: "Plant",
                            }[kind]
                          }
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </h3>
              <LayerRow
                icon={Volume1}
                title="Sound source"
                sub="Omnidirectional · S"
                color="#c6eaa8"
                active={selected === "source"}
                onClick={() => select("source")}
              />
              <LayerRow
                icon={Headphones}
                title="Listener"
                sub="Binaural receiver · L"
                color="#99cbd8"
                active={selected === "listener"}
                onClick={() => select("listener")}
              />
              <LayerRow
                icon={Sofa}
                title="Furniture"
                sub={`${room.furniture.length} objects`}
                onClick={() => setExpandedFurniture(!expandedFurniture)}
                suffix={
                  expandedFurniture ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )
                }
              />
              {expandedFurniture && (
                <div className="nested-layers">
                  {room.furniture.map((f) => (
                    <button
                      key={f.id}
                      className={selected === f.id ? "active" : ""}
                      onClick={() => select(f.id)}
                    >
                      <span
                        style={{ background: MATERIALS[f.material].color }}
                      />
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="layer-section treatments-section">
              <h3>
                TREATMENTS
                <span>
                  {room.treatments.length.toString().padStart(2, "0")}
                </span>
              </h3>
              {room.treatments.map((t, i) => (
                <LayerRow
                  key={t.id}
                  icon={PanelTop}
                  title={`Treatment ${String(i + 1).padStart(2, "0")}`}
                  sub={`${MATERIALS[t.material].name} · ${(t.width * t.height).toFixed(1)} m²`}
                  active={selected === t.id}
                  onClick={() => select(t.id)}
                />
              ))}
            </div>
          </div>
          <div className="quick-treatment">
            <button
              className="add-treatment"
              onClick={addTreatment}
              disabled={room.treatments.length >= 32}
            >
              <Plus size={15} />
              <span>Add a treatment</span>
            </button>
          </div>
          <div className="mini-plan-section">
            <div>
              <span>PLAN OVERVIEW</span>
              <button
                className="tiny-button"
                aria-label="Expand floor plan"
                onClick={() => setMode(mode === "plan" ? "orbit" : "plan")}
              >
                <Maximize2 size={12} />
              </button>
            </div>
            <PlanView {...planProps} mini />
            <div className="plan-scale">
              <span>Drag S or L to move</span>
              <span className="north-arrow">↑ N</span>
            </div>
          </div>
        </aside>
        <section className="center-column">
          <div
            ref={viewport}
            className={`viewport ${mode === "plan" ? "plan-mode" : ""}`}
          >
            <div className="viewport-top">
              <div className="view-tabs">
                <button
                  className={mode === "orbit" ? "active" : ""}
                  onClick={() => setMode("orbit")}
                >
                  <Box size={13} />
                  3D room
                </button>
                <button
                  className={mode === "plan" ? "active" : ""}
                  onClick={() => setMode("plan")}
                >
                  <Square size={13} />
                  2D plan
                </button>
                <button
                  className={mode === "walk" ? "active" : ""}
                  onClick={() => setMode("walk")}
                >
                  <Move3D size={13} />
                  Walkthrough
                </button>
              </div>
              <div className="live-badge">
                <span className="status-dot" /> LIVE MODEL
              </div>
            </div>
            <RoomView
              room={room}
              result={result}
              treated={treated}
              mode={mode}
              pathsVisible={pathsVisible}
              band={band}
              frozen={frozen}
              selected={selected}
              onMove={move}
              onSelect={select}
              onStats={statsChange}
              resetKey={resetKey}
            />
            {mode === "plan" && (
              <div className="large-plan">
                <PlanView {...planProps} edit={edit} />
              </div>
            )}
            <div className="viewport-caption">
              <span className="eyebrow">
                {mode === "walk"
                  ? "AT THE LISTENING POSITION"
                  : mode === "plan"
                    ? edit
                      ? "GEOMETRY EDITOR"
                      : "YOUR ROOM, IN PLAN"
                    : "SPACE, UNDERSTOOD"}
              </span>
              <h2>
                {mode === "walk"
                  ? "Step inside the sound."
                  : mode === "plan"
                    ? "An editable foundation."
                    : "A new perspective on sound."}
              </h2>
            </div>
            <div className="viewport-tools">
              <div className="tools-add-wrap">
                <button
                  className="icon-button"
                  aria-label="Add to room"
                  title="Add to room"
                  aria-expanded={viewportAddMenu}
                  onClick={() => setViewportAddMenu(!viewportAddMenu)}
                >
                  <Plus size={17} />
                </button>
                {viewportAddMenu && (
                  <div className="dropdown viewport-add-menu">
                    <button
                      onClick={() => {
                        addTreatment();
                        setViewportAddMenu(false);
                      }}
                    >
                      <PanelTop size={14} />
                      Acoustic treatment
                    </button>
                    {(
                      [
                        "door",
                        "window",
                        "sofa",
                        "table",
                        "shelf",
                        "rug",
                        "plant",
                      ] as const
                    ).map((kind) => (
                      <button
                        key={kind}
                        onClick={() => {
                          addObject(kind);
                          setViewportAddMenu(false);
                        }}
                      >
                        <Plus size={13} />
                        {
                          {
                            door: "Door",
                            window: "Window",
                            sofa: "Sofa",
                            table: "Table",
                            shelf: "Bookshelf",
                            rug: "Area rug",
                            plant: "Plant",
                          }[kind]
                        }
                      </button>
                    ))}
                    <hr />
                    <button
                      onClick={() => {
                        select("room");
                        setViewportAddMenu(false);
                      }}
                    >
                      <Settings2 size={14} />
                      Room settings
                    </button>
                  </div>
                )}
              </div>
              <button
                className={`icon-button ${pathsVisible ? "toggled" : ""}`}
                title="Toggle sound paths"
                aria-label="Toggle sound paths"
                aria-pressed={pathsVisible}
                onClick={() => setPathsVisible(!pathsVisible)}
              >
                <Waves size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Reset camera"
                title="Reset camera"
                onClick={() => setResetKey((k) => k + 1)}
              >
                <RotateCcw size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Fullscreen room"
                title="Fullscreen"
                onClick={() => {
                  if (document.fullscreenElement)
                    void document.exitFullscreen();
                  else
                    void viewport.current
                      ?.requestFullscreen()
                      .catch(() =>
                        notify("Fullscreen is unavailable in this browser."),
                      );
                }}
              >
                <Expand size={16} />
              </button>
            </div>
            <div className="room-dimensions">
              <span>
                {roomArea(room).toFixed(1)}
                <small>m²</small>
              </span>
              <i />
              <span>
                {room.ceiling.toFixed(1)}
                <small>m ceiling</small>
              </span>
              <i />
              <span>
                {result.volume.toFixed(1)}
                <small>m³</small>
              </span>
            </div>
            <div className="path-legend">
              <span>
                <i className="direct" /> Direct
              </span>
              <span>
                <i className="first" /> 1st reflection
              </span>
              <span>
                <i className="second" /> 2nd reflection
              </span>
            </div>
            <div className="viewport-bottom">
              <span>
                <MousePointer2 size={12} />
                {mode === "walk"
                  ? "WASD to move · drag to look · Esc to exit"
                  : mode === "plan"
                    ? edit
                      ? "Drag corners to trace · click a surface to edit"
                      : "Drag S or L · select an object to edit"
                    : "Drag to orbit · scroll to zoom"}
              </span>
              <span>
                {mode === "walk" ? "Listener-linked camera" : "Perspective"}{" "}
                <span className="small-mono">
                  {frozen ? "CAPTURE" : `${perf.fps} FPS`}
                </span>
              </span>
            </div>
            {mode === "walk" && (
              <div className="walk-controls">
                <button
                  aria-label="Walk forward"
                  onClick={() =>
                    move("listener", {
                      ...room.listener,
                      x: room.listener.x + Math.sin(room.yaw) * 0.35,
                      z: room.listener.z - Math.cos(room.yaw) * 0.35,
                    })
                  }
                >
                  ↑
                </button>
                <div>
                  <button
                    aria-label="Turn left"
                    onClick={() =>
                      move("listener", room.listener, room.yaw + 0.3)
                    }
                  >
                    ↶
                  </button>
                  <button
                    aria-label="Walk backward"
                    onClick={() =>
                      move("listener", {
                        ...room.listener,
                        x: room.listener.x - Math.sin(room.yaw) * 0.35,
                        z: room.listener.z + Math.cos(room.yaw) * 0.35,
                      })
                    }
                  >
                    ↓
                  </button>
                  <button
                    aria-label="Turn right"
                    onClick={() =>
                      move("listener", room.listener, room.yaw - 0.3)
                    }
                  >
                    ↷
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="response-panel">
            <div className="response-heading">
              <div>
                <AudioLines size={15} />
                <h3>Early impulse response</h3>
                <span className="subtle-tag">
                  {result.provenance === "fitted"
                    ? "FITTED MODEL"
                    : "SIMULATED"}
                </span>
              </div>
              <div className="frequency-select">
                <span>OCTAVE BAND</span>
                <select
                  aria-label="Octave band"
                  value={band}
                  onChange={(e) => setBand(Number(e.target.value))}
                >
                  {BANDS.map((b, i) => (
                    <option value={i} key={b}>
                      {b < 1000 ? b : `${b / 1000}k`} Hz
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <ImpulseChart result={result} band={band} />
            <div className="response-foot">
              <span>
                First arrival{" "}
                <strong>
                  {result.paths[0]
                    ? `${(result.paths[0].delay * 1000).toFixed(1)} ms`
                    : "No valid arrival"}
                </strong>
              </span>
              <span>
                {result.paths.length} valid paths <i /> {BANDS[band]} Hz
              </span>
            </div>
          </div>
        </section>
        <aside className="inspector">
          <div className="inspector-tabs">
            <button
              className={inspector === "acoustics" ? "active" : ""}
              onClick={() => setInspector("acoustics")}
            >
              Acoustics
            </button>
            <button
              className={inspector === "selection" ? "active" : ""}
              onClick={() => setInspector("selection")}
            >
              Selection
            </button>
            <Settings2 size={14} />
          </div>
          <div className="inspector-scroll">
            {inspector === "acoustics" ? (
              <>
                <div className="inspector-intro">
                  <span className="eyebrow">THE ROOM RESPONSE</span>
                  <h2>Hear the difference.</h2>
                  <p>A little less echo. A little more clarity.</p>
                </div>
                <div className="rt-card">
                  <div className="metric-label">
                    Predicted decay <span>RT60</span>
                  </div>
                  <div className="rt-value" data-testid="rt60">
                    {midRT.toFixed(2)}
                    <span>s</span>
                    {treated && reduction > 0 && (
                      <small>
                        <Leaf size={12} /> −{reduction}%
                      </small>
                    )}
                  </div>
                  <div className="rt-caption">
                    500 Hz–1 kHz average{" "}
                    <span className="model-chip">
                      {result.provenance === "fitted"
                        ? "FITTED"
                        : room.provenance === "illustrative"
                          ? "ILLUSTRATIVE"
                          : "INFERRED"}
                    </span>
                  </div>
                  <DecayChart
                    result={result}
                    treated={treated}
                    band={band}
                    onBand={setBand}
                  />
                  <div className="chart-legend">
                    <span>
                      <i className="dashed" />
                      Original
                    </span>
                    <span>
                      <i />
                      {treated ? "With treatments" : "Current room"}
                    </span>
                  </div>
                </div>
                <div className="acoustic-metrics">
                  <div>
                    <span>Source → listener</span>
                    <strong>
                      {result.directDistance.toFixed(2)}
                      <small>m</small>
                    </strong>
                  </div>
                  <div>
                    <span>Direct arrival</span>
                    <strong>
                      {result.paths.some((p) => p.order === 0) ? (
                        <>
                          {(result.directDelay * 1000).toFixed(1)}
                          <small>ms</small>
                        </>
                      ) : (
                        "Blocked"
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Early reflection paths</span>
                    <strong>
                      {result.paths.filter((p) => p.order > 0).length}
                      <small>paths</small>
                    </strong>
                  </div>
                </div>
                <div className="reflection-settings">
                  <div>
                    <span>Reflection order</span>
                    <div className="segmented small">
                      {[1, 2].map((n) => (
                        <button
                          key={n}
                          aria-label={`Reflection order ${n}`}
                          className={order === n ? "active" : ""}
                          onClick={() => setOrder(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p>Direct + early paths, with a modeled diffuse tail.</p>
                </div>
                <div className="insight-card">
                  <span className="insight-icon">
                    <Sparkles size={17} strokeWidth={1.5} />
                  </span>
                  <div>
                    <h4>
                      {treated && room.treatments.length
                        ? "A softer landing for sound."
                        : "Make room for better sound."}
                    </h4>
                    <p>
                      {treated && room.treatments.length
                        ? `Your treatment layout predicts ${reduction}% less midband decay. Listen to A / B to explore the change.`
                        : "Try an absorbent panel at an early reflection point. Compare the room before and after."}
                    </p>
                    {!room.treatments.length && (
                      <button onClick={addTreatment}>
                        Add your first treatment <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {room.calibration && (
                  <div className="calibration-status">
                    <span>
                      MEASURED {room.calibration.rt60.toFixed(2)} s ·{" "}
                      {new Date(
                        room.calibration.measuredAt,
                      ).toLocaleDateString()}
                    </span>
                    <label>
                      <input
                        type="checkbox"
                        checked={room.calibration.applied}
                        onChange={(e) =>
                          update((r) => ({
                            ...r,
                            calibration: {
                              ...r.calibration!,
                              applied: e.target.checked,
                            },
                          }))
                        }
                      />
                      Apply fitted decay factor
                    </label>
                  </div>
                )}
              </>
            ) : (
              <div className="selection-panel">
                <span className="eyebrow">OBJECT INSPECTOR</span>
                <h2>{selectedTitle}</h2>
                <span className="selection-confidence">
                  {selectedWall?.confidence ??
                    selectedFurniture?.confidence ??
                    selectedOpening?.confidence ??
                    (selectedTreatment ? "user-defined" : room.provenance)}{" "}
                  · editable
                </span>
                {selectedPosition && (
                  <>
                    <p className="hint">
                      Drag in either view, or enter precise coordinates. Changes
                      update the sound as you listen.
                    </p>
                    <div className="coordinate-fields">
                      <NumberField
                        label="X position"
                        value={selectedPosition.x}
                        min={bounds(room).minX + 0.1}
                        max={bounds(room).maxX - 0.1}
                        onChange={(x) =>
                          move(selected, { ...selectedPosition, x })
                        }
                      />
                      <NumberField
                        label="Z position"
                        value={selectedPosition.z}
                        min={bounds(room).minZ + 0.1}
                        max={bounds(room).maxZ - 0.1}
                        onChange={(z) =>
                          move(selected, { ...selectedPosition, z })
                        }
                      />
                      <NumberField
                        label="Height"
                        value={selectedPosition.y}
                        min={0.2}
                        max={room.ceiling - 0.1}
                        onChange={(y) =>
                          move(selected, { ...selectedPosition, y })
                        }
                      />
                    </div>
                    {selected === "listener" && (
                      <NumberField
                        label="Facing"
                        value={(room.yaw * 180) / Math.PI}
                        min={-36000}
                        max={36000}
                        unit="°"
                        step={15}
                        onChange={(yaw) =>
                          update((r) => ({ ...r, yaw: (yaw * Math.PI) / 180 }))
                        }
                      />
                    )}
                    <div className="object-note">
                      <Headphones size={18} />
                      <p>
                        {selected === "source"
                          ? "An omnidirectional source. Use headphones to hear changes in distance, direction, and reflected sound."
                          : "The listener’s position and orientation drive binaural rendering. Walkthrough follows this position."}
                      </p>
                    </div>
                  </>
                )}
                {selectedWall && (
                  <>
                    <label className="select-label">
                      Selected wall
                      <select
                        aria-label="Selected wall"
                        value={selectedWall.id}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        {room.walls.map((w, i) => (
                          <option value={w.id} key={w.id}>
                            Wall {i + 1} · {wallLength(w).toFixed(2)} m
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="selection-dimensions">
                      <span>
                        Length
                        <strong>{wallLength(selectedWall).toFixed(2)} m</strong>
                      </span>
                      <span>
                        Gross area
                        <strong>
                          {(wallLength(selectedWall) * room.ceiling).toFixed(1)}{" "}
                          m²
                        </strong>
                      </span>
                    </div>
                    <button
                      className="outline-button full-width"
                      onClick={() => {
                        setMode("plan");
                        setEdit(true);
                      }}
                    >
                      Edit wall corners <Ruler size={14} />
                    </button>
                  </>
                )}
                {selectedMaterial && (
                  <>
                    <MaterialSelect
                      value={selectedMaterial}
                      onChange={changeMaterial}
                    />
                    <div className="absorption-mini">
                      <span>ABSORPTION COEFFICIENT · α</span>
                      <div>
                        {MATERIALS[selectedMaterial].alpha.map((a, i) => (
                          <div key={i}>
                            <span
                              style={{
                                height: `${a * 50 + 2}px`,
                                background: MATERIALS[selectedMaterial].color,
                              }}
                            />
                            <strong>{a.toFixed(2)}</strong>
                            <small>
                              {BANDS[i] < 1000
                                ? BANDS[i]
                                : `${BANDS[i] / 1000}k`}
                            </small>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="hint">
                      Generic illustrative preset. Construction, thickness,
                      backing, and mounting change real absorption.
                    </p>
                  </>
                )}
                {selectedFurniture && (
                  <>
                    <div className="coordinate-fields">
                      {(["x", "z", "width", "depth", "height"] as const).map(
                        (key) => (
                          <NumberField
                            key={key}
                            label={
                              {
                                x: "X position",
                                z: "Z position",
                                width: "Width",
                                depth: "Depth",
                                height: "Height",
                              }[key]
                            }
                            value={selectedFurniture[key]}
                            min={
                              key === "height"
                                ? 0.01
                                : key === "x" || key === "z"
                                  ? -100
                                  : 0.1
                            }
                            max={key === "x" || key === "z" ? 100 : 20}
                            onChange={(v) =>
                              update((r) => ({
                                ...r,
                                furniture: r.furniture.map((f) =>
                                  f.id === selected ? { ...f, [key]: v } : f,
                                ),
                              }))
                            }
                          />
                        ),
                      )}
                    </div>
                    <NumberField
                      label="Rotation"
                      value={(selectedFurniture.rotation * 180) / Math.PI}
                      min={-360}
                      max={360}
                      step={15}
                      unit="°"
                      onChange={(v) =>
                        update((r) => ({
                          ...r,
                          furniture: r.furniture.map((f) =>
                            f.id === selected
                              ? { ...f, rotation: (v * Math.PI) / 180 }
                              : f,
                          ),
                        }))
                      }
                    />
                  </>
                )}
                {(selectedOpening || selectedTreatment) &&
                  (() => {
                    const obj = (selectedOpening ?? selectedTreatment)!,
                      wall = room.walls.find((w) => w.id === obj.wallId)!,
                      len = wallLength(wall);
                    const change = (field: string, value: number | string) =>
                      update((r) =>
                        selectedOpening
                          ? {
                              ...r,
                              openings: r.openings.map((o) =>
                                o.id === selected
                                  ? { ...o, [field]: value }
                                  : o,
                              ),
                            }
                          : {
                              ...r,
                              treatments: r.treatments.map((t) =>
                                t.id === selected
                                  ? { ...t, [field]: value }
                                  : t,
                              ),
                            },
                      );
                    return (
                      <>
                        <label className="select-label">
                          On wall
                          <select
                            aria-label="Treatment or opening wall"
                            value={obj.wallId}
                            onChange={(e) => {
                              const w = room.walls.find(
                                (w) => w.id === e.target.value,
                              )!;
                              update((r) => {
                                const patch = {
                                  wallId: w.id,
                                  offset: wallLength(w) / 2,
                                  width: Math.min(
                                    obj.width,
                                    wallLength(w) - 0.1,
                                  ),
                                };
                                return selectedOpening
                                  ? {
                                      ...r,
                                      openings: r.openings.map((o) =>
                                        o.id === selected
                                          ? { ...o, ...patch }
                                          : o,
                                      ),
                                    }
                                  : {
                                      ...r,
                                      treatments: r.treatments.map((t) =>
                                        t.id === selected
                                          ? { ...t, ...patch }
                                          : t,
                                      ),
                                    };
                              });
                            }}
                          >
                            {room.walls.map((w, i) => (
                              <option key={w.id} value={w.id}>
                                Wall {i + 1}
                              </option>
                            ))}
                          </select>
                        </label>
                        <NumberField
                          label="Width"
                          value={obj.width}
                          min={0.1}
                          max={Math.min(obj.offset, len - obj.offset) * 2}
                          onChange={(v) => change("width", v)}
                        />
                        <NumberField
                          label="Height"
                          value={obj.height}
                          min={0.1}
                          max={room.ceiling - (selectedOpening?.sill ?? 0)}
                          onChange={(v) => change("height", v)}
                        />
                        <NumberField
                          label="Distance along wall"
                          value={obj.offset}
                          min={obj.width / 2}
                          max={len - obj.width / 2}
                          onChange={(v) => change("offset", v)}
                        />
                        {selectedOpening && (
                          <NumberField
                            label="Sill height"
                            value={selectedOpening.sill}
                            min={0}
                            max={room.ceiling - selectedOpening.height}
                            onChange={(v) => change("sill", v)}
                          />
                        )}
                        {selectedTreatment && (
                          <p className="hint">
                            Centered vertically. A excludes added treatments; B
                            includes them. Layered or overlapping panels count
                            once.
                          </p>
                        )}
                      </>
                    );
                  })()}
                {(selectedFurniture ||
                  selectedOpening ||
                  selectedTreatment) && (
                  <button
                    className="delete-button"
                    onClick={() => {
                      update((r) => ({
                        ...r,
                        furniture: r.furniture.filter((f) => f.id !== selected),
                        openings: r.openings.filter((o) => o.id !== selected),
                        treatments: r.treatments.filter(
                          (t) => t.id !== selected,
                        ),
                      }));
                      setSelected("room");
                      notify("Object removed. Use Undo to restore it.");
                    }}
                  >
                    <Trash2 size={14} />
                    Remove {selectedTreatment ? "treatment" : "object"}
                  </button>
                )}
                {selected === "room" && (
                  <>
                    <label className="select-label">
                      Room name
                      <input
                        value={room.name}
                        maxLength={80}
                        onChange={(e) =>
                          update((r) => ({ ...r, name: e.target.value }))
                        }
                      />
                    </label>
                    <NumberField
                      label="Ceiling height"
                      value={room.ceiling}
                      min={Math.max(
                        1.8,
                        room.source.y + 0.1,
                        room.listener.y + 0.1,
                        ...room.openings.map((o) => o.sill + o.height),
                        ...room.treatments.map((t) => t.height),
                      )}
                      max={12}
                      onChange={(ceiling) => update((r) => ({ ...r, ceiling }))}
                    />
                    <p className="hint">
                      Geometry is in meters. One room, one closed boundary.
                      Windows and doors are modeled as closed surfaces.
                    </p>
                    <button
                      className="outline-button full-width"
                      onClick={() => setModal("import")}
                    >
                      <Upload size={14} />
                      Trace a floor plan
                    </button>
                    {room.photos.length > 0 && (
                      <>
                        <h4 className="eyebrow">REFERENCE PHOTOGRAPHS</h4>
                        <div className="reference-photos">
                          {room.photos.map((p, i) => (
                            <img
                              src={p}
                              key={i}
                              alt={`Room reference ${i + 1}`}
                            />
                          ))}
                        </div>
                        <p className="hint">
                          Reference only. Material recognition has not been
                          performed.
                        </p>
                      </>
                    )}
                  </>
                )}
                {selectedWall && (
                  <button
                    className="primary-button full-width"
                    onClick={addTreatment}
                  >
                    <Plus size={14} />
                    Treat this wall
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            className="calibrate-button fixed-calibrate"
            onClick={() => {
              audio.stop();
              setPlaying(false);
              setTreated(false);
              setModal("calibrate");
            }}
          >
            <Mic size={17} />
            <span>
              {room.calibration
                ? "Review & recalibrate"
                : "Calibrate with your room"}
              <small>Optional microphone measurement</small>
            </span>
            <ChevronRight size={14} />
          </button>
          <div className="model-note">
            <span className="status-dot amber-dot" />
            <p>
              {room.provenance === "illustrative"
                ? "Illustrative demo · approximate acoustics"
                : "Inferred room · approximate acoustics"}
              <br />
              <span>For exploration, not professional certification.</span>
            </p>
          </div>
        </aside>
      </main>
      <section className="audio-dock" aria-label="Spatial audio player">
        <div className="audio-title">
          <span className={`audio-emblem ${playing ? "playing" : ""}`}>
            <AudioLines size={22} />
          </span>
          <div>
            <strong>Listen to your space</strong>
            <span>
              <Headphones size={11} /> Headphones recommended
            </span>
          </div>
        </div>
        <button
          className="play-button"
          aria-label={playing ? "Pause spatial audio" : "Play spatial audio"}
          data-testid="play-audio"
          onClick={() => void toggleAudio()}
        >
          {playing ? (
            <Pause size={17} fill="currentColor" />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
        </button>
        <div className="signal-select">
          <select
            aria-label="Sound sample"
            value={signal}
            onChange={(e) => {
              const s = e.target.value as typeof signal;
              setSignal(s);
              audio.setSignal(s);
            }}
          >
            <option value="percussion">Soft percussion</option>
            <option value="noise">Filtered noise</option>
          </select>
          <span>{playing ? "PLAYING · BINAURAL" : "READY WHEN YOU ARE"}</span>
        </div>
        <div
          className={`audio-wave ${playing ? "playing" : ""}`}
          aria-hidden="true"
        >
          {Array.from({ length: 31 }, (_, i) => (
            <i
              key={i}
              style={{
                height: `${5 + Math.abs(Math.sin(i * 1.3) * Math.sin(i * 0.41)) * 25}px`,
                animationDelay: `${i * -0.07}s`,
              }}
            />
          ))}
        </div>
        <div className="volume-control">
          <Volume1 size={17} />
          <input
            aria-label="Playback volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              audio.setVolume(Number(e.target.value));
            }}
          />
        </div>
        <div className="dock-divider" />
        <div className="comparison-control">
          <span>LISTEN & COMPARE</span>
          <div className="ab-switch">
            <button
              className={!treated ? "active" : ""}
              aria-pressed={!treated}
              onClick={() => setTreated(false)}
            >
              <kbd>A</kbd>Original
            </button>
            <button
              className={treated ? "active" : ""}
              aria-pressed={treated}
              onClick={() => setTreated(true)}
            >
              <kbd>B</kbd>Treated{room.treatments.length > 0 && <i />}
            </button>
          </div>
        </div>
      </section>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          {playing ? "Audio engine active" : "Acoustic engine ready"}
          <i />
          {result.elapsedMs.toFixed(1)} ms calculation
        </span>
        <span className="footer-center">
          A private little laboratory for your space.
        </span>
        <div>
          <button
            aria-label="Undo change"
            disabled={!historyState[0]}
            onClick={undo}
          >
            <Undo2 size={13} />
          </button>
          <button
            aria-label="Redo change"
            disabled={!historyState[1]}
            onClick={redo}
          >
            <Redo2 size={13} />
          </button>
          <button
            className={debug ? "active" : ""}
            onClick={() => setDebug(!debug)}
          >
            <Activity size={12} />
            {debug ? "Close inspector" : "Engine v0.1"}
          </button>
        </div>
      </footer>
      {debug && (
        <div className="debug-panel">
          <header>
            <span>
              <Cpu size={15} />
              ACOUSTIC DEBUG STATE
            </span>
            <button
              className="icon-button"
              aria-label="Close debug state"
              onClick={() => setDebug(false)}
            >
              <X size={15} />
            </button>
          </header>
          <div>
            <span>
              Scene <strong>{room.name}</strong>
            </span>
            <span>
              Worker <strong>{result.elapsedMs.toFixed(2)} ms</strong>
            </span>
            <span>
              Paths{" "}
              <strong>
                {result.paths.length} / {result.testedPaths} tested
              </strong>
            </span>
            <span>
              Renderer{" "}
              <strong>
                {perf.fps} fps · {perf.calls} calls
              </strong>
            </span>
            <span>
              Triangles <strong>{perf.triangles.toLocaleString()}</strong>
            </span>
            <span>
              Audio{" "}
              <strong>
                {audio.debug().state} · {audio.debug().voices} voices
              </strong>
            </span>
          </div>
          <pre data-testid="debug-state">
            {JSON.stringify(
              {
                source: room.source,
                listener: room.listener,
                yaw: room.yaw,
                rt60: result.rt60,
                absorption: result.absorption,
                provenance: result.provenance,
                treated,
                order,
                geometries: perf.geometries,
              },
              null,
              2,
            )}
          </pre>
          <button
            className="outline-button"
            onClick={() =>
              download(
                "echo-acoustic-state.json",
                JSON.stringify(window.__ECHO__.getState(), null, 2),
              )
            }
          >
            <ArrowDownToLine size={14} />
            Export debug state
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button
            className="tiny-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {modal === "import" && (
        <ImportRoom
          onClose={() => setModal(null)}
          onImport={(r) => {
            update(() => r);
            setTreated(false);
            setMode("plan");
            setEdit(true);
            setResetKey((k) => k + 1);
            setSelected("room");
            setInspector("selection");
            setModal(null);
            notify(
              "Your room is ready. Review inferred materials and add doors, windows, and furniture.",
            );
          }}
        />
      )}
      {modal === "calibrate" && (
        <CalibrationDialog
          predicted={
            baselineRT *
            (room.calibration?.applied ? room.calibration.scale : 1)
          }
          onClose={() => setModal(null)}
          onApply={(calibration) => {
            update((r) => ({ ...r, calibration }));
            setModal(null);
            notify(
              "Measured decay saved. The simulation now uses an approximate fitted absorption factor.",
            );
          }}
        />
      )}
      {modal === "materials" && (
        <Modal
          wide
          title="The character of a surface."
          eyebrow="MATERIAL LIBRARY · ILLUSTRATIVE PRESETS"
          onClose={() => setModal(null)}
        >
          <p className="material-intro">
            Explore how surfaces absorb sound across the spectrum. Presets are
            approximate starting points; real construction matters.
          </p>
          <div className="material-grid">
            {Object.entries(MATERIALS).map(([id, m]) => (
              <button
                key={id}
                className="material-card"
                disabled={!selectedMaterial}
                onClick={() => {
                  changeMaterial(id as MaterialId);
                  setModal(null);
                  notify(
                    `${m.name} applied to ${selectedTitle.toLowerCase()}.`,
                  );
                }}
              >
                <div
                  className={`material-swatch ${id}`}
                  style={{ "--swatch": m.color } as React.CSSProperties}
                >
                  <span>
                    {id === "panel" ? (
                      <PanelTop size={35} strokeWidth={0.7} />
                    ) : id === "bookshelves" ? (
                      <Layers3 size={35} strokeWidth={0.7} />
                    ) : null}
                  </span>
                  <small>α {m.alpha[3].toFixed(2)} @ 1k Hz</small>
                </div>
                <h3>{m.name}</h3>
                <p>{m.description}</p>
                <div className="material-bars">
                  {m.alpha.map((a, i) => (
                    <span
                      key={i}
                      style={{ height: `${a * 28 + 2}px`, background: m.color }}
                    />
                  ))}
                </div>
              </button>
            ))}
          </div>
          <footer className="modal-footer">
            <span>
              {selectedMaterial
                ? `Choose a preset to apply to ${selectedTitle.toLowerCase()}.`
                : "Select a wall, surface, or object to apply a material."}
            </span>
            <button className="outline-button" onClick={() => setModal(null)}>
              Back to room <ArrowLeft size={14} />
            </button>
          </footer>
        </Modal>
      )}
      {modal === "about" && (
        <Modal
          title="A room, heard differently."
          eyebrow="ECHO CARTOGRAPHER · FIELD NOTES"
          onClose={() => setModal(null)}
        >
          <div className="about-body">
            <p className="modal-intro">
              A local acoustic sketchbook for exploring how geometry and
              materials change the sound of a space.
            </p>
            <div className="provenance-grid">
              <div>
                <span className="status-dot" />
                <strong>Measured</strong>
                <p>
                  A microphone capture, when you explicitly start calibration.
                  It includes your devices’ response.
                </p>
              </div>
              <div>
                <span className="status-dot amber-dot" />
                <strong>Inferred</strong>
                <p>
                  Traced geometry, assumed surfaces, and predictions from a
                  simplified model. Review every material.
                </p>
              </div>
              <div>
                <span className="status-dot blue-dot" />
                <strong>Illustrative</strong>
                <p>
                  The demo room, generic material presets, and synthesized late
                  reverberation. No real measurement implied.
                </p>
              </div>
            </div>
            <h3>What you’re hearing</h3>
            <p>
              Image-source direct and first/second reflections, spatialized with
              the browser’s generic HRTF. A seeded, six-band diffuse tail
              follows a Sabine decay estimate. Furniture contributes approximate
              absorption; diffraction, furniture occlusion, transmission, and
              room modes are not simulated. Doors and windows are closed
              surfaces.
            </p>
            <p>
              Calibration estimates a regularized sweep impulse response and a
              noise-corrected T20 decay. A single fitted factor adjusts the
              simulated decay; it cannot identify the materials of your room.
            </p>
            <div className="shortcut-grid">
              <span>
                <kbd>Space</kbd>Play / pause
              </span>
              <span>
                <kbd>A</kbd>
                <kbd>B</kbd>Compare treatments
              </span>
              <span>
                <kbd>W A S D</kbd>Walk
              </span>
              <span>
                <kbd>← →</kbd>Turn in walkthrough
              </span>
              <span>
                <kbd>⌘ Z</kbd>Undo
              </span>
              <span>
                <kbd>Esc</kbd>Exit walkthrough / dialog
              </span>
            </div>
            <p className="hint">
              Everything stays in this browser’s IndexedDB. Export a room backup
              before clearing browser data. Once loaded from the production
              build, the application can run offline. No accounts, remote
              inference, or analytics.
            </p>
            <p className="hint">
              Original procedural geometry and audio. Inter and Manrope fonts:
              SIL Open Font License. Lucide icons: ISC. Engine and validation
              notes are included in ENGINEERING_LOG.md.
            </p>
          </div>
          <footer className="modal-footer">
            <span>
              For exploration, not professional acoustic certification.
            </span>
            <button className="primary-button" onClick={() => setModal(null)}>
              Back to exploring <ArrowRight size={14} />
            </button>
          </footer>
        </Modal>
      )}
      <input
        ref={file}
        hidden
        type="file"
        accept=".json,.echo.json,application/json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            if (f.size > 50_000_000)
              throw new Error("Room backups must be smaller than 50 MB.");
            const r = validateRoom(JSON.parse(await f.text()));
            update(() => r);
            setTreated(r.treatments.length > 0);
            setResetKey((k) => k + 1);
            setSelected("room");
            notify("Room backup restored on this device.");
          } catch (e) {
            notify(`Could not open room: ${(e as Error).message}`);
          }
        }}
      />
    </div>
  );
}
