/**
 * Test the host-side sync request broker with mock Excel objects.
 * Verifies that definitions/commands are correctly replayed against host objects.
 */
import { createSyncRequestBroker, type SyncRequestPayload } from "../sandbox-host";

let passed = 0, failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (e: any) {
      console.log(`  ❌ ${name}: ${e.message}`);
      failed++;
    }
  })();
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// --- Mock Excel objects ---

function createMockExcel() {
  const sheetData: Record<string, any[][]> = {
    "Sheet1": [
      ["Name", "Score"],
      ["Alice", 95],
      ["Bob", 82],
    ],
  };

  let synced = false;

  const mockRange = (sheet: string, addr: string) => {
    const loaded: Record<string, any> = {};
    return {
      _type: "Range",
      _sheet: sheet,
      _addr: addr,
      load(props: string | string[]) {
        // On next sync, populate the loaded properties
        const keys = Array.isArray(props) ? props : typeof props === "string" ? [props] : ["values"];
        for (const key of keys) {
          if (key === "values") loaded.values = sheetData[sheet] ?? [[]];
          if (key === "address") loaded.address = `${sheet}!${addr}`;
          if (key === "rowCount") loaded.rowCount = (sheetData[sheet] ?? []).length;
        }
      },
      get values() { return loaded.values; },
      set values(v: any) { loaded.values = v; },
      toJSON() { return { ...loaded }; },
    };
  };

  const mockSheet = (name: string) => ({
    _type: "Worksheet",
    name,
    getRange(addr: string) { return mockRange(name, addr); },
    toJSON() { return { name }; },
  });

  const mockWorksheets = {
    _type: "WorksheetCollection",
    getItem(name: string) { return mockSheet(name); },
    toJSON() { return {}; },
  };

  const mockWorkbook = {
    _type: "Workbook",
    worksheets: mockWorksheets,
    toJSON() { return {}; },
  };

  const mockContext = {
    _type: "RequestContext",
    workbook: mockWorkbook,
    async sync() { synced = true; },
    toJSON() { return {}; },
  };

  const mockExcelApi = {
    _type: "ExcelNamespace",
    ErrorCodes: { generalException: "GeneralException" },
    toJSON() { return {}; },
  };

  return { mockContext, mockExcelApi, sheetData, getSynced: () => synced };
}

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║  Host-Side Sync Request Broker Tests                ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

// Test 1: Simple property chain resolution
await test("resolve property chain: ctx.workbook.worksheets", async () => {
  const { mockContext, mockExcelApi } = createMockExcel();
  const broker = createSyncRequestBroker({
    context: mockContext, excelApi: mockExcelApi,
    limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
    destructive: false,
  });

  const payload: SyncRequestPayload = {
    requestId: "req-1",
    definitions: [
      { id: 1, kind: "root", root: "ctx" },
      { id: 3, kind: "property", parentId: 1, property: "workbook" },
      { id: 4, kind: "property", parentId: 3, property: "worksheets" },
    ],
    commands: [],
  };

  const response = await broker.handleSyncRequest(payload);
  assert(response.requestId === "req-1", "requestId matches");
  // worksheets should be serialized
  assert(typeof response.snapshots["4"] !== "undefined", "worksheets snapshot exists");
});

// Test 2: Method invocation (getItem)
await test("method invocation: worksheets.getItem('Sheet1')", async () => {
  const { mockContext, mockExcelApi } = createMockExcel();
  const broker = createSyncRequestBroker({
    context: mockContext, excelApi: mockExcelApi,
    limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
    destructive: false,
  });

  const payload: SyncRequestPayload = {
    requestId: "req-1",
    definitions: [
      { id: 1, kind: "root", root: "ctx" },
      { id: 3, kind: "property", parentId: 1, property: "workbook" },
      { id: 4, kind: "property", parentId: 3, property: "worksheets" },
      { id: 5, kind: "property", parentId: 4, property: "getItem" },
      { id: 6, kind: "invoke", parentId: 4, method: "getItem", args: ["Sheet1"] },
    ],
    commands: [
      { kind: "invoke", targetId: 4, method: "getItem", resultId: 6, args: ["Sheet1"], write: false },
    ],
  };

  const response = await broker.handleSyncRequest(payload);
  assert(response.requestId === "req-1", "requestId matches");
  const sheetSnapshot = response.snapshots["6"];
  assert(sheetSnapshot?.name === "Sheet1", `sheet name is Sheet1, got ${JSON.stringify(sheetSnapshot)}`);
});

// Test 3: Load command
await test("load command: range.load('values')", async () => {
  const { mockContext, mockExcelApi } = createMockExcel();
  const broker = createSyncRequestBroker({
    context: mockContext, excelApi: mockExcelApi,
    limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
    destructive: false,
  });

  const payload: SyncRequestPayload = {
    requestId: "req-1",
    definitions: [
      { id: 1, kind: "root", root: "ctx" },
      { id: 3, kind: "property", parentId: 1, property: "workbook" },
      { id: 4, kind: "property", parentId: 3, property: "worksheets" },
      { id: 5, kind: "property", parentId: 4, property: "getItem" },
      { id: 6, kind: "invoke", parentId: 4, method: "getItem", args: ["Sheet1"] },
      { id: 7, kind: "property", parentId: 6, property: "getRange" },
      { id: 8, kind: "invoke", parentId: 6, method: "getRange", args: ["A1:B3"] },
    ],
    commands: [
      { kind: "invoke", targetId: 4, method: "getItem", resultId: 6, args: ["Sheet1"], write: false },
      { kind: "invoke", targetId: 6, method: "getRange", resultId: 8, args: ["A1:B3"], write: false },
      { kind: "load", targetId: 8, spec: ["values"] },
    ],
  };

  const response = await broker.handleSyncRequest(payload);
  const rangeSnapshot = response.snapshots["8"];
  assert(Array.isArray(rangeSnapshot?.values), `range has values array`);
  assert(rangeSnapshot.values[0][0] === "Name", `first cell is "Name"`);
  assert(rangeSnapshot.values[1][1] === 95, `Alice's score is 95`);
});

// Test 4: ctx.sync() is called
await test("ctx.sync() is called during broker sync", async () => {
  const { mockContext, mockExcelApi, getSynced } = createMockExcel();
  const broker = createSyncRequestBroker({
    context: mockContext, excelApi: mockExcelApi,
    limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
    destructive: false,
  });

  assert(!getSynced(), "not synced before");
  await broker.handleSyncRequest({ requestId: "req-1", definitions: [], commands: [] });
  assert(getSynced(), "synced after");
});

// Test 5: Destructive check
await test("destructive=false blocks write commands", async () => {
  const { mockContext, mockExcelApi } = createMockExcel();
  const broker = createSyncRequestBroker({
    context: mockContext, excelApi: mockExcelApi,
    limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
    destructive: false,
  });

  const payload: SyncRequestPayload = {
    requestId: "req-1",
    definitions: [
      { id: 1, kind: "root", root: "ctx" },
      { id: 3, kind: "property", parentId: 1, property: "workbook" },
    ],
    commands: [
      { kind: "set", targetId: 3, property: "name", value: "hacked" },
    ],
  };

  let threw = false;
  try { await broker.handleSyncRequest(payload); }
  catch (e: any) { threw = e.message.includes("destructive=false"); }
  assert(threw, "should throw for set command when destructive=false");
});

// Test 6: Definition conflict detection
await test("conflicting redefinition throws", async () => {
  const { mockContext, mockExcelApi } = createMockExcel();
  const broker = createSyncRequestBroker({
    context: mockContext, excelApi: mockExcelApi,
    limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
    destructive: false,
  });

  await broker.handleSyncRequest({
    requestId: "req-1",
    definitions: [{ id: 1, kind: "root", root: "ctx" }, { id: 3, kind: "property", parentId: 1, property: "workbook" }],
    commands: [],
  });

  let threw = false;
  try {
    await broker.handleSyncRequest({
      requestId: "req-2",
      definitions: [{ id: 3, kind: "property", parentId: 1, property: "DIFFERENT" }],
      commands: [],
    });
  } catch (e: any) { threw = e.message.includes("redefine"); }
  assert(threw, "should throw on conflicting redefinition");
});

// Test 7: Idempotent re-registration is OK
await test("idempotent re-registration is OK", async () => {
  const { mockContext, mockExcelApi } = createMockExcel();
  const broker = createSyncRequestBroker({
    context: mockContext, excelApi: mockExcelApi,
    limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
    destructive: false,
  });

  const defs = [{ id: 1, kind: "root" as const, root: "ctx" }, { id: 3, kind: "property" as const, parentId: 1, property: "workbook" }];
  await broker.handleSyncRequest({ requestId: "req-1", definitions: defs, commands: [] });
  await broker.handleSyncRequest({ requestId: "req-2", definitions: defs, commands: [] });
  // No error = pass
});

// Test 8: Unknown object ID
await test("unknown object ID throws", async () => {
  const { mockContext, mockExcelApi } = createMockExcel();
  const broker = createSyncRequestBroker({
    context: mockContext, excelApi: mockExcelApi,
    limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
    destructive: false,
  });

  let threw = false;
  try {
    await broker.handleSyncRequest({
      requestId: "req-1",
      definitions: [],
      commands: [{ kind: "load", targetId: 999, spec: null }],
    });
  } catch (e: any) { threw = e.message.includes("unknown host object"); }
  assert(threw, "should throw for unknown object ID");
});

// Test 9: Excel root object accessible
await test("Excel root (id=2) resolves to excelApi", async () => {
  const { mockContext, mockExcelApi } = createMockExcel();
  const broker = createSyncRequestBroker({
    context: mockContext, excelApi: mockExcelApi,
    limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
    destructive: false,
  });

  const response = await broker.handleSyncRequest({
    requestId: "req-1",
    definitions: [
      { id: 2, kind: "root", root: "excel" },
      { id: 3, kind: "property", parentId: 2, property: "ErrorCodes" },
    ],
    commands: [],
  });

  assert(response.snapshots["3"]?.generalException === "GeneralException", "ErrorCodes resolved");
});

console.log(`\n${"═".repeat(60)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(60)}`);

process.exit(failed > 0 ? 1 : 0);
