import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Stamped before the first render rather than in an effect: the macOS window
// controls sit inside the content area, and shifting the header afterwards
// would be a visible jump on every launch.
document.documentElement.dataset.platform = window.alleycat?.platform ?? 'unknown'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
