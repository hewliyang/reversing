const defaultWalnutBaseUrl = "/walnut-wasm/";

let exportsPromise = null;

function resolveUrl(url) {
  return new URL(url, globalThis.location?.href ?? "http://127.0.0.1/").href;
}

async function readBootConfig(baseUrl) {
  const response = await fetch(new URL("blazor.boot.json", baseUrl));
  if (!response.ok) {
    throw new Error(`Walnut boot config request failed: ${response.status}`);
  }
  return response.json();
}

function createResourceLoader() {
  return (type, _name, defaultUri, integrity) => {
    if (type === "dotnetjs") return defaultUri;

    const url = new URL(defaultUri, globalThis.location.href);
    if (url.origin === globalThis.location.origin) return url.href;

    return fetch(url.href, {
      credentials: "omit",
      integrity,
    });
  };
}

async function createWalnutExports(options = {}) {
  const baseUrl = resolveUrl(options.walnutBaseUrl ?? defaultWalnutBaseUrl);
  const [{ dotnet }, bootConfig] = await Promise.all([
    import(new URL("dotnet.js", baseUrl).href),
    readBootConfig(baseUrl),
  ]);

  const runtime = await dotnet
    .withConfig(structuredClone(bootConfig))
    .withResourceLoader(createResourceLoader())
    .create();

  const assemblyName = runtime.getConfig().mainAssemblyName;
  if (!assemblyName) throw new Error("Walnut reader assembly unavailable");

  return runtime.getAssemblyExports(assemblyName);
}

export function getWalnutExports(options = {}) {
  exportsPromise ??= createWalnutExports(options).catch((error) => {
    exportsPromise = null;
    throw error;
  });
  return exportsPromise;
}
