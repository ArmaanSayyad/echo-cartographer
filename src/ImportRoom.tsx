import { useRef, useState } from "react";
import {
  Upload,
  ArrowRight,
  Undo2,
  ScanLine,
  ImagePlus,
  Check,
  Ruler,
  MousePointer2,
} from "lucide-react";
import Modal from "./Modal";
import { imageData } from "./storage";
import { demoRoom, inside, validPolygon, validateRoom } from "./model";
import type { Room, Vec2 } from "./model";
type ImageInfo = { image: string; width: number; height: number };
export default function ImportRoom({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (room: Room) => void;
}) {
  const [image, setImage] = useState<ImageInfo>(),
    [photos, setPhotos] = useState<string[]>([]),
    [step, setStep] = useState(0),
    [dimension, setDimension] = useState(5),
    [ceiling, setCeiling] = useState(2.8),
    [name, setName] = useState("My listening space"),
    [scalePoints, setScalePoints] = useState<Vec2[]>([]),
    [points, setPoints] = useState<Vec2[]>([]),
    [error, setError] = useState(""),
    [inferred, setInferred] = useState(false),
    [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null),
    file = useRef<HTMLInputElement>(null),
    photoInput = useRef<HTMLInputElement>(null);
  const mpp =
    scalePoints.length === 2
      ? dimension /
        Math.hypot(
          scalePoints[1].x - scalePoints[0].x,
          scalePoints[1].z - scalePoints[0].z,
        )
      : 0;
  const addImage = async (f?: File) => {
    if (!f) return;
    try {
      setBusy(true);
      setImage(await imageData(f));
      setScalePoints([]);
      setPoints([]);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const suggest = async () => {
    if (!image) return;
    const img = new Image();
    img.src = image.image;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = image.width,
      y0 = image.height,
      x1 = 0,
      y1 = 0;
    for (
      let y = Math.ceil(image.height * 0.04);
      y < image.height * 0.96;
      y += 2
    )
      for (
        let x = Math.ceil(image.width * 0.04);
        x < image.width * 0.96;
        x += 2
      ) {
        const i = (y * image.width + x) * 4;
        if (
          (data[i] + data[i + 1] + data[i + 2]) / 3 < 90 &&
          data[i + 3] > 150
        ) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    if (x1 - x0 < 20 || y1 - y0 < 20) {
      setError(
        "No clear dark outline found. Click the interior wall corners to trace the room.",
      );
      return;
    }
    setPoints([
      { x: x0, z: y0 },
      { x: x1, z: y0 },
      { x: x1, z: y1 },
      { x: x0, z: y1 },
    ]);
    setInferred(true);
    setError(
      "Suggested bounding rectangle only. Labels and furniture can affect this guess. Review all four corners in the plan editor.",
    );
  };
  const create = () => {
    if (!image || !mpp) return;
    try {
      const ox = Math.min(...points.map((p) => p.x)),
        oy = Math.min(...points.map((p) => p.z));
      const vertices = points.map((p) => ({
        x: (p.x - ox) * mpp,
        z: (p.z - oy) * mpp,
      }));
      if (!validPolygon(vertices))
        throw new Error(
          "Trace one simple, closed room with at least three corners and an area above 2 m². Corners must not cross.",
        );
      const room: Room = {
        ...demoRoom("shoebox"),
        name: name.trim() || "My listening space",
        ceiling,
        walls: vertices.map((a, i) => ({
          id: `wall-${i}`,
          a,
          b: vertices[(i + 1) % vertices.length],
          material: "plaster",
          confidence: "inferred",
        })),
        photos,
        provenance: "inferred",
        treatments: [],
        plan: { ...image, metersPerPixel: mpp, originX: ox, originY: oy },
      };
      const maxX = Math.max(...vertices.map((p) => p.x)),
        maxZ = Math.max(...vertices.map((p) => p.z));
      const candidates = [];
      for (let x = 0.15; x < maxX; x += Math.max(0.1, maxX / 20))
        for (let z = 0.15; z < maxZ; z += Math.max(0.1, maxZ / 20))
          if (inside({ x, z }, room))
            candidates.push({ x, z, y: Math.min(1.2, ceiling / 2) });
      candidates.sort(
        (a, b) =>
          Math.hypot(a.x - maxX / 2, a.z - maxZ / 2) -
          Math.hypot(b.x - maxX / 2, b.z - maxZ / 2),
      );
      if (candidates.length < 2)
        throw new Error(
          "The room is too narrow to place a source and listener. Check the scale.",
        );
      room.listener = candidates[0];
      room.source =
        candidates[
          Math.min(candidates.length - 1, Math.floor(candidates.length * 0.4))
        ];
      onImport(validateRoom(room));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="Bring your room into focus."
      eyebrow="NEW ROOM · EVERYTHING STAYS ON THIS DEVICE"
      wide
      onClose={onClose}
    >
      <div className="import-steps">
        {["Reference", "Set the scale", "Trace the room"].map((s, i) => (
          <button
            key={s}
            disabled={i > step}
            className={step === i ? "active" : ""}
            onClick={() => setStep(i)}
          >
            <span>{i < step ? <Check size={13} /> : `0${i + 1}`}</span>
            {s}
          </button>
        ))}
      </div>
      <div className="import-body">
        <div
          className="import-canvas"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (step === 0) void addImage(e.dataTransfer.files[0]);
          }}
        >
          {!image ? (
            <button
              className="upload-zone"
              onClick={() => file.current?.click()}
            >
              <div className="upload-graphic">
                <ScanLine size={60} strokeWidth={0.7} />
              </div>
              <h3>A floor plan is all you need.</h3>
              <p>Drop an image here or browse your files</p>
              <span>PNG, JPEG, WebP · up to 20 MB</span>
            </button>
          ) : (
            <svg
              ref={svg}
              viewBox={`0 0 ${image.width} ${image.height}`}
              aria-label="Floor plan tracing canvas"
              data-testid="trace-canvas"
              onClick={(e) => {
                const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
                  svg.current!.getScreenCTM()!.inverse(),
                );
                if (
                  p.x < 0 ||
                  p.y < 0 ||
                  p.x > image.width ||
                  p.y > image.height
                )
                  return;
                if (step === 1)
                  setScalePoints((prev) =>
                    prev.length >= 2
                      ? [{ x: p.x, z: p.y }]
                      : [...prev, { x: p.x, z: p.y }],
                  );
                if (step === 2) {
                  setPoints((prev) => [
                    ...prev.slice(0, 31),
                    { x: p.x, z: p.y },
                  ]);
                  setInferred(false);
                  setError("");
                }
              }}
            >
              <image
                href={image.image}
                width={image.width}
                height={image.height}
              />
              {scalePoints.length === 2 && (
                <line
                  x1={scalePoints[0].x}
                  y1={scalePoints[0].z}
                  x2={scalePoints[1].x}
                  y2={scalePoints[1].z}
                  stroke="#367777"
                  strokeWidth={image.width / 200}
                />
              )}
              {scalePoints.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.z}
                  r={image.width / 80}
                  fill="#8cdae5"
                  stroke="#194d4d"
                  strokeWidth={image.width / 350}
                />
              ))}
              {points.length > 1 && (
                <polygon
                  points={points.map((p) => `${p.x},${p.z}`).join(" ")}
                  fill="#669c63"
                  fillOpacity=".25"
                  stroke="#315e36"
                  strokeWidth={image.width / 220}
                  strokeDasharray={inferred ? "10 6" : undefined}
                />
              )}
              {points.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p.x}
                    cy={p.z}
                    r={image.width / 90}
                    fill="#b4dd93"
                    stroke="#284629"
                    strokeWidth={image.width / 400}
                  />
                  <text
                    x={p.x}
                    y={p.z + image.width / 250}
                    fill="#16321b"
                    fontSize={image.width / 70}
                    textAnchor="middle"
                  >
                    {i + 1}
                  </text>
                </g>
              ))}
            </svg>
          )}
          {image && step === 0 && (
            <button
              className="canvas-replace small-button"
              onClick={() => file.current?.click()}
            >
              <Upload size={14} /> Replace image
            </button>
          )}
        </div>
        <div className="import-instructions">
          {step === 0 ? (
            <>
              <span className="step-symbol">
                <ImagePlus size={24} />
              </span>
              <h3>Start with the space.</h3>
              <p>
                Use a top-down plan of one room. A scan, drawing, or a clear
                photograph of a plan works well.
              </p>
              <label>
                Room name
                <input
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                className="outline-button"
                onClick={() => photoInput.current?.click()}
              >
                <ImagePlus size={16} /> Add reference photographs
              </button>
              <span className="hint">
                Optional · {photos.length}/6 added. Used as visual references;
                surfaces need your review.
              </span>
              <div className="photo-strip">
                {photos.map((p, i) => (
                  <img src={p} key={i} alt={`Room reference ${i + 1}`} />
                ))}
              </div>
            </>
          ) : step === 1 ? (
            <>
              <span className="step-symbol">
                <Ruler size={24} />
              </span>
              <h3>One known dimension.</h3>
              <p>
                Click the two ends of a known distance on the image. Enter that
                distance below.
              </p>
              <label>
                Known distance <span>meters</span>
                <input
                  data-testid="known-dimension"
                  type="number"
                  min=".25"
                  max="50"
                  step=".1"
                  value={dimension}
                  onChange={(e) => setDimension(e.target.valueAsNumber)}
                />
              </label>
              <label>
                Ceiling height <span>meters</span>
                <input
                  type="number"
                  min="1.8"
                  max="12"
                  step=".1"
                  value={ceiling}
                  onChange={(e) => setCeiling(e.target.valueAsNumber)}
                />
              </label>
              <div className="confidence-note">
                <span className="status-dot" />
                {scalePoints.length}/2 scale points placed
              </div>
              <p className="hint">
                Perspective-distorted photographs cannot give a reliable scale.
                Use a flat, top-down plan.
              </p>
            </>
          ) : (
            <>
              <span className="step-symbol">
                <MousePointer2 size={24} />
              </span>
              <h3>Follow the inner walls.</h3>
              <p>
                Click every interior corner in order. The last corner connects
                to the first. Model one room per workspace.
              </p>
              <div className="trace-actions">
                <button
                  className="outline-button"
                  onClick={() => {
                    setPoints((p) => p.slice(0, -1));
                    setInferred(false);
                  }}
                >
                  <Undo2 size={15} /> Undo corner
                </button>
                <button
                  className="outline-button"
                  onClick={() => {
                    setPoints([]);
                    setInferred(false);
                  }}
                >
                  Clear
                </button>
              </div>
              <button className="outline-button" onClick={() => void suggest()}>
                <ScanLine size={16} /> Suggest rectangle
              </button>
              <div className="confidence-note amber">
                {points.length} corners ·{" "}
                {inferred
                  ? "Low-confidence suggestion"
                  : "Your traced geometry"}
              </div>
              <p className="hint">
                Walls begin as inferred plaster. Add doors, windows, furniture,
                and materials in the editor. No unseen details are filled in.
              </p>
            </>
          )}
        </div>
      </div>
      {error && (
        <div role="status" className="form-error">
          {error}
        </div>
      )}
      <footer className="modal-footer">
        <span>
          <span className="status-dot" />{" "}
          {busy
            ? "Preparing local image…"
            : "Private by design. No image uploads."}
        </span>
        <button
          className="primary-button"
          disabled={
            busy ||
            (step === 0
              ? !image
              : step === 1
                ? scalePoints.length !== 2 ||
                  !Number.isFinite(mpp) ||
                  mpp <= 0 ||
                  dimension < 0.25 ||
                  dimension > 50 ||
                  ceiling < 1.8 ||
                  ceiling > 12
                : points.length < 3)
          }
          onClick={() => (step < 2 ? setStep(step + 1) : create())}
        >
          {step === 2 ? "Create room" : "Continue"}
          <ArrowRight size={16} />
        </button>
      </footer>
      <input
        ref={file}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => void addImage(e.target.files?.[0])}
      />
      <input
        ref={photoInput}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          try {
            const images = await Promise.all(
              Array.from(e.target.files ?? [])
                .slice(0, 6 - photos.length)
                .map(imageData),
            );
            setPhotos((p) => [...p, ...images.map((i) => i.image)]);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
    </Modal>
  );
}
