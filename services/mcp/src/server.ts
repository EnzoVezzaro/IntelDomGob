// MCP server entrypoint. Boots the MCP service as a client of the API gateway.
import { config } from "@intel.dom.gob/config";
import { McpServer } from "./index";

const port = Number(process.env.MCP_PORT ?? 4100);
const server = new McpServer({
  apiBaseUrl: `http://${config.domain === "localhost" ? "api" : "api." + config.domain}:${config.apiPort}`,
  token: process.env.INTEL_API_TOKEN,
  port,
});
server.start();
