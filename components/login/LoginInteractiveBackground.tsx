"use client";

import { useEffect, useRef } from "react";

type AuroraBlob = {
  baseX: number;
  baseY: number;
  radius: number;
  inner: string;
  mid: string;
  outer: string;
  phaseX: number;
  phaseY: number;
  phaseR: number;
  speed: number;
  parallax: number;
};

type PointerState = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  active: boolean;
};

const AURORA_BLOBS: AuroraBlob[] = [
  {
    baseX: 0.22,
    baseY: 0.28,
    radius: 0.62,
    inner: "rgba(56, 189, 248, 0.34)",
    mid: "rgba(37, 99, 235, 0.14)",
    outer: "rgba(2, 6, 23, 0)",
    phaseX: 0.2,
    phaseY: 1.4,
    phaseR: 0.6,
    speed: 0.22,
    parallax: 1.15,
  },
  {
    baseX: 0.52,
    baseY: 0.42,
    radius: 0.58,
    inner: "rgba(129, 140, 248, 0.22)",
    mid: "rgba(79, 70, 229, 0.1)",
    outer: "rgba(2, 6, 23, 0)",
    phaseX: 2.1,
    phaseY: 0.5,
    phaseR: 1.8,
    speed: 0.16,
    parallax: 0.75,
  },
  {
    baseX: 0.78,
    baseY: 0.62,
    radius: 0.55,
    inner: "rgba(251, 113, 133, 0.2)",
    mid: "rgba(249, 115, 22, 0.09)",
    outer: "rgba(2, 6, 23, 0)",
    phaseX: 3.4,
    phaseY: 2.6,
    phaseR: 2.4,
    speed: 0.19,
    parallax: 0.95,
  },
  {
    baseX: 0.38,
    baseY: 0.72,
    radius: 0.48,
    inner: "rgba(14, 165, 233, 0.14)",
    mid: "rgba(59, 130, 246, 0.06)",
    outer: "rgba(2, 6, 23, 0)",
    phaseX: 4.2,
    phaseY: 1.1,
    phaseR: 0.9,
    speed: 0.14,
    parallax: 0.55,
  },
];

function drawStaticFallback(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (const blob of AURORA_BLOBS) {
    const cx = blob.baseX * width;
    const cy = blob.baseY * height;
    const r = blob.radius * Math.max(width, height);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, blob.inner);
    gradient.addColorStop(0.42, blob.mid);
    gradient.addColorStop(1, blob.outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();
  drawVignette(ctx, width, height);
}

function drawVignette(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.46,
    Math.min(width, height) * 0.18,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72,
  );
  vignette.addColorStop(0, "rgba(2, 6, 23, 0)");
  vignette.addColorStop(0.68, "rgba(2, 6, 23, 0.38)");
  vignette.addColorStop(1, "rgba(2, 6, 23, 0.94)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function createGrainPattern(size: number): HTMLCanvasElement {
  const grainCanvas = document.createElement("canvas");
  grainCanvas.width = size;
  grainCanvas.height = size;
  const grainCtx = grainCanvas.getContext("2d");
  if (!grainCtx) return grainCanvas;

  const imageData = grainCtx.createImageData(size, size);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const value = Math.random() * 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 18;
  }

  grainCtx.putImageData(imageData, 0, 0);
  return grainCanvas;
}

export default function LoginInteractiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer: PointerState = {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.5,
      targetX: window.innerWidth * 0.5,
      targetY: window.innerHeight * 0.5,
      active: false,
    };
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let grainPattern = createGrainPattern(256);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      grainPattern = createGrainPattern(256);

      if (reducedMotion.matches) {
        drawStaticFallback(ctx, width, height);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointer.targetX = event.clientX;
      pointer.targetY = event.clientY;
      pointer.active = true;
    };

    const handlePointerLeave = () => {
      pointer.active = false;
      pointer.targetX = width * 0.5;
      pointer.targetY = height * 0.5;
    };

    const drawAuroraBlob = (
      blob: AuroraBlob,
      time: number,
      parallaxX: number,
      parallaxY: number,
    ) => {
      const driftX =
        Math.sin(time * blob.speed + blob.phaseX) * width * 0.07 +
        Math.cos(time * blob.speed * 0.6 + blob.phaseY) * width * 0.03;
      const driftY =
        Math.cos(time * blob.speed * 0.85 + blob.phaseY) * height * 0.06 +
        Math.sin(time * blob.speed * 0.45 + blob.phaseX) * height * 0.025;
      const cursorPullX = parallaxX * width * 0.11 * blob.parallax;
      const cursorPullY = parallaxY * height * 0.11 * blob.parallax;

      const cx = blob.baseX * width + driftX - cursorPullX;
      const cy = blob.baseY * height + driftY - cursorPullY;
      const pulse = 1 + Math.sin(time * 0.55 + blob.phaseR) * 0.1;
      const radius = blob.radius * Math.max(width, height) * pulse;

      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, blob.inner);
      gradient.addColorStop(0.38, blob.mid);
      gradient.addColorStop(1, blob.outer);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    };

    const animate = () => {
      if (reducedMotion.matches) {
        drawStaticFallback(ctx, width, height);
        return;
      }

      pointer.x += (pointer.targetX - pointer.x) * 0.06;
      pointer.y += (pointer.targetY - pointer.y) * 0.06;

      const time = performance.now() * 0.001;
      const parallaxX = pointer.x / width - 0.5;
      const parallaxY = pointer.y / height - 0.5;

      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, width, height);

      const baseWash = ctx.createLinearGradient(0, 0, width, height);
      baseWash.addColorStop(0, "rgba(15, 23, 42, 0.9)");
      baseWash.addColorStop(0.5, "rgba(2, 6, 23, 0.95)");
      baseWash.addColorStop(1, "rgba(15, 23, 42, 0.88)");
      ctx.fillStyle = baseWash;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const blob of AURORA_BLOBS) {
        drawAuroraBlob(blob, time, parallaxX, parallaxY);
      }

      const wakeX =
        pointer.x -
        parallaxX * width * 0.04 +
        Math.sin(time * 0.9) * width * 0.012;
      const wakeY =
        pointer.y -
        parallaxY * height * 0.04 +
        Math.cos(time * 0.75) * height * 0.01;
      const wakeStrength = pointer.active ? 1 : 0.35;
      const wake = ctx.createRadialGradient(wakeX, wakeY, 0, wakeX, wakeY, 320);
      wake.addColorStop(0, `rgba(191, 219, 254, ${0.14 * wakeStrength})`);
      wake.addColorStop(0.35, `rgba(129, 140, 248, ${0.08 * wakeStrength})`);
      wake.addColorStop(0.7, `rgba(251, 113, 133, ${0.04 * wakeStrength})`);
      wake.addColorStop(1, "rgba(2, 6, 23, 0)");
      ctx.fillStyle = wake;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.055;
      const grainOffsetX = (time * 18) % grainPattern.width;
      const grainOffsetY = (time * 12) % grainPattern.height;
      for (let x = -grainPattern.width; x < width + grainPattern.width; x += grainPattern.width) {
        for (let y = -grainPattern.height; y < height + grainPattern.height; y += grainPattern.height) {
          ctx.drawImage(
            grainPattern,
            x + grainOffsetX,
            y + grainOffsetY,
            grainPattern.width,
            grainPattern.height,
          );
        }
      }
      ctx.restore();

      drawVignette(ctx, width, height);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const handleMotionChange = () => {
      window.cancelAnimationFrame(animationFrame);
      resize();
      if (!reducedMotion.matches) {
        animationFrame = window.requestAnimationFrame(animate);
      }
    };

    const resizeObserver = new ResizeObserver(resize);

    resize();
    resizeObserver.observe(document.documentElement);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerleave", handlePointerLeave);
    reducedMotion.addEventListener("change", handleMotionChange);

    if (!reducedMotion.matches) {
      animationFrame = window.requestAnimationFrame(animate);
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      reducedMotion.removeEventListener("change", handleMotionChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
