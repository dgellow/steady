import { assertEquals } from "@std/assert";
import { encodeHeaderText, encodeUriReference } from "./http-header.ts";

Deno.test("encodeHeaderText", async (t) => {
  await t.step("printable ASCII is unchanged", () => {
    const text = "Method DELETE not allowed for /users/{id} (expected: a, b)";
    assertEquals(encodeHeaderText(text), text);
  });

  await t.step("non-ASCII text becomes percent-encoded UTF-8", () => {
    assertEquals(
      encodeHeaderText("Unknown property '名前'"),
      "Unknown property '%e5%90%8d%e5%89%8d'",
    );
  });

  await t.step("control characters are encoded", () => {
    assertEquals(encodeHeaderText("a\nb\r\tc\x7f\x00"), "a%0ab%0d%09c%7f%00");
  });

  await t.step("the percent sign is encoded so decoding is unambiguous", () => {
    assertEquals(encodeHeaderText("/%E5 100%"), "/%25E5 100%25");
  });

  await t.step("decodeURIComponent restores the original text", () => {
    for (
      const text of [
        "plain",
        "名前",
        `emoji \u{1F600} and em-dash ${String.fromCodePoint(0x2014)}`,
        "line\nbreak",
        "100% of /%E5%90%8D",
        "latin-1 café",
      ]
    ) {
      assertEquals(decodeURIComponent(encodeHeaderText(text)), text);
    }
  });

  await t.step("every result is accepted by Headers.set", () => {
    const headers = new Headers();
    for (let codePoint = 0; codePoint < 0x3000; codePoint++) {
      headers.set("X-Test", encodeHeaderText(String.fromCodePoint(codePoint)));
    }
    // An unpaired surrogate cannot be encoded as UTF-8; it must still not throw.
    headers.set("X-Test", encodeHeaderText("\ud800"));
  });
});

Deno.test("encodeUriReference", async (t) => {
  await t.step("ASCII references and existing escapes are unchanged", () => {
    assertEquals(
      encodeUriReference("/caf%C3%A9?x=1&y=%20#frag"),
      "/caf%C3%A9?x=1&y=%20#frag",
    );
    assertEquals(
      encodeUriReference("https://example.com/a/b"),
      "https://example.com/a/b",
    );
  });

  await t.step("non-ASCII, spaces and control characters are escaped", () => {
    assertEquals(
      encodeUriReference("/名前?q=a b\n"),
      "/%E5%90%8D%E5%89%8D?q=a%20b%0A",
    );
  });
});
