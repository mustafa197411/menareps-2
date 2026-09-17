import React, { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { HotspotDefinition } from "../../lib/detailingHotspotService";

export interface HotspotRectangle { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number }
interface Props {
  url: string;
  mimeType: string;
  alt: string;
  hotspots?: HotspotDefinition[];
  editable?: boolean;
  onRectangle?: (pageNumber: number, rectangle: HotspotRectangle) => void;
  onHotspotActivate?: (hotspot: HotspotDefinition) => void;
  onPageChange?: (page: number, total: number) => void;
  onReady?: () => void;
}

export function ControlledResourcePage({ url, mimeType, alt, hotspots = [], editable = false, onRectangle, onHotspotActivate, onPageChange, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null), surfaceRef = useRef<HTMLDivElement>(null);
  const onPageChangeRef = useRef(onPageChange), onReadyRef = useRef(onReady);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [page, setPage] = useState(1), [total, setTotal] = useState(1), [error, setError] = useState("");
  const [start, setStart] = useState<{ x: number; y: number } | null>(null), [draft, setDraft] = useState<HotspotRectangle | null>(null);
  const isPdf = mimeType === "application/pdf" || /\.pdf(?:$|[?#])/i.test(alt);

  useEffect(() => { onPageChangeRef.current = onPageChange; onReadyRef.current = onReady; }, [onPageChange, onReady]);
  useEffect(() => { setError(""); }, [mimeType, url]);

  useEffect(() => {
    if (!isPdf) { setPdf(null); setPage(1); setTotal(1); return; }
    let disposed = false, destroy = () => {};
    void import("pdfjs-dist").then(({ GlobalWorkerOptions, getDocument }) => {
      GlobalWorkerOptions.workerSrc = workerUrl;
      const task = getDocument({ url }); destroy = () => { void task.destroy(); };
      return task.promise;
    }).then(document => { if (!document) return; if (disposed) return void document.cleanup(); setPdf(document); setTotal(document.numPages); setPage(1); setError(""); }).catch(() => { if (!disposed) setError("Unable to render this PDF."); });
    return () => { disposed = true; destroy(); };
  }, [isPdf, url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false, render: RenderTask | null = null;
    void pdf.getPage(page).then(pdfPage => {
      if (cancelled || !canvasRef.current) return;
      const viewport = pdfPage.getViewport({ scale: 1.5 }), canvas = canvasRef.current, context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width; canvas.height = viewport.height;
      render = pdfPage.render({ canvas, canvasContext: context, viewport });
      return render.promise;
    }).then(() => { if (!cancelled) { onPageChangeRef.current?.(page, total); if (page === 1) onReadyRef.current?.(); } }).catch(reason => { if (!cancelled && reason?.name !== "RenderingCancelledException") setError("Unable to render this PDF page."); });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, page, total]);

  const point = (event: React.PointerEvent) => { const box = surfaceRef.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - box.top) / box.height) * 100)) }; };
  const down = (event: React.PointerEvent) => { if (!editable) return; event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); setStart(p); setDraft({ xPercent: p.x, yPercent: p.y, widthPercent: 0, heightPercent: 0 }); };
  const move = (event: React.PointerEvent) => { if (!editable || !start) return; const p = point(event); setDraft({ xPercent: Math.min(start.x, p.x), yPercent: Math.min(start.y, p.y), widthPercent: Math.abs(p.x - start.x), heightPercent: Math.abs(p.y - start.y) }); };
  const up = () => { if (draft && draft.widthPercent >= .5 && draft.heightPercent >= .5) onRectangle?.(page, draft); setStart(null); setDraft(null); };
  const visible = hotspots.filter(item => item.active && item.pageNumber === page);

  return <div className="flex h-full min-h-0 flex-col gap-2">
    {isPdf && <div className="flex items-center justify-center gap-3 text-xs font-semibold"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded bg-slate-700 px-3 py-1 disabled:opacity-40">Previous</button><span>Page {page} / {total}</span><button type="button" disabled={page >= total} onClick={() => setPage(value => value + 1)} className="rounded bg-slate-700 px-3 py-1 disabled:opacity-40">Next</button></div>}
    {error ? <div role="alert" className="p-6 text-center text-rose-300">{error}</div> : <div ref={surfaceRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} className={`relative mx-auto min-h-0 max-h-full max-w-full touch-none overflow-hidden ${editable ? "cursor-crosshair" : ""}`}>
      {isPdf ? <canvas ref={canvasRef} className="block max-h-[65vh] max-w-full" aria-label={alt} /> : <img src={url} alt={alt} draggable={false} onLoad={onReady} onError={() => setError("Unable to render this image.")} className="block max-h-[65vh] max-w-full object-contain" />}
      {visible.map(item => <button type="button" key={item.hotspotId} aria-label={item.hotspotName} title={item.hotspotName} onPointerDown={event => event.stopPropagation()} onClick={() => onHotspotActivate?.(item)} style={{ left: `${item.xPercent}%`, top: `${item.yPercent}%`, width: `${item.widthPercent}%`, height: `${item.heightPercent}%` }} className="absolute border-2 border-amber-400 bg-amber-300/20 hover:bg-amber-300/35 focus:outline-none focus:ring-2 focus:ring-amber-200" />)}
      {draft && <div style={{ left: `${draft.xPercent}%`, top: `${draft.yPercent}%`, width: `${draft.widthPercent}%`, height: `${draft.heightPercent}%` }} className="pointer-events-none absolute border-2 border-dashed border-cyan-300 bg-cyan-300/20" />}
    </div>}
  </div>;
}
