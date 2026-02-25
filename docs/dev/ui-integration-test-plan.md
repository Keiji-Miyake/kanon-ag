# Implementation Plan: UI Chat Function Result Integration Test

This plan outlines the steps to simulate and verify the integration of orchestration results into the Kanon Dashboard UI (VS Code Webview).

## 1. Objective
Ensure that the final report generated at the end of an orchestration run is correctly transmitted via WebSockets and displayed prominently in the Kanon Dashboard UI.

## 2. Proposed Changes

### 2.1 CLI: Update `src/cli/orchestrate.ts`
- **Modify `runReport` function:** Add a call to `Logger.log(reportContent, 'result')` to stream the final report to the UI dashboard.
- **Why:** Currently, the report is only sent to the `antigravity chat` command line tool. Streaming it to the UI ensures the user doesn't have to switch contexts to see the summary.

### 2.2 Extension: Update `src/extension/src/extension.ts`
- **Update Webview Script:**
    - Modify `getRoleInfo(agentName)` to recognize `'result'` as a special agent.
    - Map `'result'` to a new CSS class `agent-result`.
- **Update Webview Styles:**
    - Add `.agent-result` styling:
        - `border-left-color: #4CAF50` (Green)
        - `background-color: rgba(76, 175, 80, 0.1)`
        - `font-weight: bold`
- **Why:** This makes the final result visually distinct from the intermediate "Thinking Logs".

### 2.3 Testing: Create `src/cli/test-ui-integration.ts`
- **Functionality:**
    - Start the UI server in a child process.
    - Connect a mock WebSocket client.
    - Call the `runReport` logic (or a mock version of it).
    - Listen for messages on the mock WebSocket client.
    - Verify that a message with `agent: 'result'` is received.
- **Why:** To provide automated assurance that the integration between the CLI orchestrator and the UI server works as expected.

## 3. Verification Plan

### 3.1 Automated Tests
- **Test File:** `src/cli/test-ui-integration.ts`
- **Test Cases:**
    1. **Server Startup:** Verify HTTP (3000) and WS (3001) ports are listening.
    2. **WS Handshake:** Verify the mock client receives the "Connected to Kanon Orchestrator" message.
    3. **Result Message:** Verify that triggering a report results in a WebSocket message with `agent: "result"`.
    4. **Formatting:** Verify the message contains the expected task summary and plan snippets.

### 3.2 Manual Verification (Simulated)
1. Run `kanon ui` to start the server.
2. Open VS Code with the Kanon Extension installed.
3. Open the "Kanon Dashboard" view.
4. Run `kanon run --task="Create a hello world in TS"` in the terminal.
5. Observe that the "Final Report" appears in the Dashboard with a green highlight at the end of the run.

## 4. Dependencies
- `ws` (WebSocket library) - Already present in `package.json`.
- `ts-node` - For running the integration test.

## 5. Risk & Mitigations
- **Port Conflict:** If port 3001 is already in use, the test might fail.
    - *Mitigation:* The test should check for port availability and try an alternative if necessary, or simply report a clear error.
- **WebSocket Latency:** Race condition between sending a message and the client receiving it.
    - *Mitigation:* Use `async/await` with a timeout for the mock client to wait for messages.
