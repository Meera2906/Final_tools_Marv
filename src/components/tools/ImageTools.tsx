import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Globe,
  IdCard,
  LayoutGrid,
  List,
  Loader2,
  Mail,
  Maximize2,
  Phone,
  Plus,
  PlusCircle,
  Printer,
  RotateCw,
  Trash2,
  Type,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { loadSample } from "@/lib/samples";
import { PresetPicker } from "@/components/tools/PresetPicker";

import { fitToTarget } from "@/lib/fit-size";
import { cornerRadii, drawModule, drawQr, type QrCorner, type QrFrame, type QrShape } from "@/lib/qr-render";
import { QrPrintLayout } from "./QrPrinter";
import { QrCollage } from "./QrCollage";
import { Btn, Dropzone, DownloadBtn, ErrorNote, Field, Panel, baseName, canvasBlob, download, extFor, fmtBytes, inputCls, loadImage, rangeCls } from "./ui";

type Out = { name: string; before: number; blob: Blob; url: string };

/* ---------- Image Compressor ---------- */
export function ImageCompressor() {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(70);
  const [format, setFormat] = useState("image/webp");
  const [out, setOut] = useState<Out[]>([]);
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);
  const run = async () => {
    setBusy(true);
    const res: Out[] = [];
    for (const f of files) {
      const img = await loadImage(f);
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      if (format === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0);
      const blob = await canvasBlob(c, format, quality / 100);
      res.push({ name: `${baseName(f.name)}-compressed.${extFor(format)}`, before: f.size, blob, url: URL.createObjectURL(blob) });
    }
    setOut(res); setBusy(false);
  };
  const saved = out.reduce((s, o) => s + o.before - o.blob.size, 0);
  return (
    <Panel>
      <Dropzone accept="image/jpeg,image/png,image/webp" multiple label="Drop JPG, PNG or WebP images" onFiles={(f) => { setFiles(f); setOut([]); }}
        sample={{ label: "Try a sample photo", busy: sampling, onPick: async () => { setSampling(true); const f = await loadSample("photo"); setFiles([f]); setOut([]); setSampling(false); } }} />
      {files.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={`Quality: ${quality}%`}><input type="range" min={10} max={95} value={quality} onChange={(e) => setQuality(+e.target.value)} className={rangeCls} /></Field>
          <Field label="Output format">
            <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="image/webp">WebP (smallest)</option><option value="image/jpeg">JPG</option>
            </select>
          </Field>
          <div className="flex items-end"><Btn busy={busy} onClick={run}>Compress {files.length} image{files.length > 1 ? "s" : ""}</Btn></div>
        </div>
      )}
      {out.length > 0 && (
        <>
          <p className="rounded-2xl border border-[#D6CCB5] bg-[#FAF7F0] px-4 py-3 text-sm font-semibold tabular-nums text-[#000000]">
            Saved {fmtBytes(Math.max(0, saved))} across {out.length} image{out.length > 1 ? "s" : ""}.
          </p>
          <div className="grid gap-3">
            {out.map((o) => (
              <div key={o.name} className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#D6CCB5] bg-[#FAF7F0] p-3.5">
                <img src={o.url} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-xl border border-[#D6CCB5] bg-[#FFFFFF] object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-semibold text-[#000000]">{o.name}</p>
                  <p className="mt-0.5 tabular-nums text-[#4A4740]">
                    {fmtBytes(o.before)} → <b className="text-[#000000]">{fmtBytes(o.blob.size)}</b> ({Math.round((1 - o.blob.size / o.before) * 100)}% smaller)
                  </p>
                </div>
                <DownloadBtn onClick={() => download(o.blob, o.name)} />
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------- Image Resizer ---------- */
export function ImageResizer() {

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [name, setName] = useState("image");
  const [w, setW] = useState(0); const [h, setH] = useState(0);
  const [lock, setLock] = useState(true);
  const [sampling, setSampling] = useState(false);
  const [fit, setFit] = useState<"cover" | "contain" | "stretch">("cover");
  const [kb, setKb] = useState<number | "">("");
  const [out, setOut] = useState<{ blob: Blob; url: string; q: number; scale: number; hits: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const ratio = img ? img.naturalWidth / img.naturalHeight : 1;
  const target = kb ? Math.max(1, Math.round(kb * 1024)) : 0;

  const draw = (scale = 1) => {
    if (!img || !w || !h) return null;
    const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    if (fit === "stretch") ctx.drawImage(img, 0, 0, W, H);
    else {
      const s = fit === "cover" ? Math.max(W / img.naturalWidth, H / img.naturalHeight) : Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    return c;
  };

  // Hit the target file size: tune JPEG quality first, and only give up pixels if quality alone can't get there.
  const make = async () => {
    const base = draw(); if (!base) return null;
    const mk = (blob: Blob, q: number, scale: number, hits: boolean) => ({ blob, url: URL.createObjectURL(blob), q, scale, hits });
    if (!target) return mk(await canvasBlob(base, "image/jpeg", 0.92), 0.92, 1, true);
    const cache = new Map<string, Blob>();
    const encode = async (q: number, scale: number) => {
      const key = `${q}|${scale}`;
      let blob = cache.get(key);
      if (!blob) { blob = await canvasBlob(scale === 1 ? base : draw(scale)!, "image/jpeg", q); cache.set(key, blob); }
      return { size: blob.size, blob };
    };
    const fit = await fitToTarget(encode, target);
    return mk((await encode(fit.q, fit.scale)).blob, fit.q, fit.scale, fit.hits);
  };

  useEffect(() => {
    if (!img || !w || !h) return;
    let alive = true;
    const t = setTimeout(() => {
      setBusy(true);
      make().then((r) => {
        if (!alive) { if (r) URL.revokeObjectURL(r.url); return; }
        setOut((prev) => { if (prev) URL.revokeObjectURL(prev.url); return r; });
        setBusy(false);
      });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, w, h, fit, kb]);

  const pick = async (f: File) => { const i = await loadImage(f); setImg(i); setName(baseName(f.name)); setW(i.naturalWidth); setH(i.naturalHeight); };
  return (
    <Panel>
      {!img ? (
        <Dropzone accept="image/*" label="Drop an image to resize or crop" onFiles={async ([f]) => { if (f) await pick(f); }}
          sample={{ label: "Try a sample passport photo", busy: sampling, onPick: async () => { setSampling(true); await pick(await loadSample("portrait")); setSampling(false); } }} />
      ) : (
        <>
          <PresetPicker w={w} h={h} kb={kb} onPick={(p) => { setW(p.w); setH(p.h); setKb(p.kb ?? ""); setLock(false); }} />
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">

          <div className="grid content-start gap-3">
            <div className="grid-dots flex min-h-64 items-center justify-center rounded-2xl border border-[#D6CCB5] bg-[#FAF7F0] p-4">
              {out ? <img src={out.url} alt="Preview" className="max-h-96 max-w-full rounded-lg border border-[#D6CCB5] shadow-sm" /> : <div className="h-40 w-40 rounded-lg bg-[#E8DFCA]" />}
            </div>
            <div
              aria-live="polite"
              className={`rounded-2xl border p-4 text-sm ${
                out && !out.hits
                  ? "border-[#D95338]/35 bg-[#D95338]/10 text-[#9F2D18]"
                  : "border-[#D6CCB5] bg-[#FAF7F0] text-[#000000]"
              }`}
            >
              {busy ? (
                <p className="flex items-center gap-2 font-semibold text-[#000000]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Matching your target size…</p>
              ) : out ? (
                <>
                  <p className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
                    {out.hits ? <Check className="h-4 w-4 text-[#000000]" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 text-[#9F2D18]" aria-hidden="true" />}
                    {fmtBytes(out.blob.size)}
                    {target ? (out.hits ? <span className="text-[#4A4740]">— under your {kb} KB target</span> : <span className="text-[#9F2D18]">— still above your {kb} KB target</span>) : <span className="text-[#4A4740]">— no target set</span>}
                  </p>
                  <p className={`mt-1 tabular-nums ${!out.hits ? "text-[#9F2D18]" : "text-[#4A4740]"}`}>
                    Quality {Math.round(out.q * 100)}%
                    {out.scale < 1 ? ` · output ${Math.round(w * out.scale)}×${Math.round(h * out.scale)} px to fit the target` : target ? " · full size kept" : ""}
                    {out.q < 0.25 ? " · it will look soft — a looser target stays sharper" : ""}
                    {target && !out.hits ? " · try a smaller width/height or a looser target" : ""}
                  </p>
                </>
              ) : null}
            </div>
          </div>
          <div className="grid content-start gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Width px"><input className={inputCls} type="number" value={w} onChange={(e) => { const v = +e.target.value; setW(v); if (lock) setH(Math.round(v / ratio)); }} /></Field>
              <Field label="Height px"><input className={inputCls} type="number" value={h} onChange={(e) => { const v = +e.target.value; setH(v); if (lock) setW(Math.round(v * ratio)); }} /></Field>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[#000000]"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} className="accent-[#000000]" /> Lock aspect ratio</label>
            <Field label="Fit">
              <select className={inputCls} value={fit} onChange={(e) => setFit(e.target.value as typeof fit)}>
                <option value="cover">Crop to fill</option><option value="contain">Fit inside (white bars)</option><option value="stretch">Stretch</option>
              </select>
            </Field>
            <Field label="Target file size (KB)" hint="Tell us the portal's limit — we tune quality, then pixels, to land under it.">
              <div className="grid gap-2">
                <input className={inputCls} type="number" min={1} value={kb} onChange={(e) => setKb(e.target.value ? +e.target.value : "")} placeholder="e.g. 20" />
                <div className="flex flex-wrap gap-1.5">
                  {[10, 20, 50, 100, 200].map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={kb === v}
                      onClick={() => setKb(v)}
                      className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
                        kb === v
                          ? "border-[#000000] bg-[#000000] text-[#FFFFFF]"
                          : "border-[#D6CCB5] bg-[#FAF7F0] text-[#4A4740] hover:border-[#7895B2] hover:bg-[#FFFFFF] hover:text-[#000000]"
                      }`}
                    >
                      ≤ {v} KB
                    </button>
                  ))}
                  {kb !== "" && (
                    <button
                      type="button"
                      onClick={() => setKb("")}
                      className="cursor-pointer rounded-full border border-[#D6CCB5] bg-[#FFFFFF] px-3 py-1 text-xs font-semibold text-[#4A4740] transition-colors hover:border-[#000000]/40 hover:text-[#000000] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2]"
                    >
                      No target
                    </button>
                  )}
                </div>
              </div>
            </Field>
            <div className="flex flex-wrap gap-2">
              <DownloadBtn onClick={() => out && download(out.blob, `${name}-${w}x${h}.jpg`)}>Download {out ? fmtBytes(out.blob.size) : ""}</DownloadBtn>
              <Btn variant="ghost" onClick={() => setImg(null)}>New image</Btn>
            </div>
          </div>
        </div>
        </>
      )}

    </Panel>
  );
}

/* ---------- Format Converter ---------- */
export function FormatConverter() {
  const [files, setFiles] = useState<File[]>([]);
  const [to, setTo] = useState("image/png");
  const [out, setOut] = useState<Out[]>([]);
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);
  const run = async () => {
    setBusy(true); const res: Out[] = [];
    for (const f of files) {
      const img = await loadImage(f);
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      if (to === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0);
      const blob = await canvasBlob(c, to, 0.92);
      res.push({ name: `${baseName(f.name)}.${extFor(to)}`, before: f.size, blob, url: URL.createObjectURL(blob) });
    }
    setOut(res); setBusy(false);
  };
  const zip = async () => { const z = new JSZip(); out.forEach((o) => z.file(o.name, o.blob)); download(await z.generateAsync({ type: "blob" }), "converted-images.zip"); };
  return (
    <Panel>
      <Dropzone accept="image/*" multiple label="Drop images to convert" onFiles={(f) => { setFiles(f); setOut([]); }}
        sample={{ label: "Try sample images", busy: sampling, onPick: async () => { setSampling(true); const [a, b] = await Promise.all([loadSample("photo"), loadSample("logo")]); setFiles([a, b]); setOut([]); setSampling(false); } }} />
      {files.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Convert to">
            <div className="flex gap-2">
              {["image/png", "image/jpeg", "image/webp"].map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={to === m}
                  onClick={() => setTo(m)}
                  className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
                    to === m
                      ? "border-[#000000] bg-[#000000] text-[#FFFFFF]"
                      : "border-[#D6CCB5] bg-[#FAF7F0] text-[#4A4740] hover:border-[#7895B2] hover:bg-[#FFFFFF] hover:text-[#000000]"
                  }`}
                >
                  {extFor(m).toUpperCase()}
                </button>
              ))}
            </div>
          </Field>
          <Btn busy={busy} onClick={run}>Convert {files.length} file{files.length > 1 ? "s" : ""}</Btn>
          {to === "image/jpeg" && <span className="text-xs text-[#4A4740]">JPG has no transparency — transparent areas become white.</span>}
        </div>
      )}
      {out.length > 0 && (
        <div className="grid gap-3">
          {out.map((o) => (
            <div key={o.name} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#D6CCB5] bg-[#FAF7F0] p-3 text-sm">
              <img src={o.url} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-lg border border-[#D6CCB5] bg-[#FFFFFF] object-cover" />
              <span className="min-w-0 flex-1 truncate font-semibold text-[#000000]">{o.name}</span>
              <span className="tabular-nums text-[#4A4740]">{fmtBytes(o.blob.size)}</span>
              <DownloadBtn onClick={() => download(o.blob, o.name)}>Save</DownloadBtn>
            </div>
          ))}
          {out.length > 1 && <div><DownloadBtn onClick={zip}>Download all as ZIP</DownloadBtn></div>}
        </div>
      )}
    </Panel>
  );
}

/* ---------- QR Code ---------- */
type QrType = "url" | "text" | "wifi" | "email" | "phone" | "vcard";
const QR_TYPES: { id: QrType; label: string; Icon: typeof Globe }[] = [
  { id: "url", label: "Website", Icon: Globe },
  { id: "text", label: "Text", Icon: Type },
  { id: "wifi", label: "Wi-Fi", Icon: Wifi },
  { id: "email", label: "Email", Icon: Mail },
  { id: "phone", label: "Phone", Icon: Phone },
  { id: "vcard", label: "vCard", Icon: IdCard },
];
const QR_LEVELS = [
  { id: "L", label: "L · 7%", hint: "Smallest code" },
  { id: "M", label: "M · 15%", hint: "Everyday use" },
  { id: "Q", label: "Q · 25%", hint: "Print & posters" },
  { id: "H", label: "H · 30%", hint: "Withstands damage" },
] as const;
const QR_SWATCHES = ["#000000", "#1e1b4b", "#537190", "#0f766e", "#b45309", "#be123c"];

function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#000000] text-xs font-bold tabular-nums text-[#FFFFFF]">{n}</span>
      <h3 className="font-serif text-xl font-normal tracking-tight text-[#000000]">{title}</h3>
    </div>
  );
}

type QrDesignTab = "frame" | "shape" | "logo" | "level";

const QR_SHAPES: { id: QrShape; label: string; hint: string }[] = [
  { id: "square", label: "Classic", hint: "Sharp square modules" },
  { id: "rounded", label: "Rounded", hint: "Soft corners" },
  { id: "dots", label: "Dots", hint: "Playful circles" },
  { id: "diamond", label: "Diamond", hint: "Sharp gems" },
  { id: "star", label: "Stars", hint: "Little sparkles" },
  { id: "classy", label: "Classy", hint: "Leaf-cut corners" },
  { id: "fluid", label: "Fluid", hint: "Blobs that join up" },
  { id: "bars", label: "Bars", hint: "Vertical stripes" },
];
const QR_CORNERS: { id: QrCorner; label: string }[] = [
  { id: "square", label: "Square" },
  { id: "rounded", label: "Rounded" },
  { id: "circle", label: "Circle" },
  { id: "leaf", label: "Leaf" },
];
const THUMB = [1,1,0,1,0, 0,1,1,1,1, 1,0,1,0,1, 1,1,1,0,0, 0,1,0,1,1];
function ShapeThumb({ shape }: { shape: QrShape }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!; c.width = 100; c.height = 100;
    ctx.clearRect(0, 0, 100, 100); ctx.fillStyle = "#000000";
    for (let r = 0; r < 5; r++) for (let k = 0; k < 5; k++) if (THUMB[r * 5 + k])
      drawModule(ctx, shape, 4 + k * 18.4, 4 + r * 18.4, 18.4, (dr, dc) => r + dr < 5 && k + dc < 5 && !!THUMB[(r + dr) * 5 + k + dc]);
  }, [shape]);
  return <canvas ref={ref} className="mb-2 h-12 w-12" aria-hidden />;
}
function CornerThumb({ corner }: { corner: QrCorner }) {
  const r = (s: number) => { const v = cornerRadii(corner, s); return Array.isArray(v) ? v[0] : v; };
  const leaf = corner === "leaf";
  const style = (s: number) => leaf ? { borderRadius: `${r(s)}px 0 ${r(s)}px 0` } : { borderRadius: r(s) };
  return (
    <span className="mb-2 grid h-12 w-12 place-items-center bg-[#000000]" style={style(48)}>
      <span className="grid h-8 w-8 place-items-center bg-[#FFFFFF]" style={style(32)}>
        <span className="h-4 w-4 bg-[#000000]" style={style(16)} />
      </span>
    </span>
  );
}
const QR_FRAMES: { id: QrFrame; label: string }[] = [
  { id: "none", label: "No frame" },
  { id: "border", label: "Border" },
  { id: "banner", label: "Scan-me banner" },
  { id: "badge", label: "Badge ring" },
];

function FrameThumb({ id, fg }: { id: QrFrame; fg: string }) {
  const dots: [number, number][] = [[2, 2], [5, 2], [8, 2], [2, 5], [5, 5], [8, 5], [2, 8], [5, 8], [8, 8], [5, 11], [8, 11]];
  const qr = <g fill={fg} opacity={0.85}>{dots.map(([x, y], i) => <rect key={i} x={x * 2.4} y={y * 2.4} width={2} height={2} rx={0.5} />)}</g>;
  return (
    <svg viewBox="0 0 28 34" className="h-14 w-full" aria-hidden>
      {id === "none" && <g><circle cx="14" cy="15" r="9" fill="none" stroke="#4A4740" strokeWidth="2" /><line x1="7" y1="22" x2="21" y2="8" stroke="#4A4740" strokeWidth="2" /></g>}
      {id === "border" && <g><rect x="4" y="4" width="20" height="26" rx="4" fill="none" stroke={fg} strokeWidth="2" /><g transform="translate(4.5 7)">{qr}</g></g>}
      {id === "banner" && <g><rect x="4" y="3" width="20" height="28" rx="4" fill="none" stroke="#D6CCB5" strokeWidth="1.4" /><g transform="translate(4.5 6)">{qr}</g><rect x="6" y="25" width="16" height="4.5" rx="2.2" fill={fg} /></g>}
      {id === "badge" && <g><circle cx="14" cy="17" r="12.5" fill="none" stroke={fg} strokeWidth="2" /><g transform="translate(4.5 9)">{qr}</g></g>}
    </svg>
  );
}

export function QrGenerator() {
  const [mode, setMode] = useState<"design" | "print" | "collage">("design");
  const [type, setType] = useState<QrType>("url");
  const [text, setText] = useState("https://marvedge.com/");
  const [ssid, setSsid] = useState(""); const [pass, setPass] = useState(""); const [enc, setEnc] = useState("WPA");
  const [mailTo, setMailTo] = useState(""); const [mailSub, setMailSub] = useState(""); const [mailBody, setMailBody] = useState("");
  const [phone, setPhone] = useState("");
  const [vName, setVName] = useState(""); const [vOrg, setVOrg] = useState(""); const [vTel, setVTel] = useState(""); const [vMail, setVMail] = useState(""); const [vUrl, setVUrl] = useState("");
  const [fg, setFg] = useState("#000000"); const [bg, setBg] = useState("#FFFFFF");
  const [size, setSize] = useState(512);
  const [level, setLevel] = useState<"L" | "M" | "Q" | "H">("M");
  const [designTab, setDesignTab] = useState<QrDesignTab>("frame");
  const [frame, setFrame] = useState<QrFrame>("none");
  const [shape, setShape] = useState<QrShape>("square");
  const [corner, setCorner] = useState<QrCorner>("square");
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const value =
    type === "wifi" ? `WIFI:T:${enc};S:${ssid};P:${pass};;`
    : type === "email" ? `mailto:${mailTo}?subject=${encodeURIComponent(mailSub)}&body=${encodeURIComponent(mailBody)}`
    : type === "phone" ? `tel:${phone.replace(/[^+\d]/g, "")}`
    : type === "vcard" ? ["BEGIN:VCARD", "VERSION:3.0", `FN:${vName}`, vOrg && `ORG:${vOrg}`, vTel && `TEL:${vTel}`, vMail && `EMAIL:${vMail}`, vUrl && `URL:${vUrl}`, "END:VCARD"].filter(Boolean).join("\n")
    : text;
  const plainSvg = shape === "square" && corner === "square" && frame === "none" && !logo;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !value.trim()) return;
    try { drawQr(c, value, { fg, bg, size, level, shape, corner, frame, logo }); } catch { /* invalid content — keep last frame */ }
  }, [value, fg, bg, size, level, shape, corner, frame, logo]);

  const downloadPng = () => { const c = canvasRef.current; if (c) download(c.toDataURL("image/png"), "qr-code.png"); };
  const downloadSvg = async () => download(new Blob([await QRCode.toString(value, { width: size, margin: 2, color: { dark: fg, light: bg }, errorCorrectionLevel: level, type: "svg" })], { type: "image/svg+xml" }), "qr-code.svg");

  return (
    <Panel>
      {/* type tabs */}
      <div className="flex flex-wrap gap-2">
        {QR_TYPES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={type === id}
            onClick={() => setType(id)}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
              type === id
                ? "border-[#000000] bg-[#E8DFCA]/60 text-[#000000]"
                : "border-[#D6CCB5] bg-[#FAF7F0] text-[#4A4740] hover:border-[#7895B2] hover:bg-[#FFFFFF] hover:text-[#000000]"
            }`}
          >
            <span className={`grid h-7 w-7 place-items-center rounded-lg ${type === id ? "bg-[#000000] text-[#FFFFFF]" : "border border-[#D6CCB5] bg-[#FFFFFF] text-[#000000]"}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            {label}
          </button>
        ))}
      </div>

      {/* design vs print mode */}
      <div className="flex w-fit flex-wrap gap-1 rounded-2xl border border-[#D6CCB5] bg-[#FAF7F0] p-1">
        {([["design", "Design & download", Download], ["print", "Print a sheet", Printer], ["collage", "QR collage", LayoutGrid]] as const).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
              mode === m
                ? "bg-[#000000] text-[#FFFFFF] shadow-xs"
                : "text-[#4A4740] hover:text-[#000000]"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />{label}
          </button>
        ))}
      </div>

      {mode === "print" ? (
        <QrPrintLayout value={value} fg={fg} bg={bg} shape={shape} corner={corner} logo={logo} />
      ) : mode === "collage" ? (
        <QrCollage value={value} fg={fg} bg={bg} shape={shape} corner={corner} logo={logo} />
      ) : (
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="grid content-start gap-7">
          {/* step 1: content */}
          <div className="grid gap-3">
            <StepHead n={1} title="Complete the content" />
            {type === "wifi" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Network name"><input className={inputCls} value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="MyHomeWifi" /></Field>
                <Field label="Password"><input className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} /></Field>
                <Field label="Security"><select className={inputCls} value={enc} onChange={(e) => setEnc(e.target.value)}><option>WPA</option><option>WEP</option><option value="nopass">None</option></select></Field>
              </div>
            )}
            {type === "email" && (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Send to"><input className={inputCls} value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="hello@example.com" /></Field>
                  <Field label="Subject"><input className={inputCls} value={mailSub} onChange={(e) => setMailSub(e.target.value)} /></Field>
                </div>
                <Field label="Message"><textarea rows={2} className={inputCls} value={mailBody} onChange={(e) => setMailBody(e.target.value)} /></Field>
              </div>
            )}
            {type === "phone" && (
              <Field label="Phone number" hint="Include the country code, e.g. +91 98765 43210"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" /></Field>
            )}
            {type === "vcard" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name"><input className={inputCls} value={vName} onChange={(e) => setVName(e.target.value)} placeholder="Asha Verma" /></Field>
                <Field label="Company"><input className={inputCls} value={vOrg} onChange={(e) => setVOrg(e.target.value)} /></Field>
                <Field label="Phone"><input className={inputCls} value={vTel} onChange={(e) => setVTel(e.target.value)} /></Field>
                <Field label="Email"><input className={inputCls} value={vMail} onChange={(e) => setVMail(e.target.value)} /></Field>
                <Field label="Website"><input className={inputCls} value={vUrl} onChange={(e) => setVUrl(e.target.value)} /></Field>
              </div>
            )}
            {(type === "url" || type === "text") && (
              <Field label={type === "url" ? "Enter your website" : "Enter your text"}>
                <textarea rows={type === "url" ? 1 : 3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder={type === "url" ? "E.g. https://www.myweb.com/" : "Anything you like…"} />
              </Field>
            )}
          </div>

          {/* step 2: design */}
          <div className="grid gap-4">
            <StepHead n={2} title="Design your QR" />
            <div className="flex w-fit flex-wrap gap-1 rounded-2xl border border-[#D6CCB5] bg-[#FAF7F0] p-1">
              {(["frame", "shape", "logo", "level"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={designTab === t}
                  onClick={() => setDesignTab(t)}
                  className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
                    designTab === t
                      ? "bg-[#000000] text-[#FFFFFF] shadow-xs"
                      : "text-[#4A4740] hover:text-[#000000]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {designTab === "frame" && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {QR_FRAMES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={frame === f.id}
                    onClick={() => setFrame(f.id)}
                    className={`grid cursor-pointer justify-items-center gap-1 rounded-2xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
                      frame === f.id
                        ? "border-[#000000] bg-[#E8DFCA]/60"
                        : "border-[#D6CCB5] bg-[#FAF7F0] hover:border-[#7895B2] hover:bg-[#FFFFFF]"
                    }`}
                  >
                    <FrameThumb id={f.id} fg={fg} />
                    <span className="text-xs font-semibold text-[#000000]">{f.label}</span>
                  </button>
                ))}
              </div>
            )}

            {designTab === "shape" && (
              <div className="grid gap-4">
                <span className="text-sm font-semibold text-[#000000]">Dot style</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {QR_SHAPES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={shape === s.id}
                      onClick={() => setShape(s.id)}
                      className={`cursor-pointer rounded-2xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
                        shape === s.id
                          ? "border-[#000000] bg-[#E8DFCA]/60"
                          : "border-[#D6CCB5] bg-[#FAF7F0] hover:border-[#7895B2] hover:bg-[#FFFFFF]"
                      }`}
                    >
                      <ShapeThumb shape={s.id} />
                      <span className="block text-sm font-bold text-[#000000]">{s.label}</span>
                      <span className="block text-xs text-[#4A4740]">{s.hint}</span>
                    </button>
                  ))}
                </div>
                <span className="text-sm font-semibold text-[#000000]">Corner eyes</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {QR_CORNERS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      aria-pressed={corner === k.id}
                      onClick={() => setCorner(k.id)}
                      className={`flex cursor-pointer flex-col items-center rounded-2xl border px-3 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
                        corner === k.id
                          ? "border-[#000000] bg-[#E8DFCA]/60"
                          : "border-[#D6CCB5] bg-[#FAF7F0] hover:border-[#7895B2] hover:bg-[#FFFFFF]"
                      }`}
                    >
                      <CornerThumb corner={k.id} />
                      <span className="text-sm font-bold text-[#000000]">{k.label}</span>
                    </button>
                  ))}
                </div>
                <div className="grid gap-3">
                  <span className="text-sm font-semibold text-[#000000]">Code color</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {QR_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Code color ${c}`}
                        aria-pressed={fg === c}
                        onClick={() => setFg(c)}
                        className={`h-9 w-9 cursor-pointer rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
                          fg === c ? "scale-110 border-[#000000] ring-2 ring-[#7895B2]/50" : "border-[#D6CCB5] hover:scale-105"
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                    <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} aria-label="Custom code color" className="h-9 w-12 cursor-pointer rounded-lg border border-[#D6CCB5]" />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Background">
                    <div className="flex items-center gap-2">
                      {["#FFFFFF", "#FAF7F0", "#E8DFCA", "#111111"].map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Background ${c}`}
                          aria-pressed={bg === c}
                          onClick={() => setBg(c)}
                          className={`h-9 w-9 cursor-pointer rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
                            bg === c ? "scale-110 border-[#000000] ring-2 ring-[#7895B2]/50" : "border-[#D6CCB5] hover:scale-105"
                          }`}
                          style={{ background: c }}
                        />
                      ))}
                      <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Custom background color" className="h-9 w-12 cursor-pointer rounded-lg border border-[#D6CCB5]" />
                    </div>
                  </Field>
                  <Field label={`Size · ${size}px`}><input type="range" min={128} max={1024} step={32} value={size} onChange={(e) => setSize(+e.target.value)} className={rangeCls} /></Field>
                </div>
              </div>
            )}

            {designTab === "logo" && (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Btn variant="ghost" onClick={() => logoInputRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{logo ? "Change logo" : "Upload a logo"}</Btn>
                  {logo && <Btn variant="ghost" onClick={() => setLogo(null)}><X className="h-4 w-4" aria-hidden="true" />Remove</Btn>}
                  <input ref={logoInputRef} type="file" hidden accept="image/*"
                    onChange={async (e) => { const f = e.target.files?.[0]; if (f) setLogo(await loadImage(f)); e.target.value = ""; }} />
                </div>
                <p className="text-xs text-[#4A4740]">Your logo sits in the middle on a clean patch. We automatically switch to the strongest error correction (H) so the code keeps scanning.</p>
              </div>
            )}

            {designTab === "level" && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {QR_LEVELS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={level === l.id}
                    onClick={() => setLevel(l.id)}
                    disabled={!!logo}
                    className={`cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] disabled:opacity-50 ${
                      level === l.id
                        ? "border-[#000000] bg-[#E8DFCA]/60"
                        : "border-[#D6CCB5] bg-[#FAF7F0] hover:border-[#7895B2] hover:bg-[#FFFFFF]"
                    }`}
                  >
                    <span className="block text-sm font-bold text-[#000000]">{l.label}</span>
                    <span className="block text-xs text-[#4A4740]">{l.hint}</span>
                  </button>
                ))}
                {logo && <p className="col-span-full text-xs text-[#4A4740]">Locked to H while a logo is placed — remove the logo to change it.</p>}
              </div>
            )}
          </div>
        </div>

        {/* step 3: download */}
        <div className="grid content-start justify-items-center gap-4 rounded-3xl border border-[#D6CCB5] bg-[#FAF7F0] p-6">
          <StepHead n={3} title="Download your QR" />
          <div className="rounded-2xl border border-[#D6CCB5] bg-[#FFFFFF] p-4 shadow-sm">
            <canvas ref={canvasRef} className="w-56 rounded-lg" aria-label="QR code preview" />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <DownloadBtn onClick={downloadPng}>PNG</DownloadBtn>
            <Btn variant="ghost" onClick={() => { if (plainSvg) void downloadSvg(); }} disabled={!plainSvg}>SVG</Btn>
          </div>
          {!plainSvg && <p className="text-center text-xs text-[#4A4740]">SVG export is available for the classic square style without a frame or logo.</p>}
          <p className="text-center text-xs text-[#4A4740]">Updates live as you type — scan it with your phone to test.</p>
          <Btn variant="ghost" onClick={() => setMode("print")}><Printer className="h-4 w-4" aria-hidden="true" />Print this design</Btn>
        </div>
      </div>
      )}
    </Panel>
  );
}

/* ---------- Favicon ---------- */
const SIZES = [16, 32, 48, 180, 192, 512];
export function FaviconGenerator() {
  const [icons, setIcons] = useState<{ s: number; blob: Blob; url: string }[]>([]);
  const [radius, setRadius] = useState(20);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [sampling, setSampling] = useState(false);
  useEffect(() => {
    if (!img) return;
    Promise.all(SIZES.map(async (s) => {
      const c = document.createElement("canvas"); c.width = c.height = s;
      const ctx = c.getContext("2d")!;
      const r = (radius / 100) * s * 0.5;
      ctx.beginPath(); ctx.roundRect(0, 0, s, s, r); ctx.clip();
      const m = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, s, s);
      const blob = await canvasBlob(c, "image/png");
      return { s, blob, url: URL.createObjectURL(blob) };
    })).then(setIcons);
  }, [img, radius]);
  const zip = async () => {
    const z = new JSZip();
    icons.forEach((i) => z.file(i.s === 180 ? "apple-touch-icon.png" : `favicon-${i.s}x${i.s}.png`, i.blob));
    z.file("snippet.html", `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">\n<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">`);
    download(await z.generateAsync({ type: "blob" }), "favicons.zip");
  };
  return (
    <Panel>
      <Dropzone accept="image/*" label="Drop your logo (square works best)" onFiles={async ([f]) => f && setImg(await loadImage(f))}
        sample={{ label: "Try a sample logo", busy: sampling, onPick: async () => { setSampling(true); setImg(await loadImage(await loadSample("logo"))); setSampling(false); } }} />
      {icons.length > 0 && (
        <>
          <div className="flex items-center gap-3 rounded-t-xl border border-[#D6CCB5] bg-[#FAF7F0] px-3.5 py-2.5 text-sm">
            <img src={icons[0]?.url} alt="" width={16} height={16} className="h-4 w-4 rounded-xs" />
            <span className="font-medium text-[#000000]">Your Site — Home</span>
            <span className="ml-auto text-xs text-[#4A4740]">tab preview</span>
          </div>
          <div className="flex flex-wrap items-end gap-6 rounded-2xl border border-[#D6CCB5] bg-[#FAF7F0] p-5">
            {icons.map((i) => (
              <div key={i.s} className="flex flex-col items-center gap-1.5">
                <img
                  src={i.url}
                  alt={`${i.s} by ${i.s} favicon`}
                  width={Math.min(i.s, 96)}
                  height={Math.min(i.s, 96)}
                  style={{ width: Math.min(i.s, 96), height: Math.min(i.s, 96) }}
                  className="shadow-xs"
                />
                <span className="text-xs tabular-nums text-[#4A4740]">{i.s}px</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <Field label={`Corner rounding ${radius}%`}><input type="range" min={0} max={100} value={radius} onChange={(e) => setRadius(+e.target.value)} className={rangeCls} /></Field>
            <DownloadBtn onClick={zip}>Download icon pack</DownloadBtn>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------- PDF Merger & Splitter ---------- */
const parseRanges = (s: string, max: number) => {
  const pages: number[] = [];
  s.split(",").forEach((part) => {
    const [a, b] = part.trim().split("-").map((x) => parseInt(x, 10));
    if (!a) return;
    for (let p = a; p <= (b || a); p++) if (p >= 1 && p <= max) pages.push(p - 1);
  });
  return pages;
};
/** Dummy PDFs built in-browser so the PDF tool can be tried without a real file. */
async function dummyPdf(title: string, pages: number, name: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(title, { x: 56, y: 762, size: 22, font: bold, color: rgb(0, 0, 0) });
    p.drawText(`Page ${i} of ${pages}`, { x: 56, y: 726, size: 12, font, color: rgb(0.35, 0.35, 0.35) });
    p.drawText("A dummy document created in your browser so you can try this tool.", { x: 56, y: 690, size: 12, font });
    p.drawText("Marvedge Tools · marvedge.com", { x: 56, y: 60, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
  }
  const bytes = await doc.save();
  return new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/pdf" });
}
type PdfItem = {
  id: string;
  file: File;
  pages: number;
  url: string;
  rotation: number;
  selected: boolean;
  isImage: boolean;
};

type PageItem = {
  id: string;
  originalIndex: number;
  pageNumber: number;
  url: string;
  rotation: number;
  selected: boolean;
};

export function PdfTool() {
  const [mode, setMode] = useState<"merge" | "split">("merge");
  const [viewType, setViewType] = useState<"grid" | "list">("grid");
  const [files, setFiles] = useState<PdfItem[]>([]);
  const [range, setRange] = useState("1-2");
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<PdfItem | null>(null);

  // Individual Inner Pages Inspection state
  const [activeInspectPdf, setActiveInspectPdf] = useState<PdfItem | null>(null);
  const [innerPages, setInnerPages] = useState<PageItem[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const insertIndexRef = useRef<number | null>(null);

  const processIncomingFiles = async (fs: File[]): Promise<PdfItem[]> => {
    const items: PdfItem[] = [];
    for (const file of fs) {
      const isImg = file.type.startsWith("image/");
      let pageCount = 1;
      if (!isImg) {
        try {
          const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
          pageCount = doc.getPageCount();
        } catch {
          throw new Error(`"${file.name}" couldn't be loaded as a valid PDF.`);
        }
      }
      items.push({
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        pages: pageCount,
        url: URL.createObjectURL(file),
        rotation: 0,
        selected: true,
        isImage: isImg,
      });
    }
    return items;
  };

  const add = async (fs: File[], targetIndex?: number | null) => {
    setErr(null);
    try {
      const loaded = await processIncomingFiles(fs);
      setFiles((prev) => {
        if (mode === "split") {
          return loaded.slice(0, 1);
        }
        if (typeof targetIndex === "number" && targetIndex >= 0 && targetIndex <= prev.length) {
          const next = [...prev];
          next.splice(targetIndex, 0, ...loaded);
          return next;
        }
        return [...prev, ...loaded];
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "One of those files couldn't be loaded.");
    }
  };

  const triggerAddAt = (index: number | null) => {
    insertIndexRef.current = index;
    fileInputRef.current?.click();
  };

  const handleNativeInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const chosen = Array.from(e.target.files);
      await add(chosen, insertIndexRef.current);
      e.target.value = "";
    }
  };

  const move = (i: number, d: number) => {
    setFiles((f) => {
      const n = [...f];
      const [x] = n.splice(i, 1);
      if (x) n.splice(i + d, 0, x);
      return n;
    });
  };

  const rotate = (id: string) => {
    setFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, rotation: (item.rotation + 90) % 360 } : item))
    );
  };

  const toggleSelect = (id: string) => {
    setFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item))
    );
  };

  const remove = (id: string) => {
    setFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const sortByName = () => {
    setFiles((prev) => [...prev].sort((a, b) => a.file.name.localeCompare(b.file.name)));
  };

  const sortByPages = () => {
    setFiles((prev) => [...prev].sort((a, b) => a.pages - b.pages));
  };

  const reverseOrder = () => {
    setFiles((prev) => [...prev].reverse());
  };

  // --- Inner Pages Inspection Logic ---
  const openInnerPages = async (item: PdfItem) => {
    setActiveInspectPdf(item);
    setLoadingPages(true);
    setErr(null);
    try {
      if (item.isImage) {
        setInnerPages([
          {
            id: `${item.id}-p1`,
            originalIndex: 0,
            pageNumber: 1,
            url: item.url,
            rotation: item.rotation,
            selected: true,
          },
        ]);
      } else {
        const srcDoc = await PDFDocument.load(await item.file.arrayBuffer(), { ignoreEncryption: true });
        const count = srcDoc.getPageCount();
        const pages: PageItem[] = [];
        for (let i = 0; i < count; i++) {
          const singleDoc = await PDFDocument.create();
          const [copied] = await singleDoc.copyPages(srcDoc, [i]);
          if (item.rotation) {
            copied.setRotation(degrees((copied.getRotation().angle + item.rotation) % 360));
          }
          singleDoc.addPage(copied);
          const bytes = await singleDoc.save();
          const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
          pages.push({
            id: `${item.id}-p${i + 1}`,
            originalIndex: i,
            pageNumber: i + 1,
            url: URL.createObjectURL(blob),
            rotation: 0,
            selected: true,
          });
        }
        setInnerPages(pages);
      }
    } catch (e) {
      setErr("Could not extract individual pages from this PDF.");
    } finally {
      setLoadingPages(false);
    }
  };

  const moveInnerPage = (i: number, d: number) => {
    setInnerPages((prev) => {
      const next = [...prev];
      const [x] = next.splice(i, 1);
      if (x) next.splice(i + d, 0, x);
      return next;
    });
  };

  const rotateInnerPage = (id: string) => {
    setInnerPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p))
    );
  };

  const rotateAllInnerPages = () => {
    setInnerPages((prev) => prev.map((p) => ({ ...p, rotation: (p.rotation + 90) % 360 })));
  };

  const toggleSelectInnerPage = (id: string) => {
    setInnerPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p))
    );
  };

  const deleteInnerPage = (id: string) => {
    setInnerPages((prev) => prev.filter((p) => p.id !== id));
  };

  const saveInnerPagesChanges = async () => {
    if (!activeInspectPdf) return;
    setBusy(true);
    setErr(null);
    try {
      const selectedPages = innerPages.filter((p) => p.selected);
      if (selectedPages.length === 0) {
        throw new Error("At least one page must be selected.");
      }

      if (activeInspectPdf.isImage) {
        setActiveInspectPdf(null);
        return;
      }

      const srcDoc = await PDFDocument.load(await activeInspectPdf.file.arrayBuffer(), { ignoreEncryption: true });
      const newDoc = await PDFDocument.create();

      for (const pageItem of selectedPages) {
        const [copied] = await newDoc.copyPages(srcDoc, [pageItem.originalIndex]);
        const currentRot = copied.getRotation().angle;
        copied.setRotation(degrees((currentRot + pageItem.rotation) % 360));
        newDoc.addPage(copied);
      }

      const bytes = await newDoc.save();
      const newFile = new File([bytes as Uint8Array<ArrayBuffer>], activeInspectPdf.file.name, {
        type: "application/pdf",
      });
      const newUrl = URL.createObjectURL(newFile);

      setFiles((prev) =>
        prev.map((f) =>
          f.id === activeInspectPdf.id
            ? {
                ...f,
                file: newFile,
                pages: selectedPages.length,
                url: newUrl,
                rotation: 0,
              }
            : f
        )
      );
      setActiveInspectPdf(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to apply page changes.");
    } finally {
      setBusy(false);
    }
  };

  const extractSelectedPagesDirectly = async () => {
    if (!activeInspectPdf) return;
    setBusy(true);
    setErr(null);
    try {
      const selectedPages = innerPages.filter((p) => p.selected);
      if (selectedPages.length === 0) {
        throw new Error("No pages selected to extract.");
      }

      const srcDoc = await PDFDocument.load(await activeInspectPdf.file.arrayBuffer(), { ignoreEncryption: true });
      const newDoc = await PDFDocument.create();

      for (const pageItem of selectedPages) {
        const [copied] = await newDoc.copyPages(srcDoc, [pageItem.originalIndex]);
        const currentRot = copied.getRotation().angle;
        copied.setRotation(degrees((currentRot + pageItem.rotation) % 360));
        newDoc.addPage(copied);
      }

      const bytes = await newDoc.save();
      download(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
        `extracted-${activeInspectPdf.file.name}`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  };

  const totalPages = files.reduce((acc, f) => acc + (f.selected ? f.pages : 0), 0);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const out = await PDFDocument.create();
      const activeFiles = files.filter((f) => f.selected);
      if (activeFiles.length === 0) {
        throw new Error("Please select at least one document to proceed.");
      }

      if (mode === "merge") {
        for (const item of activeFiles) {
          if (item.isImage) {
            const imgBytes = await item.file.arrayBuffer();
            let embeddedImg;
            if (item.file.type === "image/jpeg" || item.file.type === "image/jpg") {
              embeddedImg = await out.embedJpg(imgBytes);
            } else {
              const img = await loadImage(item.file);
              const canvas = document.createElement("canvas");
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext("2d")!;
              ctx.drawImage(img, 0, 0);
              const pngBlob = await canvasBlob(canvas, "image/png");
              embeddedImg = await out.embedPng(await pngBlob.arrayBuffer());
            }
            const page = out.addPage([embeddedImg.width, embeddedImg.height]);
            if (item.rotation) {
              page.setRotation(degrees(item.rotation));
            }
            page.drawImage(embeddedImg, {
              x: 0,
              y: 0,
              width: embeddedImg.width,
              height: embeddedImg.height,
            });
          } else {
            const src = await PDFDocument.load(await item.file.arrayBuffer(), { ignoreEncryption: true });
            const copied = await out.copyPages(src, src.getPageIndices());
            copied.forEach((p) => {
              if (item.rotation) {
                const currentRot = p.getRotation().angle;
                p.setRotation(degrees((currentRot + item.rotation) % 360));
              }
              out.addPage(p);
            });
          }
        }
      } else {
        const item = activeFiles[0]!;
        const src = await PDFDocument.load(await item.file.arrayBuffer(), { ignoreEncryption: true });
        const idx = parseRanges(range, src.getPageCount());
        if (!idx.length) throw new Error("Enter page numbers like 1-3, 5");
        const copied = await out.copyPages(src, idx);
        copied.forEach((p) => {
          if (item.rotation) {
            const currentRot = p.getRotation().angle;
            p.setRotation(degrees((currentRot + item.rotation) % 360));
          }
          out.addPage(p);
        });
      }

      download(
        new Blob([(await out.save()) as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
        mode === "merge" ? "merged.pdf" : "extracted-pages.pdf"
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    }
    setBusy(false);
  };

  return (
    <Panel>
      {/* Hidden File Input for intermediate "+" insertions and dashed add card */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleNativeInputChange}
        multiple={mode === "merge"}
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
      />

      {/* When inspecting a single PDF's inner pages */}
      {activeInspectPdf ? (
        <div className="space-y-6">
          {/* Inner Pages Navigation Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#D6CCB5] pb-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveInspectPdf(null)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#D6CCB5] bg-white px-3.5 py-1.5 text-xs font-semibold text-black hover:border-black transition-colors cursor-pointer shadow-xs"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Back to All Files</span>
              </button>

              <div
                className="rounded-full bg-[#FCE4E8] text-[#9E2034] px-3.5 py-1 text-xs font-bold truncate max-w-[220px] shadow-2xs"
                title={activeInspectPdf.file.name}
              >
                {activeInspectPdf.file.name}
              </div>

              <span className="text-xs font-mono text-black/50">
                ({innerPages.length} {innerPages.length === 1 ? "page" : "pages"})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={rotateAllInnerPages}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCB5] bg-white px-2.5 py-1.5 text-xs font-semibold text-black hover:border-black transition-colors cursor-pointer shadow-xs"
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span>Rotate All 90°</span>
              </button>

              <button
                type="button"
                onClick={() => setInnerPages((p) => p.map((x) => ({ ...x, selected: true })))}
                className="rounded-lg border border-[#D6CCB5] bg-white px-2.5 py-1.5 text-xs font-semibold text-black hover:border-black transition-colors cursor-pointer shadow-xs"
              >
                Select All
              </button>

              <button
                type="button"
                onClick={extractSelectedPagesDirectly}
                disabled={busy}
                className="rounded-lg border border-[#7895B2] bg-[#7895B2]/10 px-3 py-1.5 text-xs font-bold text-[#7895B2] hover:bg-[#7895B2] hover:text-white transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                Extract Selected
              </button>

              <button
                type="button"
                onClick={saveInnerPagesChanges}
                disabled={busy}
                className="rounded-lg bg-[#000000] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#1A1A1A] transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                Save &amp; Return
              </button>
            </div>
          </div>

          {/* Inner Pages Grid */}
          {loadingPages ? (
            <div className="flex flex-col items-center justify-center p-16 rounded-3xl bg-[#FAF7F0] border border-[#E8DFCA]">
              <Loader2 className="h-8 w-8 animate-spin text-[#7895B2]" />
              <span className="mt-3 text-sm font-semibold text-black/70">
                Extracting and rendering {activeInspectPdf.pages} individual pages...
              </span>
            </div>
          ) : (
            <div className="rounded-3xl border border-[#D6CCB5] bg-[#FAF7F0] p-6 shadow-xs">
              <div className="flex flex-wrap items-center gap-4 sm:gap-6 overflow-x-auto pb-4">
                {innerPages.map((page, idx) => (
                  <div key={page.id} className="flex items-center gap-3 sm:gap-4 shrink-0">
                    {/* Individual Page Card */}
                    <div className="relative group w-40 sm:w-44 h-60 rounded-2xl bg-white border border-[#D6CCB5] shadow-xs hover:shadow-xl transition-all duration-200 flex flex-col justify-between p-3 select-none">
                      {/* Top Row: Page Checkbox & Page Badge */}
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => toggleSelectInnerPage(page.id)}
                          className={`h-5 w-5 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                            page.selected
                              ? "bg-[#000000] border-[#000000] text-white"
                              : "border-[#D6CCB5] bg-white hover:border-black text-transparent"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </button>
                        <span className="rounded bg-[#E8DFCA] px-2 py-0.5 text-[10px] font-bold font-mono text-black">
                          Page {page.pageNumber}
                        </span>
                      </div>

                      {/* Page Preview Thumbnail */}
                      <div className="relative my-2 flex-1 rounded-xl overflow-hidden bg-[#18181B] border border-black/10 flex items-center justify-center group-hover:scale-[1.02] transition-transform">
                        {activeInspectPdf.isImage ? (
                          <img
                            src={page.url}
                            alt={`Page ${page.pageNumber}`}
                            className="w-full h-full object-cover transition-transform duration-200"
                            style={{ transform: `rotate(${page.rotation}deg)` }}
                          />
                        ) : (
                          <object
                            data={`${page.url}#toolbar=0&navpanes=0`}
                            type="application/pdf"
                            className="absolute inset-0 w-full h-full pointer-events-none object-cover"
                            style={{ transform: `rotate(${page.rotation}deg)` }}
                          />
                        )}

                        {/* Hover Controls on Individual Page */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 p-2">
                          <button
                            type="button"
                            onClick={() => rotateInnerPage(page.id)}
                            className="h-7 w-7 rounded-full bg-white text-black hover:bg-[#E8DFCA] flex items-center justify-center shadow-md transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                            title="Rotate Page 90°"
                          >
                            <RotateCw className="h-3 w-3" />
                          </button>

                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveInnerPage(idx, -1)}
                            className="h-7 w-7 rounded-full bg-white text-black hover:bg-[#E8DFCA] flex items-center justify-center shadow-md transition-transform hover:scale-110 active:scale-95 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            title="Move Page Left"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={idx === innerPages.length - 1}
                            onClick={() => moveInnerPage(idx, 1)}
                            className="h-7 w-7 rounded-full bg-white text-black hover:bg-[#E8DFCA] flex items-center justify-center shadow-md transition-transform hover:scale-110 active:scale-95 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            title="Move Page Right"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteInnerPage(page.id)}
                            className="h-7 w-7 rounded-full bg-[#D95338] text-white hover:bg-red-700 flex items-center justify-center shadow-md transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                            title="Delete Page"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Bottom Page Status */}
                      <div className="text-center text-[10px] font-mono text-black/50">
                        {page.rotation > 0 ? `Rotated ${page.rotation}°` : "Standard"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Normal Workspace: All Uploaded Documents */
        <>
          {/* Top Controls: Mode Tabs & Quick Stats */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#D6CCB5] pb-4">
            <div className="flex flex-wrap gap-2">
              {(["merge", "split"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setFiles([]);
                  }}
                  className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7895B2] ${
                    mode === m
                      ? "border-[#000000] bg-[#000000] text-[#FFFFFF]"
                      : "border-[#D6CCB5] bg-[#FAF7F0] text-[#4A4740] hover:border-[#7895B2] hover:bg-[#FFFFFF] hover:text-[#000000]"
                  }`}
                >
                  {m === "merge" ? "Merge PDFs & Images" : "Split / Extract Pages"}
                </button>
              ))}
            </div>

            {files.length > 0 && (
              <div className="flex items-center gap-2">
                {/* View Mode Toggle: Grid Cards vs List */}
                <div className="inline-flex rounded-lg border border-[#D6CCB5] bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewType("grid")}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                      viewType === "grid" ? "bg-[#000000] text-white" : "text-black/60 hover:text-black"
                    }`}
                    title="Visual Cards View"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewType("list")}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                      viewType === "list" ? "bg-[#000000] text-white" : "text-black/60 hover:text-black"
                    }`}
                    title="Compact List View"
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>

                {/* Quick Sorting Buttons */}
                {mode === "merge" && files.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={sortByName}
                      className="rounded-lg border border-[#D6CCB5] bg-white px-2.5 py-1.5 text-xs font-semibold text-black hover:border-black transition-colors cursor-pointer shadow-xs"
                      title="Sort by file name A-Z"
                    >
                      A-Z
                    </button>
                    <button
                      type="button"
                      onClick={reverseOrder}
                      className="rounded-lg border border-[#D6CCB5] bg-white px-2.5 py-1.5 text-xs font-semibold text-black hover:border-black transition-colors cursor-pointer shadow-xs"
                      title="Reverse current sequence"
                    >
                      <ArrowUpDown className="h-3.5 w-3.5 inline mr-1" />
                      Flip
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* Initial Empty State Dropzone */}
          {files.length === 0 && (
            <Dropzone
              accept="application/pdf,image/png,image/jpeg,image/webp"
              multiple={mode === "merge"}
              label={mode === "merge" ? "Drop PDFs & images to merge" : "Drop a PDF to split"}
              onFiles={(fs) => add(fs)}
              sample={{
                label: mode === "merge" ? "Try two sample PDFs" : "Try a sample PDF",
                busy: sampling,
                onPick: async () => {
                  setSampling(true);
                  await add(
                    mode === "merge"
                      ? [
                          await dummyPdf("Quarterly Report", 3, "quarterly-report.pdf"),
                          await dummyPdf("Invoice #1042", 2, "invoice-1042.pdf"),
                        ]
                      : [await dummyPdf("Project Handbook", 4, "handbook.pdf")]
                  );
                  setSampling(false);
                },
              }}
            />
          )}

          {/* Visual Workspace after upload (iLovePDF visual gallery style) */}
          {files.length > 0 && (
            <div className="space-y-6">
              {viewType === "grid" ? (
                /* ====================================================================
                   1. VISUAL CARDS GRID (EXACT MATCH TO USER SPEC & SCREENSHOT)
                   ==================================================================== */
                <div className="rounded-3xl border border-[#D6CCB5] bg-[#FAF7F0] p-6 shadow-xs">
                  <div className="flex flex-wrap items-center gap-4 sm:gap-6 overflow-x-auto pb-2">
                    {files.map((f, i) => (
                      <div key={f.id} className="flex items-center gap-3 sm:gap-4 shrink-0">
                        {/* The Visual PDF Document Card */}
                        <div
                          onClick={() => openInnerPages(f)}
                          className="relative group w-44 sm:w-48 h-64 rounded-2xl bg-white border border-[#D6CCB5] shadow-xs hover:shadow-xl transition-all duration-200 flex flex-col justify-between p-3 select-none cursor-pointer"
                          title="Click to view and organize inner pages"
                        >
                          {/* Top Row: Checkbox & Sequence Tag */}
                          <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => toggleSelect(f.id)}
                              className={`h-5 w-5 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                                f.selected
                                  ? "bg-[#000000] border-[#000000] text-white"
                                  : "border-[#D6CCB5] bg-white hover:border-black text-transparent"
                              }`}
                              title={f.selected ? "Deselect" : "Select"}
                            >
                              <Check className="h-3 w-3 stroke-[3]" />
                            </button>

                            <span className="font-mono text-[10px] font-bold text-black/40">
                              #{i + 1}
                            </span>
                          </div>

                          {/* Document Thumbnail Preview Canvas */}
                          <div className="relative my-2 flex-1 rounded-xl overflow-hidden bg-[#18181B] border border-black/10 flex items-center justify-center group-hover:scale-[1.02] transition-transform">
                            {f.isImage ? (
                              <img
                                src={f.url}
                                alt={f.file.name}
                                className="w-full h-full object-cover transition-transform duration-200"
                                style={{ transform: `rotate(${f.rotation}deg)` }}
                              />
                            ) : (
                              <div className="relative w-full h-full p-2.5 flex flex-col justify-between bg-gradient-to-b from-[#27272A] to-[#18181B] text-white">
                                {/* Native embedded PDF first page */}
                                <object
                                  data={`${f.url}#page=1&toolbar=0&navpanes=0`}
                                  type="application/pdf"
                                  className="absolute inset-0 w-full h-full pointer-events-none opacity-85 object-cover"
                                  style={{ transform: `rotate(${f.rotation}deg)` }}
                                />
                                {/* Minimalist document sheet fallback decoration */}
                                <div className="relative z-10 flex items-center justify-between pointer-events-none">
                                  <span className="rounded bg-[#D95338] px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white uppercase shadow-xs">
                                    PDF
                                  </span>
                                  <span className="text-[10px] font-mono text-white/70">
                                    p.1
                                  </span>
                                </div>
                                <div className="relative z-10 space-y-1 my-auto pointer-events-none">
                                  <div className="h-1.5 w-3/4 rounded bg-white/40" />
                                  <div className="h-1.5 w-1/2 rounded bg-white/20" />
                                </div>
                                <div className="relative z-10 text-[9px] font-mono text-white/50 truncate pointer-events-none">
                                  {f.pages} pages
                                </div>
                              </div>
                            )}

                            {/* Hover Quick Actions Overlay Bar (iLovePDF style) */}
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 p-2" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rotate(f.id);
                                }}
                                className="h-8 w-8 rounded-full bg-white text-black hover:bg-[#E8DFCA] flex items-center justify-center shadow-md transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                                title="Rotate 90° Clockwise"
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                              </button>

                              {mode === "merge" && (
                                <>
                                  <button
                                    type="button"
                                    disabled={i === 0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      move(i, -1);
                                    }}
                                    className="h-8 w-8 rounded-full bg-white text-black hover:bg-[#E8DFCA] flex items-center justify-center shadow-md transition-transform hover:scale-110 active:scale-95 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                                    title="Move Left"
                                  >
                                    <ChevronLeft className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={i === files.length - 1}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      move(i, 1);
                                    }}
                                    className="h-8 w-8 rounded-full bg-white text-black hover:bg-[#E8DFCA] flex items-center justify-center shadow-md transition-transform hover:scale-110 active:scale-95 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                                    title="Move Right"
                                  >
                                    <ChevronRight className="h-4 w-4" />
                                  </button>
                                </>
                              )}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openInnerPages(f);
                                }}
                                className="h-8 w-8 rounded-full bg-white text-black hover:bg-[#E8DFCA] flex items-center justify-center shadow-md transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                                title="View Inner Pages"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  remove(f.id);
                                }}
                                className="h-8 w-8 rounded-full bg-[#D95338] text-white hover:bg-red-700 flex items-center justify-center shadow-md transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                                title="Delete file"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Bottom Labels (Matching user's screenshot exact pink pill!) */}
                          <div className="flex flex-col items-center">
                            <div
                              className="rounded-full bg-[#FCE4E8] text-[#9E2034] px-3 py-0.5 text-xs font-semibold truncate max-w-[145px] text-center shadow-2xs"
                              title={f.file.name}
                            >
                              {f.file.name}
                            </div>
                            <span className="mt-1 text-[11px] font-medium text-black/60 flex items-center gap-1 group-hover:text-black">
                              <Eye className="h-3 w-3 text-[#7895B2]" />
                              {f.pages} {f.pages === 1 ? "page" : "pages"} (click to view)
                              {f.rotation > 0 ? ` · ${f.rotation}°` : ""}
                            </span>
                          </div>
                        </div>

                        {/* Intermediate Circular Blue Plus Button (Matching user's screenshot!) */}
                        {mode === "merge" && (
                          <button
                            type="button"
                            onClick={() => triggerAddAt(i + 1)}
                            className="h-8 w-8 rounded-full bg-[#7895B2] hover:bg-[#5A7B9D] text-white flex items-center justify-center shadow-sm transition-transform hover:scale-110 active:scale-95 cursor-pointer shrink-0"
                            title="Insert document here"
                          >
                            <Plus className="h-4 w-4 stroke-[3]" />
                          </button>
                        )}
                      </div>
                    ))}

                    {/* Dashed Dropzone Card on Right (Matching user's screenshot!) */}
                    {mode === "merge" && (
                      <div
                        onClick={() => triggerAddAt(files.length)}
                        className="w-44 sm:w-48 h-64 rounded-2xl border-2 border-dashed border-[#7895B2] bg-white/40 hover:bg-white flex flex-col items-center justify-center p-5 text-center cursor-pointer transition-all hover:border-black hover:shadow-md active:scale-[0.99] group shrink-0"
                      >
                        <div className="h-10 w-10 rounded-full border-2 border-[#7895B2] flex items-center justify-center text-[#7895B2] group-hover:scale-110 transition-transform">
                          <Plus className="h-5 w-5 stroke-[2.5]" />
                        </div>
                        <p className="mt-4 text-xs leading-relaxed text-black/70">
                          Add <span className="font-bold text-[#3B71CA]">PDF</span>,{" "}
                          <span className="font-bold text-[#3B71CA]">image</span>, Word, Excel, and PowerPoint files
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* ====================================================================
                   2. COMPACT LIST VIEW
                   ==================================================================== */
                <div className="grid gap-2">
                  {files.map((f, i) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-3 rounded-2xl border border-[#D6CCB5] bg-[#FAF7F0] p-3 text-sm"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSelect(f.id)}
                        className={`h-5 w-5 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                          f.selected
                            ? "bg-[#000000] border-[#000000] text-white"
                            : "border-[#D6CCB5] bg-white hover:border-black text-transparent"
                        }`}
                      >
                        <Check className="h-3 w-3 stroke-[3]" />
                      </button>

                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#000000] text-xs font-bold tabular-nums text-[#FFFFFF]">
                        {i + 1}
                      </span>

                      <span className="min-w-0 flex-1 truncate font-semibold text-[#000000]">
                        {f.file.name}
                      </span>

                      <button
                        type="button"
                        onClick={() => openInnerPages(f)}
                        className="rounded-full bg-white border border-[#D6CCB5] px-2.5 py-1 text-xs font-semibold text-[#7895B2] hover:border-black hover:text-black flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="h-3 w-3" />
                        <span>{f.pages} pages</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => rotate(f.id)}
                        className="p-1.5 rounded-lg text-black hover:bg-white transition-colors cursor-pointer"
                        title="Rotate 90°"
                      >
                        <RotateCw className="h-4 w-4" />
                      </button>

                      {mode === "merge" && (
                        <>
                          <button
                            type="button"
                            aria-label={`Move ${f.file.name} up`}
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                            className="cursor-pointer rounded-lg p-1.5 text-[#000000] transition-colors hover:bg-[#FFFFFF] disabled:opacity-30 disabled:pointer-events-none"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${f.file.name} down`}
                            disabled={i === files.length - 1}
                            onClick={() => move(i, 1)}
                            className="cursor-pointer rounded-lg p-1.5 text-[#000000] transition-colors hover:bg-[#FFFFFF] disabled:opacity-30 disabled:pointer-events-none"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => setPreviewItem(f)}
                        className="cursor-pointer rounded-lg p-1.5 text-[#000000] transition-colors hover:bg-[#FFFFFF]"
                        title="Preview"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        aria-label={`Remove ${f.file.name}`}
                        onClick={() => remove(f.id)}
                        className="cursor-pointer rounded-lg p-1.5 text-[#D95338] transition-colors hover:bg-red-50"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Split Mode Options */}
              {mode === "split" && (
                <Field label="Pages to extract" hint="e.g. 1-3, 5, 8-10">
                  <input className={inputCls} value={range} onChange={(e) => setRange(e.target.value)} />
                </Field>
              )}

              {/* Bottom Action Footer Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl bg-[#000000] p-4 sm:p-5 text-white shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#7895B2]">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold">
                      {mode === "merge" ? `${files.length} Documents Ready` : files[0]?.file.name}
                    </div>
                    <div className="text-xs text-white/60 font-mono">
                      {totalPages} total pages selected · Instant local render
                    </div>
                  </div>
                </div>

                <Btn
                  busy={busy}
                  disabled={mode === "merge" && files.length < 2}
                  onClick={run}
                >
                  {mode === "merge" ? `Merge ${files.length} Files into PDF →` : "Extract Pages →"}
                </Btn>
              </div>
            </div>
          )}
        </>
      )}

      <ErrorNote msg={err} />

      {/* Fullscreen Document Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6 backdrop-blur-xs">
          <div className="relative flex flex-col max-w-3xl w-full h-[85vh] rounded-3xl bg-white overflow-hidden shadow-2xl border border-black/20">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#D6CCB5] px-6 py-4 bg-[#FAF7F0]">
              <div>
                <h3 className="font-bold text-sm text-black truncate max-w-md">
                  {previewItem.file.name}
                </h3>
                <span className="text-xs font-mono text-black/50">
                  {previewItem.pages} pages · {fmtBytes(previewItem.file.size)}
                  {previewItem.rotation > 0 ? ` · Rotated ${previewItem.rotation}°` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => rotate(previewItem.id)}
                  className="rounded-lg border border-[#D6CCB5] bg-white px-3 py-1.5 text-xs font-semibold text-black hover:border-black flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Rotate 90°
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="rounded-full p-2 text-black/70 hover:bg-black/10 hover:text-black cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Content Preview */}
            <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-[#E5E5E5]">
              {previewItem.isImage ? (
                <img
                  src={previewItem.url}
                  alt={previewItem.file.name}
                  className="max-h-full max-w-full rounded-lg shadow-lg object-contain transition-transform"
                  style={{ transform: `rotate(${previewItem.rotation}deg)` }}
                />
              ) : (
                <iframe
                  src={`${previewItem.url}#toolbar=1`}
                  className="w-full h-full rounded-lg shadow-lg border-0 bg-white"
                  title="PDF Document Preview"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
