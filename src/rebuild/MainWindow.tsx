import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { init } from '../controller/main'
import './main-window.css'

type Page = 'home' | 'storage' | 'mount' | 'transmit' | 'task' | 'setting'
type StartupState = 'starting' | 'ready' | 'error'

// Keep initialization single-flight across component remounts (including React development remounts).
let initialization: Promise<void> | undefined

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
  const [startupState, setStartupState] = useState<StartupState>('starting')
  const [startupMessage, setStartupMessage] = useState('正在初始化应用…')
  const [startupError, setStartupError] = useState('')

  useEffect(() => {
    let alive = true
    if (!initialization) {
      initialization = init(message => {
        if (alive) setStartupMessage(message)
      })
    }
    initialization.then(() => {
      if (alive) setStartupState('ready')
    }).catch(error => {
      if (!alive) return
      const message = error instanceof Error ? error.message : String(error)
      setStartupError(message)
      setStartupState('error')
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (startupState !== 'ready') return
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
  }, [startupState])

  const active = pages.find(p => p.id === page) ?? {
    id: 'home' as Page, label: '首页', icon: '⌂', desc: '运行状态与快捷入口',
  }

  return <div className="nm-shell">
    {startupState !== 'ready' && <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', background: '#f5f7fa', color: '#253044', padding: 24 }}>
      <div style={{ width: 'min(460px, 100%)', padding: 32, borderRadius: 16, background: '#fff', boxShadow: '0 12px 40px rgba(20,35,60,.10)' }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>NetMount 正在启动</div>
        {startupState === 'starting' ? <div style={{ color: '#667085' }}>{startupMessage}</div> : <>
          <div style={{ color: '#b42318', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 18 }}>{startupError}</div>
          <div style={{ color: '#667085', fontSize: 13, marginBottom: 18 }}>初始化可能已启动部分后台组件。请重新加载窗口以进行一次干净的启动，不要连续重复点击初始化。</div>
          <button onClick={() => window.location.reload()} style={{ padding: '9px 16px', border: 0, borderRadius: 8, background: '#315efb', color: '#fff', cursor: 'pointer' }}>重新加载并重试</button>
        </>}
      </div>
    </div>}
    <aside className="nm-sidebar">
      <div className="nm-brand"><div className="nm-logo">N</div><div><b>NetMount</b><small>云存储管理</small></div></div>
      <div className="nm-caption">工作空间</div>
      <nav>{pages.map(p => <button key={p.id} className={'nm-nav'+(page===p.id?' selected':'')} onClick={() => setPage(p.id)}><span>{p.icon}</span>{p.label}</button>)}</nav>
      <div className="nm-foot"><i />{startupState === 'ready' ? '应用已就绪' : '正在初始化'}</div>
    </aside>
    <main className="nm-main">
      <header><div><small>NETMOUNT WORKSPACE</small><strong>{active.label}</strong></div><span>NetMount · 1.2.4</span></header>
      {page === 'home' ? <section className="nm-content">
        <div className="nm-hero"><small>PERSONAL CLOUD HUB</small><h1>管理你的云存储，<br/>从这里开始。</h1><p>统一管理网盘连接、本地挂载与文件传输。</p><div className="nm-orbit"><b>N</b></div></div>
        <h2>快捷入口</h2><p className="nm-sub">选择一个模块继续操作</p>
        <div className="nm-grid">{pages.slice(1).map(p=><button key={p.id} onClick={()=>setPage(p.id)}><i>{p.icon}</i><b>{p.label}</b><small>{p.desc}</small><em>→</em></button>)}</div>
        <div className="nm-notice"><i/>主窗口已启动，原有业务模块正在逐步接回。</div>
      </section> : <section className="nm-content"><div className="nm-panel"><i>{active.icon}</i><small>MODULE</small><h1>{active.label}</h1><p>{active.desc}</p><hr/><div>主窗口已正常运行。此模块的原有业务操作尚未接入，当前不会执行可能影响网盘数据的操作。</div><button onClick={()=>setPage('home')}>返回首页</button></div></section>}
    </main>
  </div>
}
export default MainWindow
