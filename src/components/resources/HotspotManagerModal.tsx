import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { resolveResourceBinary } from "../../lib/resourceBinaryResolver";
import { ALLOWED_HOTSPOT_TYPES, detectHotspotOverlap, type HotspotDefinition, type HotspotType } from "../../lib/detailingHotspotService";
import { createManagedResourceHotspot, deactivateManagedResourceHotspot, discoverManagedResourceHotspots, updateManagedResourceHotspot } from "../../lib/resourceReadClient";
import { ControlledResourcePage, type HotspotRectangle } from "./ControlledResourcePage";

interface Props { resource: any; onClose: () => void }
const emptyRect = { xPercent: 0, yPercent: 0, widthPercent: 0, heightPercent: 0 };

export default function HotspotManagerModal({ resource, onClose }: Props) {
  const resourceId = resource.resourceId || resource.id;
  const [url, setUrl] = useState(""), [mime, setMime] = useState(""), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [hotspots, setHotspots] = useState<HotspotDefinition[]>([]), [products, setProducts] = useState<any[]>([]), [messages, setMessages] = useState<any[]>([]), [canCreate, setCanCreate] = useState(false);
  const [editing, setEditing] = useState<HotspotDefinition | null>(null), [pageNumber, setPageNumber] = useState(1), [rect, setRect] = useState<HotspotRectangle>(emptyRect);
  const [name, setName] = useState(""), [type, setType] = useState<HotspotType>("KEY_MESSAGE"), [productId, setProductId] = useState(""), [messageId, setMessageId] = useState(""), [description, setDescription] = useState(""), [saving, setSaving] = useState(false);
  const refresh = async () => { const result = await discoverManagedResourceHotspots(resourceId); setHotspots(result.hotspots); setProducts(result.products); setMessages(result.keyMessages); setCanCreate(result.canCreate); setProductId(value => value || result.products[0]?.id || ""); };
  useEffect(() => { let cancelled = false, cleanup = () => {}; setLoading(true); Promise.all([resolveResourceBinary(resource), refresh()]).then(([binary]) => { if (cancelled) return binary.cleanup(); cleanup = binary.cleanup; setUrl(binary.url); setMime(binary.mimeType); setLoading(false); }).catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : "HOTSPOT_EDITOR_LOAD_FAILED"); setLoading(false); } }); return () => { cancelled = true; cleanup(); }; }, [resourceId]);
  const current = hotspots.filter(item => item.resourceVersion === Number(resource.fileVersion)), historical = hotspots.filter(item => item.resourceVersion !== Number(resource.fileVersion) || !item.active);
  const overlaps = useMemo(() => detectHotspotOverlap(rect, current.filter(item => item.pageNumber === pageNumber), editing?.hotspotId), [current, editing, pageNumber, rect]);
  const select = (item: HotspotDefinition) => { setEditing(item); setPageNumber(item.pageNumber); setRect(item); setName(item.hotspotName); setType(item.hotspotType); setProductId(item.productId); setMessageId(item.linkedKeyMessageId || ""); setDescription(item.description || ""); };
  const reset = () => { setEditing(null); setRect(emptyRect); setName(""); setMessageId(""); setDescription(""); };
  const save = async () => { setError(""); setSaving(true); const input = { productId, pageNumber, hotspotName: name, hotspotType: type, ...rect, ...(messageId ? { linkedKeyMessageId: messageId } : {}), ...(description ? { description } : {}) }; try { if (editing) await updateManagedResourceHotspot(resourceId, editing.hotspotId, input); else await createManagedResourceHotspot(resourceId, input); await refresh(); reset(); } catch (reason) { setError(reason instanceof Error ? reason.message : "HOTSPOT_SAVE_FAILED"); } finally { setSaving(false); } };
  const filteredMessages = messages.filter(message => message.productId === productId);
  const supported = mime === "application/pdf" || mime.startsWith("image/") || /\.pdf$/i.test(resource.fileName || "");
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-3"><div className="flex max-h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-slate-900 text-white shadow-2xl">
    <div className="flex items-center justify-between border-b border-slate-700 p-4"><div><h3 className="font-bold">Manage hotspots — {resource.titleEn || resource.title}</h3><p className="text-xs text-slate-400">Resource v{resource.fileVersion}; coordinates are version-bound.</p></div><button onClick={onClose}><X /></button></div>
    {error && <div role="alert" className="m-3 rounded bg-rose-950 p-3 text-xs text-rose-200">{error}</div>}
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-3"><div className="min-h-[520px] rounded-xl bg-slate-950 p-3 lg:col-span-2">{loading ? <div className="p-8 text-center">Loading controlled preview…</div> : !supported ? <div className="p-8 text-center text-amber-300">Hotspots support PDF/document pages and images. Video timeline hotspots are deferred.</div> : <ControlledResourcePage url={url} mimeType={mime} alt={resource.fileName || resource.titleEn} hotspots={current} editable={canCreate} onPageChange={page => setPageNumber(page)} onRectangle={(page, value) => { setPageNumber(page); setRect(value); }} />}</div>
      <div className="space-y-3 overflow-y-auto"><div className="rounded-xl bg-slate-800 p-3"><h4 className="mb-2 text-xs font-bold uppercase">{editing ? "Edit hotspot" : "New hotspot"}</h4>{!canCreate ? <p className="text-xs text-amber-300">Explicit Promotion Group ownership is required for Product Manager group-wide hotspot authoring.</p> : <div className="space-y-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Hotspot name" className="w-full rounded bg-slate-950 p-2 text-xs" />
        <select value={productId} onChange={e => { setProductId(e.target.value); setMessageId(""); }} className="w-full rounded bg-slate-950 p-2 text-xs">{products.map(product => <option key={product.id} value={product.id}>{product.name || product.id}</option>)}</select>
        <select value={type} onChange={e => setType(e.target.value as HotspotType)} className="w-full rounded bg-slate-950 p-2 text-xs">{ALLOWED_HOTSPOT_TYPES.map(value => <option key={value}>{value}</option>)}</select>
        <select value={messageId} onChange={e => setMessageId(e.target.value)} className="w-full rounded bg-slate-950 p-2 text-xs"><option value="">No linked key message</option>{filteredMessages.map(message => <option key={message.id} value={message.id}>{message.message || message.messageContent || message.id}</option>)}</select>
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" className="w-full rounded bg-slate-950 p-2 text-xs" />
        <p className="text-[10px] text-slate-400">Page {pageNumber}: x {rect.xPercent.toFixed(1)}%, y {rect.yPercent.toFixed(1)}%, w {rect.widthPercent.toFixed(1)}%, h {rect.heightPercent.toFixed(1)}%</p>
        {overlaps.length > 0 && <p className="text-xs text-amber-300">Warning: overlaps {overlaps.length} active hotspot(s).</p>}
        <div className="flex gap-2"><button disabled={saving || !name || !productId || rect.widthPercent <= 0} onClick={save} className="rounded bg-indigo-600 px-3 py-2 text-xs font-bold disabled:opacity-40">{saving ? "Saving…" : editing ? "Update" : "Create"}</button>{editing && <button onClick={reset} className="rounded bg-slate-700 px-3 py-2 text-xs">Cancel</button>}</div>
      </div>}</div>
      <div className="rounded-xl bg-slate-800 p-3"><h4 className="mb-2 text-xs font-bold uppercase">Current definitions</h4>{current.filter(item => item.active).map(item => <div key={item.hotspotId} className="mb-2 rounded bg-slate-950 p-2 text-xs"><button onClick={() => select(item)} className="font-bold text-indigo-300">{item.hotspotName}</button><span className="ml-2 text-slate-400">p{item.pageNumber} · {item.productId}</span><button onClick={async () => { await deactivateManagedResourceHotspot(resourceId, item.hotspotId); await refresh(); }} className="float-right text-rose-300">Deactivate</button></div>)}</div>
      {historical.length > 0 && <div className="rounded-xl bg-slate-800 p-3"><h4 className="mb-2 text-xs font-bold uppercase">Inactive / historical</h4>{historical.map(item => <p key={item.hotspotId} className="text-xs text-slate-400">{item.hotspotName} · resource v{item.resourceVersion} · {item.active ? "historical" : "inactive"}</p>)}</div>}
    </div></div>
  </div></div>;
}
