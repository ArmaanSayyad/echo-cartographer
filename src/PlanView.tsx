import { useRef } from "react";
import { bounds, MATERIALS, wallLength } from "./model";
import type { Room, Vec2, Vec3 } from "./model";
import type { AcousticResult } from "./acoustics";
type Props = {
  room: Room;
  result: AcousticResult;
  treated: boolean;
  mini?: boolean;
  edit?: boolean;
  selected: string;
  pathsVisible: boolean;
  onSelect: (id: string) => void;
  onMove: (who: "source" | "listener" | string, p: Vec3) => void;
  onVertex: (index: number, p: Vec2) => void;
};
export default function PlanView({
  room,
  result,
  treated,
  mini,
  edit,
  selected,
  pathsVisible,
  onSelect,
  onMove,
  onVertex,
}: Props) {
  const ref = useRef<SVGSVGElement>(null),
    drag = useRef<{
      id: string;
      vertex?: number;
      dx: number;
      dz: number;
    } | null>(null);
  const b = bounds(room),
    margin = mini ? 0.55 : 1.05,
    w = b.maxX - b.minX,
    h = b.maxZ - b.minZ;
  const coordinate = (e: React.PointerEvent) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      ref.current!.getScreenCTM()!.inverse(),
    );
    return { x: p.x, z: p.y };
  };
  const start = (
    e: React.PointerEvent,
    id: string,
    pos: Vec2,
    vertex?: number,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const p = coordinate(e);
    drag.current = { id, vertex, dx: p.x - pos.x, dz: p.z - pos.z };
    ref.current!.setPointerCapture(e.pointerId);
    onSelect(id);
  };
  return (
    <svg
      ref={ref}
      className={`plan-svg ${mini ? "mini" : ""}`}
      viewBox={`${b.minX - margin} ${b.minZ - margin} ${w + margin * 2} ${h + margin * 2}`}
      aria-label={
        mini
          ? "Synchronized mini floor plan"
          : "Editable floor plan. Drag the speaker, listener, furniture, or wall corners."
      }
      data-testid={mini ? "mini-plan" : "plan"}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const p = coordinate(e),
          d = drag.current,
          next = { x: p.x - d.dx, z: p.z - d.dz };
        if (d.vertex !== undefined) onVertex(d.vertex, next);
        else
          onMove(d.id, {
            ...next,
            y: d.id === "source" ? room.source.y : room.listener.y,
          });
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (ref.current!.hasPointerCapture(e.pointerId))
          ref.current!.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <defs>
        <pattern
          id={mini ? "mini-grid" : "plan-grid"}
          width=".5"
          height=".5"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M .5 0 L 0 0 0 .5"
            fill="none"
            stroke="#6c8276"
            strokeOpacity=".12"
            strokeWidth=".01"
          />
        </pattern>
      </defs>
      <rect
        x={b.minX - margin}
        y={b.minZ - margin}
        width={w + margin * 2}
        height={h + margin * 2}
        fill={`url(#${mini ? "mini-grid" : "plan-grid"})`}
      />
      {room.plan && (
        <image
          href={room.plan.image}
          x={-room.plan.originX * room.plan.metersPerPixel}
          y={-room.plan.originY * room.plan.metersPerPixel}
          width={room.plan.width * room.plan.metersPerPixel}
          height={room.plan.height * room.plan.metersPerPixel}
          opacity={mini ? 0.16 : 0.35}
        />
      )}
      <polygon
        points={room.walls.map((w) => `${w.a.x},${w.a.z}`).join(" ")}
        fill="#313d33"
        fillOpacity={room.plan ? 0.45 : 0.6}
      />
      {room.furniture.map((f) => (
        <g
          key={f.id}
          transform={`translate(${f.x} ${f.z}) rotate(${(f.rotation * 180) / Math.PI})`}
          className="plan-object"
          onPointerDown={(e) => start(e, f.id, f)}
        >
          <rect
            x={-f.width / 2}
            y={-f.depth / 2}
            width={f.width}
            height={f.depth}
            rx={f.kind === "plant" ? f.width / 2 : 0.06}
            fill={MATERIALS[f.material].color}
            fillOpacity={f.kind === "rug" ? 0.13 : 0.34}
            stroke={selected === f.id ? "#d2f5c5" : "#8e9b87"}
            strokeWidth=".025"
            strokeDasharray={f.kind === "rug" ? ".06 .04" : undefined}
          />
          {f.kind === "sofa" && (
            <path
              d={`M${-f.width / 2 + 0.13},${f.depth / 2 - 0.12} V${-f.depth / 2 + 0.16} H${f.width / 2 - 0.13} V${f.depth / 2 - 0.12}`}
              fill="none"
              stroke="#b2b7a4"
              strokeWidth=".09"
            />
          )}
          {f.kind === "shelf" &&
            Array.from({ length: Math.floor(f.width / 0.14) }, (_, i) => (
              <line
                key={i}
                x1={-f.width / 2 + 0.07 + i * 0.14}
                x2={-f.width / 2 + 0.07 + i * 0.14}
                y1={-f.depth / 2 + 0.05}
                y2={f.depth / 2 - 0.05}
                stroke="#9caa95"
                strokeWidth=".04"
              />
            ))}
        </g>
      ))}
      {room.walls.map((wall, i) => (
        <g
          key={wall.id}
          onClick={() => onSelect(wall.id)}
          className="plan-wall"
        >
          <line
            x1={wall.a.x}
            y1={wall.a.z}
            x2={wall.b.x}
            y2={wall.b.z}
            stroke={selected === wall.id ? "#ceecba" : "#a7b39b"}
            strokeWidth={mini ? 0.09 : 0.07}
          />
          <line
            x1={wall.a.x}
            y1={wall.a.z}
            x2={wall.b.x}
            y2={wall.b.z}
            stroke="transparent"
            strokeWidth=".28"
          />
          {!mini && (
            <text
              x={(wall.a.x + wall.b.x) / 2}
              y={(wall.a.z + wall.b.z) / 2 - 0.17}
              textAnchor="middle"
              fill="#b1bca6"
              fontSize=".15"
            >
              {String(i + 1).padStart(2, "0")} · {wallLength(wall).toFixed(2)} m
            </text>
          )}
        </g>
      ))}
      {room.openings.map((o) => {
        const wall = room.walls.find((w) => w.id === o.wallId)!;
        const len = wallLength(wall),
          dx = (wall.b.x - wall.a.x) / len,
          dz = (wall.b.z - wall.a.z) / len;
        return (
          <g key={o.id} className="plan-object" onClick={() => onSelect(o.id)}>
            <line
              x1={wall.a.x + dx * (o.offset - o.width / 2)}
              y1={wall.a.z + dz * (o.offset - o.width / 2)}
              x2={wall.a.x + dx * (o.offset + o.width / 2)}
              y2={wall.a.z + dz * (o.offset + o.width / 2)}
              stroke={o.kind === "window" ? "#91c7d2" : "#c4a27d"}
              strokeWidth=".11"
            />
          </g>
        );
      })}
      {treated &&
        room.treatments.map((t) => {
          const wall = room.walls.find((w) => w.id === t.wallId)!;
          const len = wallLength(wall),
            dx = (wall.b.x - wall.a.x) / len,
            dz = (wall.b.z - wall.a.z) / len;
          return (
            <line
              key={t.id}
              className="plan-object"
              onClick={() => onSelect(t.id)}
              x1={wall.a.x + dx * (t.offset - t.width / 2)}
              y1={wall.a.z + dz * (t.offset - t.width / 2)}
              x2={wall.a.x + dx * (t.offset + t.width / 2)}
              y2={wall.a.z + dz * (t.offset + t.width / 2)}
              stroke="#c0f39b"
              strokeWidth=".2"
            />
          );
        })}
      {pathsVisible &&
        result.paths
          .filter(
            (p) =>
              p.order <= 1 &&
              !p.surfaces.includes("ceiling") &&
              !p.surfaces.includes("floor"),
          )
          .map((path) => (
            <polyline
              key={path.id}
              points={path.points.map((p) => `${p.x},${p.z}`).join(" ")}
              stroke={path.order === 0 ? "#d2f6ad" : "#b4cb85"}
              strokeWidth={path.order === 0 ? 0.035 : 0.02}
              strokeOpacity={path.order === 0 ? 0.85 : 0.4}
              fill="none"
              strokeDasharray={path.order ? ".07 .05" : undefined}
            />
          ))}
      {(["source", "listener"] as const).map((who) => {
        const p = room[who],
          color = who === "source" ? "#c9efaf" : "#a3d7e7";
        return (
          <g
            key={who}
            transform={`translate(${p.x} ${p.z})`}
            onPointerDown={(e) => start(e, who, p)}
            className="plan-marker"
            data-testid={`${mini ? "mini-" : ""}${who}-marker`}
            role="button"
            tabIndex={0}
            aria-label={`Move ${who} with arrow keys`}
            onKeyDown={(e) => {
              const delta = (
                {
                  ArrowLeft: [-0.15, 0],
                  ArrowRight: [0.15, 0],
                  ArrowUp: [0, -0.15],
                  ArrowDown: [0, 0.15],
                } as Record<string, number[]>
              )[e.key];
              if (delta) {
                e.preventDefault();
                e.stopPropagation();
                onMove(who, { ...p, x: p.x + delta[0], z: p.z + delta[1] });
              }
              if (e.key === "Enter") onSelect(who);
            }}
          >
            <circle
              r=".3"
              fill={color}
              fillOpacity=".06"
              stroke={color}
              strokeWidth=".012"
            />
            <circle r=".15" fill={color} />
            <circle r=".24" fill="transparent" />
            {who === "listener" && (
              <path
                d="M-.08,-.32 L0,-.47 L.08,-.32"
                transform={`rotate(${(room.yaw * 180) / Math.PI})`}
                fill={color}
              />
            )}
            <text
              textAnchor="middle"
              y=".055"
              fill="#26332b"
              fontSize=".16"
              fontWeight="700"
              pointerEvents="none"
            >
              {who === "source" ? "S" : "L"}
            </text>
            {!mini && (
              <text textAnchor="middle" y=".52" fill={color} fontSize=".15">
                {who === "source" ? "Sound source" : "Listener"}
              </text>
            )}
          </g>
        );
      })}
      {edit &&
        !mini &&
        room.walls.map((wall, i) => (
          <rect
            key={wall.id}
            x={wall.a.x - 0.075}
            y={wall.a.z - 0.075}
            width=".15"
            height=".15"
            fill="#d9e6b6"
            stroke="#25362d"
            strokeWidth=".025"
            className="vertex"
            onPointerDown={(e) => start(e, wall.id, wall.a, i)}
          />
        ))}
      <g stroke="#677b6c" strokeWidth=".013">
        <path
          d={`M${b.minX},${b.maxZ + 0.3} v.15 M${b.minX},${b.maxZ + 0.38} H${b.maxX} M${b.maxX},${b.maxZ + 0.3} v.15`}
        />
      </g>
      <text
        x={(b.minX + b.maxX) / 2}
        y={b.maxZ + (mini ? 0.32 : 0.67)}
        textAnchor="middle"
        fill="#9ba891"
        fontSize={mini ? 0.17 : 0.19}
      >
        {w.toFixed(2)} m
      </text>
    </svg>
  );
}
