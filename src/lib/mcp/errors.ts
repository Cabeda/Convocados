export class McpError extends Error {
  code: number;
  status: number;
  data?: unknown;
  constructor(message: string, code: number, status = 400, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.status = status;
    this.data = data;
  }
}
