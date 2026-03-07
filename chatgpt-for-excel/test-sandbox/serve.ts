Bun.serve({
  port: 8777,
  hostname: "0.0.0.0",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file("." + path);
    return file.exists().then(exists => {
      if (!exists) return new Response("Not found", { status: 404 });
      return new Response(file);
    });
  },
});
console.log("Serving on http://localhost:8777");
