import { useEffect, useRef } from "react";

// Capsule-bar mic meter — grayscale pills, centered, faded at the edges.
const BAR_COUNT = 11;
const BAR_W = 4.5;
const GAP = 4;
const HEIGHT = 26;
const WIDTH = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * GAP;
const MIN_H = 5;

export default function MicWaveform({ samplesRef }) {
  const canvasRef = useRef(null);
  const smoothRef = useRef(new Float32Array(BAR_COUNT).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const samples = samplesRef?.current;
    if (!samples?.length) return;

    let raf = 0;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || WIDTH;
      const h = canvas.clientHeight || HEIGHT;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const ink = getComputedStyle(canvas).getPropertyValue("--text-1").trim() || "25 25 25";
      const smooth = smoothRef.current;
      const n = BAR_COUNT;
      const srcN = samples.length;

      for (let i = 0; i < n; i++) {
        const src = srcN === 1 ? samples[0] : samples[Math.round((i / (n - 1)) * (srcN - 1))];
        const next = Number.isFinite(src) ? Math.min(1, Math.max(0, src)) : 0;
        smooth[i] = smooth[i] * 0.62 + next * 0.38;

        const t = n === 1 ? 0.5 : i / (n - 1);
        const envelope = Math.pow(Math.sin(Math.PI * t), 1.05);
        const amp = Math.min(1, envelope * 0.28 + smooth[i] * 0.85);
        const barH = MIN_H + amp * (h - MIN_H - 2);
        const x = i * (BAR_W + GAP);
        const y = (h - barH) / 2;
        const r = BAR_W / 2;

        ctx.globalAlpha = 0.16 + 0.84 * envelope;
        ctx.fillStyle = `rgb(${ink})`;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x, y, BAR_W, barH, r);
        } else {
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + BAR_W, y, x + BAR_W, y + barH, r);
          ctx.arcTo(x + BAR_W, y + barH, x, y + barH, r);
          ctx.arcTo(x, y + barH, x, y, r);
          ctx.arcTo(x, y, x + BAR_W, y, r);
        }
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [samplesRef]);

  return (
    <canvas
      ref={canvasRef}
      className="mx-auto block"
      style={{ width: WIDTH, height: HEIGHT }}
      width={WIDTH}
      height={HEIGHT}
      aria-label="Microphone input"
    />
  );
}
