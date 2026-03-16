const FEATURES = [
  {
    icon: '💬',
    title: 'AI-Powered Advice',
    desc: 'Get personalized financial insights from Sage, your built-in AI advisor.',
  },
  {
    icon: '📊',
    title: 'Budget & Transactions',
    desc: 'Track income and expenses, plan your budget, and visualize spending.',
  },
  {
    icon: '📈',
    title: 'Net Worth & Investments',
    desc: 'Track assets, loans, ESPP, equity grants, and portfolio allocation.',
  },
  {
    icon: '🏠',
    title: 'Rental & Passive Income',
    desc: 'Manage rental properties, track passive income streams, and monitor FI%.',
  },
  {
    icon: '🔮',
    title: 'Long-Term Forecasting',
    desc: 'See 1–10 year cash flow projections and track your financial health score.',
  },
]

export default function Landing({ onGetStarted, onLogin }) {
  return (
    <div className="landing-page">
      <div className="landing-inner">

        {/* Header */}
        <header className="landing-header">
          <div className="landing-logo-row">
            <div className="app-logo landing-logo">S</div>
            <span className="landing-app-name">Sage</span>
          </div>
          <button className="landing-header-login" onClick={onLogin}>Log In</button>
        </header>

        {/* Hero */}
        <section className="landing-hero">
          <div className="landing-hero-badge">Personal Finance · Built for Clarity</div>
          <h1 className="landing-hero-title">
            Your Personal<br />
            <span className="landing-hero-accent">Financial Advisor</span>
          </h1>
          <p className="landing-hero-sub">
            Sage brings together budgeting, net worth, investing, rentals,
            and AI-powered advice — all in one place, all your data.
          </p>
          <div className="landing-hero-cta">
            <button className="landing-cta-primary" onClick={onGetStarted}>
              Get Started — Free
            </button>
            <button className="landing-cta-ghost" onClick={onLogin}>
              Log In
            </button>
          </div>
        </section>

        {/* Features */}
        <section className="landing-features">
          <h2 className="landing-features-title">Everything you need</h2>
          <div className="landing-features-grid">
            {FEATURES.map(f => (
              <div key={f.title} className="landing-feature-card">
                <span className="landing-feature-icon">{f.icon}</span>
                <div>
                  <div className="landing-feature-title">{f.title}</div>
                  <div className="landing-feature-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Footer CTA */}
        <section className="landing-footer-cta">
          <p className="landing-footer-text">
            Your data. Synced securely to the cloud.
          </p>
          <button className="landing-cta-primary" onClick={onGetStarted}>
            Create Free Account
          </button>
        </section>

        <footer className="landing-foot">
          <span>© 2026 Sage · Personal Financial Advisor</span>
        </footer>

      </div>
    </div>
  )
}
