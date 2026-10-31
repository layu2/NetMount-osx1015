import { useState } from 'react'
import { createStorage } from '../controller/storage/create'
import { updateRcloneStorageInfoList } from '../controller/storage/framework/rclone/providers'
import { StorageInfoType, StorageParamItemType } from '../type/controller/storage/info'
import { ParametersType } from '../type/defaults'
import { delStorage, getStorageParams, renameStorage, searchStorage } from '../services/storage/StorageManager'
import { StorageList } from '../type/rclone/rcloneInfo'

type Props = { storageList: StorageList[]; refreshing: boolean; error: string; onRefresh: () => Promise<void>; ensureReady: () => Promise<void> }

export default function StorageManagerPanel({ storageList, refreshing, error, onRefresh, ensureReady }: Props) {
  const [providers, setProviders] = useState<StorageInfoType[]>([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [mode, setMode] = useState<'closed' | 'add' | 'edit'>('closed')
  const [selectedType, setSelectedType] = useState('')
  const [storageName, setStorageName] = useState('')
  const [params, setParams] = useState<ParametersType>({})
  const [originalParams, setOriginalParams] = useState<ParametersType>({})
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [renameTarget, setRenameTarget] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState('')
  const visible = storageList.filter(item => !item.hide)
  const selected = providers.find(item => item.type === selectedType)

  const loadProviders = async () => {
    setProvidersLoading(true)
    setFormError('')
    try {
      const list = await Promise.race([
        updateRcloneStorageInfoList(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('读取网盘类型超时，请确认 rclone 服务正常后重试')), 15000)),
      ])
      if (!list.length) throw new Error('rclone 未返回可用的网盘类型，请检查 rclone 服务和日志')
      setProviders(list)
      setSelectedType(current => list.some(item => item.type === current) ? current : list[0]!.type)
      setParams(current => Object.keys(current).length ? current : Object.fromEntries(list[0]!.defaultParams.parameters.map(p => [p.name, p.default])) as ParametersType)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setProvidersLoading(false)
    }
  }
  const openAdd = () => {
    setProviders([]); setSelectedType(''); setStorageName(''); setParams({}); setOriginalParams({}); setAdvanced(false); setFormError(''); setMode('add')
    void (async () => {
      setBusy(true)
      try { await ensureReady(); await loadProviders() }
      catch (e) { setFormError(e instanceof Error ? e.message : String(e)) }
      finally { setBusy(false) }
    })()
  }
  const openEdit = async (name: string, type: string) => {
    setBusy(true); setFormError('')
    try {
      await ensureReady()
      const list = await updateRcloneStorageInfoList()
      setProviders(list)
      if (!list.some(item => item.type === type)) throw new Error('当前 rclone 版本未提供该网盘类型')
      const values = await getStorageParams(name)
      setSelectedType(type); setStorageName(name); setParams(values); setOriginalParams(values); setMode('edit')
    } catch (e) { setFormError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const changeType = (type: string) => {
    const provider = providers.find(item => item.type === type)
    setSelectedType(type)
    setParams(Object.fromEntries((provider?.defaultParams.parameters || []).map(p => [p.name, p.default])) as ParametersType)
  }
  const save = async () => {
    if (!selected) return
    if (!storageName.trim() || /[<>:"|?*/\\]/.test(storageName)) { setFormError('网盘名称为空或包含非法字符'); return }
    if (mode === 'add' && searchStorage(storageName)) { setFormError('网盘名称已存在'); return }
    setBusy(true); setFormError('')
    try {
      const values = { ...params }
      if (mode === 'edit') for (const key of Object.keys(values)) {
        if (originalParams[key] === values[key] && selected.defaultParams.parameters.find(p => p.name === key)?.isPassword) delete values[key]
      }
      if (!await createStorage(storageName.trim(), selected.type, values)) throw new Error('保存失败，请检查连接参数和 rclone 日志')
      setMode('closed'); await onRefresh()
    } catch (e) { setFormError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const doRename = async () => {
    if (!renameValue.trim() || /[<>:"|?*/\\]/.test(renameValue)) { setFormError('名称为空或包含非法字符'); return }
    setBusy(true); setFormError('')
    try {
      if (!await renameStorage(renameTarget, renameValue.trim())) throw new Error('重命名失败')
      setRenameTarget(''); await onRefresh()
    } catch (e) { setFormError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const doDelete = async () => {
    const target = deleteTarget
    if (!target) return
    setBusy(true); setFormError('')
    try { await delStorage(target); setDeleteTarget(''); await onRefresh() }
    catch (e) { setFormError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const field = (item: StorageParamItemType) => {
    const value = params[item.name] ?? item.default ?? ''
    const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setParams(old => ({ ...old, [item.name]: item.type === 'number' ? Number(e.target.value) : e.target.value }))
    return <label className="nm-form-field" key={item.name}><span>{item.label}{item.required ? ' *' : ''}</span>{item.description && <small>{item.description}</small>}
      {item.type === 'boolean' ? <input type="checkbox" checked={Boolean(value)} disabled={busy} onChange={e => setParams(old => ({ ...old, [item.name]: e.target.checked }))} /> :
       item.select?.length ? <select value={String(value)} disabled={busy} onChange={onChange}>{item.select.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select> :
       <input value={String(value)} disabled={busy} onChange={onChange} type={item.isPassword ? 'password' : item.type === 'number' ? 'number' : 'text'} />}
    </label>
  }
  return <section className="nm-content">
    <div className="nm-storage-head"><div><h1>网盘管理</h1><p className="nm-sub">管理 rclone 网盘连接。OpenList 尚未接入本页。</p></div><div className="nm-actions"><button className="nm-primary" disabled={busy} onClick={openAdd}>添加网盘</button><button className="nm-refresh" disabled={refreshing || busy} onClick={onRefresh}>{refreshing ? '正在刷新…' : '刷新列表'}</button></div></div>
    {error && <div className="nm-storage-error">{error}</div>}{formError && <div className="nm-storage-error">{formError}</div>}
    <div className="nm-storage-list">{visible.map(item => <div className="nm-storage-row" key={item.framework + ':' + item.name}><span className="nm-storage-cloud">☁</span><div className="nm-storage-meta"><b>{item.name}</b><small>{item.framework} · {item.type}</small></div><span className="nm-storage-space">{item.space && item.space.total > 0 ? (item.space.total / 1024 / 1024 / 1024).toFixed(1) + ' GB 总量' : '容量暂不可用'}</span>{item.framework === 'rclone' && <div className="nm-row-actions"><button onClick={() => openEdit(item.name, item.type)} disabled={busy}>编辑</button><button onClick={() => {setRenameTarget(item.name);setRenameValue(item.name)}} disabled={busy}>重命名</button><button className="nm-danger" onClick={() => setDeleteTarget(item.name)} disabled={busy}>删除</button></div>}</div>)}{visible.length === 0 && <div className="nm-storage-empty">尚未加载网盘列表。点击“刷新列表”连接本机 rclone 服务。</div>}</div>
    <div className="nm-storage-safe">安全说明：刷新不会自动清理 .netmount-* 内部配置；本页仅管理 rclone 网盘，OpenList 服务不会被自动启动。</div>
    {mode !== 'closed' && <div className="nm-overlay"><div className="nm-dialog"><h2>{mode === 'add' ? '添加网盘' : '编辑网盘'}</h2>{mode === 'add' && <><label className="nm-form-field"><span>网盘类型</span><select value={selectedType} disabled={busy || providersLoading || providers.length === 0} onChange={e => changeType(e.target.value)}>{providers.length === 0 && <option value="">{providersLoading || busy ? '正在读取网盘类型…' : '暂无可用类型'}</option>}{providers.map(p => <option key={p.type} value={p.type}>{p.label.replace('storage.','')} · {p.type}</option>)}</select></label>{(providersLoading || busy) && <div className="nm-storage-safe">正在连接本机 rclone 并读取支持的网盘类型…</div>}{formError && <div className="nm-storage-error">{formError}<button onClick={() => { setBusy(true); void (async () => { try { await ensureReady(); await loadProviders() } catch (e) { setFormError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } })() }} disabled={busy}>重试</button></div>}</>}<label className="nm-form-field"><span>网盘名称</span><input value={storageName} disabled={mode === 'edit' || busy} onChange={e => setStorageName(e.target.value)} /></label><div className="nm-form-grid">{(selected?.defaultParams.parameters || []).filter(p => !p.hide && (advanced || !p.advanced)).map(field)}</div><button className="nm-text-action" onClick={() => setAdvanced(v => !v)}>{advanced ? '收起高级参数' : '显示高级参数'}</button><div className="nm-dialog-actions"><button onClick={() => setMode('closed')} disabled={busy}>取消</button><button className="nm-primary" onClick={save} disabled={busy || providersLoading || (mode === 'add' && !selected)}>{busy ? '正在加载…' : '保存'}</button></div></div></div>}
    {renameTarget && <div className="nm-overlay"><div className="nm-dialog nm-dialog-small"><h2>重命名网盘</h2><label className="nm-form-field"><span>新名称</span><input value={renameValue} onChange={e => setRenameValue(e.target.value)} /></label><div className="nm-dialog-actions"><button onClick={() => setRenameTarget('')} disabled={busy}>取消</button><button className="nm-primary" onClick={doRename} disabled={busy}>确认重命名</button></div></div></div>}
    {deleteTarget && <div className="nm-overlay"><div className="nm-dialog nm-dialog-small"><h2>确认删除</h2><p>确定删除网盘“{deleteTarget}”？此操作会同时移除引用它的挂载配置，且无法自动撤销。</p><div className="nm-dialog-actions"><button onClick={() => setDeleteTarget('')} disabled={busy}>取消</button><button className="nm-danger-button" onClick={doDelete} disabled={busy}>{busy ? '正在删除…' : '确认删除'}</button></div></div></div>}
  </section>
}
