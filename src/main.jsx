import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { supabaseConfigError } from './lib/supabase'
import './index.css'

function MissingConfigScreen() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="card w-full max-w-xl p-6 space-y-3">
        <h1 className="text-lg font-bold text-slate-900">Missing local environment configuration</h1>
        <p className="text-sm text-slate-600">{supabaseConfigError}</p>
        <p className="text-sm text-slate-600">Create a local <strong>.env</strong> file by copying <strong>.env.example</strong>, then set your Supabase URL and anon key.</p>
        <pre className="text-xs bg-slate-100 rounded-lg px-3 py-2 text-slate-700 overflow-x-auto">cp .env.example .env</pre>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {supabaseConfigError ? (
      <MissingConfigScreen />
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    )}
  </React.StrictMode>
)
