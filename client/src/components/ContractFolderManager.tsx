import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type ContractFolderManagerProps = {
  onFolderDrop?: (folderName: string) => void;
  dragOverFolder?: string | null;
  onFolderDragOver?: (folderName: string) => void;
  onFolderDragLeave?: () => void;
};

export function ContractFolderManager({ onFolderDrop, dragOverFolder, onFolderDragOver, onFolderDragLeave }: ContractFolderManagerProps = {}) {
  const utils = trpc.useUtils();
  const folders = trpc.contractFolders.list.useQuery();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const create = trpc.contractFolders.create.useMutation({ onSuccess: () => { setName(""); toast.success("Папка создана"); utils.contractFolders.list.invalidate(); }, onError: e => toast.error(e.message) });
  const rename = trpc.contractFolders.rename.useMutation({ onSuccess: () => { setEditingId(null); toast.success("Папка переименована"); utils.contractFolders.list.invalidate(); utils.contracts.list.invalidate(); }, onError: e => toast.error(e.message) });
  const remove = trpc.contractFolders.remove.useMutation({ onSuccess: () => { toast.success("Папка удалена"); utils.contractFolders.list.invalidate(); }, onError: e => toast.error(e.message) });
  return <details className="mb-4 rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Управление папками договоров</summary><div className="mt-4 space-y-3"><div className="flex flex-wrap gap-2"><Input className="max-w-sm" value={name} onChange={e => setName(e.target.value)} placeholder="Название новой папки" onKeyDown={e => { if (e.key === "Enter" && name.trim()) create.mutate({ name: name.trim() }); }} /><Button size="sm" onClick={() => name.trim() && create.mutate({ name: name.trim() })} disabled={create.isPending}><Plus className="mr-2 h-4 w-4" />Создать папку</Button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(folders.data ?? []).map(folder => <div key={folder.id} data-testid={`contract-folder-drop-${folder.name}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; onFolderDragOver?.(folder.name); }} onDragLeave={onFolderDragLeave} onDrop={event => { event.preventDefault(); onFolderDrop?.(folder.name); onFolderDragLeave?.(); }} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors ${dragOverFolder === folder.name ? "border-[#c79d48] bg-[#fff6df] ring-2 ring-[#e5d7b5]" : "border-slate-200"}`}><span className="min-w-0 flex-1 truncate text-sm">{editingId === folder.id ? <Input value={editingName} onChange={e => setEditingName(e.target.value)} className="h-8" /> : folder.name}</span>{editingId === folder.id ? <span className="flex shrink-0"><Button size="icon" variant="ghost" aria-label="Сохранить название" onClick={() => editingName.trim() && rename.mutate({ id: folder.id, oldName: folder.name, name: editingName.trim() })}>✓</Button></span> : <span className="flex shrink-0"><Button size="icon" variant="ghost" aria-label={`Переименовать папку ${folder.name}`} onClick={() => { setEditingId(folder.id); setEditingName(folder.name); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label={`Удалить папку ${folder.name}`} onClick={() => window.confirm(`Удалить папку «${folder.name}»?`) && remove.mutate({ id: folder.id })}><Trash2 className="h-4 w-4 text-rose-600" /></Button></span>}</div>)}</div><p className="text-xs text-slate-500">Перетащите договор на карточку папки, чтобы перенести его. Папку с договорами сначала нужно освободить переносом, затем её можно удалить.</p></div></details>;
}
