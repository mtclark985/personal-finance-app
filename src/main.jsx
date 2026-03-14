import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { HouseholdProvider } from './context/HouseholdContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HouseholdProvider>
      <App />
    </HouseholdProvider>
  </StrictMode>,
)
