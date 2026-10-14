import { Component } from 'react';

/**
 * F145 review: the terminal, admin and persona chooser load on demand. If that download fails (a
 * deploy since the page opened, or the network), React would unmount the app and leave a white page;
 * this offers a reload instead.
 */
export default class ChunkBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-load-error" role="alert">
        <p>This page could not finish loading.</p>
        <button type="button" className="app-load-retry" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
