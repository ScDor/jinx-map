import './App.css'
import { appConfig } from './config'

function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="title">{appConfig.appName}</div>
        <div className="status">אב־טיפוס מקומי • ריענון כל {appConfig.apiPollSeconds} שנ׳</div>
      </header>
      <main className="stage" aria-label="מפה">
        <div className="placeholder">
          כאן תופיע המפה עם הפוליגונים (שלב הבא).
          <div className="hint">ה־UI מוגדר RTL (עברית בלבד).</div>
        </div>
      </main>
    </div>
  )
}

export default App
