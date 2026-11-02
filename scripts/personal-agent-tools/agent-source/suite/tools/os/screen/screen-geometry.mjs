const SCREENSHOT_MAX_SIDE = 1280;
function fitWithin(width, height, maxSide = SCREENSHOT_MAX_SIDE) {
  const long = Math.max(width, height);
  if (long <= maxSide) return { width, height, resize: false };
  const ratio = maxSide / long;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
    resize: true
  };
}
function captureGeometry(region, image) {
  return {
    originX: region.x,
    originY: region.y,
    scale: image.width / region.width,
    imageWidth: image.width,
    imageHeight: image.height
  };
}
const SCALE_EPSILON = 1e-3;
function toScreenPoint(x, y, last, scaleArg) {
  const useLast = last !== void 0 && (scaleArg === void 0 || Math.abs(scaleArg - last.scale) < SCALE_EPSILON);
  const scale = useLast ? last.scale : scaleArg ?? 1;
  const originX = useLast ? last.originX : 0;
  const originY = useLast ? last.originY : 0;
  return {
    x: round1(originX + x / scale),
    y: round1(originY + y / scale),
    scale,
    originX,
    originY
  };
}
function round1(value) {
  return Math.round(value * 10) / 10;
}
class ScreenGeometryStore {
  constructor(maxSessions = 64) {
    this.maxSessions = maxSessions;
  }
  bySession = /* @__PURE__ */ new Map();
  set(sessionId, geometry) {
    this.bySession.delete(sessionId);
    this.bySession.set(sessionId, geometry);
    while (this.bySession.size > this.maxSessions) {
      const oldest = this.bySession.keys().next().value;
      if (oldest === void 0) break;
      this.bySession.delete(oldest);
    }
  }
  get(sessionId) {
    return this.bySession.get(sessionId);
  }
}
export {
  SCREENSHOT_MAX_SIDE,
  ScreenGeometryStore,
  captureGeometry,
  fitWithin,
  toScreenPoint
};
