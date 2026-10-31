import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { runtimeEnv, readNmConfig, configService } from '../services/ConfigService'
import { rcloneInfo } from '../services/rclone'
import { getOsInfo } from '../utils/tauri/osInfo'
import { defaultCacheDir } from '../utils/netmountPaths'
import { startRclone } from '../utils/rclone/process'
import { rclone_api_noop } from '../utils/rclone/request'
import { reupStorage } from '../services/storage/StorageManager'
import { useStorageStore } from '../stores/storageStore'
import StorageManagerPanel from './StorageManagerPanel'
import MountManagerPanel from './MountManagerPanel'
import './main-window.css'

type Page = 'home' | 'storage' | 'mount' | 'transmit' | 'task' | 'setting'
const pages: { id: Page; label: string; icon: string; desc: string }[] = [
  { id: 'home', label: '首页', icon: '⌂', desc: '运行状态与快捷入口' },
  { id: 'storage', label: '网盘管理', icon: '☁', desc: '添加、管理云存储连接' },
  { id: 'mount', label: '挂载管理', icon: '▣', desc: '管理本地挂载点' },
  { id: 'transmit', label: '传输中心', icon: '⇅', desc: '查看文件传输任务' },
  { id: 'task', label: '任务计划', icon: '▤', desc: '管理自动化任务' },
  { id: 'setting', label: '设置', icon: '⚙', desc: '应用偏好与系统设置' },
]
function MainWindow() {
  const [page, setPage] = useState<Page>('home')
  const [refreshing, setRefreshing] = useState(false)
  const [storageError, setStorageError] = useState('')
  const storageList = useStorageStore(state => state.storageList)
  const prepareRclone = async () => {
    if (!configService.getCacheDir()) configService.setCacheDir(defaultCacheDir())
    const cacheDir = configService.getCacheDir()
    if (!cacheDir) throw new Error('缓存目录未配置')
    // Do not call the Rust fs_make_dir command for cacheDir: its production
    // path guard only permits the app data directory, while the default cache
    // directory is ~/.cache/netmount. startRclone creates its own subfolders.
    if (rcloneInfo.process.child) {
      if (!(await rclone_api_noop())) throw new Error('检测到 rclone 进程记录，但服务未响应；为避免影响现有进程，本次不会自动重启')
    } else {
      await startRclone()
    }
    if (!(await rclone_api_noop())) throw new Error('rclone 服务启动后未能通过就绪检查')
  }
  const refreshStorages = async () => {
    if (refreshing) return
    setRefreshing(true)
    setStorageError('')
    let step = '准备系统环境'
    try {
      runtimeEnv.path.homeDir = await homeDir()
      step = '读取系统信息'
      await getOsInfo()
      step = '读取应用配置'
      await readNmConfig()
      step = '准备 rclone 服务'
      await prepareRclone()
      step = '读取网盘列表'
      await reupStorage({ cleanupInvalidInternalStorages: false, includeOpenList: false, strictRclone: true })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setStorageError(`${step}失败：${detail}`)
    } finally {
      setRefreshing(false)
    }
  }
  useEffect(() => {
    let alive = true
    let off1: (() => void) | undefined
    let off2: (() => void) | undefined
    listen<string>('netmount://navigate', e => {
      if (!alive) return
      const p = e.payload
      if (p.indexOf('/storage') === 0) setPage('storage')
      else if (p.indexOf('/mount') === 0) setPage('mount')
      else if (p.indexOf('/transmit') === 0) setPage('transmit')
      else if (p.indexOf('/task') === 0) setPage('task')
      else if (p.indexOf('/setting') === 0) setPage('setting')
      else setPage('home')
    }).then(fn => { if (alive) off1 = fn; else fn() }).catch(() => {})
    listen('netmount://add-storage', () => { if (alive) setPage('storage') })
      .then(fn => { if (alive) off2 = fn; else fn() }).catch(() => {})
    return () => { alive = false; if (off1) off1(); if (off2) off2() }
  }, [])
  const active = pages.find(p => p.id === page) ?? {
    id: 'home' as Page, label: '首页', icon: '⌂', desc: '运行状态与快捷入口',
  }
  return <div className="nm-shell">
    <aside className="nm-sidebar">
      <div className="nm-brand"><div className="nm-logo">N</div><div><b>NetMount</b><small>云存储管理</small></div></div>
      <div className="nm-caption">工作空间</div>
      <nav>{pages.map(p => <button key={p.id} className={'nm-nav'+(page===p.id?' selected':'')} onClick={() => setPage(p.id)}><span>{p.icon}</span>{p.label}</button>)}</nav>
      <div className="nm-foot"><i />应用界面已启动</div>
    </aside>
    <main className="nm-main">
      <header><div><small>NETMOUNT WORKSPACE</small><strong>{active.label}</strong></div><span>NetMount · 1.2.4</span></header>
      {page === 'storage' ? <StorageManagerPanel storageList={storageList} refreshing={refreshing} error={storageError} onRefresh={refreshStorages} ensureReady={prepareRclone} /> : page === 'mount' ? <MountManagerPanel ensureReady={prepareRclone} /> : page === 'home' ? <section className="nm-content">
        <div className="nm-hero"><small>PERSONAL CLOUD HUB</small><h1>管理你的云存储，<br/>从这里开始。</h1><p>统一管理网盘连接、本地挂载与文件传输。</p><div className="nm-orbit"><b>N</b></div></div>
        <h2>快捷入口</h2><p className="nm-sub">选择一个模块继续操作</p>
        <div className="nm-grid">{pages.slice(1).map(p=><button key={p.id} onClick={()=>setPage(p.id)}><i>{p.icon}</i><b>{p.label}</b><small>{p.desc}</small><em>→</em></button>)}</div>
        <div className="nm-notice"><i/>主窗口已独立启动，业务模块正在逐步接回原有功能。</div>
      </section> : <section className="nm-content"><div className="nm-panel"><i>{active.icon}</i><small>MODULE</small><h1>{active.label}</h1><p>{active.desc}</p><hr/><div>全新主窗口已正常运行。此模块的原有业务操作尚未接入，当前不会执行可能影响网盘数据的操作。</div><button onClick={()=>setPage('home')}>返回首页</button></div></section>}
    </main>
  </div>
}
export default MainWindow
