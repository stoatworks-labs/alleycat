import { useEffect, useState, useCallback } from 'react'
import type { Config, Job, Status } from '@shared/types'

declare const __APP_VERSION__: string

type Tab = 'folders' | 'arena' | 'queue' | 'show' | 'log'

interface LogLine {
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

const RUNNING: Job['state'][] = ['queued', 'probing', 'transcoding', 'replacing']

function pillClass(state: Job['state']): string {
  if (state === 'failed') return 'pill fail'
  if (state === 'done' || state === 'skipped') return 'pill done'
  if (RUNNING.includes(state) || state === 'transcoded') return 'pill run'
  return 'pill'
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString()
}

/**
 * Shown when the preload bridge is missing.
 *
 * v0.1.0-preview.1 rendered a completely blank window because the preload
 * script failed to load and the first `window.alleycat` call threw. A blank
 * window tells nobody anything; this at least names the failure.
 */
function BridgeMissing(): React.JSX.Element {
  return (
    <main>
      <div className="card">
        <h2>Alleycat could not start</h2>
        <p className="hint">
          The preload bridge did not load, so the window cannot talk to the rest of the app. This is
          a packaging fault rather than something you can fix in settings.
        </p>
        <p className="hint" style={{ marginBottom: 0 }}>
          Please report it at <code>github.com/stoatworks-labs/alleycat/issues</code>, including
          your OS and how you installed Alleycat.
        </p>
      </div>
    </main>
  )
}

export default function App(): React.JSX.Element {
  // Read once, before any hook can call through it.
  const bridge = typeof window !== 'undefined' ? window.alleycat : undefined
  const [tab, setTab] = useState<Tab>('folders')
  const [config, setConfig] = useState<Config | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  const [arenaTest, setArenaTest] = useState<string>('')

  useEffect(() => {
    if (!bridge) return
    void bridge.getConfig().then(setConfig)
    void bridge.getStatus().then((s) => s && setStatus(s))
    void bridge.getLog().then(setLines)
    const offStatus = bridge.onStatus(setStatus)
    const offLog = bridge.onLog((l) => setLines((prev) => [...prev.slice(-499), l]))
    return () => {
      offStatus()
      offLog()
    }
  }, [bridge])

  const patch = useCallback(async (p: Partial<Config>): Promise<void> => {
    setConfig(await window.alleycat.setConfig(p))
  }, [])

  if (!bridge) return <BridgeMissing />
  if (!config) return <div className="empty">Loading…</div>

  const jobs = status?.jobs ?? []
  const active = jobs.filter((j) => RUNNING.includes(j.state)).length

  return (
    <>
      <header>
        <h1>Alleycat</h1>
        <span className="version">{__APP_VERSION__}</span>
        <span className="spacer" />
      </header>

      <nav>
        {(['folders', 'arena', 'queue', 'show', 'log'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'show' ? 'Show scan' : t[0].toUpperCase() + t.slice(1)}
            {t === 'queue' && active > 0 ? ` (${active})` : ''}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'folders' && <FoldersTab config={config} patch={patch} />}
        {tab === 'arena' && (
          <ArenaTab
            config={config}
            patch={patch}
            status={status}
            testResult={arenaTest}
            setTestResult={setArenaTest}
          />
        )}
        {tab === 'queue' && <QueueTab jobs={jobs} />}
        {tab === 'show' && <ShowTab status={status} />}
        {tab === 'log' && <LogTab lines={lines} />}
      </main>

      <div className="status-strip">
        <span>
          <span className={`dot ${status?.arenaConnected ? 'on' : ''}`} />
          {status?.arenaConnected ? status.arenaProduct : 'Arena not connected'}
        </span>
        <span>{active === 0 ? 'Idle' : `${active} in progress`}</span>
        <span>{config.paused ? 'Paused' : 'Running'}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span>{status?.lastScanAt ? `Last scan ${timeOf(status.lastScanAt)}` : 'No scan yet'}</span>
      </div>
    </>
  )
}

function FoldersTab({
  config,
  patch
}: {
  config: Config
  patch: (p: Partial<Config>) => Promise<void>
}): React.JSX.Element {
  // Presets are read from the Alley install and from the user's own preset
  // folder, so a saved preset shows up here without Alleycat knowing about it.
  const [presets, setPresets] = useState<string[]>([])
  useEffect(() => {
    void window.alleycat.listPresets().then(setPresets)
  }, [config.alleyPath])

  const addFolder = async (): Promise<void> => {
    const dir = await window.alleycat.pickFolder()
    if (dir && !config.watchFolders.includes(dir)) {
      await patch({ watchFolders: [...config.watchFolders, dir] })
    }
  }

  return (
    <>
      <div className="card">
        <h2>Watched folders</h2>
        <p className="hint">
          Anything dropped in here is probed and, if it is not already DXV, converted. Files are
          left alone until they stop growing, so copying onto a show drive is safe.
        </p>
        <ul className="folders">
          {config.watchFolders.map((f) => (
            <li key={f}>
              <span style={{ flex: 1 }}>{f}</span>
              <button
                className="btn"
                onClick={() => patch({ watchFolders: config.watchFolders.filter((x) => x !== f) })}
              >
                Remove
              </button>
            </li>
          ))}
          {config.watchFolders.length === 0 && <li className="empty-row">Nothing watched yet.</li>}
        </ul>
        <button className="btn primary" onClick={addFolder}>
          Add folder…
        </button>
      </div>

      <div className="card">
        <h2>Output</h2>
        <p className="hint">
          Alley always writes beside the source; Alleycat moves the result here afterwards. Leave
          empty to keep converted files next to the originals.
        </p>
        <label className="row">
          <span>Output folder</span>
          <input
            type="text"
            value={config.outputFolder}
            placeholder="(beside the source)"
            onChange={(e) => patch({ outputFolder: e.target.value })}
          />
          <button
            className="btn"
            onClick={async () => {
              const dir = await window.alleycat.pickFolder()
              if (dir) await patch({ outputFolder: dir })
            }}
          >
            Choose…
          </button>
        </label>
        <label className="row">
          <span>Preset</span>
          <select value={config.preset} onChange={(e) => patch({ preset: e.target.value })}>
            {(presets.length > 0 ? presets : [config.preset]).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="row">
          <span>Force size</span>
          <input
            type="number"
            placeholder="width"
            value={config.outputWidth ?? ''}
            onChange={(e) => patch({ outputWidth: e.target.value ? Number(e.target.value) : null })}
          />
          <input
            type="number"
            placeholder="height"
            value={config.outputHeight ?? ''}
            onChange={(e) =>
              patch({ outputHeight: e.target.value ? Number(e.target.value) : null })
            }
          />
        </label>
        <p className="hint" style={{ margin: 0 }}>
          Both dimensions must be set for either to apply.
        </p>
      </div>

      <div className="card">
        <h2>Alley</h2>
        <label className="row">
          <span>Executable</span>
          <input
            type="text"
            value={config.alleyPath}
            onChange={(e) => patch({ alleyPath: e.target.value })}
          />
          <button
            className="btn"
            onClick={async () => {
              const p = await window.alleycat.pickAlley()
              if (p) await patch({ alleyPath: p })
            }}
          >
            Choose…
          </button>
        </label>
        <p className="hint" style={{ margin: 0 }}>
          On macOS this is the binary inside the bundle: <code>Alley.app/Contents/MacOS/Alley</code>
          .
        </p>
      </div>
    </>
  )
}

function ArenaTab({
  config,
  patch,
  status,
  testResult,
  setTestResult
}: {
  config: Config
  patch: (p: Partial<Config>) => Promise<void>
  status: Status | null
  testResult: string
  setTestResult: (s: string) => void
}): React.JSX.Element {
  return (
    <>
      <div className="card">
        <h2>Connection</h2>
        <p className="hint">
          The REST API has to be switched on in Arena or Avenue under Preferences &gt; Webserver. It
          is off by default.
        </p>
        <label className="row">
          <span>Host</span>
          <input
            type="text"
            value={config.arena.host}
            onChange={(e) => patch({ arena: { ...config.arena, host: e.target.value } })}
          />
        </label>
        <label className="row">
          <span>Port</span>
          <input
            type="number"
            value={config.arena.port}
            onChange={(e) => patch({ arena: { ...config.arena, port: Number(e.target.value) } })}
          />
        </label>
        <button
          className="btn"
          onClick={async () => {
            setTestResult('Testing…')
            try {
              setTestResult(
                `Connected to ${await window.alleycat.testArena(config.arena.host, config.arena.port)}`
              )
            } catch (err) {
              setTestResult(err instanceof Error ? err.message : String(err))
            }
          }}
        >
          Test connection
        </button>
        {testResult && (
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            {testResult}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Replacement</h2>
        <p className="hint">
          When a conversion finishes, Alleycat looks for clips pointing at the original file and
          repoints them at the DXV copy. Arena keeps in/out points and clip effects across the swap.
        </p>
        <label className="row">
          <input
            type="checkbox"
            checked={config.autoReplace}
            onChange={(e) => patch({ autoReplace: e.target.checked })}
          />
          <span style={{ width: 'auto' }}>Replace clips automatically</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={config.skipPlayingClips}
            onChange={(e) => patch({ skipPlayingClips: e.target.checked })}
          />
          <span style={{ width: 'auto' }}>
            Never swap a clip that is playing — retry once it stops
          </span>
        </label>
      </div>

      <div className="card">
        <h2>Show scan</h2>
        <p className="hint">
          Polls the live composition for clips whose codec is not DXV and adds them to the queue.
          Deferred swaps are retried on the same tick.
        </p>
        <label className="row">
          <input
            type="checkbox"
            checked={config.arena.scanShow}
            onChange={(e) => patch({ arena: { ...config.arena, scanShow: e.target.checked } })}
          />
          <span style={{ width: 'auto' }}>Scan the running composition</span>
        </label>
        <label className="row">
          <span>Interval (s)</span>
          <input
            type="number"
            min={5}
            value={config.arena.scanIntervalSec}
            onChange={(e) =>
              patch({ arena: { ...config.arena, scanIntervalSec: Number(e.target.value) } })
            }
          />
        </label>
        <button className="btn" onClick={() => window.alleycat.scanShow()}>
          Scan now
        </button>
        {status?.lastScanAt && (
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            Last scan {timeOf(status.lastScanAt)}.
          </p>
        )}
      </div>
    </>
  )
}

function QueueTab({ jobs }: { jobs: Job[] }): React.JSX.Element {
  if (jobs.length === 0) return <div className="empty">Nothing queued.</div>
  return (
    <div className="card">
      <div style={{ display: 'flex', marginBottom: 10 }}>
        <h2 style={{ flex: 1 }}>Queue</h2>
        <button className="btn" onClick={() => window.alleycat.clearFinished()}>
          Clear finished
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th style={{ width: 110 }}>State</th>
            <th>Detail</th>
            <th style={{ width: 70 }}>From</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td className="path">{j.sourcePath}</td>
              <td>
                <span className={pillClass(j.state)}>{j.state}</span>
              </td>
              <td>
                {j.detail}
                {j.deferredClipIds.length > 0 && (
                  <div style={{ color: 'var(--warn)' }}>
                    {j.deferredClipIds.length} clip(s) playing
                  </div>
                )}
              </td>
              <td style={{ color: 'var(--dim)' }}>{j.origin}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ShowTab({ status }: { status: Status | null }): React.JSX.Element {
  const findings = status?.showFindings ?? []
  return (
    <div className="card">
      <div style={{ display: 'flex', marginBottom: 10 }}>
        <h2 style={{ flex: 1 }}>Non-DXV clips in the composition</h2>
        <button className="btn" onClick={() => window.alleycat.scanShow()}>
          Scan now
        </button>
      </div>
      <p className="hint">
        Codec here is read from Arena&rsquo;s own clip description. Anything actually queued gets
        its fourcc read from the file before conversion.
      </p>
      {findings.length === 0 ? (
        <div className="empty">
          {status?.arenaConnected ? 'Everything in the show is DXV.' : 'Not connected to Arena.'}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 150 }}>Layer</th>
              <th style={{ width: 140 }}>Clip</th>
              <th>File</th>
              <th style={{ width: 80 }}>Playing</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((c) => (
              <tr key={c.clipId}>
                <td>{c.layerName}</td>
                <td>{c.clipName}</td>
                <td className="path">
                  {c.path}
                  <div style={{ color: 'var(--dim)' }}>{c.codec}</div>
                </td>
                <td>{c.connected ? <span className="pill run">live</span> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function LogTab({ lines }: { lines: LogLine[] }): React.JSX.Element {
  return (
    <div className="card log">
      {lines.length === 0 && <div className="empty">Nothing logged yet.</div>}
      {lines.map((l, i) => (
        <div key={i} className={l.level}>
          <span className="at">{timeOf(l.at)} </span>
          {l.message}
        </div>
      ))}
    </div>
  )
}
