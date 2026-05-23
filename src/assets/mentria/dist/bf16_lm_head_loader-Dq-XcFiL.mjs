import { n as p, t as x } from "./safetensors-FogF7D__.mjs";
async function z(a, d, o = {}) {
  if (!a || typeof a.createBuffer != "function") throw new Error("loadBf16LmHead: device must be a GPUDevice");
  let m;
  if (o.buffer) m = o.buffer;
  else {
    if (!d || typeof d != "string") throw new Error("loadBf16LmHead: url must be a non-empty string");
    const e = await fetch(d);
    if (!e.ok) throw new Error(`loadBf16LmHead: fetch(${d}) failed with status ${e.status}. If missing, download from HF: \`huggingface-cli download Qwen/Qwen3.5-0.8B-VL-Instruct model.safetensors --local-dir models/qwen3.5-0.8b-bf16/\``);
    m = await e.arrayBuffer();
  }
  const s = new x(m), h = ["model.language_model.embed_tokens.weight", "model.embed_tokens.weight"];
  let r = null;
  for (const e of h) if (s.hasTensor(e)) {
    r = e;
    break;
  }
  if (!r) throw new Error(`loadBf16LmHead: none of ${JSON.stringify(h)} found in safetensors. Available tensors: ${s.tensorNames().slice(0, 8).join(", ")}${s.tensorNames().length > 8 ? ", …" : ""}`);
  const i = s.tensorInfo(r);
  if (i.dtype !== "BF16") throw new Error(`loadBf16LmHead: tensor ${r} has dtype ${i.dtype}, expected BF16`);
  if (!Array.isArray(i.shape) || i.shape.length !== 2) throw new Error(`loadBf16LmHead: tensor ${r} has shape ${JSON.stringify(i.shape)}, expected 2D`);
  const [t, f] = i.shape;
  if (o.expectedVocabSize !== void 0 && t !== o.expectedVocabSize) throw new Error(`loadBf16LmHead: tensor ${r} vocabSize ${t} != expected ${o.expectedVocabSize}`);
  if (o.expectedHiddenSize !== void 0 && f !== o.expectedHiddenSize) throw new Error(`loadBf16LmHead: tensor ${r} hiddenSize ${f} != expected ${o.expectedHiddenSize}`);
  const n = f * t * 4, u = a.limits?.maxBufferSize, w = a.limits?.maxStorageBufferBindingSize;
  if (u !== void 0 && n > u) throw new Error(`loadBf16LmHead: required buffer size ${n} bytes exceeds device.limits.maxBufferSize ${u}. BF16 lm_head requires maxBufferSize ≥ ${n}; this adapter cannot support γ.`);
  if (w !== void 0 && n > w) throw new Error(`loadBf16LmHead: required buffer size ${n} bytes exceeds device.limits.maxStorageBufferBindingSize ${w}.`);
  const c = s.tensorBytes(r);
  let B;
  if (c.byteOffset % 2 === 0) B = new Uint16Array(c.buffer, c.byteOffset, f * t);
  else {
    const e = new Uint16Array(f * t);
    new Uint8Array(e.buffer).set(c), B = e;
  }
  const g = p(B), b = new Float32Array(f * t);
  for (let e = 0; e < t; e++) {
    const S = e * f;
    for (let l = 0; l < f; l++) b[l * t + e] = g[S + l];
  }
  const y = a.createBuffer({
    size: n,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  return a.queue.writeBuffer(y, 0, b), {
    buf: y,
    vocabSize: t,
    hiddenSize: f,
    sourceDtype: "BF16",
    byteLength: n,
    tensorName: r
  };
}
export {
  z as loadBf16LmHead
};

//# sourceMappingURL=bf16_lm_head_loader-Dq-XcFiL.mjs.map