import { test } from "node:test";
import assert from "node:assert/strict";

const { buildEmlBlob } = await import("../src/lib/emlBuilder.js");
const { renderEmailHtml, escapeHtml, DEFAULT_FROM_EMAIL } =
  await import("../src/lib/emailHtml.js");

const pdf = (name) => ({
  filename: name,
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
});

async function build(overrides = {}) {
  const blob = buildEmlBlob({
    from: "Capital Nutrition <mhart@capitalnutrition.ca>",
    to: "ap@example.com",
    subject: "Invoices - POs: 456628",
    body: "Dear team,\n\nPlease find attached.\n\nThanks",
    files: [pdf("Invoice_456628.pdf")],
    ...overrides,
  });
  return await blob.text();
}

/** Parse the boundary out of a Content-Type header line. */
function boundaryOf(eml, contentType) {
  const m = eml.match(
    new RegExp(`Content-Type: ${contentType}; boundary="([^"]+)"`)
  );
  assert.ok(m, `no ${contentType} part found`);
  return m[1];
}

test("body is sent as multipart/alternative with both text and html", async () => {
  const eml = await build();
  const alt = boundaryOf(eml, "multipart/alternative");

  const altBlock = eml.slice(
    eml.indexOf(`--${alt}\r\n`),
    eml.indexOf(`--${alt}--`)
  );
  assert.match(altBlock, /Content-Type: text\/plain; charset="UTF-8"/);
  assert.match(altBlock, /Content-Type: text\/html; charset="UTF-8"/);
  // Order matters: clients render the LAST alternative they understand, so
  // html must come after plain or Outlook shows the plain-text version.
  assert.ok(
    altBlock.indexOf("text/plain") < altBlock.indexOf("text/html"),
    "text/plain must precede text/html"
  );
});

test("attachments sit in the mixed part, not nested inside the alternative", async () => {
  const eml = await build({ files: [pdf("A.pdf"), pdf("B.pdf")] });
  const mixed = boundaryOf(eml, "multipart/mixed");
  const alt = boundaryOf(eml, "multipart/alternative");

  const altClose = eml.indexOf(`--${alt}--`);
  assert.ok(altClose > -1, "alternative part is never closed");

  for (const name of ["A.pdf", "B.pdf"]) {
    const at = eml.indexOf(`filename="${name}"`);
    assert.ok(at > -1, `${name} missing`);
    assert.ok(
      at > altClose,
      `${name} is nested inside multipart/alternative — Outlook would show no attachments`
    );
  }
  // Each attachment is introduced by the OUTER boundary.
  const outerParts = eml.split(`--${mixed}`).length - 1;
  assert.equal(outerParts, 4, "expected body part + 2 attachments + terminator");
  assert.ok(eml.trimEnd().endsWith(`--${mixed}--`));
});

test("the html part matches renderEmailHtml for the same body", async () => {
  const body = "Line one\nLine two\n\nSecond paragraph";
  const eml = await build({ body });
  const expected = renderEmailHtml({ body });
  // 7bit bodies are inlined verbatim (CRLF-normalised).
  assert.ok(
    eml.includes(expected.replace(/\n/g, "\r\n")),
    "html part does not match renderEmailHtml output"
  );
});

test("html escapes body content so a stray angle bracket cannot inject markup", () => {
  const html = renderEmailHtml({ body: 'PO <script>alert("x")</script> 12' });
  assert.ok(!html.includes("<script>"), "script tag survived escaping");
  assert.match(html, /&lt;script&gt;/);
  assert.equal(escapeHtml(`a&b<c>"d'e`), "a&amp;b&lt;c&gt;&quot;d&#39;e");
});

test("non-ASCII subject and body are encoded, not emitted raw", async () => {
  const eml = await build({
    subject: "Facture – Michèle",
    body: "Bonjour Michèle,\n\nMerci.",
  });
  assert.ok(!/Subject: .*è/.test(eml), "subject emitted raw non-ASCII");
  assert.match(eml, /Subject: =\?UTF-8\?B\?/);
  // The text/plain part specifically — not just the attachment, which is
  // always base64 and would satisfy a looser assertion.
  assert.match(
    eml,
    /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64/,
    "non-ASCII body still declared 7bit"
  );
  assert.ok(!eml.includes("Bonjour Michèle"), "utf-8 body emitted raw under a 7bit-ish part");
});

test("from falls back to the company mailbox when none is supplied", async () => {
  const eml = await build({ from: "" });
  assert.ok(eml.includes(`From: ${DEFAULT_FROM_EMAIL}`), eml.slice(0, 200));
});

test("an empty attachment does not throw", async () => {
  const eml = await build({ files: [{ filename: "empty.pdf", bytes: new Uint8Array(0) }] });
  assert.match(eml, /filename="empty\.pdf"/);
});
