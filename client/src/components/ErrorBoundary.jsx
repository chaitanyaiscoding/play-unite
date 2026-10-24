import { Component } from 'react';
import { Link } from 'react-router-dom';

// Catches render errors so one broken page shows a message instead of a blank screen.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev) {
    // Navigating to another page clears the error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card section crash">
        <h3>Something went wrong on this page</h3>
        <p className="help">
          Try reloading. If you just updated the app, make sure the API server was restarted too.
        </p>
        <pre className="crash__msg">{String(this.state.error.message ?? this.state.error)}</pre>
        <div className="section__foot">
          <Link to="/home" className="btn btn--ghost btn--sm" onClick={() => this.setState({ error: null })}>
            Home
          </Link>
          <button type="button" className="btn btn--sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
