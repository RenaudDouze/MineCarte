// Faux contexte 2D : jsdom n'implémente pas <canvas>. Chaque appel et chaque
// affectation de propriété est journalisé dans `ctx.log`, l'ImageData posée
// par putImageData est gardée dans `ctx.image`.
export function installCanvasMock() {
  const contexts = [];
  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type !== '2d') return null;
    if (this.__ctx) return this.__ctx;
    const log = [];
    const record = (name) => (...args) => { log.push([name, ...args]); };
    const ctx = {
      canvas: this,
      log,
      image: null,
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData(img, x, y) { ctx.image = img; log.push(['putImageData', x, y]); },
      drawImage: record('drawImage'),
      beginPath: record('beginPath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      stroke: record('stroke'),
    };
    for (const prop of ['strokeStyle', 'lineWidth', 'imageSmoothingEnabled']) {
      let value;
      Object.defineProperty(ctx, prop, {
        get: () => value,
        set: (v) => { value = v; log.push(['set', prop, v]); },
      });
    }
    this.__ctx = ctx;
    contexts.push(ctx);
    return ctx;
  };
  return contexts;
}
