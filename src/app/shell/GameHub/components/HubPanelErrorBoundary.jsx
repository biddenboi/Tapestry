import { Component } from 'react';

export default class HubPanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.warn('[GameHub] panel render failed:', error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.panelKey !== this.props.panelKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="hub-panel-error">
          <span className="hub-panel-error-k">PANEL ERROR</span>
          <strong>{this.state.error.message || 'This panel could not render.'}</strong>
        </div>
      );
    }
    return this.props.children;
  }
}
