import http from "http";
import fs from "fs";
import path from "path";
import url from "url";

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

// Helper to mock res
function mockResponse(res: http.ServerResponse) {
  const customRes = res as any;
  customRes.status = (code: number) => {
    res.statusCode = code;
    return customRes;
  };
  customRes.json = (data: any) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  };
  return customRes;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || "", true);
  const pathname = parsedUrl.pathname || "";

  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  // Route API requests
  if (pathname.startsWith("/api/")) {
    const apiName = pathname.replace("/api/", "");
    const apiPath = path.resolve(process.cwd(), "api", `${apiName}.ts`);
    if (fs.existsSync(apiPath)) {
      try {
        // Read body
        let bodyStr = "";
        req.on("data", chunk => {
          bodyStr += chunk;
        });
        req.on("end", async () => {
          let parsedBody = {};
          if (bodyStr) {
            try {
              parsedBody = JSON.parse(bodyStr);
            } catch (e) {}
          }

          // Mock req/res
          const mockedReq = req as any;
          mockedReq.query = parsedUrl.query;
          mockedReq.body = parsedBody;

          const mockedRes = mockResponse(res);

          // Import and call handler
          const module = await import(url.pathToFileURL(apiPath).href + "?t=" + Date.now());
          const handler = module.default;
          await handler(mockedReq, mockedRes);
        });
      } catch (err: any) {
        console.error("API error:", err);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err.message || "Internal Server Error" }));
      }
    } else {
      res.statusCode = 404;
      res.end("Not Found");
    }
    return;
  }

  // Serve static files from public
  let filePath = path.join(process.cwd(), "public", pathname === "/" ? "index.html" : pathname);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    let contentType = "text/html";
    if (ext === ".css") contentType = "text/css";
    else if (ext === ".js") contentType = "application/javascript";
    else if (ext === ".json") contentType = "application/json";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg") contentType = "image/jpeg";
    
    res.setHeader("Content-Type", contentType);
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.statusCode = 404;
    res.end("Not Found");
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Local dev server running at http://localhost:${PORT}`);
});
