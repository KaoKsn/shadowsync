/**
 * PrivSight — Liquid Metallic Iridescent Sphere (Dynamic Fluid Chrome Orb)
 * Pure Canvas2D, zero external dependencies.
 *
 * Visual Features:
 * - Spherical silhouette with subtle liquid surface-tension rippling (circular, not blobby)
 * - Dynamic swirling fluid streams inside (elongated elliptical vortex flow)
 * - Multi-chromatic iridescent palette:
 *     * Electric Cyan & Aqua
 *     * Vibrant Royal Blue & Cobalt
 *     * Vivid Violet & Purple
 *     * Coral Pink / Rose / Magenta reflection (matching reference image)
 *     * Soft Lavender / Lilac highlights
 *     * Liquid Silver & White specular caustics
 *     * Deep obsidian void hollows for dramatic depth & contrast
 * - Liquid glass / chrome reflective rim with sweeping specular glints
 * - Soft chromatic ambient glow
 */
(function () {
  'use strict';

  const canvas = document.getElementById('ps-orb-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const SIZE = 200;
  canvas.width = SIZE;
  canvas.height = SIZE;

  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const BASE_R = 58; // Base radius with safe margin for smooth ambient glow
  const N_PTS = 32;  // High resolution for silky circular boundary

  // ── Fluid stream vortex nodes (chromatic iridescent palette) ──────────────
  // Positions orbit dynamically in elliptical paths and stretch along flow tangents
  const STREAMS = [
    // [r, g, b], alpha, baseRadiusMultiplier, orbitSpeed, stretchX, stretchY, phaseOffset, radiusDist
    { c: [0, 215, 255],   a: 0.82, rm: 0.65, sp: 0.85, sx: 1.7, sy: 0.8, ph: 0.0,  dist: 0.42 }, // Electric Cyan
    { c: [37, 99, 245],   a: 0.78, rm: 0.75, sp: 0.60, sx: 1.5, sy: 0.9, ph: 1.2,  dist: 0.48 }, // Royal Blue
    { c: [147, 51, 234],  a: 0.75, rm: 0.70, sp: 0.75, sx: 1.6, sy: 0.85, ph: 2.5, dist: 0.45 }, // Vivid Purple
    { c: [244, 63, 94],   a: 0.72, rm: 0.60, sp: 0.95, sx: 1.8, sy: 0.7, ph: 3.8,  dist: 0.40 }, // Coral Pink / Rose
    { c: [56, 189, 248],  a: 0.65, rm: 0.55, sp: 1.10, sx: 1.4, sy: 0.8, ph: 4.9,  dist: 0.35 }, // Sky Aqua
    { c: [192, 132, 252], a: 0.68, rm: 0.62, sp: 0.70, sx: 1.6, sy: 0.75, ph: 5.6, dist: 0.46 }, // Lavender / Lilac
    { c: [236, 72, 153],  a: 0.58, rm: 0.50, sp: 0.90, sx: 1.5, sy: 0.75, ph: 1.9, dist: 0.38 }, // Soft Magenta
    { c: [255, 255, 255], a: 0.50, rm: 0.40, sp: 1.05, sx: 2.0, sy: 0.6, ph: 3.2,  dist: 0.30 }, // Silver Caustic
  ];

  // ── Calculate perimeter points (circular with subtle organic liquid micro-ripples) ──
  function getPerimeterPoints(t) {
    const pts = [];
    for (let i = 0; i < N_PTS; i++) {
      const angle = (i / N_PTS) * Math.PI * 2;
      // Gentle surface-tension harmonics — keeps it circular (~3-4% variance)
      const ripple =
        0.028 * Math.sin(t * 1.5 + i * 0.7) +
        0.018 * Math.cos(t * 2.1 - i * 1.3) +
        0.010 * Math.sin(t * 3.2 + i * 2.0);
      const r = BASE_R * (1.0 + ripple);
      pts.push({
        x: CX + r * Math.cos(angle),
        y: CY + r * Math.sin(angle),
      });
    }
    return pts;
  }

  // ── Construct smooth closed path using Catmull-Rom cubic beziers ──
  function constructPath(pts) {
    const n = pts.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      if (i === 0) ctx.moveTo(p1.x, p1.y);
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.closePath();
  }

  let t = 0;
  let rafId = null;
  let active = false;

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);

    const pts = getPerimeterPoints(t);

    // ── 1. Soft Multi-Hue Ambient Glow (outside the orb) ────────────────
    const outerHalo = ctx.createRadialGradient(CX, CY, BASE_R * 0.75, CX, CY, BASE_R * 1.55);
    outerHalo.addColorStop(0.0, 'rgba(56, 189, 248, 0.02)');
    outerHalo.addColorStop(0.35, 'rgba(147, 51, 234, 0.01)');
    outerHalo.addColorStop(0.65, 'rgba(244, 63, 94, 0.008)');
    outerHalo.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.beginPath();
    ctx.arc(CX, CY, BASE_R * 1.55, 0, Math.PI * 2);
    ctx.fillStyle = outerHalo;
    ctx.fill();

    // ── 2. Render Clipped Internal Fluid ──────────────────────────────
    ctx.save();
    constructPath(pts);
    ctx.clip();

    // Deep obsidian black-blue core
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Dynamic Swirling Color Streams (Elongated Vortices)
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < STREAMS.length; i++) {
      const s = STREAMS[i];
      // Orbit around the center with smooth sinusoidal motion
      const currentAngle = t * s.sp + s.ph;
      const orbitR = BASE_R * s.dist;
      const px = CX + Math.cos(currentAngle) * orbitR;
      const py = CY + Math.sin(currentAngle * 0.9 + 0.5) * orbitR;
      const rad = BASE_R * s.rm;

      // Elongate and rotate each fluid stream along its orbital tangent
      const flowTangent = currentAngle + Math.PI / 2 + Math.sin(t * 0.8 + i) * 0.35;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(flowTangent);
      ctx.scale(s.sx, s.sy);

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      grad.addColorStop(0.0, `rgba(${s.c[0]}, ${s.c[1]}, ${s.c[2]}, ${s.a})`);
      grad.addColorStop(0.45, `rgba(${s.c[0]}, ${s.c[1]}, ${s.c[2]}, ${(s.a * 0.45).toFixed(2)})`);
      grad.addColorStop(0.85, `rgba(${s.c[0]}, ${s.c[1]}, ${s.c[2]}, ${(s.a * 0.12).toFixed(2)})`);
      grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Dynamic Liquid Caustic Ribbon (Organic flowing curved light streak)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    const ribbonPhase = t * 0.7;
    const rbx1 = CX + Math.cos(ribbonPhase) * BASE_R * 0.45;
    const rby1 = CY + Math.sin(ribbonPhase * 0.9) * BASE_R * 0.55;
    const rbx2 = CX + Math.cos(ribbonPhase + 2.2) * BASE_R * 0.5;
    const rby2 = CY + Math.sin(ribbonPhase + 1.8) * BASE_R * 0.4;
    const cpX = CX + Math.sin(t * 1.2) * BASE_R * 0.3;
    const cpY = CY + Math.cos(t * 1.1) * BASE_R * 0.3;

    ctx.moveTo(rbx1, rby1);
    ctx.quadraticCurveTo(cpX, cpY, rbx2, rby2);
    ctx.lineWidth = 14;
    const ribbonGrad = ctx.createLinearGradient(rbx1, rby1, rbx2, rby2);
    ribbonGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.45)');
    ribbonGrad.addColorStop(0.4, 'rgba(56, 189, 248, 0.35)');
    ribbonGrad.addColorStop(0.7, 'rgba(244, 63, 94, 0.30)');
    ribbonGrad.addColorStop(1.0, 'rgba(147, 51, 234, 0.0)');
    ctx.strokeStyle = ribbonGrad;
    ctx.lineCap = 'round';
    ctx.filter = 'blur(4px)';
    ctx.stroke();
    ctx.filter = 'none';
    ctx.restore();

    // Central Obsidian Depth Void (creates that deep hollow seen in the reference image)
    ctx.globalCompositeOperation = 'source-over';
    const voidX = CX + Math.sin(t * 0.4) * BASE_R * 0.15;
    const voidY = CY + Math.cos(t * 0.5) * BASE_R * 0.12;
    const voidGrad = ctx.createRadialGradient(voidX, voidY, BASE_R * 0.05, voidX, voidY, BASE_R * 0.55);
    voidGrad.addColorStop(0.0, 'rgba(3, 4, 10, 0.92)');
    voidGrad.addColorStop(0.55, 'rgba(3, 4, 10, 0.45)');
    voidGrad.addColorStop(1.0, 'rgba(3, 4, 10, 0.0)');
    ctx.fillStyle = voidGrad;
    ctx.beginPath();
    ctx.arc(voidX, voidY, BASE_R * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Spherical Glass Vignette (soft 3D curvature darkening toward rim)
    const glassShade = ctx.createRadialGradient(CX, CY, BASE_R * 0.35, CX, CY, BASE_R * 1.0);
    glassShade.addColorStop(0.0, 'rgba(0, 0, 0, 0.0)');
    glassShade.addColorStop(0.70, 'rgba(2, 4, 12, 0.15)');
    glassShade.addColorStop(1.0, 'rgba(2, 4, 12, 0.35)');
    ctx.fillStyle = glassShade;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Curved Specular Liquid Reflection (Top-Left primary gloss)
    const hx = CX - BASE_R * 0.28;
    const hy = CY - BASE_R * 0.32;
    const specGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, BASE_R * 0.52);
    specGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.35)');
    specGrad.addColorStop(0.35, 'rgba(216, 240, 255, 0.15)');
    specGrad.addColorStop(0.70, 'rgba(147, 197, 253, 0.04)');
    specGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = specGrad;
    ctx.beginPath();
    ctx.arc(hx, hy, BASE_R * 0.52, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // end clip

    t += 0.016;
    rafId = requestAnimationFrame(draw);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  function start() {
    if (active) return;
    active = true;
    draw();
  }

  function stop() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  const idle = document.getElementById('ps-idle');
  if (idle && typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(
      (e) => { e[0].isIntersecting ? start() : stop(); },
      { threshold: 0.05 }
    ).observe(idle);
  } else {
    start();
  }
})();
