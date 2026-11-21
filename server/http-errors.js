/**
 * Express 4 async error handling and structured error logging.
 *
 * Express 4 does not catch rejected promises from async handlers. Without this, a single failed
 * database query becomes an unhandled rejection and Node exits, taking every user down with it.
 */
import crypto from 'crypto';

const ROUTE_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

/**
 * Wrap a request handler so both synchronous throws and rejected promises reach next(err).
 */
export function asyncRoute(fn) {
  if (typeof fn !== 'function' || fn.length >= 4 || fn.__linecartAsyncRoute) return fn;
  const wrapped = function asyncRouteHandler(req, res, next) {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch(next);
      }
      return result;
    } catch (err) {
      return next(err);
    }
  };
  wrapped.__linecartAsyncRoute = true;
  // Keep router-level properties (express.static, routers) usable
  return Object.assign(wrapped, fn);
}

/**
 * Apply asyncRoute to every handler registered on the app from now on, so new routes are
 * protected automatically. Error middleware (4 arguments) and settings getters are left untouched.
 */
export function wrapAsyncRoutes(app) {
  for (const method of ROUTE_METHODS) {
    const original = app[method].bind(app);
    app[method] = (...args) => {
      // app.get('setting') is a settings getter, not a route
      if (method === 'get' && args.length === 1 && typeof args[0] === 'string') {
        return original(...args);
      }
      return original(...args.map((a) => (typeof a === 'function' ? asyncRoute(a) : a)));
    };
  }
  return app;
}

/**
 * One-line JSON log entries. Never include request bodies, tokens or passwords.
 */
export function logEvent(level, event, fields = {}) {
  const entry = { time: new Date().toISOString(), level, event, ...fields };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function errorFields(err) {
  return {
    errorName: err?.name || 'Error',
    errorMessage: String(err?.message || err),
    errorCode: err?.code,
    stack: err?.stack ? String(err.stack).split('\n').slice(0, 6).join(' | ') : undefined
  };
}

/** Attach a request id for correlating logs with client reports. */
export function requestIdMiddleware(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '');
  req.requestId = /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/**
 * Final error middleware. Keeps the existing response shape ({ status, message }) the apps rely on.
 */
export function errorMiddleware(err, req, res, next) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ status: 400, message: 'Uploaded image exceeds maximum allowed size of 5 MB.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 400, message: 'Invalid JSON request payload.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ status: 413, message: 'Request payload is too large.' });
  }

  logEvent('error', 'request_failed', {
    requestId: req?.requestId,
    method: req?.method,
    path: req?.path,
    userId: req?._resolvedCaller?.id,
    ...errorFields(err)
  });

  if (res.headersSent) {
    return next(err);
  }
  return res.status(500).json({
    status: 500,
    message: 'Internal server error. Please try again.',
    requestId: req?.requestId
  });
}

/**
 * Process-level safety nets.
 * - unhandledRejection: log it and keep serving (every route is already wrapped; this is a backstop).
 * - uncaughtException: log it and exit so the host restarts a clean process.
 */
export function installProcessHandlers({ onFatal } = {}) {
  process.on('unhandledRejection', (reason) => {
    logEvent('error', 'unhandled_rejection', errorFields(reason));
  });
  process.on('uncaughtException', (err) => {
    logEvent('error', 'uncaught_exception', errorFields(err));
    if (typeof onFatal === 'function') {
      try { onFatal(err); } catch {}
    }
    process.exit(1);
  });
}
