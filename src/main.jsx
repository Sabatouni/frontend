import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { ENV_STATUS, IS_STAGING } from "./config/environment";
import { ConfigErrorScreen, StagingBanner, STAGING_BANNER_HEIGHT } from "./config/EnvironmentScreens.jsx";

const rootEl = document.getElementById("root");

if (!ENV_STATUS.ok) {
  // Fail closed: the app, AuthContext, the Supabase client and the admin API
  // module are never loaded, so nothing can connect anywhere.
  document.title = `⚠ Configuration error — ${document.title}`;
  ReactDOM.createRoot(rootEl).render(<ConfigErrorScreen status={ENV_STATUS} />);
} else {
  if (IS_STAGING) {
    // Permanent banner in its own root (outside the app tree, so no page,
    // modal or login screen can hide it) + layout offset so it never covers
    // the app's own top bar.
    document.title = `[STAGING] ${document.title}`;
    document.documentElement.setAttribute("data-stv-env", "staging");
    const bannerEl = document.createElement("div");
    bannerEl.id = "stv-env-banner";
    document.body.prepend(bannerEl);
    const style = document.createElement("style");
    style.textContent = `
      html[data-stv-env="staging"] #root { margin-top: ${STAGING_BANNER_HEIGHT}px; height: calc(100% - ${STAGING_BANNER_HEIGHT}px); }
      html[data-stv-env="staging"] #root > div { height: 100% !important; min-height: 0 !important; }
      html[data-stv-env="staging"] .stv-sidebar { top: ${STAGING_BANNER_HEIGHT}px !important; height: calc(100vh - ${STAGING_BANNER_HEIGHT}px) !important; }
    `;
    document.head.appendChild(style);
    ReactDOM.createRoot(bannerEl).render(<StagingBanner supabaseRef={ENV_STATUS.supabaseRef} />);
  }

  // Loaded only after the guard has passed.
  Promise.all([
    import("./App.jsx"),
    import("./context/AuthContext.jsx"),
    import("./i18n.jsx"),
  ]).then(([{ default: App }, { AuthProvider }, { LanguageProvider }]) => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <AuthProvider>
          {/* Must render inside AuthProvider -- it reads the current user/role
              from useAuth() to pick the right default language and to scope
              the persisted preference to that user. */}
          <LanguageProvider>
            <App />
          </LanguageProvider>
        </AuthProvider>
      </React.StrictMode>
    );
  });
}
