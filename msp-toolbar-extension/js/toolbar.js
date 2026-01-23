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
  const ACTIVE_USER_CACHE_TTL = 15000;
  const ACTIVE_USER_ERROR_TTL = 20000;
  const USER_DIRECTORY_TTL = 60000;

  let connectionIndex = null;
  let connectionIndexPromise = null;
  let searchRequestId = 0;
  let tabSyncIntervalId = null;
  let tabSnapshot = "";
  let tabOrder = [];
  const activeUserCache = new Map();
  const userDirectoryCache = new Map();

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

  const buildActiveConnectionsUrl = (connectionId, options = {}) => {
    const includeToken = options.includeToken !== false;
    const dataSource = options.dataSource || getDataSource();
    const apiRoot = getApiRoot();
    const basePath = `${apiRoot}/api/session/data/${encodeURIComponent(
      dataSource
    )}/connections/${encodeURIComponent(connectionId)}/activeConnections`;
    const token = getAuthToken();
    if (!token || !includeToken) {
      return basePath;
    }
    const url = new URL(basePath, window.location.origin);
    url.searchParams.set("token", token);
    return url.toString();
  };

  const buildActiveConnectionsIndexUrl = (options = {}) => {
    const includeToken = options.includeToken !== false;
    const dataSource = options.dataSource || getDataSource();
    const apiRoot = getApiRoot();
    const basePath = `${apiRoot}/api/session/data/${encodeURIComponent(
      dataSource
    )}/activeConnections`;
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

  const isActiveUserCacheFresh = (entry) => {
    if (!entry || typeof entry.fetchedAt !== "number") {
      return false;
    }
    const ttl = entry.error ? ACTIVE_USER_ERROR_TTL : ACTIVE_USER_CACHE_TTL;
    return Date.now() - entry.fetchedAt < ttl;
  };

  const isActiveConnectionsIndexFresh = (entry) => isActiveUserCacheFresh(entry);

  const extractActiveUsernames = (payload) => {
    const isUserLikeObject = (value) =>
      !!(
        value &&
        typeof value === "object" &&
        (value.username ||
          value.userName ||
          value.userIdentifier ||
          (value.user && value.user.username))
      );
    const collectEntries = (value) => {
      if (!value) {
        return [];
      }
      if (Array.isArray(value)) {
        return value;
      }
      if (typeof value === "object") {
        if (isUserLikeObject(value)) {
          return [value];
        }
        if (value.activeConnections) {
          return collectEntries(value.activeConnections);
        }
        if (value.data) {
          return collectEntries(value.data);
        }
        return Object.values(value);
      }
      return [];
    };
    const entries = collectEntries(payload);
    const usernames = entries
      .map((entry) => {
        if (!entry) {
          return null;
        }
        if (typeof entry === "string") {
          return entry;
        }
        if (entry.username) {
          return entry.username;
        }
        if (entry.user && entry.user.username) {
          return entry.user.username;
        }
        if (entry.userName) {
          return entry.userName;
        }
        if (entry.userIdentifier) {
          return entry.userIdentifier;
        }
        return null;
      })
      .filter(Boolean)
      .map((name) => String(name).trim())
      .filter(Boolean);
    const unique = [];
    const seen = new Set();
    usernames.forEach((name) => {
      if (seen.has(name)) {
        return;
      }
      seen.add(name);
      unique.push(name);
    });
    return unique;
  };

  const getConnectionIdFromActiveEntry = (entry) => {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    return (
      entry.connectionIdentifier ||
      entry.connectionId ||
      entry.connectionIdentifierId ||
      (entry.connection &&
        (entry.connection.identifier || entry.connection.id || entry.connection.connectionIdentifier)) ||
      entry.identifier ||
      entry.id ||
      null
    );
  };

  const extractActiveUsersByConnection = (payload) => {
    const map = new Map();
    const addUsers = (connectionId, users) => {
      if (!connectionId || !users || !users.length) {
        return;
      }
      const key = String(connectionId);
      const existing = map.get(key) || [];
      const seen = new Set(existing);
      users.forEach((user) => {
        if (!seen.has(user)) {
          seen.add(user);
          existing.push(user);
        }
      });
      map.set(key, existing);
    };
    const handleEntry = (entry, fallbackId = null) => {
      if (!entry) {
        return;
      }
      if (Array.isArray(entry)) {
        const users = extractActiveUsernames(entry);
        if (fallbackId) {
          addUsers(fallbackId, users);
          return;
        }
        entry.forEach((item) => handleEntry(item, null));
        return;
      }
      if (typeof entry !== "object") {
        return;
      }
      const connectionId = getConnectionIdFromActiveEntry(entry) || fallbackId;
      const users = extractActiveUsernames(
        entry.activeConnections || entry.users || entry.activeUsers || entry.connections || entry
      );
      if (connectionId) {
        addUsers(connectionId, users);
      }
      if (entry.activeConnections && Array.isArray(entry.activeConnections)) {
        entry.activeConnections.forEach((item) => handleEntry(item, null));
      }
    };

    if (!payload) {
      return map;
    }
    if (payload.data) {
      return extractActiveUsersByConnection(payload.data);
    }
    if (payload.activeConnections) {
      handleEntry(payload.activeConnections, null);
    }
    if (Array.isArray(payload)) {
      payload.forEach((entry) => handleEntry(entry, null));
      return map;
    }
    if (typeof payload === "object") {
      Object.entries(payload).forEach(([key, value]) => {
        if (value && (Array.isArray(value) || typeof value === "object")) {
          handleEntry(value, key);
        }
      });
      handleEntry(payload, null);
    }
    return map;
  };

  const fetchActiveConnections = async (connectionId, includeToken, dataSource) => {
    const url = buildActiveConnectionsUrl(connectionId, { includeToken, dataSource });
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  const buildUsersIndexUrl = (options = {}) => {
    const includeToken = options.includeToken !== false;
    const dataSource = options.dataSource || getDataSource();
    const apiRoot = getApiRoot();
    const basePath = `${apiRoot}/api/session/data/${encodeURIComponent(dataSource)}/users`;
    const token = getAuthToken();
    if (!token || !includeToken) {
      return basePath;
    }
    const url = new URL(basePath, window.location.origin);
    url.searchParams.set("token", token);
    return url.toString();
  };

  const fetchUsersIndex = async (includeToken, dataSource) => {
    const url = buildUsersIndexUrl({ includeToken, dataSource });
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  const requestUsersIndex = async (dataSource) => {
    const token = getAuthToken();
    try {
      return await fetchUsersIndex(false, dataSource);
    } catch (error) {
      if (token && (error.status === 401 || error.status === 403)) {
        return fetchUsersIndex(true, dataSource);
      }
      throw error;
    }
  };

  const isUserDirectoryFresh = (entry) => {
    if (!entry || typeof entry.fetchedAt !== "number") {
      return false;
    }
    return Date.now() - entry.fetchedAt < USER_DIRECTORY_TTL;
  };

  const extractUserDirectory = (payload) => {
    const map = new Map();
    const addMapping = (key, value) => {
      if (!key || !value) {
        return;
      }
      const k = String(key);
      const v = String(value).trim();
      if (!v) {
        return;
      }
      if (!map.has(k)) {
        map.set(k, v);
      }
    };

    const deriveDisplayName = (user) => {
      if (!user || typeof user !== "object") {
        return null;
      }
      return (
        user.username ||
        user.userName ||
        user.displayName ||
        user.name ||
        user.email ||
        user.identifier ||
        user.id ||
        null
      );
    };

    const handleEntry = (key, entry) => {
      if (!entry) {
        return;
      }
      if (typeof entry === "string") {
        addMapping(key, entry);
        addMapping(entry, entry);
        return;
      }
      if (typeof entry !== "object") {
        return;
      }
      const displayName = deriveDisplayName(entry);
      const identifiers = [
        key,
        entry.identifier,
        entry.id,
        entry.userIdentifier,
        entry.username,
        entry.userName
      ];
      identifiers.filter(Boolean).forEach((id) => addMapping(id, displayName || id));
    };

    const entries = payload && payload.data ? payload.data : payload;
    if (Array.isArray(entries)) {
      entries.forEach((entry) => handleEntry(entry && (entry.username || entry.id), entry));
      return map;
    }
    if (entries && typeof entries === "object") {
      Object.entries(entries).forEach(([key, entry]) => handleEntry(key, entry));
    }
    return map;
  };

  const getUserDirectory = (dataSource) => {
    if (!dataSource) {
      return Promise.resolve(new Map());
    }
    const cached = userDirectoryCache.get(dataSource);
    if (cached) {
      if (cached.promise) {
        return cached.promise;
      }
      if (isUserDirectoryFresh(cached)) {
        return Promise.resolve(cached.map || new Map());
      }
    }
    const promise = requestUsersIndex(dataSource)
      .then((payload) => {
        const map = extractUserDirectory(payload);
        userDirectoryCache.set(dataSource, {
          map,
          fetchedAt: Date.now(),
          error: false
        });
        return map;
      })
      .catch(() => {
        const map = new Map();
        userDirectoryCache.set(dataSource, {
          map,
          fetchedAt: Date.now(),
          error: true
        });
        return map;
      });
    userDirectoryCache.set(dataSource, {
      promise,
      fetchedAt: Date.now(),
      error: false
    });
    return promise;
  };

  const resolveUserDisplayNames = (users, dataSource) => {
    if (!Array.isArray(users) || users.length === 0) {
      return Promise.resolve(users);
    }
    return getUserDirectory(dataSource)
      .then((map) => {
        if (!map || map.size === 0) {
          return users;
        }
        const resolved = users.map((user) => map.get(user) || user);
        return resolved;
      })
      .catch(() => users);
  };

  const fetchActiveConnectionsIndex = async (includeToken, dataSource) => {
    const url = buildActiveConnectionsIndexUrl({ includeToken, dataSource });
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  const requestActiveConnections = async (connectionId, dataSource) => {
    const token = getAuthToken();
    try {
      return await fetchActiveConnections(connectionId, false, dataSource);
    } catch (error) {
      if (token && (error.status === 401 || error.status === 403)) {
        return fetchActiveConnections(connectionId, true, dataSource);
      }
      throw error;
    }
  };

  const requestActiveConnectionsIndex = async (dataSource) => {
    const token = getAuthToken();
    try {
      return await fetchActiveConnectionsIndex(false, dataSource);
    } catch (error) {
      if (token && (error.status === 401 || error.status === 403)) {
        return fetchActiveConnectionsIndex(true, dataSource);
      }
      throw error;
    }
  };

  const activeConnectionsIndexCache = new Map();
  let activeConnectionsIndexSelectionCache = null;

  const getCandidateDataSources = () => {
    const candidates = new Set();
    const primary = getDataSource();
    if (primary) {
      candidates.add(primary);
    }
    candidates.add("postgresql");
    candidates.add("postgresql-shared");
    return Array.from(candidates);
  };

  const getConnectionIdSet = () => {
    if (!Array.isArray(connectionIndex) || connectionIndex.length === 0) {
      return new Set();
    }
    return new Set(connectionIndex.map((connection) => String(connection.id)));
  };

  const countMatches = (map, idSet) => {
    if (!map || !map.size || !idSet || idSet.size === 0) {
      return 0;
    }
    let matches = 0;
    map.forEach((_, key) => {
      if (idSet.has(String(key))) {
        matches += 1;
      }
    });
    return matches;
  };

  const getActiveConnectionsIndexForDataSource = (dataSource) => {
    if (!dataSource) {
      return Promise.resolve({ map: new Map(), error: true, dataSource: null });
    }
    const cached = activeConnectionsIndexCache.get(dataSource);
    if (cached) {
      if (cached.promise) {
        return cached.promise;
      }
      if (isActiveConnectionsIndexFresh(cached)) {
        return Promise.resolve({
          map: cached.map || new Map(),
          error: !!cached.error,
          dataSource
        });
      }
    }
    const promise = requestActiveConnectionsIndex(dataSource)
      .then((payload) => {
        const map = extractActiveUsersByConnection(payload);
        activeConnectionsIndexCache.set(dataSource, {
          map,
          fetchedAt: Date.now(),
          error: false
        });
        return { map, error: false, dataSource };
      })
      .catch(() => {
        const map = new Map();
        activeConnectionsIndexCache.set(dataSource, {
          map,
          fetchedAt: Date.now(),
          error: true
        });
        return { map, error: true, dataSource };
      });
    activeConnectionsIndexCache.set(dataSource, {
      promise,
      fetchedAt: Date.now(),
      error: false
    });
    return promise;
  };

  const selectActiveConnectionsIndex = async () => {
    const candidates = getCandidateDataSources();
    if (!candidates.length) {
      return { map: new Map(), error: true, dataSource: null };
    }
    const idSet = getConnectionIdSet();
    const results = await Promise.all(
      candidates.map((dataSource) => getActiveConnectionsIndexForDataSource(dataSource))
    );
    let best = results[0];
    let bestScore = -1;
    results.forEach((result) => {
      if (!result || result.error) {
        return;
      }
      const score = idSet.size ? countMatches(result.map, idSet) : result.map.size;
      if (score > bestScore) {
        bestScore = score;
        best = result;
      }
    });
    return best || { map: new Map(), error: true, dataSource: candidates[0] };
  };

  const getActiveConnectionsIndex = () => {
    if (activeConnectionsIndexSelectionCache) {
      if (activeConnectionsIndexSelectionCache.promise) {
        return activeConnectionsIndexSelectionCache.promise;
      }
      if (isActiveConnectionsIndexFresh(activeConnectionsIndexSelectionCache)) {
        return Promise.resolve({
          map: activeConnectionsIndexSelectionCache.map || new Map(),
          error: !!activeConnectionsIndexSelectionCache.error,
          dataSource: activeConnectionsIndexSelectionCache.dataSource || getDataSource()
        });
      }
    }
    const promise = selectActiveConnectionsIndex()
      .then((result) => {
        activeConnectionsIndexSelectionCache = {
          map: result.map || new Map(),
          fetchedAt: Date.now(),
          error: !!result.error,
          dataSource: result.dataSource || getDataSource()
        };
        return {
          map: result.map || new Map(),
          error: !!result.error,
          dataSource: result.dataSource || getDataSource()
        };
      })
      .catch(() => {
        const map = new Map();
        activeConnectionsIndexSelectionCache = {
          map,
          fetchedAt: Date.now(),
          error: true,
          dataSource: getDataSource()
        };
        return { map, error: true, dataSource: getDataSource() };
      });
    activeConnectionsIndexSelectionCache = {
      promise,
      fetchedAt: Date.now(),
      error: false,
      dataSource: getDataSource()
    };
    return promise;
  };

  const fetchActiveUsersForConnection = (connectionId) => {
    if (!connectionId) {
      return Promise.resolve([]);
    }
    const cached = activeUserCache.get(connectionId);
    if (cached) {
      if (cached.promise) {
        return cached.promise;
      }
      if (isActiveUserCacheFresh(cached)) {
        return Promise.resolve(cached.users || []);
      }
    }
    const promise = getActiveConnectionsIndex()
      .then(({ map, error, dataSource }) => {
        const key = String(connectionId);
        if (map && map.size) {
          const users = map.get(key) || [];
          return resolveUserDisplayNames(users, dataSource).then((resolved) => {
            activeUserCache.set(connectionId, {
              users: resolved,
              fetchedAt: Date.now(),
              error: false
            });
            return resolved;
          });
        }
        if (!error && map && map.size === 0) {
          activeUserCache.set(connectionId, {
            users: [],
            fetchedAt: Date.now(),
            error: false
          });
          return [];
        }
        return requestActiveConnections(connectionId, dataSource)
          .then((payload) => {
            const users = extractActiveUsernames(payload);
            return resolveUserDisplayNames(users, dataSource).then((resolved) => {
              activeUserCache.set(connectionId, {
                users: resolved,
                fetchedAt: Date.now(),
                error: false
              });
              return resolved;
            });
          })
          .catch(() => {
            activeUserCache.set(connectionId, {
              users: [],
              fetchedAt: Date.now(),
              error: true
            });
            return [];
          });
      })
      .catch(() => {
        activeUserCache.set(connectionId, {
          users: [],
          fetchedAt: Date.now(),
          error: true
        });
        return [];
      });
    activeUserCache.set(connectionId, { promise, fetchedAt: Date.now(), error: false });
    return promise;
  };

  const formatActiveUserList = (users) => {
    if (!Array.isArray(users) || users.length === 0) {
      return "";
    }
    const maxVisible = 2;
    if (users.length <= maxVisible) {
      return users.join(", ");
    }
    const remaining = users.length - maxVisible;
    return `${users.slice(0, maxVisible).join(", ")} +${remaining}`;
  };

  const updateActiveUsersElement = (element, users) => {
    if (!element || !element.isConnected) {
      return;
    }
    if (!Array.isArray(users) || users.length === 0) {
      element.textContent = "";
      element.hidden = true;
      element.classList.remove("is-active");
      element.removeAttribute("title");
      return;
    }
    element.textContent = `In gebruik door: ${formatActiveUserList(users)}`;
    element.title = users.join(", ");
    element.hidden = false;
    element.classList.add("is-active");
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

      const users = document.createElement("span");
      users.className = "msp-toolbar__result-users";
      users.dataset.connectionId = match.id;
      users.hidden = true;
      mainButton.appendChild(users);

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "msp-toolbar__result-open";
      openButton.dataset.connectionId = match.id;
      openButton.setAttribute("aria-label", `Open ${match.name} in nieuw tabblad`);
      openButton.innerHTML = `
        <svg class="msp-toolbar__result-open-icon" width="24" height="24" fill="none" viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <path d="M6.25 4.75a1.5 1.5 0 0 0-1.5 1.5v11.5a1.5 1.5 0 0 0 1.5 1.5h11.5a1.5 1.5 0 0 0 1.5-1.5v-4a1 1 0 1 1 2 0v4a3.5 3.5 0 0 1-3.5 3.5H6.25a3.5 3.5 0 0 1-3.5-3.5V6.25a3.5 3.5 0 0 1 3.5-3.5h4a1 1 0 1 1 0 2h-4Zm6.5-1a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v6.5a1 1 0 1 1-2 0V6.164l-4.793 4.793a1 1 0 1 1-1.414-1.414l4.793-4.793H13.75a1 1 0 0 1-1-1Z" fill="#ffffff"/>
        </svg>
      `;

      item.appendChild(mainButton);
      item.appendChild(openButton);
      results.appendChild(item);

      fetchActiveUsersForConnection(match.id)
        .then((activeUsers) => {
          if (!users.isConnected || users.dataset.connectionId !== match.id) {
            return;
          }
          updateActiveUsersElement(users, activeUsers);
        })
        .catch(() => {
          updateActiveUsersElement(users, []);
        });
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
          <svg class="msp-toolbar__icon" width="24" height="24" fill="none" viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M10.55 2.533a2.25 2.25 0 0 1 2.9 0l6.75 5.695c.508.427.8 1.056.8 1.72v9.802a1.75 1.75 0 0 1-1.75 1.75h-3a1.75 1.75 0 0 1-1.75-1.75v-5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0-.75.75v5a1.75 1.75 0 0 1-1.75 1.75h-3A1.75 1.75 0 0 1 3 19.75V9.947c0-.663.292-1.292.8-1.72l6.75-5.694Z" fill="#ffffff"/>
          </svg>
        </button>
        <button id="${MENU_BUTTON_ID}" class="msp-toolbar__button msp-toolbar__button--icon" type="button"
          aria-label="Open menu">
          <svg class="msp-toolbar__icon" width="24" height="24" fill="none" viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M4.75 4A2.75 2.75 0 0 0 2 6.75v10.5A2.75 2.75 0 0 0 4.75 20h14.5A2.75 2.75 0 0 0 22 17.25V6.75A2.75 2.75 0 0 0 19.25 4H4.75ZM9 18.5v-13h10.25c.69 0 1.25.56 1.25 1.25v10.5c0 .69-.56 1.25-1.25 1.25H9Z" fill="#ffffff"/>
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
          <svg class="msp-toolbar__icon" width="24" height="24" fill="none" viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M16.75 2.001a5.25 5.25 0 0 0-5.005 6.84l-9.068 9.38a2.344 2.344 0 1 0 3.37 3.257l8.963-9.272A5.25 5.25 0 0 0 21.797 5.8a.75.75 0 0 0-1.25-.323L17.36 8.66l-2.06-2.06 3.16-3.162a.75.75 0 0 0-.333-1.254 5.255 5.255 0 0 0-1.378-.183Z" fill="#ffffff"/>
          </svg>
        </button>
        <button id="${LOGOUT_BUTTON_ID}" class="msp-toolbar__button msp-toolbar__button--icon" type="button"
          aria-label="Uitloggen">
          <svg class="msp-toolbar__icon" width="24" height="24" fill="none" viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M11 17.5a6.47 6.47 0 0 1 1.022-3.5h-7.77a2.249 2.249 0 0 0-2.249 2.25v.919c0 .572.179 1.13.51 1.596C4.057 20.929 6.58 22 10 22c.931 0 1.796-.08 2.592-.238A6.475 6.475 0 0 1 11 17.5ZM10 2.005a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" fill="#ffffff"/>
            <path d="M23 17.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Zm-4.647-2.853a.5.5 0 0 0-.707.707L19.293 17H15a.5.5 0 1 0 0 1h4.293l-1.647 1.647a.5.5 0 0 0 .707.707l2.5-2.5a.497.497 0 0 0 .147-.345V17.5a.498.498 0 0 0-.15-.357l-2.497-2.496Z" fill="#ffffff"/>
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

  const getManagedClientGroupId = (services, group) => {
    if (!group) {
      return null;
    }
    if (
      services &&
      services.ManagedClientGroup &&
      typeof services.ManagedClientGroup.getIdentifier === "function"
    ) {
      return services.ManagedClientGroup.getIdentifier(group);
    }
    return group.id || null;
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
        const id = getManagedClientGroupId(services, group) || "";
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

      const reconnect = document.createElement("button");
      reconnect.type = "button";
      reconnect.className = "msp-toolbar__tab-reconnect";
      reconnect.setAttribute("aria-label", `Verversen ${tab.title}`);
      reconnect.innerHTML = `
        <svg class="msp-toolbar__tab-reconnect-icon" width="24" height="24" fill="none" viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <path d="M12 4.75a7.25 7.25 0 1 0 7.201 6.406c-.068-.588.358-1.156.95-1.156.515 0 .968.358 1.03.87a9.25 9.25 0 1 1-3.432-6.116V4.25a1 1 0 1 1 2.001 0v2.698l.034.052h-.034v.25a1 1 0 0 1-1 1h-3a1 1 0 1 1 0-2h.666A7.219 7.219 0 0 0 12 4.75Z" fill="#ffffff"/>
        </svg>
      `;
      const close = document.createElement("button");
      close.type = "button";
      close.className = "msp-toolbar__tab-close";
      close.setAttribute("aria-label", `Verbreek ${tab.title}`);
      close.innerHTML = `
        <svg class="msp-toolbar__tab-close-icon" width="12" height="12" fill="none" viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <path d="m4.21 4.387.083-.094a1 1 0 0 1 1.32-.083l.094.083L12 10.585l6.293-6.292a1 1 0 1 1 1.414 1.414L13.415 12l6.292 6.293a1 1 0 0 1 .083 1.32l-.083.094a1 1 0 0 1-1.32.083l-.094-.083L12 13.415l-6.293 6.292a1 1 0 0 1-1.414-1.414L10.585 12 4.293 5.707a1 1 0 0 1-.083-1.32l.083-.094-.083.094Z" fill="currentColor"/>
        </svg>
      `;

      const actions = document.createElement("span");
      actions.className = "msp-toolbar__tab-actions";
      actions.appendChild(reconnect);
      actions.appendChild(close);
      tabEl.appendChild(actions);

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
        return getManagedClientGroupId(services, group);
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
    const reconnectClicked = event.target.closest(".msp-toolbar__tab-reconnect");
    if (reconnectClicked) {
      event.preventDefault();
      event.stopPropagation();
      window.location.reload();
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
    const toolbarVisible = isToolbarAllowed() && !isLoginRoute() && isAuthenticated();
    if (!toolbarVisible) {
      stopTabSync();
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
