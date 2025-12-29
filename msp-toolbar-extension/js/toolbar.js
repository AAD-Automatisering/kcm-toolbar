(() => {
  const TOOLBAR_ID = "msp-toolbar";
  const MENU_BUTTON_ID = "msp-toolbar-menu";
  const HOME_BUTTON_ID = "msp-toolbar-home";
  const SEARCH_INPUT_ID = "msp-toolbar-search";
  const RESULTS_ID = "msp-toolbar-results";
  const BODY_ACTIVE_CLASS = "msp-toolbar-active";
  const MOBILE_MEDIA_QUERY = "(max-width: 900px), (hover: none) and (pointer: coarse)";
  const SEARCH_SUGGEST_MIN = 2;
  const MAX_RESULTS = 8;

  let connectionIndex = null;
  let connectionIndexPromise = null;
  let searchRequestId = 0;

  const getAngularInjector = () => {
    const angular = window.angular;
    if (!angular || !angular.element) {
      return null;
    }
    const root =
      document.querySelector("[ng-app]") || document.body || document.documentElement || null;
    if (!root) {
      return null;
    }
    try {
      return angular.element(root).injector() || null;
    } catch (error) {
      return null;
    }
  };

  const getAngularScope = () => {
    const angular = window.angular;
    if (!angular || !angular.element) {
      return null;
    }
    const rootElement =
      document.querySelector("[ng-controller]") ||
      document.querySelector("[ng-app]") ||
      document.body ||
      document.documentElement ||
      null;
    if (!rootElement) {
      return null;
    }
    try {
      return angular.element(rootElement).scope() || null;
    } catch (error) {
      return null;
    }
  };

  const getAngularRootScope = () => {
    const injector = getAngularInjector();
    if (!injector) {
      return null;
    }
    try {
      return injector.get("$rootScope") || null;
    } catch (error) {
      return null;
    }
  };

  const normalizeToken = (value) => {
    if (!value) {
      return null;
    }
    let token = String(value).trim();
    if (
      (token.startsWith("\"") && token.endsWith("\"")) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1);
    }
    if (/%[0-9a-fA-F]{2}/.test(token)) {
      try {
        token = decodeURIComponent(token);
      } catch (error) {
        // Ignore decode failures and keep original token.
      }
    }
    token = token.trim();
    if (
      (token.startsWith("\"") && token.endsWith("\"")) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1);
    }
    if (/^bearer\s+/i.test(token)) {
      token = token.replace(/^bearer\s+/i, "");
    }
    return token || null;
  };

  const getTokenFromApp = () => {
    const injector = getAngularInjector();
    if (!injector) {
      return null;
    }
    try {
      const authService = injector.get("authenticationService");
      if (authService && typeof authService.getCurrentToken === "function") {
        return normalizeToken(authService.getCurrentToken());
      }
    } catch (error) {
      return null;
    }
    return null;
  };

  const getDataSource = () => "postgresql";

  const getAuthToken = () => getTokenFromApp();

  const getApiRoot = () => {
    const path = window.location.pathname || "";
    if (!path || path === "/") {
      return "";
    }
    return path.replace(/\/$/, "");
  };

  const buildApiUrl = (options = {}) => {
    const includeToken = options.includeToken !== false;
    const dataSource = getDataSource();
    const apiRoot = getApiRoot();
    const basePath = `${apiRoot}/api/session/data/${encodeURIComponent(
      dataSource
    )}/connectionGroups/ROOT/tree`;
    const token = getAuthToken();
    if (!token || !includeToken) {
      return basePath;
    }
    const url = new URL(basePath, window.location.origin);
    url.searchParams.set("token", token);
    return url.toString();
  };

  const normalizeToArray = (value) => {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === "object") {
      return Object.values(value);
    }
    return [];
  };

  const getConnectionId = (connection) =>
    (connection &&
      (connection.identifier ||
        connection.id ||
        connection.connectionIdentifier ||
        connection.uuid)) ||
    null;

  const buildConnectionIndex = (node, parents = []) => {
    const results = [];
    if (!node || typeof node !== "object") {
      return results;
    }
    const nodeName = node.name ? String(node.name) : "";
    const nodeId = node.identifier || node.id || "";
    const isRoot = nodeId === "ROOT" || nodeName === "ROOT";
    const nextParents = !isRoot && nodeName ? parents.concat([nodeName]) : parents;

    const childConnections = normalizeToArray(node.childConnections);
    childConnections.forEach((connection) => {
      const id = getConnectionId(connection);
      const name = connection && connection.name ? String(connection.name) : "";
      if (!id || !name) {
        return;
      }
      const groupPath = nextParents.join(" / ");
      const path = groupPath ? `${groupPath} / ${name}` : name;
      results.push({
        id: String(id),
        name,
        groupPath,
        path,
        nameLower: name.toLowerCase(),
        pathLower: path.toLowerCase()
      });
    });

    const childGroups = normalizeToArray(node.childConnectionGroups);
    childGroups.forEach((group) => {
      results.push(...buildConnectionIndex(group, nextParents));
    });

    return results;
  };

  const fetchConnectionTree = async (includeToken) => {
    const url = buildApiUrl({ includeToken });
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  const requestConnectionTree = async () => {
    const token = getAuthToken();
    try {
      return await fetchConnectionTree(false);
    } catch (error) {
      if (token && (error.status === 401 || error.status === 403)) {
        return fetchConnectionTree(true);
      }
      throw error;
    }
  };

  const ensureConnectionIndex = () => {
    if (connectionIndexPromise) {
      return connectionIndexPromise;
    }
    connectionIndexPromise = requestConnectionTree()
      .then((tree) => {
        const treeRoot = tree && tree.data ? tree.data : tree;
        connectionIndex = buildConnectionIndex(treeRoot);
        return connectionIndex;
      })
      .catch((error) => {
        connectionIndexPromise = null;
        throw error;
      });
    return connectionIndexPromise;
  };

  const scoreConnection = (connection, queryLower) => {
    if (connection.nameLower === queryLower) {
      return 0;
    }
    if (connection.nameLower.startsWith(queryLower)) {
      return 1;
    }
    if (connection.nameLower.includes(queryLower)) {
      return 2;
    }
    if (connection.pathLower.startsWith(queryLower)) {
      return 3;
    }
    return 4;
  };

  const findMatches = (query) => {
    if (!connectionIndex) {
      return [];
    }
    const queryLower = query.toLowerCase();
    return connectionIndex
      .filter((connection) => connection.pathLower.includes(queryLower))
      .sort((a, b) => {
        const scoreA = scoreConnection(a, queryLower);
        const scoreB = scoreConnection(b, queryLower);
        if (scoreA !== scoreB) {
          return scoreA - scoreB;
        }
        return a.pathLower.localeCompare(b.pathLower);
      });
  };

  const getResultsElement = () => document.getElementById(RESULTS_ID);

  const getSearchInput = () => document.getElementById(SEARCH_INPUT_ID);

  const isSearchFocused = () => {
    const input = getSearchInput();
    return input && document.activeElement === input;
  };

  const isSearchEvent = (event) => {
    const input = getSearchInput();
    if (!input) {
      return false;
    }
    if (event && event.target === input) {
      return true;
    }
    if (event && typeof event.composedPath === "function") {
      return event.composedPath().includes(input);
    }
    return document.activeElement === input;
  };

  const blurSearchInput = () => {
    const input = getSearchInput();
    if (input && document.activeElement === input) {
      input.blur();
    }
  };

  const showResultsMessage = (message) => {
    const results = getResultsElement();
    if (!results) {
      return;
    }
    results.innerHTML = "";
    const messageEl = document.createElement("div");
    messageEl.className = "msp-toolbar__results-empty";
    messageEl.textContent = message;
    results.appendChild(messageEl);
    results.hidden = false;
  };

  const hideResults = () => {
    const results = getResultsElement();
    if (!results) {
      return;
    }
    results.innerHTML = "";
    results.hidden = true;
  };

  const renderResults = (matches) => {
    const results = getResultsElement();
    if (!results) {
      return;
    }
    results.innerHTML = "";
    matches.forEach((match) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "msp-toolbar__result";
      item.dataset.connectionId = match.id;

      const title = document.createElement("span");
      title.className = "msp-toolbar__result-title";
      title.textContent = match.name;
      item.appendChild(title);

      if (match.groupPath) {
        const path = document.createElement("span");
        path.className = "msp-toolbar__result-path";
        path.textContent = match.groupPath;
        item.appendChild(path);
      }

      results.appendChild(item);
    });
    results.hidden = matches.length === 0;
  };

  const base64urlEncode = (value) => {
    let binary = value;
    if (window.TextEncoder) {
      const bytes = new TextEncoder().encode(value);
      binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    }
    return window
      .btoa(binary)
      .replace(/[+/=]/g, (char) => ({ "+": "-", "/": "_", "=": "" }[char]));
  };

  const buildClientIdentifier = (connectionId) => {
    const id = String(connectionId);
    const injector = getAngularInjector();
    const dataSource = getDataSource();
    if (injector) {
      try {
        const ClientIdentifier = injector.get("ClientIdentifier");
        if (ClientIdentifier && typeof ClientIdentifier.toString === "function") {
          const type =
            (ClientIdentifier.Types && ClientIdentifier.Types.CONNECTION) || "c";
          return ClientIdentifier.toString({ id, type, dataSource });
        }
      } catch (error) {
        // Ignore and fall back to local encoding.
      }
    }
    if (
      window.Guacamole &&
      window.Guacamole.ClientIdentifier &&
      typeof window.Guacamole.ClientIdentifier.toString === "function"
    ) {
      const type =
        (window.Guacamole.ClientIdentifier.Types &&
          window.Guacamole.ClientIdentifier.Types.CONNECTION) ||
        "c";
      return window.Guacamole.ClientIdentifier.toString({ id, type, dataSource });
    }
    return base64urlEncode([id, "c", dataSource].join("\0"));
  };

  const buildClientHash = (connectionId) => {
    const clientIdentifier = buildClientIdentifier(connectionId);
    const hash = window.location.hash || "";
    const [, hashQuery = ""] = hash.split("?");
    const querySuffix = hashQuery ? `?${hashQuery}` : "";
    return `#/client/${clientIdentifier}${querySuffix}`;
  };

  const navigateToConnection = (connectionId) => {
    if (!connectionId) {
      return;
    }
    const targetHash = buildClientHash(connectionId);
    window.location.hash = targetHash;
  };

  const updateResults = async () => {
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (!input) {
      return;
    }
    const query = input.value.trim();
    if (query.length < SEARCH_SUGGEST_MIN) {
      hideResults();
      return;
    }
    const requestId = ++searchRequestId;
    if (!connectionIndex) {
      showResultsMessage("Laden...");
    }
    try {
      await ensureConnectionIndex();
    } catch (error) {
      showResultsMessage("Kon verbindingen niet laden.");
      return;
    }
    if (requestId !== searchRequestId) {
      return;
    }
    const matches = findMatches(query).slice(0, MAX_RESULTS);
    if (!matches.length) {
      showResultsMessage("Geen resultaten.");
      return;
    }
    renderResults(matches);
  };

  const performSearch = async (openFirst) => {
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (!input) {
      return;
    }
    const query = input.value.trim();
    if (!query) {
      hideResults();
      return;
    }
    if (!connectionIndex) {
      showResultsMessage("Laden...");
    }
    try {
      await ensureConnectionIndex();
    } catch (error) {
      showResultsMessage("Kon verbindingen niet laden.");
      return;
    }
    const matches = findMatches(query).slice(0, MAX_RESULTS);
    if (!matches.length) {
      showResultsMessage("Geen resultaten.");
      return;
    }
    if (openFirst) {
      navigateToConnection(matches[0].id);
      hideResults();
      return;
    }
    renderResults(matches);
  };

  const interceptSearchKeys = (event) => {
    if (!isSearchEvent(event)) {
      return;
    }
    if (event.type === "keydown") {
      if (event.key === "Enter") {
        event.preventDefault();
        void performSearch(true);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideResults();
        const input = getSearchInput();
        if (input) {
          input.blur();
        }
      }
    }
    event.stopImmediatePropagation();
    event.stopPropagation();
    event.cancelBubble = true;
  };

  const guacKeyFilterTargets = new WeakSet();
  let guacKeyFiltersAttached = false;
  let guacKeyFilterTimerId = null;

  const attachGuacKeyFilters = () => {
    if (guacKeyFiltersAttached) {
      return true;
    }
    let attached = false;
    [getAngularScope(), getAngularRootScope()].forEach((target) => {
      if (!target || typeof target.$on !== "function" || guacKeyFilterTargets.has(target)) {
        return;
      }
      guacKeyFilterTargets.add(target);
      attached = true;
      target.$on("guacBeforeKeydown", (event) => {
        if (isSearchFocused()) {
          event.preventDefault();
        }
      });
      target.$on("guacBeforeKeyup", (event) => {
        if (isSearchFocused()) {
          event.preventDefault();
        }
      });
    });
    if (attached) {
      guacKeyFiltersAttached = true;
    }
    return attached;
  };

  const ensureGuacKeyFilters = () => {
    if (attachGuacKeyFilters()) {
      if (guacKeyFilterTimerId) {
        clearInterval(guacKeyFilterTimerId);
        guacKeyFilterTimerId = null;
      }
      return;
    }
    if (guacKeyFilterTimerId) {
      return;
    }
    let attempts = 0;
    guacKeyFilterTimerId = setInterval(() => {
      attempts += 1;
      if (attachGuacKeyFilters() || attempts >= 20) {
        clearInterval(guacKeyFilterTimerId);
        guacKeyFilterTimerId = null;
      }
    }, 500);
  };

  const bindGlobalKeyInterceptors = (() => {
    let bound = false;
    return () => {
      if (bound) {
        return;
      }
      bound = true;
      window.addEventListener("keydown", interceptSearchKeys, true);
      window.addEventListener("keyup", interceptSearchKeys, true);
      window.addEventListener("keypress", interceptSearchKeys, true);
    };
  })();

  const buildToolbar = () => {
    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.className = "msp-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "KCM toolbar");

    toolbar.innerHTML = `
      <div class="msp-toolbar__controls">
        <button id="${HOME_BUTTON_ID}" class="msp-toolbar__button msp-toolbar__button--icon" type="button"
          aria-label="Naar dashboard">
          <svg class="msp-toolbar__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3.2 3.5 10v10.2h6.2v-6.1h4.6v6.1h6.2V10L12 3.2zM18.6 18.2h-2.2v-6.1H7.6v6.1H5.4v-7.2L12 5.9l6.6 5.1v7.2z"/>
          </svg>
        </button>
        <button id="${MENU_BUTTON_ID}" class="msp-toolbar__button msp-toolbar__button--icon" type="button"
          aria-label="Open menu">
          <svg class="msp-toolbar__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 7.2h16v1.8H4V7.2zm0 5.9h16v1.8H4v-1.8zm0 5.9h16v1.8H4v-1.8z"/>
          </svg>
        </button>
        <div class="msp-toolbar__search">
          <input id="${SEARCH_INPUT_ID}" class="msp-toolbar__input" type="search"
            placeholder="Zoek verbinding..." aria-label="Zoek verbinding" autocomplete="off"
            spellcheck="false">
          <div id="${RESULTS_ID}" class="msp-toolbar__results" role="listbox" hidden></div>
        </div>
      </div>
    `;

    document.body.prepend(toolbar);
  };

  const dispatchKey = (type, key, code, keyCode, modifiers) => {
    const event = new KeyboardEvent(type, {
      key,
      code,
      bubbles: true,
      cancelable: true,
      ...modifiers
    });

    try {
      Object.defineProperty(event, "keyCode", { get: () => keyCode });
      Object.defineProperty(event, "which", { get: () => keyCode });
    } catch (error) {
      // Ignore if the browser prevents overriding read-only fields.
    }

    document.dispatchEvent(event);
  };

  const triggerMenuShortcut = () => {
    dispatchKey("keydown", "Control", "ControlLeft", 17, { ctrlKey: true });
    dispatchKey("keydown", "Alt", "AltLeft", 18, { ctrlKey: true, altKey: true });
    dispatchKey("keydown", "Shift", "ShiftLeft", 16, {
      ctrlKey: true,
      altKey: true,
      shiftKey: true
    });
    dispatchKey("keyup", "Shift", "ShiftLeft", 16, {
      ctrlKey: true,
      altKey: true,
      shiftKey: false
    });
    dispatchKey("keyup", "Alt", "AltLeft", 18, { ctrlKey: true, altKey: false });
    dispatchKey("keyup", "Control", "ControlLeft", 17, { ctrlKey: false });
  };

  const isClientRoute = () => {
    const hash = window.location.hash || "";
    return /^#\/client(\/|$)/.test(hash);
  };

  const isToolbarAllowed = () => {
    if (!window.matchMedia) {
      return true;
    }
    return !window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  };

  const updateVisibility = () => {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) {
      return;
    }
    const visible = isClientRoute() && isToolbarAllowed();
    toolbar.style.display = visible ? "flex" : "none";
    document.body.classList.toggle(BODY_ACTIVE_CLASS, visible);
    if (!visible) {
      hideResults();
      return;
    }
  };

  const toggleMenu = () => {
    triggerMenuShortcut();
  };

  const goHome = () => {
    const hash = window.location.hash || "";
    const [, hashQuery = ""] = hash.split("?");
    const querySuffix = hashQuery ? `?${hashQuery}` : "";
    window.location.hash = `#/${querySuffix}`;
  };

  const init = () => {
    if (!document.getElementById(TOOLBAR_ID)) {
      buildToolbar();
    }
    const homeButton = document.getElementById(HOME_BUTTON_ID);
    if (homeButton) {
      homeButton.addEventListener("click", goHome);
    }
    const button = document.getElementById(MENU_BUTTON_ID);
    if (button) {
      button.addEventListener("click", toggleMenu);
    }
    const searchInput = document.getElementById(SEARCH_INPUT_ID);
    if (searchInput) {
      searchInput.addEventListener("focus", () => {
        void ensureConnectionIndex().catch(() => {});
        ensureGuacKeyFilters();
      });
      searchInput.addEventListener("blur", (event) => {
        const toolbar = document.getElementById(TOOLBAR_ID);
        const related = event.relatedTarget;
        if (toolbar && related && toolbar.contains(related)) {
          return;
        }
        setTimeout(hideResults, 0);
      });
      searchInput.addEventListener("input", () => {
        void updateResults();
      });
      searchInput.addEventListener("keydown", (event) => {
        event.stopImmediatePropagation();
        event.stopPropagation();
        if (event.defaultPrevented) {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void performSearch(true);
        }
        if (event.key === "Escape") {
          hideResults();
          searchInput.blur();
        }
      });
      searchInput.addEventListener("keyup", (event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
      });
      searchInput.addEventListener("keypress", (event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
      });
    }
    const results = document.getElementById(RESULTS_ID);
    if (results) {
      results.addEventListener("click", (event) => {
        const target = event.target.closest("[data-connection-id]");
        if (!target) {
          return;
        }
        navigateToConnection(target.dataset.connectionId);
        const input = getSearchInput();
        if (input) {
          input.value = "";
        }
        hideResults();
        blurSearchInput();
      });
    }
    const toolbar = document.getElementById(TOOLBAR_ID);
    updateVisibility();
    ensureGuacKeyFilters();
    window.addEventListener("hashchange", updateVisibility);
    window.addEventListener("popstate", updateVisibility);
    window.addEventListener("resize", updateVisibility);
    document.addEventListener("click", (event) => {
      if (toolbar && !toolbar.contains(event.target)) {
        hideResults();
        blurSearchInput();
      }
    });
  };

  if (document.readyState === "loading") {
    bindGlobalKeyInterceptors();
    document.addEventListener("DOMContentLoaded", init);
  } else {
    bindGlobalKeyInterceptors();
    init();
  }
})();
