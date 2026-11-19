import { useEffect, useRef, useState } from 'react'
import { backendSamples } from './backendSamples'
import { exampleGroups, explorerExamples, schemaFields } from './explorerExamples'
import { detectOperationType, executeOperation, parseVariables, resolveEndpoints, streamOperation } from './graphqlClient'
import './App.css'

const endpoints = resolveEndpoints(import.meta.env.VITE_GRAPHQL_URL)
const firstQuery = explorerExamples.find((example) => example.id === 'users').query
const KIND_LABELS = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }
const RUN_LABELS = { query: 'Run query', mutation: 'Run mutation', subscription: 'Subscribe' }

const formatVariables = (variables) => (variables ? JSON.stringify(variables, null, 2) : '')
const formatBody = (body) => (typeof body === 'string' ? body : JSON.stringify(body, null, 2))
const countEvents = (count) => `${count} event${count === 1 ? '' : 's'}`
const IDLE_OUTPUT = 'Run an operation to see the response here.'
const IDLE_STATUS = { tone: 'idle', label: 'Ready' }
// Keeps a long-running subscription from growing the response panel without bound.
const MAX_VISIBLE_EVENTS = 50

const lessons = [
  ['01', 'The graph', 'A schema describes the data your API can return. Types define fields and relationships.'],
  ['02', 'Queries', 'Ask for exactly the fields your screen needs—nothing more and nothing less.'],
  ['03', 'Mutations', 'Use mutations to create or change data. Their selection set returns the updated object.'],
  ['04', 'Variables', 'Keep dynamic values separate from operation text for reusable, safer requests.'],
  ['05', 'Subscriptions', 'Subscribe to events and receive each result the moment it happens—streamed here over Server-Sent Events.'],
]

function CodeBlock({ children }) {
  return <pre tabIndex={0}><code>{children}</code></pre>
}

function BackendSamples() {
  return (
    <section className="samples" aria-labelledby="samples-title">
      <div className="section-intro">
        <p className="eyebrow">Backend samples</p>
        <h2 id="samples-title">GraphQL in 10 common backend languages.</h2>
        <p>Each sample is an illustrative snippet showing the smallest useful shape—defining schema or resolver code before wiring it to a GraphQL endpoint. Snippets may omit boilerplate and setup for brevity and are not meant to run as-is.</p>
      </div>
      <div className="sample-grid">
        {backendSamples.map(({ language, framework, code }) => (
          <article className="sample-card" key={language}>
            <div className="sample-meta">
              <h3>{language}</h3>
              <span>{framework}</span>
            </div>
            <CodeBlock>{code}</CodeBlock>
          </article>
        ))}
      </div>
    </section>
  )
}

function LearnPage({ openExplorer }) {
  return (
    <main className="page learn-page">
      <section className="hero">
        <p className="eyebrow">A practical guide to GraphQL</p>
        <h1>Build APIs people<br />love to use.</h1>
        <p className="hero-copy">Learn the mental model, write your first operation, and put each concept to work against the sample API.</p>
        <button className="primary-button" onClick={openExplorer}>Try the API <span>→</span></button>
      </section>

      <section className="principles" aria-labelledby="principles-title">
        <div>
          <p className="eyebrow">The essentials</p>
          <h2 id="principles-title">One endpoint.<br />Infinite possibilities.</h2>
        </div>
        <div className="principle-list">
          {lessons.map(([number, title, description]) => (
            <article className="principle" key={number}>
              <span>{number}</span>
              <div><h3>{title}</h3><p>{description}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="query-section">
        <div className="section-intro">
          <p className="eyebrow">Your first query</p>
          <h2>Ask for what you need.</h2>
          <p>GraphQL lets clients choose the response shape. This query retrieves users and only the fields requested.</p>
        </div>
        <CodeBlock>{firstQuery}</CodeBlock>
      </section>

      <BackendSamples />

      <section className="tips" aria-labelledby="tips-title">
        <p className="eyebrow">Tips &amp; tricks</p>
        <h2 id="tips-title">Write better operations.</h2>
        <div className="tip-grid">
          <article><b>Use named operations</b><p>They make debugging, analytics, and error messages much clearer.</p></article>
          <article><b>Prefer variables</b><p>Pass changing IDs and form values as variables rather than interpolating strings.</p></article>
          <article><b>Follow the schema</b><p>Use descriptions and types as your API contract—your tooling can validate before requests run.</p></article>
        </div>
      </section>
    </main>
  )
}

function ExplorerSidebar({ selectedId, onSelect }) {
  return (
    <aside className="sidebar">
      {exampleGroups.map((group) => (
        <div className="example-group" key={group}>
          <p className="sidebar-label">{group}</p>
          {explorerExamples.filter((example) => example.group === group).map((example) => (
            <button
              key={example.id}
              className={example.id === selectedId ? 'active' : ''}
              aria-pressed={example.id === selectedId}
              onClick={() => onSelect(example)}
            >
              {example.label} <span>{KIND_LABELS[detectOperationType(example.query)]}</span>
            </button>
          ))}
        </div>
      ))}
      <div className="schema-note">
        <p className="sidebar-label">Schema fields</p>
        {Object.entries(schemaFields).map(([type, fields]) => (
          <details key={type} open>
            <summary>{type}</summary>
            {Object.entries(fields).map(([name, args]) => (
              <code key={name}>{name}{args.length > 0 && <small>({args.join(', ')})</small>}</code>
            ))}
          </details>
        ))}
      </div>
    </aside>
  )
}

function ExplorerPage() {
  const [selectedId, setSelectedId] = useState(explorerExamples[0].id)
  const [query, setQuery] = useState(explorerExamples[0].query)
  const [variablesText, setVariablesText] = useState(formatVariables(explorerExamples[0].variables))
  const [output, setOutput] = useState(IDLE_OUTPUT)
  const [status, setStatus] = useState(IDLE_STATUS)
  const [requestId, setRequestId] = useState(null)
  // Abort controller of the in-flight run; only that run may update the response panel.
  const activeRun = useRef(null)

  const operationType = detectOperationType(query)
  const running = status.tone === 'running'
  const streaming = status.tone === 'streaming'

  useEffect(() => () => activeRun.current?.abort(), [])

  function startRun() {
    const controller = new AbortController()
    activeRun.current = controller
    return { signal: controller.signal, isCurrent: () => activeRun.current === controller }
  }

  function selectExample(example) {
    activeRun.current?.abort()
    activeRun.current = null
    setSelectedId(example.id)
    setQuery(example.query)
    setVariablesText(formatVariables(example.variables))
    setOutput(IDLE_OUTPUT)
    setStatus(IDLE_STATUS)
    setRequestId(null)
  }

  function finish(tone, label, body) {
    setStatus({ tone, label })
    if (body !== undefined) setOutput(formatBody(body))
  }

  async function runOnce(variables) {
    const { signal, isCurrent } = startRun()
    setStatus({ tone: 'running', label: 'Running…' })
    setOutput('Sending request…')
    try {
      const result = await executeOperation({ url: endpoints.http, query, variables, signal })
      if (!isCurrent()) return
      const failed = !result.ok || Boolean(result.body?.errors?.length)
      setRequestId(result.requestId)
      finish(failed ? 'error' : 'success', `${result.status} · ${result.durationMs} ms`, result.body)
    } catch (error) {
      if (isCurrent()) finish('error', 'Network error', { error: 'Unable to reach the GraphQL server.', detail: error.message })
    } finally {
      if (isCurrent()) activeRun.current = null
    }
  }

  async function runSubscription(variables) {
    const { signal, isCurrent } = startRun()
    const recent = []
    let count = 0
    // A failed setup or source stream sends an error payload right before `complete`.
    let lastHadErrors = false
    // The streaming tone shows the Stop button, so a hanging connect can be cancelled.
    setStatus({ tone: 'streaming', label: 'Connecting…' })
    setOutput('Connecting…')

    try {
      const result = await streamOperation({
        url: endpoints.stream,
        query,
        variables,
        signal,
        onOpen(meta) {
          if (!isCurrent()) return
          setRequestId(meta.requestId)
          setStatus({ tone: 'streaming', label: 'Listening' })
          setOutput('Listening for events. Run a matching mutation (for example in another tab) to see it arrive here.')
        },
        onNext(payload) {
          if (!isCurrent()) return
          count += 1
          lastHadErrors = Boolean(payload?.errors?.length)
          recent.unshift(`# event ${count}\n${formatBody(payload)}`)
          if (recent.length > MAX_VISIBLE_EVENTS) recent.pop()
          setStatus({ tone: 'streaming', label: `Streaming · ${countEvents(count)}` })
          setOutput(recent.join('\n\n'))
        },
      })
      if (!isCurrent()) return

      if (result.ended === 'rejected') {
        setRequestId(result.requestId)
        finish('error', `${result.status}`, result.body)
      } else if (result.ended === 'complete') {
        finish(lastHadErrors ? 'error' : 'success', `${lastHadErrors ? 'Failed' : 'Completed'} · ${countEvents(count)}`)
      } else if (result.ended === 'aborted') {
        finish('idle', `Stopped · ${countEvents(count)}`)
      } else {
        finish('error', 'Disconnected by server')
      }
    } catch (error) {
      if (isCurrent()) finish('error', 'Network error', { error: 'Unable to reach the GraphQL stream endpoint.', detail: error.message })
    } finally {
      if (isCurrent()) activeRun.current = null
    }
  }

  function run() {
    if (running || streaming) return
    setRequestId(null)

    const { variables, error } = parseVariables(variablesText)
    if (error) {
      finish('error', 'Invalid variables', error)
      return
    }
    if (!operationType) {
      finish('error', 'No operation', 'Write a query, mutation or subscription to run.')
      return
    }

    if (operationType === 'subscription') runSubscription(variables)
    else runOnce(variables)
  }

  function runOnShortcut(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      run()
    }
  }

  return (
    <main className="page explorer-page">
      <section className="explorer-heading">
        <div><p className="eyebrow">Interactive API reference</p><h1>GraphQL Explorer</h1></div>
        <p>Run queries, mutations and live subscriptions against the sample users, posts and finance API.</p>
      </section>

      <section className="explorer" aria-label="GraphQL API explorer">
        <ExplorerSidebar selectedId={selectedId} onSelect={selectExample} />
        <div className="workspace">
          <div className="panel editor-panel">
            <div className="panel-header">
              <span>Operation{operationType && <em className="kind-tag">{KIND_LABELS[operationType]}</em>}</span>
              <div className="run-controls">
                <kbd className="shortcut">Ctrl/⌘ + Enter</kbd>
                {streaming
                  ? <button className="run-button stop-button" onClick={() => activeRun.current?.abort()}>Stop <span>■</span></button>
                  : <button className="run-button" onClick={run} disabled={running}>{running ? 'Running…' : RUN_LABELS[operationType] ?? 'Run'} <span>▶</span></button>}
              </div>
            </div>
            <textarea
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelectedId(null)
              }}
              onKeyDown={runOnShortcut}
              aria-label="GraphQL operation"
              spellCheck="false"
            />
            <div className="panel-header variables-header"><label htmlFor="explorer-variables">Variables (JSON)</label></div>
            <textarea
              id="explorer-variables"
              className="variables-input"
              value={variablesText}
              onChange={(event) => setVariablesText(event.target.value)}
              onKeyDown={runOnShortcut}
              placeholder='{ "id": "1" }'
              spellCheck="false"
            />
          </div>
          <div className="panel result-panel">
            <div className="panel-header">
              <span>Response</span>
              <span className="response-meta">
                {requestId && <span className="request-id" title={`X-Request-Id: ${requestId}`}>id {requestId.slice(0, 8)}</span>}
                <span className={`status-dot is-${status.tone}`} role="status">{status.label}</span>
              </span>
            </div>
            <pre aria-live="polite">{output}</pre>
          </div>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [page, setPage] = useState(() => window.location.hash === '#explorer' ? 'explorer' : 'learn')

  useEffect(() => {
    const syncPage = () => setPage(window.location.hash === '#explorer' ? 'explorer' : 'learn')
    window.addEventListener('hashchange', syncPage)
    return () => window.removeEventListener('hashchange', syncPage)
  }, [])

  function navigate(nextPage) {
    window.location.hash = nextPage === 'explorer' ? 'explorer' : ''
    setPage(nextPage)
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#/" onClick={() => navigate('learn')}><span>◈</span> GraphQL <em>field guide</em></a>
        <nav aria-label="Main navigation">
          <button className={page === 'learn' ? 'active' : ''} onClick={() => navigate('learn')}>Learn</button>
          <button className={page === 'explorer' ? 'active' : ''} onClick={() => navigate('explorer')}>API Explorer</button>
        </nav>
      </header>
      {page === 'learn' ? <LearnPage openExplorer={() => navigate('explorer')} /> : <ExplorerPage />}
      <footer>Built for curious API developers · Sample GraphQL service</footer>
    </>
  )
}

export default App
