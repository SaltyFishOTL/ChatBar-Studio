import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { StudioProvider } from "./ui/store";
import "./ui/styles.css";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="boot">
        <h1>工作室遇到错误</h1>
        <p>{this.state.error}</p>
        <p>本机数据未清除。请刷新页面重试。</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <StudioProvider>
      <App />
    </StudioProvider>
  </ErrorBoundary>,
);
