import { useEffect, useState } from 'react'
import './App.css'

const examples = {
  users: `query Users {
  users {
    id
    name
    email
    posts { id title }
  }
}`,
  posts: `query Posts {
  posts {
    id
    title
    content
    author { name }
  }
}`,
  createUser: `mutation CreateUser {
  createUser(name: "Grace Hopper", email: "grace@example.com") {
    id
    name
    email
  }
}`,
}

const lessons = [
  ['01', 'The graph', 'A schema describes the data your API can return. Types define fields and relationships.'],
  ['02', 'Queries', 'Ask for exactly the fields your screen needs—nothing more and nothing less.'],
  ['03', 'Mutations', 'Use mutations to create or change data. Their selection set returns the updated object.'],
  ['04', 'Variables', 'Keep dynamic values separate from operation text for reusable, safer requests.'],
]

function CodeBlock({ children }) {
  return <pre><code>{children}</code></pre>
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
        <CodeBlock>{examples.users}</CodeBlock>
      </section>

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

function ExplorerPage() {
  const [query, setQuery] = useState(examples.users)
  const [result, setResult] = useState('Run an operation to see the response here.')
  const [loading, setLoading] = useState(false)

  async function runQuery() {
    setLoading(true)
    setResult('Sending request…')
    try {
      const response = await fetch(import.meta.env.VITE_GRAPHQL_URL || '/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const body = await response.json()
      setResult(JSON.stringify(body, null, 2))
    } catch (error) {
      setResult(JSON.stringify({ error: 'Unable to reach the GraphQL server.', detail: error.message }, null, 2))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page explorer-page">
      <section className="explorer-heading">
        <div><p className="eyebrow">Interactive API reference</p><h1>GraphQL Explorer</h1></div>
        <p>Compose an operation, then run it against the sample User and Post API.</p>
      </section>

      <section className="explorer" aria-label="GraphQL API explorer">
        <aside className="sidebar">
          <p className="sidebar-label">Example operations</p>
          <button onClick={() => setQuery(examples.users)}>List users <span>Query</span></button>
          <button onClick={() => setQuery(examples.posts)}>List posts <span>Query</span></button>
          <button onClick={() => setQuery(examples.createUser)}>Create user <span>Mutation</span></button>
          <div className="schema-note">
            <p className="sidebar-label">Available fields</p>
            <code>Query.users</code><code>Query.user(id)</code><code>Query.posts</code><code>Query.post(id)</code><code>Mutation.createUser</code><code>Mutation.createPost</code>
          </div>
        </aside>
        <div className="workspace">
          <div className="panel editor-panel">
            <div className="panel-header"><span>Operation</span><button className="run-button" onClick={runQuery} disabled={loading}>{loading ? 'Running…' : 'Run query'} <span>▶</span></button></div>
            <textarea value={query} onChange={(event) => setQuery(event.target.value)} aria-label="GraphQL operation" spellCheck="false" />
          </div>
          <div className="panel result-panel">
            <div className="panel-header"><span>Response</span><span className="status-dot">Ready</span></div>
            <pre>{result}</pre>
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
