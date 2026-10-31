import { useState } from 'react'
import { nmConfig } from '../services/ConfigService'
import { rcloneInfo } from '../services/rclone'
import { addMountStorage, delMountStorage, getMountStorage, mountStorage, reupMount, unmountStorage } from '../controller/storage/mount/mount'
import type { VfsOptions, MountOptions } from '../type/rclone/storage/mount/parameters'

type Props = { ensureReady: () => Promise<void> }
export default function MountManagerPanel({ ensureReady }: Props) {
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [storageName, setStorageName] = useState('')
  const [mountPath, setMountPath] = useState('')
  const [autoMount, setAutoMount] = useState(false)
  const configs = nmConfig.mount?.lists || []
  const mounted = rcloneInfo.mountList || []
  const reload = async () => { await reupMount(); setRevision(v => v + 1) }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await ensureReady(); await action(); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const add = async () => {
    if (!storageName) { setError('请选择要挂载的网盘'); return }
    if (!mountPath.trim()) { setError('请输入本地挂载目录'); return }
    await run(async () => {
      const params = { vfsOpt: {} as VfsOptions, mountOpt: {} as MountOptions }
      const ok = await addMountStorage(storageName, mountPath.trim(), params, autoMount)
      if (!ok) throw new Error('该挂载目录已存在，请换一个目录')
      setShowAdd(false); setStorageName(''); setMountPath(''); setAutoMount(false)
    })
  }
  const actual = (path: string) => mounted.some(item => item.mountPath === path)
  void revision
  return <section className="nm-content">
    <div className="nm-storage-head"><div><h1>挂载管理</h1><p className="nm-sub">将已配置的网盘映射到本机目录。添加配置后可手动挂载。</p></div><div className="nm-actions"><button className="nm-primary" disabled={busy} onClick={() => setShowAdd(true)}>添加挂载</button><button className="nm-refresh" disabled={busy} onClick={() => run(async () => {})}>刷新状态</button></div></div>
    {error && <div className="nm-storage-error">{error}</div>}
    <div className="nm-storage-list">{configs.map(item => <div className="nm-storage-row nm-mount-row" key={item.mountPath}><span className="nm-storage-cloud">▣</span><div className="nm-storage-meta"><b>{item.mountPath}</b><small>{item.storageName} · {actual(item.mountPath) ? '已挂载' : '未挂载'}</small></div><div className="nm-row-actions">{actual(item.mountPath) ? <button className="nm-danger" disabled={busy} onClick={() => run(async () => { if (!await unmountStorage(item.mountPath)) throw new Error('卸载失败') })}>卸载</button> : <button className="nm-primary" disabled={busy} onClick={() => run(async () => { const config = getMountStorage(item.mountPath); if (!config || !await mountStorage(config)) throw new Error('挂载失败，请检查目录权限及 rclone 日志') })}>挂载</button>}<button disabled={busy || actual(item.mountPath)} onClick={() => run(async () => { await delMountStorage(item.mountPath) })}>删除配置</button></div></div>)}{configs.length === 0 && <div className="nm-storage-empty">暂无挂载配置。添加挂载后，可在此处手动挂载或卸载。</div>}</div>
    <div className="nm-storage-safe">状态说明：已挂载状态根据 rclone 当前挂载列表判断。删除配置前请先卸载；本页不会自动挂载已有配置。</div>
    {showAdd && <div className="nm-overlay"><div className="nm-dialog nm-dialog-small"><h2>添加挂载配置</h2><label className="nm-form-field"><span>网盘</span><select value={storageName} onChange={e => setStorageName(e.target.value)}><option value="">请选择网盘</option>{rcloneInfo.storageList.filter(item => !item.hide).map(item => <option key={item.name} value={item.name}>{item.name} ({item.framework})</option>)}</select></label><label className="nm-form-field"><span>本地挂载目录</span><input value={mountPath} onChange={e => setMountPath(e.target.value)} placeholder="/Volumes/CloudDrive" /></label><label className="nm-check-field"><input type="checkbox" checked={autoMount} onChange={e => setAutoMount(e.target.checked)} /> 应用启动时自动挂载</label><p>当前先使用 rclone 默认 VFS 与挂载参数。建议选择一个已存在且为空的本地目录。</p><div className="nm-dialog-actions"><button onClick={() => setShowAdd(false)} disabled={busy}>取消</button><button className="nm-primary" onClick={add} disabled={busy}>{busy ? '正在保存…' : '保存配置'}</button></div></div></div>}
  </section>
}
