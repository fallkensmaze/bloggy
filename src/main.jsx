import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

// Restore path after 404 redirect
const redirectPath = sessionStorage.getItem('redirectPath')
if (redirectPath) {
  sessionStorage.removeItem('redirectPath')
  window.history.replaceState(null, '', redirectPath)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
