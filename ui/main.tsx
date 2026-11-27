import React from "react";
import ReactDOM from "react-dom/client";
import { AppRoot } from "@dynatrace/strato-components/core";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";

const container = document.getElementById("root");
if (container) {
  ReactDOM.createRoot(container).render(
    <AppRoot>
      <BrowserRouter basename="ui">
        <App />
      </BrowserRouter>
    </AppRoot>,
  );
}
