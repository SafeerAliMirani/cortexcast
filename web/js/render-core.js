// render-core.js - WebGPU renderer for CortexCast: a scalp sphere painted with a
// GPU topomap (inverse-distance interpolation over 64 electrode values) plus the
// electrodes as instanced discs. Depth buffer + 4x MSAA. Hand-written pipelines.
import { HEAD_SHADER, ELECTRODE_SHADER } from "./shaders.js";

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.sampleCount = 4;
    this.n = 0;
    this.headIdxCount = 0;
    this.lost = false;
    this.bg = { r: 0.02, g: 0.03, b: 0.06, a: 1.0 };
  }

  static async supported() { return !!navigator.gpu; }

  async init() {
    if (!navigator.gpu) throw new Error("WebGPU not available in this browser.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No compatible GPU adapter found.");
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => { if (info.reason !== "destroyed") { this.lost = true; console.error("device lost:", info.message); if (this.onLost) this.onLost(info.message); } });
    this.context = this.canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
    this._build();
    this.resize();
  }

  _build() {
    const dev = this.device;
    this.uniformBuffer = dev.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uniformData = new Float32Array(28);

    const headL = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
    ]});
    const elecL = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
    ]});
    this.headL = headL; this.elecL = elecL;

    const ms = { count: this.sampleCount };
    const blend = { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } };
    const vbuf = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }];

    const hm = dev.createShaderModule({ code: HEAD_SHADER });
    this.headPipe = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [headL] }),
      vertex: { module: hm, entryPoint: "vs", buffers: vbuf },
      fragment: { module: hm, entryPoint: "fs", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      multisample: ms,
    });

    const em = dev.createShaderModule({ code: ELECTRODE_SHADER });
    this.elecPipe = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [elecL] }),
      vertex: { module: em, entryPoint: "vs" },
      fragment: { module: em, entryPoint: "fs", targets: [{ format: this.format, blend }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" },
      multisample: ms,
    });
  }

  setHead(sphere) {
    const dev = this.device;
    this.headVerts = dev.createBuffer({ size: sphere.positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.headVerts, 0, sphere.positions);
    this.headIdx = dev.createBuffer({ size: sphere.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.headIdx, 0, sphere.indices);
    this.headIdxCount = sphere.indices.length;
  }

// unit: n*4 electrode unit dirs (topomap interpolation). disc: n*4 positions
  // on the scalp (rendered discs). Sets up value buffer + bind groups.
  setElectrodes(unit, disc, n) {
    const dev = this.device;
    this.n = n;
    this.ePosU = dev.createBuffer({ size: unit.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.ePosU, 0, unit);
    this.ePosD = dev.createBuffer({ size: disc.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.ePosD, 0, disc);
    this.eVal = dev.createBuffer({ size: Math.max(16, n * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.eVal, 0, new Float32Array(n));
    this.bgHead = dev.createBindGroup({ layout: this.headL, entries: [
      { binding: 0, resource: { buffer: this.uniformBuffer } },
      { binding: 1, resource: { buffer: this.ePosU } },
      { binding: 2, resource: { buffer: this.eVal } },
    ]});
    this.bgElec = dev.createBindGroup({ layout: this.elecL, entries: [
      { binding: 0, resource: { buffer: this.uniformBuffer } },
      { binding: 1, resource: { buffer: this.ePosD } },
    ]});
  }

  // vals: Float32Array(n), each electrode's normalized band power 0..1.
  setValues(vals) { if (this.eVal) this.device.queue.writeBuffer(this.eVal, 0, vals); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.msaa) return;
    this.canvas.width = w; this.canvas.height = h;
    for (const t of [this.msaa, this.depth]) if (t) t.destroy();
    this.msaa = this.device.createTexture({ size: [w, h], sampleCount: this.sampleCount, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depth = this.device.createTexture({ size: [w, h], sampleCount: this.sampleCount, format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.msaaView = this.msaa.createView();
    this.depthView = this.depth.createView();
  }

  render(viewProj, state) {
    if (this.lost) return;
    const w = this.canvas.width, h = this.canvas.height;
    const dpr = w / Math.max(1, this.canvas.clientWidth);
    this.uniformData.set(viewProj, 0);
    this.uniformData[16] = state.electrodeSize ?? 5.0;
    this.uniformData[17] = dpr;
    this.uniformData[18] = this.n;
    this.uniformData[19] = state.smooth ?? 0.02;
    this.uniformData[20] = w; this.uniformData[21] = h;
    this.uniformData[24] = 0.35; this.uniformData[25] = 0.8; this.uniformData[26] = 0.5;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.msaaView, resolveTarget: this.context.getCurrentTexture().createView(), clearValue: this.bg, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: this.depthView, depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    if (this.headVerts && this.n) {
      pass.setPipeline(this.headPipe);
      pass.setBindGroup(0, this.bgHead);
      pass.setVertexBuffer(0, this.headVerts);
      pass.setIndexBuffer(this.headIdx, "uint32");
      pass.drawIndexed(this.headIdxCount);
      pass.setPipeline(this.elecPipe);
      pass.setBindGroup(0, this.bgElec);
      pass.draw(6, this.n);
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
