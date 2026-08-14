import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.RABBITHOLE_NO_BROWSER = "1";
process.env.RABBITHOLE_MAX_BLOCK_MS = "50";
process.env.RABBITHOLE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-mcp-rearm-"));

const { openRabbithole, answerBranch } = await import("../../src/node/rabbithole.js");
const { closeAllSessions, getSession } = await import("../../src/node/sessions.js");
const { defaultFsStore } = await import("../../src/node/fs-store.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detachEvents(session) {
  return session.outboundEvents.filter((event) => event.data.type === "agent_status" && event.data.attached === false);
}

function rootNode(id = "root") {
  return {
    id,
    parent_id: null,
    title: "Root",
    markdown: "Root",
    base_url: null,
    base_url_source: null,
    origin: null,
    position: { x: 0, y: 0 },
    size: null,
    font_scale: 1,
    collapsed: false,
    status: "answered",
    read: true,
    created_at: new Date().toISOString(),
  };
}

async function runKeepListeningAndLiveReattachFixture() {
  const first = await openRabbithole({ title: "MCP Rearm", content: "Root" });
  assert.equal(first.status, "keep_listening");
  assert(first.hole_id, "keep_listening should include hole_id");
  assert(first.session_id, "keep_listening should include session_id");
  assert.match(first.instruction, /open_rabbithole/);
  assert.match(first.instruction, new RegExp(first.hole_id));

  const session = getSession(first.session_id);
  assert(session, "new hole should still have a live session after rearm");
  const originalUrl = session.url;
  assert.equal(session.agentAttached, true, "rearm should not detach immediately");
  assert.equal(session.waiters.length, 0, "rearm should remove the waiter it released");
  assert.equal(detachEvents(session).length, 0, "rearm should not broadcast detach immediately");
  await sleep(20);
  assert.equal(detachEvents(session).length, 0, "detach should not broadcast inside the grace window");

  await defaultFsStore.putAsset(session.holeId, "paste-live.png", Buffer.from([1, 2, 3, 4]));
  session.assetNames.add("paste-live.png");
  const ask = await session.handleBrowserEvent({
    type: "branch_request",
    parent_id: session.rootId,
    request_id: "req-live",
    node_id: "node-live",
    selected_text: "Root",
    question: "Explain this",
    attachment_assets: ["paste-live.png"],
  });
  assert.equal(session.queue.length, 1, "ask during rearm gap should stay queued");

  const branch = await openRabbithole({ holeId: first.hole_id });
  assert.equal(branch.status, "branch_request");
  assert.equal(branch.request_id, ask.request_id);
  assert.equal(branch.node_id, ask.node_id);
  assert.equal(branch.session_id, session.id);
  assert.equal(branch.attachments.length, 1);
  assert.equal(branch.attachments[0].kind, "image");
  assert.equal(branch.attachments[0].source, "pasted_image");
  assert.equal(path.isAbsolute(branch.attachments[0].image_path), true);
  await fs.realpath(branch.attachments[0].image_path);
  assert.deepEqual(await fs.readFile(branch.attachments[0].image_path), Buffer.from([1, 2, 3, 4]));
  assert.equal(session.url, originalUrl, "live reattach should not open a new local session");
  assert.equal(session.queue.length, 0, "reattach should drain the queued branch request");
  assert.equal(session.waiters.length, 0);
  assert.equal(session.rearmDetachTimer, null, "reattach should clear the grace timer");

  const afterAnswer = await answerBranch({
    sessionId: branch.session_id,
    requestId: branch.request_id,
    title: "Answer",
    content: "Answered.",
  });
  assert.equal(afterAnswer.status, "keep_listening");
  assert.equal(session.pendingByRequest.size, 0);
  assert.equal(session.inFlightBranchRequests.size, 0);
  assert.equal(session.waiters.length, 0, "answer_branch rearm should not leak waiters");
  assert.equal(detachEvents(session).length, 0, "answer_branch rearm should stay attached during grace");

  const second = await openRabbithole({ holeId: first.hole_id });
  assert.equal(second.status, "keep_listening");
  assert.equal(session.queue.length, 0);
  assert.equal(session.waiters.length, 0, "repeated rearm should not leak waiters");
  assert.equal(detachEvents(session).length, 0, "repeated rearm should not broadcast detach inside grace");

  const controller = new AbortController();
  const cancelledWait = session.waitForEvent(controller.signal);
  controller.abort();
  const cancelled = await cancelledWait;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(session.agentAttached, false, "hard MCP cancellation should still detach");
  assert.equal(detachEvents(session).at(-1)?.data.reason, "cancelled");
  assert.equal(session.waiters.length, 0, "hard cancellation should remove its waiter");

  console.log("ok rearm: keep_listening shape, grace, live reattach, and waiter cleanup");
}

async function runSavedAskRequeueFixture() {
  const holeId = "mcp-rearm-saved";
  const root = rootNode();
  const child = {
    id: "saved-child",
    parent_id: null,
    title: "Saved question",
    markdown: "",
    base_url: null,
    base_url_source: null,
    origin: {
      selected_text: "stale standalone selection",
      question: "Saved while away?",
      lens: null,
      anchor: null,
      branch_type: "followup",
      attachment_assets: ["../escape.png", "source.pdf", "paste-saved.png"],
    },
    position: { x: 0, y: 0 },
    size: null,
    font_scale: 1,
    collapsed: false,
    status: "pending",
    read: false,
    created_at: "2026-08-13T00:00:00.000Z",
  };
  const laterChild = {
    ...child,
    id: "saved-child-later",
    title: "Later saved question",
    origin: { ...child.origin, question: "Does the next saved ask still arrive?", attachment_assets: [] },
    created_at: "2026-08-13T00:00:01.000Z",
  };

  await defaultFsStore.putAsset(holeId, "paste-saved.png", Buffer.from([5, 6, 7, 8]));

  await defaultFsStore.saveHole({
    hole_id: holeId,
    title: "MCP Rearm Saved",
    root_id: "root",
    created_at: new Date().toISOString(),
    nodes: [
      root,
      child,
      laterChild,
    ],
  });

  const saved = await openRabbithole({ holeId });
  assert.equal(saved.status, "branch_request");
  assert.equal(saved.saved, true);
  assert.equal(saved.node_id, "saved-child");
  assert.equal(saved.parent_node_id, "root", "saved standalone asks resume with root as their context source");
  assert.equal(saved.parent_node_title, "Root");
  assert.equal(saved.selected_text, "", "saved standalone asks retain whole-hole selection semantics");
  assert.deepEqual(saved.lineage, ["Root"]);
  assert.equal(saved.attachments.length, 1, "saved asks re-resolve their pasted images after restart");
  assert.equal(saved.attachments[0].kind, "image");
  assert.equal(saved.attachments[0].source, "pasted_image");
  assert.equal(path.isAbsolute(saved.attachments[0].image_path), true);
  await fs.realpath(saved.attachments[0].image_path);
  assert.deepEqual(await fs.readFile(saved.attachments[0].image_path), Buffer.from([5, 6, 7, 8]));
  assert(saved.rehydration, "first saved ask should include rehydration");
  assert.deepEqual(saved.rehydration.saved_asks, [{
    node_id: "saved-child", question: "Saved while away?", selected_text: "",
  }, {
    node_id: "saved-child-later", question: "Does the next saved ask still arrive?", selected_text: "",
  }]);

  const session = getSession(saved.session_id);
  assert(session, "cold resume should create a live session");
  assert.equal(session.queue.length, 1, "the later saved ask should already be queued behind the first delivery");

  const afterAnswer = await answerBranch({
    sessionId: saved.session_id,
    requestId: saved.request_id,
    title: "Saved answer",
    content: "Saved answer.",
  });
  assert.equal(afterAnswer.status, "branch_request", "a bad saved attachment name must not wedge the later saved-ask requeue");
  assert.equal(afterAnswer.node_id, "saved-child-later");
  assert.equal(afterAnswer.question, "Does the next saved ask still arrive?");
  const afterLaterAnswer = await answerBranch({
    sessionId: afterAnswer.session_id,
    requestId: afterAnswer.request_id,
    title: "Later saved answer",
    content: "Later saved answer.",
  });
  assert.equal(afterLaterAnswer.status, "keep_listening");
  assert.equal([...session.nodes.values()].filter((node) => node.status === "pending").length, 0);
  assert.equal(session.nodes.get("saved-child").parent_id, null, "answering a saved standalone ask keeps it disconnected");
  assert.equal(session.pendingByRequest.size, 0);
  assert.equal(session.inFlightBranchRequests.size, 0);

  const liveAgain = await openRabbithole({ holeId });
  assert.equal(liveAgain.status, "keep_listening");
  assert.equal(session.queue.length, 0, "live reattach should not requeue saved asks again");
  assert.equal(session.waiters.length, 0);

  console.log("ok rearm: invalid saved attachment names do not block valid delivery or later saved asks");
}

// The wire entry a note node should produce (standalone by default; anchored
// entries override on_node_id/on_selected_text, lineage entries add the flag).
function noteEntry(session, id, content, extra = {}) {
  return { note_id: id, on_node_id: null, on_selected_text: null, content, created_at: session.nodes.get(id).created_at, ...extra };
}

async function runNotesContextFixture() {
  const opened = await openRabbithole({ title: "MCP notes context", content: "Root note target" });
  const session = getSession(opened.session_id);
  assert(session);

  await session.handleBrowserEvent({
    type: "node_create",
    id: "replied-note",
    markdown: "Keep the target caveat in mind.",
    origin: { kind: "note" },
  });
  await session.handleBrowserEvent({
    type: "node_create",
    id: "ambient-note-one",
    markdown: "Relate this to the broader argument.",
    origin: { kind: "note" },
  });
  await session.handleBrowserEvent({
    type: "node_create",
    id: "ambient-note-two",
    markdown: "Compare this with the appendix.",
    origin: { kind: "note" },
  });
  assert.deepEqual(session.queue, [], "note creation must remain pull-only for the agent");

  await session.handleBrowserEvent({
    type: "branch_request",
    request_id: "notes-request",
    node_id: "notes-branch",
    parent_id: "replied-note",
    selected_text: "",
    question: "Expand on this note",
  });
  const branch = await openRabbithole({ holeId: session.holeId });
  const expectedNotes = [
    noteEntry(session, "replied-note", "Keep the target caveat in mind.", { on_lineage: true }),
    noteEntry(session, "ambient-note-one", "Relate this to the broader argument."),
    noteEntry(session, "ambient-note-two", "Compare this with the appendix."),
  ];
  assert.deepEqual(branch.notes, expectedNotes, "a live follow-up inside one of three notes delivers all three with the replied-to note flagged first");
  const expectedAllNotes = [
    noteEntry(session, "replied-note", "Keep the target caveat in mind."),
    ...expectedNotes.slice(1),
  ];

  const holeId = session.holeId;
  await session.close("notes_context_cold_resume");
  const resumed = await openRabbithole({ holeId });
  assert.equal(resumed.status, "branch_request");
  assert.equal(resumed.saved, true);
  assert.deepEqual(resumed.notes, expectedNotes, "saved branch delivery recomputes lineage-aware note context after cold resume");
  assert.deepEqual(resumed.rehydration.notes, expectedAllNotes, "cold resume carries all active notes without lineage presentation flags");
  assert.equal(resumed.rehydration.nodes.find((node) => node.id === "replied-note")?.kind, "note");
  assert.equal(resumed.rehydration.nodes.find((node) => node.id === "ambient-note-one")?.kind, "note");
  assert.equal(resumed.rehydration.nodes.find((node) => node.id === "ambient-note-two")?.kind, "note");
  assert.equal(Object.hasOwn(resumed.rehydration.nodes.find((node) => node.id === session.rootId), "kind"), false, "non-note rehydration nodes stay untagged");

  console.log("ok rearm notes: three-note reply thread, lineage flag, and cold-resume note rehydration");
}

async function runDoneNotesDeliveryFixture() {
  const opened = await openRabbithole({ title: "MCP notes on Done", content: "Root feedback target" });
  const session = getSession(opened.session_id);
  assert(session);

  await session.handleBrowserEvent({
    type: "node_create",
    id: "done-anchored-note",
    parent_id: session.rootId,
    markdown: "Tighten this paragraph.",
    origin: { kind: "note", selected_text: "feedback target", anchor: { offset_start: 5, offset_end: 20 } },
  });
  await session.handleBrowserEvent({
    type: "node_create",
    id: "done-standalone-note",
    markdown: "Check the conclusion too.",
    origin: { kind: "note" },
  });

  const blocked = session.waitForEvent();
  assert.equal(session.waiters.length, 1, "the agent call should be blocked before Done");
  assert.deepEqual(await session.handleBrowserEvent({ type: "done" }), { ok: true });
  assert.deepEqual(await blocked, {
    status: "session_closed",
    session_id: session.id,
    notes: [
      noteEntry(session, "done-standalone-note", "Check the conclusion too."),
      noteEntry(session, "done-anchored-note", "Tighten this paragraph.", { on_node_id: session.rootId, on_selected_text: "feedback target" }),
    ],
  }, "Done resolves the blocked agent call with every note in the hole");
  assert.equal(session.watchdogTimer, null, "session_closed delivery must not arm the answer watchdog");
  assert.equal(session.inFlightBranchRequests.size, 0, "session_closed delivery must not enter branch request tracking");

  console.log("ok rearm notes: Done delivers all notes without arming branch lifecycle state");
}

try {
  await runKeepListeningAndLiveReattachFixture();
  await runSavedAskRequeueFixture();
  await runNotesContextFixture();
  await runDoneNotesDeliveryFixture();
} finally {
  await closeAllSessions("mcp_rearm_test_complete");
}

console.log("MCP rearm verification passed");
