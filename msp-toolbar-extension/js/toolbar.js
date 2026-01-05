(() => {
  const TOOLBAR_ID = "msp-toolbar";
  const MENU_BUTTON_ID = "msp-toolbar-menu";
  const HOME_BUTTON_ID = "msp-toolbar-home";
  const SETTINGS_BUTTON_ID = "msp-toolbar-settings";
  const LOGOUT_BUTTON_ID = "msp-toolbar-logout";
  const SEARCH_INPUT_ID = "msp-toolbar-search";
  const RESULTS_ID = "msp-toolbar-results";
  const BODY_ACTIVE_CLASS = "msp-toolbar-active";
  const TAB_BAR_ID = "msp-toolbar-tabs";
  const TAB_LIST_CLASS = "msp-toolbar__tabs-inline";
  const MOBILE_MEDIA_QUERY = "(max-width: 900px), (hover: none) and (pointer: coarse)";
  const SEARCH_SUGGEST_MIN = 2;
  const MAX_RESULTS = 8;
  const TAB_SYNC_INTERVAL = 1000;

  let connectionIndex = null;
  let connectionIndexPromise = null;
  let searchRequestId = 0;
  let tabSyncIntervalId = null;
  let tabSnapshot = "";
  let tabOrder = [];

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

  const getGuacServices = (() => {
    let cache = null;
    return () => {
      const injector = getAngularInjector();
      if (!injector) {
        cache = null;
        return null;
      }
      if (cache && cache.injector === injector) {
        return cache;
      }
      try {
        cache = {
          injector,
          guacClientManager: injector.get("guacClientManager"),
          ManagedClientGroup: injector.get("ManagedClientGroup"),
          ManagedClientState: injector.get("ManagedClientState"),
          authenticationService: injector.get("authenticationService")
        };
        return cache;
      } catch (error) {
        cache = null;
        return null;
      }
    };
  })();

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

  const clearSearchInput = () => {
    const input = getSearchInput();
    if (input) {
      input.value = "";
    }
    hideResults();
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
      const item = document.createElement("div");
      item.className = "msp-toolbar__result";
      item.dataset.connectionId = match.id;

      const mainButton = document.createElement("button");
      mainButton.type = "button";
      mainButton.className = "msp-toolbar__result-main";
      mainButton.dataset.connectionId = match.id;

      const title = document.createElement("span");
      title.className = "msp-toolbar__result-title";
      title.textContent = match.name;
      mainButton.appendChild(title);

      if (match.groupPath) {
        const path = document.createElement("span");
        path.className = "msp-toolbar__result-path";
        path.textContent = match.groupPath;
        mainButton.appendChild(path);
      }

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "msp-toolbar__result-open";
      openButton.dataset.connectionId = match.id;
      openButton.setAttribute("aria-label", `Open ${match.name} in nieuw tabblad`);
      openButton.innerHTML = `
        <svg class="msp-toolbar__result-open-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false" fill="currentColor">
          <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"/>
        </svg>
      `;

      item.appendChild(mainButton);
      item.appendChild(openButton);
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

  const buildClientUrl = (connectionId) => {
    const targetHash = buildClientHash(connectionId);
    const { origin, pathname, search } = window.location;
    return `${origin}${pathname}${search}${targetHash}`;
  };

  const buildClientGroupHash = (groupId) => {
    if (!groupId) {
      return null;
    }
    const hash = window.location.hash || "";
    const [, hashQuery = ""] = hash.split("?");
    const querySuffix = hashQuery ? `?${hashQuery}` : "";
    return `#/client/${groupId}${querySuffix}`;
  };

  const navigateToConnection = (connectionId, options = {}) => {
    if (!connectionId) {
      return;
    }
    const { openInNewTab = false } = options;
    if (openInNewTab) {
      const targetUrl = buildClientUrl(connectionId);
      window.open(targetUrl, "_blank", "noopener");
      return;
    }
    const targetHash = buildClientHash(connectionId);
    window.location.hash = targetHash;
  };

  const navigateToClientGroup = (groupId, options = {}) => {
    if (!groupId) {
      return;
    }
    const { openInNewTab = false } = options;
    const targetHash = buildClientGroupHash(groupId);
    if (!targetHash) {
      return;
    }
    if (openInNewTab) {
      const { origin, pathname, search } = window.location;
      const targetUrl = `${origin}${pathname}${search}${targetHash}`;
      window.open(targetUrl, "_blank", "noopener");
      return;
    }
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

  const performSearch = async (openFirst, options = {}) => {
    const { openInNewTab = false } = options;
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
      navigateToConnection(matches[0].id, { openInNewTab });
      if (!openInNewTab) {
        hideResults();
      }
      return;
    }
    renderResults(matches);
  };

  const shouldOpenInNewTab = (event) =>
    !!(event && (event.ctrlKey || event.metaKey || event.altKey || event.button === 1));

  const interceptSearchKeys = (event) => {
    if (!isSearchEvent(event)) {
      return;
    }
    if (event.type === "keydown") {
      if (event.key === "Enter") {
        event.preventDefault();
        void performSearch(true, { openInNewTab: shouldOpenInNewTab(event) });
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
        <div class="msp-toolbar__controls-left">
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
          <div id="${TAB_BAR_ID}" class="${TAB_LIST_CLASS}" role="navigation" aria-label="Open verbindingen" hidden></div>
        </div>
        <div class="msp-toolbar__controls-right">
        <button id="${SETTINGS_BUTTON_ID}" class="msp-toolbar__button msp-toolbar__button--icon" type="button"
          aria-label="Open sessie-instellingen">
          <svg class="msp-toolbar__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 8.5c-1.93 0-3.5 1.57-3.5 3.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5S13.93 8.5 12 8.5Zm8.94 2.2-1.87-.29c-.14-.43-.33-.83-.56-1.21l1.12-1.55c.18-.25.15-.6-.07-.82l-1.49-1.49c-.22-.22-.57-.25-.82-.07l-1.55 1.12c-.38-.23-.78-.42-1.21-.56l-.29-1.87A.75.75 0 0 0 12.5 4h-2a.75.75 0 0 0-.74.63l-.29 1.87c-.43.14-.83.33-1.21.56L6.71 5.94a.75.75 0 0 0-.82.07L4.4 7.5c-.22.22-.25.57-.07.82l1.12 1.55c-.23.38-.42.78-.56 1.21l-1.87.29A.75.75 0 0 0 3 12.5v2c0 .37.27.69.63.74l1.87.29c.14.43.33.83.56 1.21l-1.12 1.55c-.18.25-.15.6.07.82l1.49 1.49c.22.22.57.25.82.07l1.55-1.12c.38.23.78.42 1.21.56l.29 1.87c.06.36.38.63.74.63h2c.37 0 .69-.27.74-.63l.29-1.87c.43-.14.83-.33 1.21-.56l1.55 1.12c.25.18.6.15.82-.07l1.49-1.49c.22-.22.25-.57.07-.82l-1.12-1.55c.23-.38.42-.78.56-1.21l1.87-.29c.36-.06.63-.38.63-.74v-2a.75.75 0 0 0-.63-.74ZM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/>
          </svg>
        </button>
        <button id="${LOGOUT_BUTTON_ID}" class="msp-toolbar__button msp-toolbar__button--icon" type="button"
          aria-label="Uitloggen">
          <svg class="msp-toolbar__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm9.71 8.29-3-3-1.42 1.42L16.59 11H9v2h7.59l-1.3 1.29 1.42 1.42 3-3a1 1 0 0 0 0-1.42Z"/>
          </svg>
        </button>
        </div>
      </div>
    `;

    const tabBar = toolbar.querySelector(`#${TAB_BAR_ID}`);
    if (tabBar) {
      tabBar.addEventListener("click", handleTabInteraction);
      tabBar.addEventListener("auxclick", handleTabInteraction);
    }

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

  const isToolbarAllowed = () => {
    if (!window.matchMedia) {
      return true;
    }
    return !window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  };

  const isLoginRoute = () => {
    const hash = window.location.hash || "";
    return /^#\/login/.test(hash);
  };

  const isAuthenticated = () => {
    const services = getGuacServices();
    if (
      services &&
      services.authenticationService &&
      typeof services.authenticationService.getCurrentToken === "function"
    ) {
      return !!services.authenticationService.getCurrentToken();
    }
    if (
      services &&
      services.authenticationService &&
      typeof services.authenticationService.isAuthenticated === "function"
    ) {
      return !!services.authenticationService.isAuthenticated();
    }
    const token = getAuthToken();
    if (token !== null && token !== undefined) {
      return !!token;
    }
    // If we cannot determine auth state, default to visible; login route check still hides it.
    return true;
  };

  const getActiveGroupIdFromHash = () => {
    const hash = window.location.hash || "";
    const match = hash.match(/^#\/client\/([^?]+)/);
    return match && match[1] ? match[1] : null;
  };

  const hasClientStatusUpdate = (clients, ManagedClientState) => {
    if (!ManagedClientState || !ManagedClientState.ConnectionState || !Array.isArray(clients)) {
      return false;
    }
    const { ConnectionState } = ManagedClientState;
    return clients.some((client) => {
      const state = client && client.clientState && client.clientState.connectionState;
      return (
        state === ConnectionState.CONNECTION_ERROR ||
        state === ConnectionState.CLIENT_ERROR ||
        state === ConnectionState.TUNNEL_ERROR ||
        state === ConnectionState.DISCONNECTED
      );
    });
  };

  const buildTabModels = () => {
    const services = getGuacServices();
    if (
      !services ||
      !services.guacClientManager ||
      typeof services.guacClientManager.getManagedClientGroups !== "function"
    ) {
      return [];
    }
    const groups = services.guacClientManager.getManagedClientGroups() || [];
    if (!Array.isArray(groups) || !groups.length) {
      return [];
    }
    const activeGroupId = getActiveGroupIdFromHash();
    return groups
      .map((group) => {
        if (!group) {
          return null;
        }
        const id =
          services.ManagedClientGroup && typeof services.ManagedClientGroup.getIdentifier === "function"
            ? services.ManagedClientGroup.getIdentifier(group)
            : group.id || "";
        if (!id) {
          return null;
        }
        const title =
          services.ManagedClientGroup && typeof services.ManagedClientGroup.getTitle === "function"
            ? services.ManagedClientGroup.getTitle(group)
            : group.title || group.name || id;
        const clients = Array.isArray(group.clients) ? group.clients : [];
        const clientCount = clients.length || 0;
        const needsAttention = hasClientStatusUpdate(clients, services.ManagedClientState);
        const lastUsed = typeof group.lastUsed === "number" ? group.lastUsed : 0;
        const attached = !!group.attached || id === activeGroupId;

        return { id, title, clientCount, needsAttention, lastUsed, attached };
      })
      .filter(Boolean);
  };

  const getTabBarElement = () => document.getElementById(TAB_BAR_ID);

  const getTabListElement = () => {
    const bar = getTabBarElement();
    if (!bar) {
      return null;
    }
    return bar;
  };

  const orderTabs = (tabs) => {
    if (!tabs.length) {
      tabOrder = [];
      return tabs;
    }
    const ids = tabs.map((tab) => tab.id);
    tabOrder = tabOrder.filter((id) => ids.includes(id));
    ids.forEach((id) => {
      if (!tabOrder.includes(id)) {
        tabOrder.push(id);
      }
    });
    const orderMap = new Map(tabOrder.map((id, index) => [id, index]));
    return tabs.slice().sort((a, b) => {
      const indexA = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const indexB = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return indexA - indexB;
    });
  };

  const setTabBarVisibility = (visible) => {
    const bar = getTabBarElement();
    if (!bar) {
      return;
    }
    bar.hidden = !visible;
    bar.setAttribute("aria-hidden", visible ? "false" : "true");
  };

  const renderTabBar = (tabs) => {
    const list = getTabListElement();
    if (!list) {
      return;
    }
    list.innerHTML = "";
    if (!tabs.length) {
      return;
    }
    const fragment = document.createDocumentFragment();
    tabs.forEach((tab) => {
      const tabEl = document.createElement("button");
      tabEl.type = "button";
      tabEl.className = "msp-toolbar__tab";
      if (tab.attached) {
        tabEl.classList.add("is-active");
      }
      if (tab.needsAttention) {
        tabEl.classList.add("needs-attention");
      }
      tabEl.dataset.groupId = tab.id;

      const name = document.createElement("span");
      name.className = "msp-toolbar__tab-name";
      name.textContent = tab.title;
      tabEl.appendChild(name);

      if (tab.clientCount > 1) {
        const count = document.createElement("span");
        count.className = "msp-toolbar__tab-count";
        count.textContent = String(tab.clientCount);
        tabEl.appendChild(count);
      }

      const close = document.createElement("button");
      close.type = "button";
      close.className = "msp-toolbar__tab-close";
      close.setAttribute("aria-label", `Verbreek ${tab.title}`);
      close.textContent = "x";
      tabEl.appendChild(close);

      fragment.appendChild(tabEl);
    });
    list.appendChild(fragment);
  };

  const disconnectClientGroup = (groupId) => {
    if (!groupId) {
      return;
    }
    const services = getGuacServices();
    if (
      !services ||
      !services.guacClientManager ||
      typeof services.guacClientManager.removeManagedClientGroup !== "function"
    ) {
      return;
    }
    const previousOrder = tabOrder.slice();
    const activeGroupId = getActiveGroupIdFromHash();
    try {
      services.guacClientManager.removeManagedClientGroup(groupId);
    } catch (error) {
      // Ignore disconnect errors.
    }
    const remainingGroups =
      typeof services.guacClientManager.getManagedClientGroups === "function"
        ? services.guacClientManager.getManagedClientGroups() || []
        : [];
    const remainingIds = remainingGroups
      .map((group) => {
        if (!group) {
          return null;
        }
        if (
          services.ManagedClientGroup &&
          typeof services.ManagedClientGroup.getIdentifier === "function"
        ) {
          return services.ManagedClientGroup.getIdentifier(group);
        }
        return group.id || null;
      })
      .filter(Boolean);

    tabOrder = tabOrder.filter((id) => remainingIds.includes(id));

    if (!remainingIds.length) {
      goHome();
      syncTabBar();
      return;
    }
    const orderedRemaining = previousOrder.filter((id) => remainingIds.includes(id));
    const closedIndex = previousOrder.indexOf(groupId);
    let nextId = orderedRemaining[0] || remainingIds[0] || null;
    if (closedIndex !== -1) {
      const nextAfterClosed = orderedRemaining.find(
        (id) => previousOrder.indexOf(id) > closedIndex
      );
      if (nextAfterClosed) {
        nextId = nextAfterClosed;
      }
    }
    const shouldSwitch = groupId === activeGroupId || !remainingIds.includes(activeGroupId);
    if (shouldSwitch && nextId) {
      navigateToClientGroup(nextId, { openInNewTab: false });
    }
    syncTabBar();
  };

  const handleTabInteraction = (event) => {
    const tab = event.target.closest(".msp-toolbar__tab");
    if (!tab) {
      return;
    }
    const groupId = tab.dataset.groupId;
    if (!groupId) {
      return;
    }
    const closeClicked = event.target.closest(".msp-toolbar__tab-close");
    if (closeClicked) {
      event.preventDefault();
      event.stopPropagation();
      disconnectClientGroup(groupId);
      return;
    }
    const openInNewTab = shouldOpenInNewTab(event);
    navigateToClientGroup(groupId, { openInNewTab });
    if (!openInNewTab) {
      clearSearchInput();
      blurSearchInput();
    }
  };

  const syncTabBar = () => {
    const toolbarVisible = isToolbarAllowed();
    if (!toolbarVisible) {
      tabSnapshot = "";
      setTabBarVisibility(false);
      updateToolbarHeight();
      return;
    }
    const tabs = orderTabs(buildTabModels());
    setTabBarVisibility(tabs.length > 0);
    const snapshot = JSON.stringify(tabs);
    if (!tabs.length) {
      const list = getTabListElement();
      if (list) {
        list.innerHTML = "";
      }
      tabSnapshot = "";
      updateToolbarHeight();
      return;
    }
    if (snapshot === tabSnapshot) {
      updateToolbarHeight();
      return;
    }
    tabSnapshot = snapshot;
    renderTabBar(tabs);
    updateToolbarHeight();
  };

  const startTabSync = () => {
    if (tabSyncIntervalId) {
      return;
    }
    tabSyncIntervalId = setInterval(syncTabBar, TAB_SYNC_INTERVAL);
    syncTabBar();
  };

  const updateToolbarHeight = () => {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) {
      return;
    }
    const baseHeight =
      getComputedStyle(document.documentElement).getPropertyValue("--msp-toolbar-base-height") ||
      "48px";
    const height = baseHeight.trim() || "48px";
    document.body.style.setProperty("--msp-toolbar-height", height);
    toolbar.style.height = height;
  };

  const updateVisibility = () => {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) {
      return;
    }
    const visible = isToolbarAllowed() && !isLoginRoute();
    toolbar.style.display = visible ? "flex" : "none";
    document.body.classList.toggle(BODY_ACTIVE_CLASS, visible);
    if (!visible) {
      document.body.style.setProperty("--msp-toolbar-height", "0px");
      hideResults();
      syncTabBar();
      return;
    }
    syncTabBar();
    updateToolbarHeight();
  };

  const toggleMenu = () => {
    clearSearchInput();
    triggerMenuShortcut();
  };

  const goSettingsSessions = () => {
    clearSearchInput();
    window.location.hash = "#/settings/sessions";
  };

  const logout = async () => {
    clearSearchInput();
    const services = getGuacServices();
    if (services && services.authenticationService) {
      try {
        await services.authenticationService.logout();
      } catch (error) {
        // Ignore logout errors; visibility will update based on auth state.
      }
    }
    tabOrder = [];
    tabSnapshot = "";
    const list = getTabListElement();
    if (list) {
      list.innerHTML = "";
    }
    setTabBarVisibility(false);
    updateVisibility();
  };

  const goHome = () => {
    clearSearchInput();
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
    const settingsButton = document.getElementById(SETTINGS_BUTTON_ID);
    if (settingsButton) {
      settingsButton.addEventListener("click", goSettingsSessions);
    }
    const logoutButton = document.getElementById(LOGOUT_BUTTON_ID);
    if (logoutButton) {
      logoutButton.addEventListener("click", logout);
    }
    const searchInput = document.getElementById(SEARCH_INPUT_ID);
    if (searchInput) {
      searchInput.addEventListener("focus", () => {
        void ensureConnectionIndex().catch(() => {});
        ensureGuacKeyFilters();
        void updateResults();
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
          void performSearch(true, { openInNewTab: shouldOpenInNewTab(event) });
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
      const handleResultClick = (event) => {
        const target = event.target.closest("[data-connection-id]");
        if (!target) {
          return;
        }
        const openButtonClicked = event.target.closest(".msp-toolbar__result-open");
        const openInNewTab = openButtonClicked ? true : shouldOpenInNewTab(event);
        navigateToConnection(target.dataset.connectionId, { openInNewTab });
        if (!openInNewTab) {
          clearSearchInput();
          blurSearchInput();
        }
      };
      results.addEventListener("click", handleResultClick);
      results.addEventListener("auxclick", handleResultClick);
    }
    const toolbar = document.getElementById(TOOLBAR_ID);
    updateVisibility();
    ensureGuacKeyFilters();
    startTabSync();
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
