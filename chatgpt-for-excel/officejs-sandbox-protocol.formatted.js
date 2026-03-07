try {
  (function () {
    var e =
        typeof window < "u"
          ? window
          : typeof global < "u"
            ? global
            : typeof globalThis < "u"
              ? globalThis
              : typeof self < "u"
                ? self
                : {},
      t = new e.Error().stack;
    t &&
      ((e._sentryDebugIds = e._sentryDebugIds || {}),
      (e._sentryDebugIds[t] = "02a24dae-f252-422a-addd-f410cc30aa35"),
      (e._sentryDebugIdIdentifier =
        "sentry-dbid-02a24dae-f252-422a-addd-f410cc30aa35"));
  })();
} catch {}
(function () {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const n of document.querySelectorAll('link[rel="modulepreload"]')) s(n);
  new MutationObserver((n) => {
    for (const o of n)
      if (o.type === "childList")
        for (const a of o.addedNodes)
          a.tagName === "LINK" && a.rel === "modulepreload" && s(a);
  }).observe(document, { childList: !0, subtree: !0 });
  function r(n) {
    const o = {};
    return (
      n.integrity && (o.integrity = n.integrity),
      n.referrerPolicy && (o.referrerPolicy = n.referrerPolicy),
      n.crossOrigin === "use-credentials"
        ? (o.credentials = "include")
        : n.crossOrigin === "anonymous"
          ? (o.credentials = "omit")
          : (o.credentials = "same-origin"),
      o
    );
  }
  function s(n) {
    if (n.ep) return;
    n.ep = !0;
    const o = r(n);
    fetch(n.href, o);
  }
})();
var X =
  typeof globalThis < "u"
    ? globalThis
    : typeof window < "u"
      ? window
      : typeof global < "u"
        ? global
        : typeof self < "u"
          ? self
          : {};
function Y(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default")
    ? e.default
    : e;
}
function k(e) {
  if (Object.prototype.hasOwnProperty.call(e, "__esModule")) return e;
  var t = e.default;
  if (typeof t == "function") {
    var r = function s() {
      return this instanceof s
        ? Reflect.construct(t, arguments, this.constructor)
        : t.apply(this, arguments);
    };
    r.prototype = t.prototype;
  } else r = {};
  return (
    Object.defineProperty(r, "__esModule", { value: !0 }),
    Object.keys(e).forEach(function (s) {
      var n = Object.getOwnPropertyDescriptor(e, s);
      Object.defineProperty(
        r,
        s,
        n.get
          ? n
          : {
              enumerable: !0,
              get: function () {
                return e[s];
              },
            },
      );
    }),
    r
  );
}
function g() {
  return "prod".trim().toLowerCase();
}
function _() {
  return !1;
}
function E(e, t) {
  const r = globalThis.console,
    s = r == null ? void 0 : r[e];
  typeof s == "function" && Reflect.apply(s, r, t);
}
function y(e, t) {
  const r = globalThis.console,
    s = r == null ? void 0 : r[e];
  typeof s == "function" && Reflect.apply(s, r, t);
}
const u = g() === "dev" || g() === "staging" || _();
function d(e) {
  return (...t) => {
    u && E(e, t);
  };
}
const q = {
    enabled: u,
    log: d("log"),
    debug: d("debug"),
    info: d("info"),
    warn: d("warn"),
    error: d("error"),
    groupCollapsed: (...e) => {
      u && y("groupCollapsed", e);
    },
    groupEnd: () => {
      u && y("groupEnd", []);
    },
  },
  h = 120,
  S = 800,
  O = 2e4,
  l = "[officejs sandbox logs truncated]";
function b(e, t) {
  return e.length <= t ? e : `${e.slice(0, Math.max(0, t - 3))}...`;
}
function j(e) {
  if (typeof e == "string") return e;
  if (typeof e == "number" || typeof e == "boolean" || typeof e == "bigint")
    return String(e);
  if (e instanceof Error) return e.stack || e.message || "Error";
  if (e === null) return "null";
  if (typeof e > "u") return "undefined";
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
function z() {
  return { entries: [], totalChars: 0, truncated: !1 };
}
function G(e, t, r) {
  if (e.truncated) return;
  if (e.entries.length >= h || e.totalChars >= O) {
    (e.entries.push({ level: "warn", message: l }), (e.truncated = !0));
    return;
  }
  const s = r.length > 0 ? r.map((m) => j(m)).join(" ") : "",
    n = b(s, S),
    o = O - e.totalChars;
  if (o <= 0) {
    (e.entries.push({ level: "warn", message: l }), (e.truncated = !0));
    return;
  }
  const a = b(n, o);
  (e.entries.push({ level: t, message: a }), (e.totalChars += a.length));
}
function I(e) {
  return e.map((t) => `[${t.level}] ${t.message}`).join(`
`);
}
function A(e) {
  return e instanceof Error &&
    typeof e.message == "string" &&
    e.message.length > 0
    ? e.message
    : typeof e == "string" && e.length > 0
      ? e
      : "unknown error";
}
function $(e, t) {
  const r = `Office.js sandbox execution failed: ${A(e)}`;
  return t.length === 0
    ? r
    : `${r}
Office.js sandbox console output:
${I(t)}`;
}
const C = "bps.officejs-sandbox.bootstrap",
  F = "bps.officejs-sandbox.ready",
  R = "bps.officejs-sandbox.run",
  N = "bps.officejs-sandbox.sync_request",
  M = "bps.officejs-sandbox.sync_response",
  L = "bps.officejs-sandbox.result",
  T = "bps.officejs-sandbox.error",
  w = 1,
  p = "__officejsRef",
  U = {
    maxObjectIds: 256,
    maxQueuedOperations: 256,
    maxSerializedChars: 2e5,
    maxMatrixWriteCells: 1e4,
    timeoutMs: 2e4,
  };
function i(e) {
  if (typeof e != "object" || e === null) return !1;
  const t = Object.getPrototypeOf(e);
  return t === Object.prototype || t === null;
}
function P(e) {
  return i(e) && typeof e[p] == "number" && Number.isInteger(e[p]) && e[p] >= 0;
}
function f(e) {
  return e === null ||
    typeof e == "string" ||
    typeof e == "boolean" ||
    (typeof e == "number" && Number.isFinite(e))
    ? !0
    : Array.isArray(e)
      ? e.every((t) => f(t))
      : i(e)
        ? P(e)
          ? !0
          : Object.values(e).every((t) => f(t))
        : !1;
}
function V(e) {
  return JSON.stringify(e).length;
}
function K(e) {
  return !Array.isArray(e) || e.length === 0
    ? 0
    : e.every(Array.isArray)
      ? e.reduce((t, r) => t + r.length, 0)
      : e.length;
}
function H(e) {
  return /^(?:add|autofitColumns|autofitRows|clear|copyFrom|delete|insert|merge|remove|set|sort|unmerge)/u.test(
    e,
  );
}
function x(e) {
  return !i(e) ||
    typeof e.kind != "string" ||
    typeof e.id != "number" ||
    !Number.isInteger(e.id) ||
    e.id < 0
    ? !1
    : e.kind === "root"
      ? e.root === "ctx" || e.root === "excel"
      : typeof e.parentId != "number" ||
          !Number.isInteger(e.parentId) ||
          e.parentId < 0
        ? !1
        : e.kind === "property"
          ? typeof e.property == "string"
          : e.kind === "invoke"
            ? typeof e.method == "string" &&
              Array.isArray(e.args) &&
              e.args.every((t) => f(t))
            : !1;
}
function D(e) {
  return !i(e) ||
    typeof e.kind != "string" ||
    typeof e.targetId != "number" ||
    !Number.isInteger(e.targetId) ||
    e.targetId < 0
    ? !1
    : e.kind === "load"
      ? f(e.spec)
      : e.kind === "set"
        ? typeof e.property == "string" && f(e.value)
        : e.kind === "invoke"
          ? typeof e.method == "string" &&
            typeof e.resultId == "number" &&
            Number.isInteger(e.resultId) &&
            e.resultId >= 0 &&
            typeof e.write == "boolean" &&
            Array.isArray(e.args) &&
            e.args.every((t) => f(t))
          : !1;
}
function J(e) {
  return (
    i(e) &&
    typeof e.requestId == "string" &&
    Array.isArray(e.definitions) &&
    e.definitions.every((t) => x(t)) &&
    Array.isArray(e.commands) &&
    e.commands.every((t) => D(t))
  );
}
function B(e) {
  return (
    i(e) &&
    typeof e.requestId == "string" &&
    i(e.snapshots) &&
    Object.values(e.snapshots).every((t) => f(t))
  );
}
function c(e, t) {
  return (
    i(e) &&
    e.type === t &&
    e.protocolVersion === w &&
    typeof e.invocationId == "string" &&
    typeof e.nonce == "string"
  );
}
function Q(e) {
  return c(e, C);
}
function W(e) {
  return c(e, F);
}
function Z(e) {
  return c(e, R) && typeof e.script == "string" && i(e.limits);
}
function v(e) {
  return c(e, N) && J(e.payload);
}
function ee(e) {
  return c(e, M) && B(e.payload);
}
function te(e) {
  return (
    c(e, L) &&
    Array.isArray(e.logs) &&
    e.logs.every(
      (t) => i(t) && typeof t.level == "string" && typeof t.message == "string",
    ) &&
    (typeof e.result > "u" || f(e.result))
  );
}
function re(e) {
  return (
    c(e, T) &&
    typeof e.error == "string" &&
    Array.isArray(e.logs) &&
    e.logs.every(
      (t) => i(t) && typeof t.level == "string" && typeof t.message == "string",
    )
  );
}
export {
  H as A,
  V as B,
  K as C,
  U as D,
  P as E,
  p as O,
  X as a,
  z as b,
  q as c,
  $ as d,
  J as e,
  B as f,
  k as g,
  G as h,
  f as i,
  Q as j,
  w as k,
  F as l,
  ee as m,
  Z as n,
  L as o,
  T as p,
  N as q,
  Y as r,
  W as s,
  A as t,
  R as u,
  v,
  M as w,
  te as x,
  re as y,
  C as z,
};
