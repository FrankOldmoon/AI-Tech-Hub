console.log("===== PART 28: local draft (increment 13) =====");
var DKEY = "pw.draft";
function wipeDraft() { try { localStorage.removeItem(DKEY); } catch (e) {} }
/* these assertions use the origin's real storage, so put back whatever was there */
var __savedDraft = null;
try { __savedDraft = localStorage.getItem(DKEY); } catch (e) {}

wipeDraft();
eq(readDraft(), null, "DF1. an empty store has no draft");

eq(writeDraft("x = 1\n", 1000) ? "saved" : "refused", "saved", "DF2. a real program is saved");
var d1 = readDraft();
eq(d1 ? d1.code : "missing", "x = 1\n", "DF3. and reads back verbatim");
eq(d1 ? d1.at : -1, 1000, "DF4. the timestamp is kept");

eq(writeDraft(SAMPLE, 2000) ? "saved" : "cleared", "cleared", "DF5. content equal to the sample clears the entry");
eq(readDraft(), null, "DF6. so a deliberate reset cannot come back from the dead");

writeDraft("y = 2\n", 3000);
eq(writeDraft("", 4000) ? "saved" : "cleared", "cleared", "DF7. empty content clears the entry");
eq(readDraft(), null, "DF8. and nothing is restored afterwards");

writeDraft("z = 3\n", 5000);
eq(writeDraft("x".repeat(200001), 6000) ? "saved" : "refused", "refused", "DF9. an oversized paste is refused");
eq(readDraft(), null, "DF10. and does not leave a stale entry behind");

try { localStorage.setItem(DKEY, "{not json"); } catch (e) {}
eq(readDraft(), null, "DF11. a corrupt entry reads as no draft");
try { localStorage.setItem(DKEY, JSON.stringify({ at: 1 })); } catch (e) {}
eq(readDraft(), null, "DF12. an entry without code reads as no draft");
wipeDraft();

var shared = encodeCodeParam("link = 1\n");
eq(pickInitialCode("?code=" + shared, { code: "draft = 1\n", at: 9 }).from, "link", "DF13. a shared link wins over the draft");
eq(pickInitialCode("?code=" + shared, { code: "draft = 1\n", at: 9 }).code, "link = 1\n", "DF14. and its code is used");
eq(pickInitialCode("", { code: "draft = 1\n", at: 9 }).from, "draft", "DF15. without a link the draft is restored");
eq(pickInitialCode("", { code: "draft = 1\n", at: 9 }).at, 9, "DF16. with its timestamp, for the readout");
eq(pickInitialCode("", null).from, "sample", "DF17. with neither, the sample is shown");
eq(pickInitialCode("?run=1", undefined).from, "sample", "DF18. an unrelated query parameter does not count as a link");
try {
  if (__savedDraft === null) localStorage.removeItem(DKEY);
  else localStorage.setItem(DKEY, __savedDraft);
} catch (e) {}
eq(readDraft() ? "restored" : "clean", __savedDraft ? "restored" : "clean", "DF19. the harness leaves the origin's draft as it found it");
