import { useEffect, useRef } from 'react';

const TAU = Math.PI * 2;
// 原站全局角公式：O += dt·0.5；θ = ((O mod 32) / 32)·2π —— 64 秒转一整圈。
// 不要简化成 0.5 rad/s 直接乘（那样 12.6s 一圈，快 5 倍）。
const ORBIT_ACCUM_SPEED = 0.5;
const ORBIT_WRAP = 32;
const MAX_DT = 0.1;
const MAX_DPR = 2;
const MAX_GL_PIXELS = 6_000_000; // goo 层 backing store 像素上限（原站 4e6 且不乘 DPR，浅底下锯齿明显，故提高并乘 DPR）
const MAX_GL_DPR = 2; // goo 层 DPR 上限
const STATIC_THETA = 0.9; // reduced-motion 静态帧的角度

// 场景 1600×900，contain fit + alignX max / alignY mid（原站桌面值）。
const SCENE_W = 1600;
const SCENE_H = 900;

// 浅色主题：细描边明显可见但不喧宾夺主（深 slate / 青 / 深 slate / 橙）。
const STROKE_COLORS = [
  'rgba(23, 32, 51, 0.24)',
  'rgba(8, 145, 178, 0.26)',
  'rgba(23, 32, 51, 0.2)',
  'rgba(255, 122, 0, 0.24)',
];

// 原站桌面常量。
const LINE_WIDTH = 1.05;
const GOO_BLUR = 4.1;
const GOO_WIDTH = 3.1;
const GOO_GAIN = 80;
const ACCENT_BLUR = 8;
const GOO_REACH = 4 * GOO_BLUR; // 16.4
const GOO_HYSTERESIS = Math.max(24, 0.5 * GOO_REACH); // 24

// Abramowitz–Stegun 7.1.26 近似的 erf，用于求 goo 高斯峰值的离线积分。
function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

const GOO_PEAK = erfApprox(GOO_WIDTH / (2 * Math.SQRT2 * GOO_BLUR)); // ≈0.294
const GOO_SIGMA = Math.sqrt(GOO_BLUR * GOO_BLUR + (GOO_WIDTH * GOO_WIDTH) / 12); // ≈4.197

// 原站 4 圆配置（orbitCX/CY 缺省 1000/450）。
const GOLDEN_ANGLE = 2.39996323;
const CIRCLE_DEFS = [
  { baseR: 101, scaleFactor: 4.2, idx: 0, orbitCX: 1200, orbitCY: 300 },
  { baseR: 102, scaleFactor: 3, idx: 7, orbitCX: 900, orbitCY: 800 },
  { baseR: 101, scaleFactor: 2.2, idx: 13, orbitCX: 1000, orbitCY: 450 }, // 卫星圆，钉到圆 0
  { baseR: 30, scaleFactor: 5, idx: 8, orbitCX: 1000, orbitCY: 500 },
];
const CIRCLES = CIRCLE_DEFS.map((def) => {
  const radius = def.baseR * def.scaleFactor;
  const scatter = 300 * Math.sqrt((def.idx + 0.55) / 15);
  const angle = GOLDEN_ANGLE * def.idx;
  return {
    radius,
    orbitCX: def.orbitCX,
    orbitCY: def.orbitCY,
    cloudX: def.orbitCX + Math.cos(angle) * scatter,
    cloudY: def.orbitCY + Math.sin(angle) * scatter * 0.82,
    driftPhase: (1.7 * def.idx) % TAU,
    driftAmp: 46 + (def.idx % 5) * 10,
    driftFreq: 1 + (def.idx % 2),
    driftDir: def.idx % 2 === 0 ? 1 : -1,
  };
});
const CIRCLE_COUNT = CIRCLES.length;

const PAIR_I = [0, 0, 0, 1, 1, 2];
const PAIR_J = [1, 2, 3, 2, 3, 3];
const PAIR_COUNT = PAIR_I.length;

const SLOT_COUNT = 3;
// 光点颜色绑在「圆对」（即交点身份）上而不是槽位上：同一个交点永远是同一种颜色，
// 槽位重选不会导致颜色跳变。三个彩色 + 三个深 slate（浅底加深版：青/金/橙/slate）。
const SLATE_RGB = [23 / 255, 32 / 255, 51 / 255] as const;
const PAIR_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [8 / 255, 145 / 255, 178 / 255], // (0,1) 青
  [230 / 255, 168 / 255, 0], // (0,2) 金
  SLATE_RGB, // (0,3)
  SLATE_RGB, // (1,2)
  [255 / 255, 122 / 255, 0], // (1,3) 橙
  SLATE_RGB, // (2,3)
];
// 槽位不透明度的指数趋近速度（/s）：约 0.5s 淡入淡出，避免突变。
const ACCENT_FADE_SPEED = 5;

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

// 逐字移植原站 goo fragment shader；唯一改动是 outputColor 从白改为深 slate
// （白色 goo 在浅底上不可见），uAccentColors 由 JS 传入加深色。
const FRAGMENT_SHADER_SOURCE = `
precision highp float;

uniform vec2 uResolution;
uniform vec2 uSceneOffset;
uniform float uSceneScale;
uniform float uLineWidth;
uniform float uGooGain;
uniform float uGooPeak;
uniform float uGooSigma;
uniform float uAccentBlur;
uniform vec3 uCircles[4];
uniform float uCircleGoo[4];
uniform vec4 uAccents[3];
uniform vec3 uAccentColors[3];

float ringDistance(vec2 point, vec3 circle) {
  return abs(length(point - circle.xy) - circle.z);
}

float strokeCoverage(float distanceToEdge, float halfWidth, float aa) {
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, distanceToEdge);
}

float blurredStrokeField(float distanceToEdge) {
  float sigma = max(0.001, uGooSigma);
  return uGooPeak * exp(
    -0.5 * distanceToEdge * distanceToEdge / (sigma * sigma)
  );
}

float unionField(float field, float contribution) {
  // Approximate the source-over union that SVG builds before blurring.
  // Adding fields directly makes shallow intersections turn into fat bars.
  return field + contribution - field * contribution;
}

float thresholdField(float field) {
  return clamp(
    (field - 0.3) * max(1.0, uGooGain),
    0.0,
    1.0
  );
}

void main() {
  vec2 fragment = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 point = (fragment - uSceneOffset) / max(0.001, uSceneScale);
  float aa = max(0.45 / max(0.001, uSceneScale), 0.18);
  float lineAlpha = 0.0;
  float sceneField = 0.0;

  for (int index = 0; index < 4; index++) {
    vec3 circle = uCircles[index];
    float distanceToRing = ringDistance(point, circle);
    lineAlpha = max(
      lineAlpha,
      strokeCoverage(distanceToRing, uLineWidth * 0.5, aa)
    );

    float ringField = blurredStrokeField(distanceToRing);
    sceneField = unionField(
      sceneField,
      ringField * uCircleGoo[index]
    );
  }

  // 浅底适配：不做任何指针交互（原站的指针 uiField 层不移植）——试过后结论是
  // 指针 goo 会形成难看肿块，形变方案又会与 goo 场错位，保持纯粹的圆与圆关系。
  float sceneGooAlpha = thresholdField(sceneField);
  float gooAlpha = sceneGooAlpha;

  float shapeAlpha = max(lineAlpha, sceneGooAlpha);
  float outputAlpha = gooAlpha;
  vec3 outputColor = vec3(0.09, 0.125, 0.20);  // 浅底适配：深色 goo（原为 vec3(1.0) 白）

  for (int index = 0; index < 3; index++) {
    vec4 accent = uAccents[index];
    float radius = max(0.001, accent.z);
    float distanceToAccent = length(point - accent.xy);
    float accentFeather = max(0.001, uAccentBlur * 1.5);
    float radial = 1.0 - smoothstep(
      radius - accentFeather,
      radius + accentFeather,
      distanceToAccent
    );
    float tint = radial * accent.w * shapeAlpha;
    outputColor = mix(outputColor, uAccentColors[index], tint);
    outputAlpha = max(outputAlpha, tint);
  }

  // 浅底适配：goo 饱和时保持半透明，避免死黑带子喧宾夺主（原站白色饱和无此问题）。
  outputAlpha *= 0.55;
  if (outputAlpha <= 0.001) discard;
  gl_FragColor = vec4(outputColor * outputAlpha, outputAlpha);
}
`;

const FULLSCREEN_TRIANGLES = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function PaperCirclesCanvas() {
  const lineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const lineCanvas = lineCanvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (!lineCanvas || !glCanvas) {
      return;
    }
    const lineCtx = lineCanvas.getContext('2d');
    if (!lineCtx) {
      return;
    }
    const host = lineCanvas.parentElement ?? lineCanvas;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- WebGL goo 层（不可用时静默降级为只有细线层）----
    let gl: WebGLRenderingContext | null = null;
    let glProgram: WebGLProgram | null = null;
    let glBuffer: WebGLBuffer | null = null;
    let glVertexShader: WebGLShader | null = null;
    let glFragmentShader: WebGLShader | null = null;
    let glLost = false;
    const loc: Record<string, WebGLUniformLocation | null> = {};
    let aPositionLocation = -1;

    const initGL = (): boolean => {
      if (!gl) {
        gl = glCanvas.getContext('webgl', {
          alpha: true,
          antialias: false,
          depth: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: false,
          stencil: false,
        });
        if (!gl) {
          return false;
        }
      }
      glVertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
      glFragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
      if (!glVertexShader || !glFragmentShader) {
        return false;
      }
      glProgram = gl.createProgram();
      if (!glProgram) {
        return false;
      }
      gl.attachShader(glProgram, glVertexShader);
      gl.attachShader(glProgram, glFragmentShader);
      gl.linkProgram(glProgram);
      if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
        return false;
      }
      gl.useProgram(glProgram);
      glBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLES, gl.STATIC_DRAW);
      aPositionLocation = gl.getAttribLocation(glProgram, 'aPosition');
      gl.enableVertexAttribArray(aPositionLocation);
      gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);
      const uniformNames = [
        'uResolution',
        'uSceneOffset',
        'uSceneScale',
        'uLineWidth',
        'uGooGain',
        'uGooPeak',
        'uGooSigma',
        'uAccentBlur',
        'uCircles[0]',
        'uCircleGoo[0]',
        'uAccents[0]',
        'uAccentColors[0]',
      ];
      for (const name of uniformNames) {
        loc[name] = gl.getUniformLocation(glProgram, name);
      }
      // 静态 uniform。
      gl.uniform1f(loc.uLineWidth, LINE_WIDTH);
      gl.uniform1f(loc.uGooGain, GOO_GAIN);
      gl.uniform1f(loc.uGooPeak, GOO_PEAK);
      gl.uniform1f(loc.uGooSigma, GOO_SIGMA);
      gl.uniform1f(loc.uAccentBlur, ACCENT_BLUR);
      gl.clearColor(0, 0, 0, 0);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return true;
    };

    const teardownGL = () => {
      if (gl) {
        if (glBuffer) {
          gl.deleteBuffer(glBuffer);
        }
        if (glVertexShader) {
          gl.deleteShader(glVertexShader);
        }
        if (glFragmentShader) {
          gl.deleteShader(glFragmentShader);
        }
        if (glProgram) {
          gl.deleteProgram(glProgram);
        }
      }
      glBuffer = null;
      glVertexShader = null;
      glFragmentShader = null;
      glProgram = null;
    };

    let glReady = !glLost && initGL();
    if (!glReady) {
      teardownGL();
    }

    // ---- 预分配的热循环状态 ----
    const centerX = new Float64Array(CIRCLE_COUNT);
    const centerY = new Float64Array(CIRCLE_COUNT);
    const gooOn = [false, false, false, false];
    const pairValid = new Array<boolean>(PAIR_COUNT).fill(false);
    const pairX1 = new Float64Array(PAIR_COUNT);
    const pairY1 = new Float64Array(PAIR_COUNT);
    const pairX2 = new Float64Array(PAIR_COUNT);
    const pairY2 = new Float64Array(PAIR_COUNT);
    const slotPair = [-1, -1, -1];
    const slotSide = [0, 0, 0];
    // 槽位淡入淡出状态：alpha 连续趋近目标值；淡出期间位置冻结在 holdX/holdY。
    const slotAlpha = [0, 0, 0];
    const slotTarget = [0, 0, 0];
    const slotHoldX = new Float64Array(SLOT_COUNT);
    const slotHoldY = new Float64Array(SLOT_COUNT);
    const circlesVec = new Float32Array(12);
    const gooFlags = new Float32Array(4);
    const accentsVec = new Float32Array(12);
    // 每帧按槽位当前绑定的圆对填充颜色（颜色随交点身份，不随槽位）。
    const slotColorVec = new Float32Array(9);

    let width = 0;
    let height = 0;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let glRatio = 1; // backing store 相对 CSS 像素的比例
    let dpr = 1;
    let rafId = 0;
    let running = false;
    let inViewport = true;
    let pageVisible = !document.hidden;
    let elapsed = 0;
    let lastTime = 0;

    const renderFrame = (theta: number, dt: number) => {
      if (width <= 0 || height <= 0) {
        return;
      }

      // 圆心（场景坐标）：(cloud − orbit) 旋转 θ 后加回轨道中心，再叠加 drift。
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      for (let i = 0; i < CIRCLE_COUNT; i += 1) {
        const c = CIRCLES[i];
        const baseDX = c.cloudX - c.orbitCX;
        const baseDY = c.cloudY - c.orbitCY;
        const rotatedX = baseDX * cosT - baseDY * sinT;
        const rotatedY = baseDX * sinT + baseDY * cosT;
        const driftX = Math.cos(c.driftDir * c.driftFreq * theta + c.driftPhase) * c.driftAmp * 0.9;
        const driftY = Math.sin(c.driftDir * c.driftFreq * theta + 1.3 * c.driftPhase) * c.driftAmp * 0.63;
        centerX[i] = c.orbitCX + rotatedX + driftX;
        centerY[i] = c.orbitCY + rotatedY + driftY;
      }
      // 卫星圆（数组下标 2）钉在圆 0 的圆周内侧。
      const pinAngle = 3.2 * theta + 0.8;
      const pinRadius = CIRCLES[0].radius - CIRCLES[2].radius;
      centerX[2] = centerX[0] + Math.cos(pinAngle) * pinRadius;
      centerY[2] = centerY[0] + Math.sin(pinAngle) * pinRadius;

      if (import.meta.env.DEV) {
        // 开发调试钩子：让 e2e 验证脚本能拿到圆环的实时位置（生产构建会被摇掉）。
        (window as unknown as Record<string, unknown>).__paperCircles = {
          centerX: Array.from(centerX),
          centerY: Array.from(centerY),
          radii: CIRCLES.map((c) => c.radius),
          scale,
          offsetX,
          offsetY,
          slotPair: [...slotPair],
          slotAlpha: [...slotAlpha],
        };
      }

      // ---- 细线层（Canvas 2D）----
      // 注：不做任何指针交互（试过原站的指针 goo 和表面张力隆起，前者形成难看肿块，
      // 后者让细线与 goo 场错位、破坏交叉点效果——决定保持纯粹的圆与圆关系）。
      lineCtx.setTransform(1, 0, 0, 1, 0, 0);
      lineCtx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
      lineCtx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
      for (let e = 0; e < CIRCLE_COUNT; e += 1) {
        lineCtx.beginPath();
        lineCtx.arc(centerX[e], centerY[e], CIRCLES[e].radius, 0, TAU);
        lineCtx.lineWidth = LINE_WIDTH / scale;
        lineCtx.strokeStyle = STROKE_COLORS[e];
        lineCtx.stroke();
      }

      // ---- goo 层（WebGL）----
      if (!glReady || !gl || !glProgram) {
        return;
      }

      // goo 开关（每圆、带滞回）。
      for (let e = 0; e < CIRCLE_COUNT; e += 1) {
        let near = false;
        for (let o = 0; o < CIRCLE_COUNT; o += 1) {
          if (o === e) {
            continue;
          }
          const d = Math.hypot(centerX[e] - centerX[o], centerY[e] - centerY[o]);
          const threshold =
            CIRCLES[e].radius + CIRCLES[o].radius + GOO_REACH + (gooOn[e] ? GOO_HYSTERESIS : 0);
          if (d < threshold) {
            near = true;
            break;
          }
        }
        gooOn[e] = near;
        gooFlags[e] = near ? 1 : 0;
        circlesVec[e * 3] = centerX[e];
        circlesVec[e * 3 + 1] = centerY[e];
        circlesVec[e * 3 + 2] = CIRCLES[e].radius;
      }

      // 6 个圆对的交点（场景坐标 +10% 出血的视口判定）。
      const viewBleedX = (width / scale) * 0.1;
      const viewBleedY = (height / scale) * 0.1;
      const viewX0 = -offsetX / scale - viewBleedX;
      const viewY0 = -offsetY / scale - viewBleedY;
      const viewX1 = (width - offsetX) / scale + viewBleedX;
      const viewY1 = (height - offsetY) / scale + viewBleedY;
      for (let p = 0; p < PAIR_COUNT; p += 1) {
        pairValid[p] = false;
        const i = PAIR_I[p];
        const j = PAIR_J[p];
        const r1 = CIRCLES[i].radius;
        const r2 = CIRCLES[j].radius;
        const dx = centerX[j] - centerX[i];
        const dy = centerY[j] - centerY[i];
        const d = Math.hypot(dx, dy);
        if (d >= r1 + r2 || d <= Math.abs(r1 - r2) || d < 1e-6) {
          continue;
        }
        const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
        const hSq = r1 * r1 - a * a;
        if (hSq <= 0) {
          continue;
        }
        const h = Math.sqrt(hSq);
        const midX = centerX[i] + (a * dx) / d;
        const midY = centerY[i] + (a * dy) / d;
        const normalX = (-dy / d) * h;
        const normalY = (dx / d) * h;
        pairValid[p] = true;
        pairX1[p] = midX + normalX;
        pairY1[p] = midY + normalY;
        pairX2[p] = midX - normalX;
        pairY2[p] = midY - normalY;
      }

      // 3 个光点槽位：颜色随交点身份（圆对）固定；alpha 连续缓动——交点失效时先在
      // 原地淡出，淡到 0 才随机重选（排除其他槽位占用的 pair），在新位置再淡入。
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        const pair = slotPair[slot];
        let valid = pair >= 0 && pairValid[pair];
        if (valid) {
          const px = slotSide[slot] === 0 ? pairX1[pair] : pairX2[pair];
          const py = slotSide[slot] === 0 ? pairY1[pair] : pairY2[pair];
          if (px < viewX0 || px > viewX1 || py < viewY0 || py > viewY1) {
            valid = false;
          } else {
            slotHoldX[slot] = px;
            slotHoldY[slot] = py;
            const i = PAIR_I[pair];
            const j = PAIR_J[pair];
            const d = Math.hypot(centerX[j] - centerX[i], centerY[j] - centerY[i]);
            slotTarget[slot] = Math.min(
              1,
              Math.max(0, (CIRCLES[i].radius + CIRCLES[j].radius - d) / 24),
            );
          }
        }
        if (!valid) {
          slotTarget[slot] = 0;
          if (slotAlpha[slot] < 0.02) {
            // 已淡出到不可见，允许重选（候选逻辑与原站一致）。
            let candidates = 0;
            for (let p = 0; p < PAIR_COUNT; p += 1) {
              if (!pairValid[p]) {
                continue;
              }
              let occupied = false;
              for (let other = 0; other < SLOT_COUNT; other += 1) {
                if (other !== slot && slotPair[other] === p) {
                  occupied = true;
                  break;
                }
              }
              if (occupied) {
                continue;
              }
              if (pairX1[p] >= viewX0 && pairX1[p] <= viewX1 && pairY1[p] >= viewY0 && pairY1[p] <= viewY1) {
                candidates += 1;
              }
              if (pairX2[p] >= viewX0 && pairX2[p] <= viewX1 && pairY2[p] >= viewY0 && pairY2[p] <= viewY1) {
                candidates += 1;
              }
            }
            if (candidates > 0) {
              let pick = Math.floor(Math.random() * candidates);
              for (let p = 0; p < PAIR_COUNT; p += 1) {
                if (!pairValid[p]) {
                  continue;
                }
                let occupied = false;
                for (let other = 0; other < SLOT_COUNT; other += 1) {
                  if (other !== slot && slotPair[other] === p) {
                    occupied = true;
                    break;
                  }
                }
                if (occupied) {
                  continue;
                }
                for (let side = 0; side < 2; side += 1) {
                  const px = side === 0 ? pairX1[p] : pairX2[p];
                  const py = side === 0 ? pairY1[p] : pairY2[p];
                  if (px < viewX0 || px > viewX1 || py < viewY0 || py > viewY1) {
                    continue;
                  }
                  if (pick === 0) {
                    slotPair[slot] = p;
                    slotSide[slot] = side;
                    slotHoldX[slot] = px;
                    slotHoldY[slot] = py;
                    pick = -1;
                    break;
                  }
                  pick -= 1;
                }
                if (pick < 0) {
                  break;
                }
              }
            } else {
              slotPair[slot] = -1;
            }
          }
        }
        slotAlpha[slot] += (slotTarget[slot] - slotAlpha[slot]) * Math.min(1, dt * ACCENT_FADE_SPEED);
      }

      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        const pair = slotPair[slot];
        const base = slot * 4;
        // 位置用冻结的 hold 坐标（淡出期间不跳），alpha 用缓动值。
        accentsVec[base] = slotHoldX[slot];
        accentsVec[base + 1] = slotHoldY[slot];
        accentsVec[base + 2] =
          pair >= 0 ? 0.1 * Math.min(CIRCLES[PAIR_I[pair]].radius, CIRCLES[PAIR_J[pair]].radius) + 20 : 1;
        accentsVec[base + 3] = slotAlpha[slot];
        const color = pair >= 0 ? PAIR_COLORS[pair] : SLATE_RGB;
        slotColorVec[slot * 3] = color[0];
        slotColorVec[slot * 3 + 1] = color[1];
        slotColorVec[slot * 3 + 2] = color[2];
      }

      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(loc.uResolution, glCanvas.width, glCanvas.height);
      gl.uniform2f(loc.uSceneOffset, offsetX * glRatio, offsetY * glRatio);
      gl.uniform1f(loc.uSceneScale, Math.max(0.001, scale * glRatio));
      gl.uniform3fv(loc['uCircles[0]'], circlesVec);
      gl.uniform1fv(loc['uCircleGoo[0]'], gooFlags);
      gl.uniform4fv(loc['uAccents[0]'], accentsVec);
      gl.uniform3fv(loc['uAccentColors[0]'], slotColorVec);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (width <= 0 || height <= 0) {
        return;
      }
      // contain fit + alignX max / alignY mid。
      scale = Math.min(width / SCENE_W, height / SCENE_H);
      offsetX = width - SCENE_W * scale;
      offsetY = (height - SCENE_H * scale) * 0.5;

      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      lineCanvas.width = Math.round(width * dpr);
      lineCanvas.height = Math.round(height * dpr);

      // goo 层按 DPR 渲染（上限 MAX_GL_PIXELS），避免低分辨率放大产生锯齿。
      const maxGlRatio = Math.min(window.devicePixelRatio || 1, MAX_GL_DPR);
      glRatio = Math.min(maxGlRatio, Math.sqrt(MAX_GL_PIXELS / (width * height)));
      glCanvas.width = Math.max(1, Math.round(width * glRatio));
      glCanvas.height = Math.max(1, Math.round(height * glRatio));

      if (reducedMotion) {
        // reduce 模式不启动 rAF，只绘制一帧静态画面（dt=1 让槽位 alpha 直接到位）。
        renderFrame(STATIC_THETA, 1);
      }
    };

    const tick = (now: number) => {
      if (!running) {
        return;
      }
      const dt = Math.min(MAX_DT, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      elapsed += dt;
      const orbit = (elapsed * ORBIT_ACCUM_SPEED) % ORBIT_WRAP;
      renderFrame((orbit / ORBIT_WRAP) * TAU, dt);
      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || reducedMotion) {
        return;
      }
      running = true;
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(rafId);
    };

    const updateRunning = () => {
      if (inViewport && pageVisible && !glLost) {
        start();
      } else {
        stop();
      }
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      glLost = true;
      glReady = false;
      teardownGL();
      stop();
    };

    const handleContextRestored = () => {
      glLost = false;
      gl = null;
      glReady = initGL();
      if (!glReady) {
        teardownGL();
      }
      updateRunning();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const intersectionObserver = new IntersectionObserver((entries) => {
      inViewport = entries[0]?.isIntersecting ?? true;
      updateRunning();
    });
    intersectionObserver.observe(glCanvas);

    const handleVisibilityChange = () => {
      pageVisible = !document.hidden;
      updateRunning();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    glCanvas.addEventListener('webglcontextlost', handleContextLost);
    glCanvas.addEventListener('webglcontextrestored', handleContextRestored);

    updateRunning();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      glCanvas.removeEventListener('webglcontextlost', handleContextLost);
      glCanvas.removeEventListener('webglcontextrestored', handleContextRestored);
      teardownGL();
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas ref={lineCanvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <canvas ref={glCanvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
    </div>
  );
}
