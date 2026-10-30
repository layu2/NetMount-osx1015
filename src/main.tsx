import ReactDOM from 'react-dom/client'
import './services/i18n'
import './index.css'
import MainWindow from './rebuild/MainWindow'

const container = document.getElementById('root')
if (!container) throw new Error('NetMount root element was not found')
ReactDOM.createRoot(container).render(<MainWindow />)
