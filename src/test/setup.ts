import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../../test.db");
process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
process.env.NODE_ENV = "test";
