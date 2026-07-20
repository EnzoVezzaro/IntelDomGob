/* eslint-disable no-undef */
// React wrapper that properly exports useEffectEvent.
// React 19.2+ has useEffectEvent at runtime but intentionally omits it
// from the ESM exports map (it's experimental). This wrapper forces
// webpack to see it as a named export.

// Import the default React module
const React = require('react');

// Re-export everything from React
module.exports = React;

// Explicitly expose useEffectEvent as a named export.
// It exists at runtime on React.useEffectEvent but webpack's ESM
// parser can't find it because it's not in React's exports map.
if (React.useEffectEvent) {
  module.exports.useEffectEvent = React.useEffectEvent;
}
