import { BANDS } from "./model";
import type { AcousticResult } from "./acoustics";
export function DecayChart({
  result,
  treated,
  band,
  onBand,
}: {
  result: AcousticResult;
  treated: boolean;
  band: number;
  onBand: (b: number) => void;
}) {
  const top = Math.ceil(Math.max(...result.baselineRT, ...result.rt60) * 2) / 2;
  const xs = BANDS.map((_, i) => 36 + i * 38),
    y = (v: number) => 112 - (v / top) * 86;
  const line = (values: number[]) =>
    values.map((v, i) => `${xs[i]},${y(v)}`).join(" ");
  return (
    <svg
      className="decay-chart"
      viewBox="0 0 260 146"
      aria-label="Predicted decay time by octave band"
    >
      {[0, 0.5, 1].map((n) => (
        <g key={n}>
          <line
            x1="29"
            x2="238"
            y1={y(n * top)}
            y2={y(n * top)}
            stroke="#a4bba0"
            strokeOpacity=".12"
            strokeDasharray="2 4"
          />
          <text x="0" y={y(n * top) + 3} fill="#829081" fontSize="9">
            {(n * top).toFixed(1)}
          </text>
        </g>
      ))}
      <polygon
        points={`36,112 ${line(result.rt60)} 226,112`}
        fill="#b7dc9d"
        opacity=".055"
      />
      <polyline
        points={line(result.baselineRT)}
        fill="none"
        stroke="#82917b"
        strokeWidth="1.3"
        strokeDasharray="4 4"
      />
      <polyline
        points={line(result.rt60)}
        fill="none"
        stroke={treated ? "#c5eca1" : "#c5cdae"}
        strokeWidth="1.8"
      />
      {BANDS.map((freq, i) => (
        <g
          key={freq}
          role="button"
          tabIndex={0}
          aria-label={`Select ${freq} Hz band`}
          onClick={() => onBand(i)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onBand(i);
          }}
          className="chart-point"
        >
          <circle
            cx={xs[i]}
            cy={y(result.rt60[i])}
            r={i === band ? 4 : 2.5}
            fill="#cee7ac"
          />
          <circle cx={xs[i]} cy={y(result.rt60[i])} r="12" fill="transparent" />
          <text
            x={xs[i]}
            y="133"
            textAnchor="middle"
            fill={i === band ? "#d7eac4" : "#879683"}
            fontSize="9"
          >
            {freq < 1000 ? freq : `${freq / 1000}k`}
          </text>
        </g>
      ))}
      <text x="243" y="133" fill="#879683" fontSize="8">
        Hz
      </text>
    </svg>
  );
}
export function ImpulseChart({
  result,
  band,
}: {
  result: AcousticResult;
  band: number;
}) {
  const max = Math.max(...result.paths.map((p) => p.gains[band]), 0.001),
    limit = Math.max(0.06, result.directDelay * 2.5);
  return (
    <svg
      className="impulse-chart"
      viewBox="0 0 650 96"
      preserveAspectRatio="none"
      aria-label="Simulated early impulse arrivals"
    >
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <g key={i}>
          <line
            x1={24 + i * 100}
            x2={24 + i * 100}
            y1="8"
            y2="70"
            stroke="#a4bba0"
            strokeOpacity=".1"
            strokeDasharray="2 5"
          />
          <text
            x={24 + i * 100}
            y="90"
            textAnchor="middle"
            fill="#7d8a7a"
            fontSize="9"
          >
            {((limit * 1000 * i) / 6).toFixed(0)}
            {i === 6 ? " ms" : ""}
          </text>
        </g>
      ))}
      <line
        x1="24"
        x2="624"
        y1="70"
        y2="70"
        stroke="#a4bba0"
        strokeOpacity=".18"
      />
      {result.paths
        .filter((p) => p.delay <= limit)
        .map((path) => {
          const x = 24 + (path.delay / limit) * 600,
            height = (path.gains[band] / max) * 56,
            color =
              path.order === 0
                ? "#d1ebae"
                : path.order === 1
                  ? "#a6c399"
                  : "#a78f68";
          return (
            <g key={path.id}>
              <line
                x1={x}
                x2={x}
                y1={70 - height}
                y2="70"
                stroke={color}
                strokeWidth={path.order === 0 ? 2.5 : 1.5}
              />
              <circle
                cx={x}
                cy={70 - height}
                r={path.order === 0 ? 3 : 1.5}
                fill={color}
              />
            </g>
          );
        })}
    </svg>
  );
}
export function MeasuredChart({
  decay,
  impulse,
}: {
  decay: number[];
  impulse: number[];
}) {
  return (
    <svg
      className="measured-chart"
      viewBox="0 0 600 160"
      aria-label="Measured impulse envelope and noise-corrected Schroeder decay"
    >
      {[0, -20, -40, -60].map((db) => (
        <g key={db}>
          <line
            x1="32"
            x2="590"
            y1={20 - db * 1.8}
            y2={20 - db * 1.8}
            stroke="#728974"
            strokeOpacity=".2"
          />
          <text x="0" y={24 - db * 1.8} fontSize="10" fill="#8b9f8b">
            {db}
          </text>
        </g>
      ))}
      {impulse.map((v, i) => (
        <line
          key={i}
          x1={32 + (i / impulse.length) * 550}
          x2={32 + (i / impulse.length) * 550}
          y1="135"
          y2={135 - Math.abs(v) * 90}
          stroke="#84b4ba"
          strokeOpacity=".4"
        />
      ))}
      <polyline
        points={decay
          .map(
            (v, i) =>
              `${32 + (i / decay.length) * 550},${20 - Math.max(-65, v) * 1.8}`,
          )
          .join(" ")}
        fill="none"
        stroke="#c0e6a0"
        strokeWidth="1.5"
      />
      <text x="32" y="156" fill="#8b9f8b" fontSize="10">
        0 s
      </text>
      <text x="540" y="156" fill="#8b9f8b" fontSize="10">
        1.8 s
      </text>
    </svg>
  );
}
