import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import { installBackend } from "./core/store/install";
import "./ui/styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

// バックエンド(ファイル・DB・通知など)を決めてから描画する
installBackend().then(
  () =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  (e: unknown) =>
    root.render(
      <div className="main">
        <p className="error">起動に失敗しました: {e instanceof Error ? e.message : String(e)}</p>
      </div>,
    ),
);
