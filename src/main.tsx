import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import EnvironmentBanner from './components/EnvironmentBanner.tsx'
import { installGlobalErrorHandlers } from './lib/errorReporting.ts'

// Reports uncaught errors and unhandled promise rejections (errors thrown while rendering are
// caught by the ErrorBoundary below).
installGlobalErrorHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <EnvironmentBanner />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 14,
            borderRadius: 10,
          }
        }}
      />
    </BrowserRouter>
  </StrictMode>,
)