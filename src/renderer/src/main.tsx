import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { BubbleShape } from '../../shared/types'
import { App } from './App'
import { Bubble } from './overlay/Bubble'
import { Overlay } from './overlay/Overlay'
import { Toolbar } from './overlay/Toolbar'
import './styles.css'

const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?')
const params = new URLSearchParams(query)

function pick() {
  switch (path) {
    case '/bubble':
      document.body.classList.add('floating')
      return <Bubble cameraId={params.get('cam') ?? ''} initialShape={(params.get('shape') as BubbleShape) ?? 'circle'} />
    case '/overlay':
      document.body.classList.add('floating')
      return <Overlay />
    case '/toolbar':
      document.body.classList.add('floating')
      return <Toolbar />
    default:
      return <App />
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode>{pick()}</StrictMode>)
